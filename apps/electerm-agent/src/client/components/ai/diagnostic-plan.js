import { redactAuditText } from '../../common/safety-transactions/audit-redaction.js'
import { classifyCommand } from '../../common/safety-transactions/command-classifier.js'
import {
  buildEndpointKey,
  normalizeEndpoint
} from '../../common/safety-transactions/endpoint-guard.js'

const maxPlanSteps = 10
const maxListItems = 10
const maxSummaryLength = 1000
const maxTitleLength = 160
const maxPurposeLength = 500
const maxCommandLength = 2000
const maxSignalLength = 500
const maxContextTextLength = 2000
const maxContextItems = 20
const maxPromptLength = 20000
const targetScalarFields = [
  'id',
  'name',
  'unit',
  'service',
  'status',
  'state',
  'activeState',
  'subState',
  'loadState',
  'description',
  'code',
  'target',
  'pid',
  'mainPid',
  'process',
  'command',
  'protocol',
  'address',
  'port',
  'ports',
  'cpuPercent',
  'memoryPercent',
  'value',
  'message',
  'workingDirectory',
  'fragmentPath',
  'execStart',
  'image',
  'composeProject',
  'composeWorkingDirectory',
  'engine',
  'confidence'
]
const endpointSessionFields = [
  'tabId',
  'pid',
  'terminalPid',
  'sessionType',
  'title'
]

