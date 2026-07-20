import {
  isServerMaintenanceQuickCommand,
  validateAndNormalizeQuickCommandParams as validateAndNormalizeMaintenanceParams,
  validateQuickCommandParams as validateMaintenanceQuickCommandParams
} from './server-maintenance/shared/validation.js'
import {
  buildMutationSafetyCommand
} from './server-maintenance/shared/safety-metadata.js'

function toStringValue (value, fallback = '') {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  return String(value)
}

function isIpLike (value) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[0-9a-f:]+$/i.test(value)
}

function safePathPart (value) {
  return toStringValue(value, 'server')
    .trim()
    .replace(/[^a-zA-Z0-9.-]+/g, '-')
    .replace(/\./g, '-')
    .replace(/^-+|-+$/g, '') || 'server'
}

function replaceQuickCommandPlaceholders (text = '', replacements = {}) {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const name = key.trim()
    return replacements[name] ?? match
  })
}

function buildDefaultReplacements (context = {}) {
  return {
    服务器: context.title || '当前服务器',
    服务器IP: context.host || '1.2.3.4',
    目标IP: context.host || '1.2.3.4',
    端口: context.port || '80',
    协议: context.protocol || 'tcp',
    网卡: context.packetInterface || 'any',
    过滤条件: context.packetFilter || 'port 80',
    数量: context.packetCount || '100',
    抓包文件: context.capturePath || '/tmp/shellpilot-capture.pcap',
    回滚脚本: context.rollbackPath || '/tmp/shellpilot-rollback/network-current.sh',
    域名: context.defaultDomain || 'example.com',
    服务名: context.defaultService || 'nginx',
    日志路径: context.defaultLogPath || '/var/log',
    关键词: context.defaultKeyword || 'error'
  }
}

function getPacketFilterFromParams (values = {}) {
  const type = toStringValue(values.过滤类型, 'tcp').trim()
  const port = toStringValue(values.过滤端口).trim()
  const ip = toStringValue(values.过滤IP).trim()
  const custom = toStringValue(values.自定义过滤).trim()

  if (type === 'port') {
    return port ? `port ${port}` : 'tcp'
  }
  if (type === 'ip') {
    return ip ? `host ${ip}` : 'tcp'
  }
  if (type === 'ip-port') {
    if (ip && port) {
      return `host ${ip} and port ${port}`
    }
    return ip ? `host ${ip}` : (port ? `port ${port}` : 'tcp')
  }
  if (type === 'custom') {
    return custom || 'tcp'
  }
  return 'tcp'
}

function normalizeParamValues (values = {}) {
  return Object.entries(values).reduce((acc, [key, value]) => {
    acc[key] = toStringValue(value)
    return acc
  }, {})
}

export function validateQuickCommandParams (item = {}, values = {}) {
  return validateMaintenanceQuickCommandParams(item, values)
}

export function validateAndNormalizeQuickCommandParams (item = {}, values = {}) {
  return validateAndNormalizeMaintenanceParams(item, values)
}

export function clearQuickCommandParamError (paramErrors = {}, name) {
  if (!paramErrors || typeof paramErrors !== 'object') return {}
  const nextErrors = { ...paramErrors }
  delete nextErrors[name]
  return nextErrors
}

export function buildQuickCommandContext (tab = {}) {
  const host = toStringValue(tab.host || tab.hostname || tab.ip)
  const port = toStringValue(tab.port || tab.sshPort, '22')
  const username = toStringValue(tab.username || tab.user)
  const title = toStringValue(tab.title || tab.name || host, host || '当前服务器')
  const safeHost = safePathPart(host || title)
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const capturePath = `/tmp/shellpilot-capture-${safeHost}-${timestamp}.pcap`
  const rollbackPath = `/tmp/shellpilot-rollback/network-${safeHost}-${Date.now()}.sh`
  const defaultDomain = host && !isIpLike(host) ? host : 'example.com'
  const packetFilter = 'tcp'

  return {
    host,
    port,
    username,
    title,
    protocol: 'tcp',
    packetInterface: 'any',
    packetCount: '50',
    packetFilter,
    capturePath,
    rollbackPath,
    defaultDomain,
    defaultService: 'nginx',
    defaultLogPath: '/var/log',
    defaultKeyword: 'error'
  }
}

export function buildQuickCommandRollbackContext (item = {}, context = {}) {
  if (!item.mutatesServer) {
    return context
  }
  const commandPart = safePathPart(
    String(item.id || 'change').replace(/^builtin-server-/, '')
  )
  const currentPath = context.rollbackPath || '/tmp/shellpilot-rollback/change-server.sh'
  const rollbackPath = currentPath.replace(
    /\/network-([^/]+)\.sh$/,
    `/${commandPart}-$1.sh`
  )
  return {
    ...context,
    rollbackPath
  }
}

export function shouldTrackRollback (item = {}, values = {}) {
  if (!item.mutatesServer || !item.rollback) {
    return false
  }
  const {
    actionParam,
    mutatingValues = [],
    confirmParam,
    confirmValue
  } = item.rollback
  if (confirmParam && values[confirmParam] !== confirmValue) {
    return false
  }
  return !actionParam || mutatingValues.includes(values[actionParam])
}

