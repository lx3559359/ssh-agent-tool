import {
  isServerMaintenanceQuickCommand,
  rollbackScriptDirectory,
  rollbackScriptFilenameMaxLength,
  validateAndNormalizeQuickCommandParams as validateAndNormalizeMaintenanceParams,
  validateQuickCommandParams as validateMaintenanceQuickCommandParams
} from './server-maintenance/shared/validation.js'
import {
  buildMutationSafetyCommand,
  createMutationSafetyMetadata
} from './server-maintenance/shared/safety-metadata.js'
import {
  getValidatedCommandSafetyMetadata
} from './server-maintenance/shared/definition.js'
import {
  buildPacketFilterArguments,
  hardenMutationCommand
} from './server-maintenance/shared/command-builders.js'
import {
  createInternalMaintenanceRecoveryIntent,
  isMaintenanceRecoveryQuickCommand
} from '../../common/safety-transactions/maintenance-recovery-delegation.js'

const quickCommandSessionMismatchMessage = '当前服务器已切换，请重新打开快捷命令后再执行'

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

function stablePathDigest (value) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function boundRollbackFilename (filename) {
  if (filename.length <= rollbackScriptFilenameMaxLength) return filename
  const timestampSuffix = filename.match(/-[0-9]+\.sh$/)?.[0] || '.sh'
  const stem = filename.slice(0, -timestampSuffix.length)
  const digest = stablePathDigest(filename)
  const visibleLength = rollbackScriptFilenameMaxLength -
    timestampSuffix.length - digest.length - 1
  return `${stem.slice(0, visibleLength)}-${digest}${timestampSuffix}`
}

function boundRollbackPath (rollbackPath) {
  const prefix = `${rollbackScriptDirectory}/`
  if (!rollbackPath.startsWith(prefix)) return rollbackPath
  const filename = rollbackPath.slice(prefix.length)
  if (filename.includes('/')) return rollbackPath
  return prefix + boundRollbackFilename(filename)
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
    return buildPacketFilterArguments(custom || 'tcp')
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
  const rollbackPath = boundRollbackPath(
    `${rollbackScriptDirectory}/network-${safeHost}-${Date.now()}.sh`
  )
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

export function buildQuickCommandContextIdentity (context = {}) {
  return JSON.stringify([
    toStringValue(context.username),
    toStringValue(context.host),
    toStringValue(context.port)
  ])
}

export function buildQuickCommandRollbackContext (item = {}, context = {}) {
  if (!item.mutatesServer) {
    return context
  }
  const commandPart = safePathPart(
    String(item.id || 'change').replace(/^builtin-server-/, '')
  )
  const currentPath = context.rollbackPath || '/tmp/shellpilot-rollback/change-server.sh'
  const rollbackPath = boundRollbackPath(currentPath.replace(
    /\/network-([^/]+)\.sh$/,
    `/${commandPart}-$1.sh`
  ))
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

function resolveMutationSafetyMetadata (values, context, item) {
  const metadata = getValidatedCommandSafetyMetadata(item)
  const resolve = text => applyQuickCommandParamValues(text, values, context)
  const rollbackParam = item.rollback?.pathParam
  const rollbackScript = rollbackParam ? values[rollbackParam] : metadata.rollbackScript
  return createMutationSafetyMetadata({
    title: metadata.title,
    backupTargets: metadata.backupTargets.map(resolve),
    verifyCommands: metadata.verifyCommands.map(resolve),
    rollbackScript: rollbackScript ? resolve(rollbackScript) : undefined
  })
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
    paramValues,
    context,
    item
  )
  const mutationCommand = hardenMutationCommand(item.id, commandText)
  return buildMutationSafetyCommand(safetyMetadata, mutationCommand)
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
  const hasValidationErrors = Object.keys(validation.errors).length > 0
  const canBuildText = !hasValidationErrors || !shouldTrackRollback(
    pendingCommand.item,
    validation.values
  )

  return {
    ...pendingCommand,
    paramValues: nextValues,
    paramErrors,
    text: canBuildText
      ? buildQuickCommandText(
        pendingCommand.item,
        pendingCommand.context,
        validation.values
      )
      : pendingCommand.text
  }
}

export function validateQuickCommandSession (pendingCommand = {}, activeSession) {
  if (activeSession === undefined) return ''
  const boundTabId = toStringValue(pendingCommand.boundTabId)
  const activeTabId = toStringValue(activeSession?.tabId)
  const boundContextIdentity = toStringValue(pendingCommand.contextIdentity)
  const activeContextIdentity = toStringValue(activeSession?.contextIdentity)
  const pendingCommandId = toStringValue(pendingCommand.id)
  const activeCommandId = toStringValue(activeSession?.commandId)
  if (!boundTabId || !activeTabId || !boundContextIdentity || !activeContextIdentity) {
    return quickCommandSessionMismatchMessage
  }
  if (boundTabId !== activeTabId || boundContextIdentity !== activeContextIdentity ||
    (activeCommandId && activeCommandId !== pendingCommandId)) {
    return quickCommandSessionMismatchMessage
  }
  return ''
}

export function submitValidatedQuickCommand (pendingCommand = {}, submit, activeSession) {
  const sessionError = validateQuickCommandSession(pendingCommand, activeSession)
  if (sessionError) {
    return {
      submitted: false,
      errors: pendingCommand.paramErrors || {},
      paramValues: pendingCommand.paramValues || {},
      commandText: '',
      sessionError
    }
  }
  const item = pendingCommand.item || {}
  const validation = validateAndNormalizeMaintenanceParams(
    item,
    pendingCommand.paramValues || {}
  )
  if (Object.keys(validation.errors).length) {
    return {
      submitted: false,
      errors: validation.errors,
      paramValues: validation.values,
      commandText: ''
    }
  }
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

  if (!commandText.trim()) {
    return result
  }
  if (typeof submit !== 'function') {
    throw new Error('快捷命令执行入口不可用')
  }
  let maintenanceRecoveryIntent
  if (shouldTrackRollback(item, validation.values) &&
    isMaintenanceRecoveryQuickCommand(item.id)) {
    const safetyMetadata = resolveMutationSafetyMetadata(
      validation.values,
      pendingCommand.context,
      item
    )
    maintenanceRecoveryIntent = createInternalMaintenanceRecoveryIntent({
      quickCommandId: item.id,
      command: commandText,
      title: item.name,
      rollbackPath: safetyMetadata.rollbackScript,
      endpoint: {
        tabId: pendingCommand.boundTabId,
        host: pendingCommand.context?.host,
        port: pendingCommand.context?.port,
        username: pendingCommand.context?.username
      },
      backupTargets: safetyMetadata.backupTargets,
      verification: safetyMetadata.verifyCommands
    })
  }
  submit(pendingCommand.id, {
    commandText,
    inputOnly: pendingCommand.inputOnly,
    confirmed: true,
    tabId: pendingCommand.boundTabId,
    ...(maintenanceRecoveryIntent ? { maintenanceRecoveryIntent } : {})
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
