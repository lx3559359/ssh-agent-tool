export const operationTaskKinds = Object.freeze({
  sftpTransfer: 'sftp-transfer',
  sshTunnel: 'ssh-tunnel',
  aiFileChange: 'ai-file-change',
  manualBackup: 'manual-backup'
})

export const operationTaskStatuses = Object.freeze({
  queued: 'queued',
  running: 'running',
  pausing: 'pausing',
  paused: 'paused',
  interrupted: 'interrupted',
  resuming: 'resuming',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled'
})

export const finalOperationTaskStatuses = Object.freeze([
  operationTaskStatuses.completed,
  operationTaskStatuses.failed,
  operationTaskStatuses.cancelled
])

const validKinds = new Set(Object.values(operationTaskKinds))
const validStatuses = new Set(Object.values(operationTaskStatuses))
const finalStatuses = new Set(finalOperationTaskStatuses)
const allowedTransitions = Object.freeze({
  [operationTaskStatuses.queued]: new Set([
    operationTaskStatuses.running,
    operationTaskStatuses.cancelled
  ]),
  [operationTaskStatuses.running]: new Set([
    operationTaskStatuses.pausing,
    operationTaskStatuses.interrupted,
    operationTaskStatuses.completed,
    operationTaskStatuses.failed,
    operationTaskStatuses.cancelled
  ]),
  [operationTaskStatuses.pausing]: new Set([
    operationTaskStatuses.paused,
    operationTaskStatuses.interrupted,
    operationTaskStatuses.failed,
    operationTaskStatuses.cancelled
  ]),
  [operationTaskStatuses.paused]: new Set([
    operationTaskStatuses.resuming,
    operationTaskStatuses.interrupted,
    operationTaskStatuses.cancelled
  ]),
  [operationTaskStatuses.interrupted]: new Set([
    operationTaskStatuses.resuming,
    operationTaskStatuses.cancelled
  ]),
  [operationTaskStatuses.resuming]: new Set([
    operationTaskStatuses.running,
    operationTaskStatuses.interrupted,
    operationTaskStatuses.failed,
    operationTaskStatuses.cancelled
  ])
})
const sensitiveKeyPattern = /(?:password|passphrase|private.?key|api.?key|token|authorization|cookie|secret|credential)/i

function taskError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function toDate (value, fallback, label) {
  const date = value ? new Date(value) : fallback
  if (Number.isNaN(date.getTime())) {
    throw taskError('OPERATION_TASK_TIME_INVALID', `${label}时间无效`)
  }
  return date.toISOString()
}

function toSafeValue (value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (value instanceof Date) return value.toISOString()
  if (!value || typeof value !== 'object') return undefined
  if (
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    seen.has(value)
  ) {
    return undefined
  }
  seen.add(value)
  if (Array.isArray(value)) {
    const result = value
      .map(item => toSafeValue(item, seen))
      .filter(item => item !== undefined)
    seen.delete(value)
    return result
  }
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key)) continue
    const safe = toSafeValue(item, seen)
    if (safe !== undefined) result[key] = safe
  }
  seen.delete(value)
  return result
}

function normalizeEndpoint (endpoint) {
  if (!endpoint || typeof endpoint !== 'object') return null
  return {
    host: String(endpoint.host || ''),
    port: Math.max(1, Math.min(65535, Number(endpoint.port) || 22)),
    username: String(endpoint.username || '')
  }
}

function normalizeProgress (progress = {}) {
  const transferred = Math.max(0, Number(progress.transferred) || 0)
  const total = Math.max(0, Number(progress.total) || 0)
  return {
    transferred,
    total,
    percent: total
      ? Math.min(100, Math.floor(transferred * 100 / total))
      : 0,
    speed: Math.max(0, Number(progress.speed) || 0),
    etaSeconds: Math.max(0, Number(progress.etaSeconds) || 0)
  }
}

export function isFinalOperationTask (task) {
  return finalStatuses.has(task?.status)
}

export function assertOperationTaskTransition (from, to) {
  if (from === to) return
  if (!validStatuses.has(from) || !validStatuses.has(to) ||
    finalStatuses.has(from) || !allowedTransitions[from]?.has(to)) {
    throw taskError(
      'OPERATION_TASK_TRANSITION_INVALID',
      `不支持的任务状态变化：${String(from)} -> ${String(to)}`
    )
  }
}

export function normalizeOperationTask (
  input = {},
  clock = () => new Date()
) {
  const nowValue = clock()
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue)
  if (Number.isNaN(now.getTime())) {
    throw taskError('OPERATION_TASK_TIME_INVALID', '当前时间无效')
  }
  const id = String(input.id || '').trim()
  const kind = String(input.kind || '').trim()
  const status = String(input.status || operationTaskStatuses.queued)
  if (!id) {
    throw taskError('OPERATION_TASK_ID_INVALID', '任务缺少唯一标识')
  }
  if (!validKinds.has(kind)) {
    throw taskError('OPERATION_TASK_KIND_INVALID', '任务类型不受支持')
  }
  if (!validStatuses.has(status)) {
    throw taskError('OPERATION_TASK_STATUS_INVALID', '任务状态不受支持')
  }
  return {
    schemaVersion: 1,
    id,
    kind,
    status,
    title: String(input.title || '').slice(0, 240),
    endpoint: normalizeEndpoint(input.endpoint),
    progress: normalizeProgress(input.progress),
    metadata: toSafeValue(input.metadata) || {},
    createdAt: toDate(input.createdAt, now, '创建'),
    updatedAt: toDate(input.updatedAt, now, '更新')
  }
}