function isObject (value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeText (value, limit = maxContextTextLength) {
  return redactAuditText(String(value ?? '')).slice(0, limit)
}

function requiredText (value, label, limit) {
  const text = safeText(value, limit + 1).trim()
  if (!text) throw new Error(`${label}不能为空。`)
  if (text.length > limit) throw new Error(`${label}长度不能超过 ${limit} 个字符。`)
  return text
}

function optionalScalar (value) {
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return safeText(value)
  return undefined
}

function compactObject (source = {}) {
  const result = {}
  for (const field of targetScalarFields) {
    const value = optionalScalar(source[field])
    if (value !== undefined && value !== '') result[field] = value
  }
  if (Array.isArray(source.installPaths)) {
    result.installPaths = source.installPaths
      .slice(0, maxListItems)
      .map(value => safeText(value, 500))
      .filter(Boolean)
  }
  if (Array.isArray(source.evidence)) {
    result.evidence = source.evidence.slice(0, maxListItems).map(item => {
      if (!isObject(item)) return safeText(item, 500)
      return Object.fromEntries(Object.entries(item).slice(0, 8).map(([key, value]) => [
        safeText(key, 80),
        typeof value === 'number' || typeof value === 'boolean'
          ? value
          : safeText(value, 500)
      ]))
    })
  }
  return result
}

function targetCandidates (snapshot, type) {
  if (type === 'alert') return snapshot.alerts || []
  if (type === 'service') {
    return [
      ...(snapshot.services || []),
      ...(snapshot.platforms || []).flatMap(platform => platform.services || [])
    ]
  }
  if (type === 'container') {
    return [
      ...(snapshot.containers || []),
      ...(snapshot.platforms || []).flatMap(platform => platform.containers || [])
    ]
  }
  if (type === 'platform') return snapshot.platforms || []
  return []
}

function identityValues (value = {}) {
  const values = [
    value.id,
    value.name,
    value.unit,
    value.service,
    value.target,
    value.process,
    value.composeProject
  ]
  return values.map(item => String(item || '').trim()).filter(Boolean)
}

function findTarget (snapshot, target) {
  const type = String(target?.type || target?.kind || '').trim().toLowerCase()
  if (!['alert', 'service', 'container', 'platform'].includes(type)) {
    throw new Error('诊断目标类型无效。')
  }
  if (isObject(target.data || target.item)) {
    return { type, value: target.data || target.item }
  }
  const requested = new Set(identityValues(target).map(value => value.toLowerCase()))
  const value = targetCandidates(snapshot, type).find(item => {
    return identityValues(item).some(identity => requested.has(identity.toLowerCase()))
  })
  if (!value) throw new Error('在当前状态快照中找不到诊断目标。')
  return { type, value }
}

function addIdentity (sets, value) {
  const identity = String(value || '').trim().toLowerCase()
  if (!identity) return
  sets.exact.add(identity)
  if (identity.length >= 3) sets.fuzzy.add(identity)
  const withoutSuffix = identity.replace(/\.(?:service|socket|target)$/, '')
  if (withoutSuffix.length >= 3) sets.fuzzy.add(withoutSuffix)
}

function mappedContainerPorts (value) {
  if (Array.isArray(value)) return value.flatMap(mappedContainerPorts)
  if (isObject(value)) {
    return ['hostPort', 'published', 'containerPort', 'target']
      .flatMap(field => mappedContainerPorts(value[field]))
  }
  if (typeof value === 'number') return [value]
  const ports = []
  for (const segment of String(value || '').split(',')) {
    const text = segment.trim()
    if (!text) continue
    const mapping = text.split('->')
    if (mapping.length === 2) {
      const host = mapping[0].trim().match(/(?:^|:)(\d{1,5})$/)
      const container = mapping[1].trim().match(/^(\d{1,5})(?:\/[a-z0-9]+)?$/i)
      if (host) ports.push(Number(host[1]))
      if (container) ports.push(Number(container[1]))
      continue
    }
    const exposed = text.match(/^(\d{1,5})(?:\/[a-z0-9]+)?$/i)
    if (exposed) ports.push(Number(exposed[1]))
  }
  return ports
}

function buildTargetIdentity (type, target) {
  const sets = { exact: new Set(), fuzzy: new Set(), pids: new Set(), ports: new Set() }
  const items = [
    target,
    ...(type === 'platform' ? target.services || [] : []),
    ...(type === 'platform' ? target.containers || [] : [])
  ]
  for (const item of items) {
    for (const identity of identityValues(item)) addIdentity(sets, identity)
    for (const field of ['pid', 'mainPid']) {
      const pid = Number(item?.[field])
      if (Number.isInteger(pid) && pid > 0) sets.pids.add(pid)
    }
    for (const value of mappedContainerPorts([item?.port, item?.ports])) {
      const port = Number(value)
      if (Number.isInteger(port) && port > 0 && port <= 65535) sets.ports.add(port)
    }
  }
  return sets
}

function matchesIdentity (value, identity) {
  const text = String(value || '').toLowerCase()
  if (!text) return false
  if (identity.exact.has(text.trim())) return true
  return [...identity.fuzzy].some(item => {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(text)
  })
}

function matchesRelatedItem (item, identity) {
  if (!item) return false
  const pid = Number(item.pid ?? item.mainPid)
  if (identity.pids.has(pid)) return true
  const port = Number(item.port)
  if (identity.ports.has(port)) return true
  return [
    item.id,
    item.name,
    item.unit,
    item.service,
    item.target,
    item.message,
    item.process,
    item.command,
    item.composeProject,
    item.image
  ].some(value => matchesIdentity(value, identity))
}

function boundedRelatedItems (items, identity, limit = maxContextItems) {
  return items.filter(item => matchesRelatedItem(item, identity))
    .slice(0, limit)
    .map(item => compactObject(item))
}

function logValues (value) {
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap(item => String(item || '').replace(/\r/g, '').split('\n'))
}

function relatedLogs (snapshot, target, identity) {
  const lines = []
  for (const field of ['recentLogs', 'logs', 'log', 'tail', 'logOutput']) {
    lines.push(...logValues(target[field]))
  }
  if (isObject(snapshot.recentLogs)) {
    for (const [key, value] of Object.entries(snapshot.recentLogs)) {
      if (matchesIdentity(key, identity)) lines.push(...logValues(value))
    }
  } else if (Array.isArray(snapshot.recentLogs)) {
    for (const item of snapshot.recentLogs) {
      if (matchesRelatedItem(item, identity)) {
        lines.push(...logValues(item.lines || item.output || item.message))
      }
    }
  }
  for (const probe of snapshot.probes || []) {
    for (const line of logValues([probe.rawOutput, probe.stderr])) {
      if (matchesIdentity(line, identity)) lines.push(line)
    }
  }
  return [...new Set(lines.map(line => safeText(line, 1000).trim()).filter(Boolean))]
    .slice(0, maxContextItems)
}

function allListeningPorts (snapshot) {
  return [
    ...(snapshot.network?.listeningPorts || []),
    ...(snapshot.networks || []).flatMap(network => network.listeningPorts || [])
  ]
}

function allContainers (snapshot) {
  return [
    ...(snapshot.containers || []),
    ...(snapshot.platforms || []).flatMap(platform => platform.containers || [])
  ]
}

function boundJsonValue (value, options, depth = 0) {
  if (typeof value === 'string') return value.slice(0, options.stringLimit)
  if (Array.isArray(value)) {
    return value
      .slice(0, options.itemLimit)
      .map(item => boundJsonValue(item, options, depth + 1))
  }
  if (!isObject(value) || depth > 8) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    boundJsonValue(item, options, depth + 1)
  ]))
}