export function describeQuickCommandContext (context = {}) {
  const userHost = [
    context.username,
    context.host
  ].filter(Boolean).join('@')
  const target = userHost || context.title || '当前连接'
  const port = context.port ? `:${context.port}` : ''
  return `${target}${port}`
}

export function applyQuickCommandDefaults (text = '', context = {}) {
  return replaceQuickCommandPlaceholders(text, buildDefaultReplacements(context))
}

export function resolveQuickCommandParamDefault (param = {}, context = {}) {
  return applyQuickCommandDefaults(toStringValue(param.defaultValue), context)
}

export function buildQuickCommandParamValues (item = {}, context = {}) {
  return (item.params || []).reduce((acc, param) => {
    acc[param.name] = resolveQuickCommandParamDefault(param, context)
    return acc
  }, {})
}

export function applyQuickCommandParamValues (text = '', values = {}, context = {}) {
  const paramValues = normalizeParamValues(values)
  const packetFilter = getPacketFilterFromParams(paramValues)
  const replacements = {
    ...buildDefaultReplacements({
      ...context,
      packetInterface: toStringValue(paramValues.网卡, context.packetInterface || 'any'),
      packetFilter,
      packetCount: toStringValue(paramValues.数量, context.packetCount || '50'),
      capturePath: toStringValue(paramValues.抓包文件, context.capturePath)
    }),
    ...paramValues,
    网卡: toStringValue(paramValues.网卡, context.packetInterface || 'any'),
    过滤类型: toStringValue(paramValues.过滤类型, 'tcp'),
    过滤端口: toStringValue(paramValues.过滤端口),
    过滤IP: toStringValue(paramValues.过滤IP),
    自定义过滤: toStringValue(paramValues.自定义过滤),
    过滤条件: packetFilter,
    数量: toStringValue(paramValues.数量, context.packetCount || '50'),
    抓包文件: toStringValue(paramValues.抓包文件, context.capturePath)
  }

  return replaceQuickCommandPlaceholders(text, replacements)
}

function resolveMutationSafetyMetadata (metadata, values, context) {
  if (!metadata) {
    throw new Error('修改命令缺少安全元数据')
  }
  const resolve = text => applyQuickCommandParamValues(text, values, context)
  return {
    ...metadata,
    backupTargets: metadata.backupTargets.map(resolve),
    verifyCommands: metadata.verifyCommands.map(resolve)
  }
}

export function buildQuickCommandText (item = {}, context = {}, paramValues = {}) {
  const text = item.commands?.length
    ? item.commands.map(commandStep => commandStep.command).join('\n')
    : item.command || ''
  let commandText
  if (item.params?.length) {
    commandText = applyQuickCommandParamValues(text, paramValues, context)
  } else {
    commandText = applyQuickCommandDefaults(text, context)
  }
  if (!shouldTrackRollback(item, paramValues)) {
    return commandText
  }
  const safetyMetadata = resolveMutationSafetyMetadata(
    item.safetyMetadata,
    paramValues,
    context
  )
  return buildMutationSafetyCommand(safetyMetadata, commandText)
}

function sameParamValue (left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function updatePendingQuickCommandParams (pendingCommand, nextValues = {}) {
  if (!pendingCommand) return pendingCommand
  const currentValues = pendingCommand.paramValues || {}
  const changedNames = (pendingCommand.item?.params || [])
    .map(param => param.name)
    .filter(name => !sameParamValue(currentValues[name], nextValues[name]))
  const validation = validateAndNormalizeMaintenanceParams(
    pendingCommand.item,
    nextValues
  )
  const paramErrors = { ...(pendingCommand.paramErrors || {}) }

  for (const name of changedNames) {
    if (validation.errors[name]) {
      paramErrors[name] = validation.errors[name]
    } else {
      delete paramErrors[name]
    }
  }

  return {
    ...pendingCommand,
    paramValues: nextValues,
    paramErrors,
    text: buildQuickCommandText(
      pendingCommand.item,
      pendingCommand.context,
      validation.values
    )
  }
}

export function submitValidatedQuickCommand (pendingCommand = {}, submit) {
  const item = pendingCommand.item || {}
  const validation = validateAndNormalizeMaintenanceParams(
    item,
    pendingCommand.paramValues || {}
  )
  const rebuildText = isServerMaintenanceQuickCommand(item) ||
    (item.params || []).some(param => param.validationType)
  const commandText = rebuildText
    ? buildQuickCommandText(item, pendingCommand.context, validation.values)
    : toStringValue(pendingCommand.text)
  const result = {
    submitted: false,
    errors: validation.errors,
    paramValues: validation.values,
    commandText
  }

  if (Object.keys(validation.errors).length || !commandText.trim()) {
    return result
  }
  if (typeof submit !== 'function') {
    throw new Error('快捷命令执行入口不可用')
  }
  submit(pendingCommand.id, {
    commandText,
    inputOnly: pendingCommand.inputOnly,
    confirmed: true
  })
  return { ...result, submitted: true }
}

export function buildAdvancedUsage (item = {}, context = {}) {
  const paramValues = buildQuickCommandParamValues(item, context)
  return (item.advancedUsage || [])
    .map(text => {
      if (item.params?.length) {
        return applyQuickCommandParamValues(text, paramValues, context)
      }
      return applyQuickCommandDefaults(text, context)
    })
}