function stringifyBoundedContext (context, limit) {
  const bounds = [
    { stringLimit: 2000, itemLimit: 20 },
    { stringLimit: 1000, itemLimit: 15 },
    { stringLimit: 500, itemLimit: 10 },
    { stringLimit: 240, itemLimit: 8 },
    { stringLimit: 120, itemLimit: 5 },
    { stringLimit: 60, itemLimit: 3 }
  ]
  for (const options of bounds) {
    const serialized = JSON.stringify(boundJsonValue(context, options), null, 2)
    if (serialized.length <= limit) return serialized
  }
  throw new Error('定向诊断上下文超过安全上限，无法生成完整请求。')
}

function safeEndpoint (endpoint = {}) {
  const normalized = normalizeEndpoint(endpoint)
  const result = { ...normalized }
  for (const field of endpointSessionFields) {
    const value = optionalScalar(endpoint[field])
    if (value !== undefined && value !== '') result[field] = value
  }
  return result
}

function boundedStringList (value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组。`)
  if (value.length < 1 || value.length > maxListItems) {
    throw new Error(`${label} 必须包含 1 到 ${maxListItems} 项。`)
  }
  return value.map((item, index) => {
    return requiredText(item, `${label}[${index}]`, maxSignalLength)
  })
}

export function buildTargetedDiagnosticContext ({ snapshot = {}, target = {} } = {}) {
  const resolved = findTarget(snapshot, target)
  const identity = buildTargetIdentity(resolved.type, resolved.value)
  const contextTarget = {
    type: resolved.type,
    ...compactObject(resolved.value)
  }
  if (resolved.type === 'platform') {
    contextTarget.services = (resolved.value.services || [])
      .slice(0, maxListItems)
      .map(compactObject)
    contextTarget.containers = (resolved.value.containers || [])
      .slice(0, maxListItems)
      .map(compactObject)
  }
  return {
    endpoint: safeEndpoint(snapshot.endpoint || {}),
    target: contextTarget,
    recentLogs: relatedLogs(snapshot, resolved.value, identity),
    listeningPorts: boundedRelatedItems(allListeningPorts(snapshot), identity),
    processes: boundedRelatedItems(snapshot.resources?.processes || [], identity),
    containers: boundedRelatedItems(allContainers(snapshot), identity, maxListItems),
    alerts: boundedRelatedItems(snapshot.alerts || [], identity, maxListItems)
  }
}

export function buildTargetedDiagnosticPrompt (input = {}) {
  const context = buildTargetedDiagnosticContext(input)
  const prefix = [
    '你是 ShellPilot 的只读服务器异常诊断规划器。',
    '只能根据下方单个目标上下文制定诊断计划，不得推测或请求整台服务器的其他输出。',
    '所有 command 必须是静态、无换行、无凭据、不会修改任何状态的只读命令。',
    '禁止重启、停止、写文件、安装、删除、修改权限、动态 shell 展开或脚本解释器。',
    '只能返回一个 JSON 对象，不能使用 Markdown、解释文字或多个对象。',
    'JSON 结构必须为：',
    '{"summary":"中文结论","steps":[{"id":"ascii-id","title":"中文标题","purpose":"诊断目的","command":"完整只读命令","timeoutMs":15000}],"expectedSignals":["预期信号"],"stopConditions":["停止条件"]}',
    'steps 必须为 1 到 10 步，timeoutMs 必须为 1000 到 60000。',
    '',
    '单目标上下文：'
  ].join('\n')
  const contextJson = stringifyBoundedContext(context, maxPromptLength - prefix.length - 1)
  return `${prefix}\n${contextJson}`
}

export function validateDiagnosticPlan (plan = {}, options = {}) {
  if (!isObject(plan)) throw new Error('AI 诊断计划必须是 JSON 对象。')
  if (!Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > maxPlanSteps) {
    throw new Error('AI 诊断计划必须包含 1 到 10 个步骤。')
  }
  const ids = new Set()
  const titles = new Set()
  const commands = new Set()
  const steps = plan.steps.map((step, index) => {
    if (!isObject(step)) throw new Error(`步骤 ${index + 1} 格式无效。`)
    const id = step.id === undefined
      ? `diagnostic-${index + 1}`
      : requiredText(step.id, `步骤 ${index + 1} id`, 64)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(id)) {
      throw new Error(`步骤 ${index + 1} id 只能使用 ASCII 字母、数字及 ._:-。`)
    }
    if (ids.has(id)) throw new Error(`步骤 id 重复：${id}`)
    ids.add(id)
    const title = requiredText(step.title, `步骤 ${id} title（标题）`, maxTitleLength)
    const purpose = requiredText(step.purpose, `步骤 ${id} purpose（目的）`, maxPurposeLength)
    const titleKey = title.toLowerCase()
    if (titles.has(titleKey)) throw new Error(`步骤标题重复：${title}`)
    titles.add(titleKey)
    const command = String(step.command ?? '')
    if (!command.trim()) throw new Error(`步骤 ${id} command 不能为空。`)
    if (command.length > maxCommandLength) {
      throw new Error(`步骤 ${id} command 长度不能超过 ${maxCommandLength} 个字符。`)
    }
    if (/[\0\r\n]/.test(command)) throw new Error(`步骤 ${id} command 包含换行或 NUL。`)
    if (redactAuditText(command) !== command) {
      throw new Error(`步骤 ${id} command 包含疑似凭据。`)
    }
    const commandKey = command.trim()
    if (commands.has(commandKey)) throw new Error(`步骤命令重复：${commandKey}`)
    commands.add(commandKey)
    const timeoutSeconds = Number(step.timeoutSeconds ?? step.timeout)
    if (step.timeoutMs === undefined && !Number.isInteger(timeoutSeconds)) {
      throw new Error(`步骤 ${id} 超时必须是 1 到 60 之间的整数秒。`)
    }
    const timeoutMs = step.timeoutMs === undefined
      ? timeoutSeconds * 1000
      : Number(step.timeoutMs)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
      throw new Error(`步骤 ${id} timeoutMs 必须是 1000 到 60000 之间的整数。`)
    }
    const classification = classifyCommand(command)
    if (classification.risk !== 'readonly') {
      throw new Error(`步骤 ${id} 不是只读命令：${classification.reason}`)
    }
    return {
      id,
      title,
      purpose,
      command,
      timeoutMs,
      risk: classification.risk,
      readOnly: true,
      reason: classification.reason
    }
  })
  const result = {
    summary: requiredText(plan.summary, 'summary（摘要）', maxSummaryLength),
    steps,
    expectedSignals: boundedStringList(plan.expectedSignals, 'expectedSignals（预期信号）'),
    stopConditions: boundedStringList(plan.stopConditions, 'stopConditions（停止条件）')
  }
  if (options.endpoint) {
    result.endpoint = safeEndpoint(options.endpoint)
    result.endpointKey = buildEndpointKey(result.endpoint)
  }
  if (options.target) {
    result.target = {
      type: safeText(options.target.type || options.target.kind, 40),
      ...compactObject(options.target.data || options.target.item || options.target)
    }
  }
  return result
}

export function parseDiagnosticPlan (value, options = {}) {
  const text = String(value ?? '').replace(/^\uFEFF/, '').trim()
  if (!text) throw new Error('AI 未返回诊断计划。')
  const fence = text.match(/^```json[\t ]*\r?\n([\s\S]*?)\r?\n```$/i)
  let json = text
  if (text.startsWith('```')) {
    if (!fence) throw new Error('AI 诊断计划必须是纯 JSON 或单个 json 代码块，不能包含多余可执行文本。')
    json = fence[1].trim()
  }
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('AI 诊断计划不是有效的严格 JSON 格式。')
  }
  return validateDiagnosticPlan(parsed, options)
}

export const buildDiagnosticContext = buildTargetedDiagnosticContext

const criticalDiagnosticStates = new Set([
  'critical',
  'failed',
  'unhealthy',
  'dead',
  'exited'
])
const warningDiagnosticStates = new Set([
  'warning',
  'inactive',
  'stopped',
  'degraded',
  'restarting',
  'paused'
])

function diagnosticStateTokens (value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return []
  const tokens = [text.match(/^[a-z]+/)?.[0]]
  for (const match of text.matchAll(/\(([^)]*)\)/g)) {
    tokens.push(...(match[1].match(/[a-z]+/g) || []))
  }
  return tokens.filter(Boolean)
}

export function deriveDiagnosticSeverity (target = {}) {
  let severity = null
  for (const value of [target.severity, target.activeState, target.state, target.status]) {
    for (const token of diagnosticStateTokens(value)) {
      if (criticalDiagnosticStates.has(token)) return 'critical'
      if (warningDiagnosticStates.has(token)) severity = 'warning'
    }
  }
  return severity
}

export function isDiagnosticTargetAbnormal (target = {}) {
  const severity = deriveDiagnosticSeverity(target)
  return severity === 'warning' || severity === 'critical'
}

export function buildDiagnosticResultPrompt (input = {}) {
  const plan = input.plan || input
  const task = input.task || input
  const endpointSource = task.endpoint || plan.endpoint || {}
  const endpoint = endpointSource.host && endpointSource.username
    ? safeEndpoint(endpointSource)
    : {}
  const steps = (task.steps || []).slice(0, maxPlanSteps).map(step => ({
    title: safeText(step.title, maxTitleLength),
    purpose: safeText(step.purpose, maxPurposeLength),
    command: safeText(step.command, maxCommandLength),
    status: safeText(step.status, 40),
    code: Number.isFinite(step.audit?.at(-1)?.code) ? step.audit.at(-1).code : null,
    output: safeText(step.output, 2000),
    error: safeText(step.error, 500)
  }))
  const report = {
    taskId: safeText(task.id, 100),
    title: safeText(task.title || plan.title, maxTitleLength),
    summary: safeText(task.summary || task.purpose || plan.summary, maxSummaryLength),
    endpoint,
    status: safeText(task.status, 40),
    error: safeText(task.error, 1000),
    expectedSignals: (task.expectedSignals || plan.expectedSignals || []).slice(0, maxListItems).map(item => safeText(item, maxSignalLength)),
    stopConditions: (task.stopConditions || plan.stopConditions || []).slice(0, maxListItems).map(item => safeText(item, maxSignalLength)),
    steps
  }
  const statusLabel = task.status === 'partially-completed'
    ? '部分完成 (partially-completed)'
    : safeText(task.status || '未知', 80)
  return [
    'ShellPilot 只读诊断结果',
    `状态：${statusLabel}`,
    '结论：未自动判定，请基于以下有界脱敏证据继续分析。',
    `预期信号：${report.expectedSignals.join('；') || '未提供'}`,
    `停止条件：${report.stopConditions.join('；') || '未提供'}`,
    '不要自动执行命令；需要更多信息时只提出只读建议。',
    '',
    JSON.stringify(report, null, 2)
  ].join('\n').slice(0, 12000)
}
