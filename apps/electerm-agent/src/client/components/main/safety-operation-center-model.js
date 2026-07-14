import { redactAuditText } from '../../common/safety-transactions/audit-redaction.js'
import { safetyOperationUpdatedEvent as legacySafetyOperationUpdatedEvent } from '../../common/safety-operation-records.js'
import {
  assertSameSessionEndpoint,
  buildEndpointKey
} from '../../common/safety-transactions/endpoint-guard.js'
import {
  finalOperationStates,
  operationStates,
  validateRecoveryStructure
} from '../../common/safety-transactions/models.js'
import { verifyRecoveryBinding } from '../../common/safety-transactions/recovery-binding.js'
import {
  finalTaskStatuses,
  safetyTransactionUpdatedEvent,
  taskStatuses
} from '../../common/safety-transactions/transaction-store.js'

export { safetyTransactionUpdatedEvent }
export { legacySafetyOperationUpdatedEvent }

const knownOperationStates = new Set(Object.values(operationStates))
const finalOperationStateSet = new Set(finalOperationStates)
const knownTaskStatuses = new Set(Object.values(taskStatuses))
const finalTaskStatusSet = new Set(finalTaskStatuses)
const recoveryOperationStates = new Set([
  operationStates.verificationPassed,
  operationStates.rollbackAvailable,
  operationStates.failed
])
const successfulStepStatuses = new Set([
  'completed',
  'success',
  'succeeded'
])
const finalStepStatuses = new Set([
  ...successfulStepStatuses,
  'failed',
  'cancelled',
  'skipped'
])
const maxCommandPreview = 320
const maxTextPreview = 2048
const maxAuditEntries = 20
export const legacyClaimUnknownResultMessage = '上次执行中断，结果未知'
export const recoveryIntegrityFailureMessage = '恢复记录完整性校验失败'
const auditPhaseLabels = {
  prepare: '准备',
  execute: '执行',
  rollback: '回滚',
  verify: '验证',
  cancel: '取消',
  readonly: '只读'
}

export const safetyOperationStatusPresentations = Object.freeze({
  [operationStates.preparing]: Object.freeze(['准备恢复点', 'processing']),
  [operationStates.recoveryReady]: Object.freeze(['恢复点已就绪', 'processing']),
  [operationStates.awaitingConfirmation]: Object.freeze(['等待确认', 'warning']),
  [operationStates.executing]: Object.freeze(['执行中', 'processing']),
  [operationStates.verificationPassed]: Object.freeze(['验证通过', 'success']),
  [operationStates.rollbackAvailable]: Object.freeze(['可回滚', 'warning']),
  [operationStates.kept]: Object.freeze(['已保留', 'default']),
  [operationStates.rollingBack]: Object.freeze(['回滚中', 'processing']),
  [operationStates.restored]: Object.freeze(['已恢复', 'success']),
  [operationStates.failed]: Object.freeze(['失败', 'error']),
  [operationStates.cancelled]: Object.freeze(['已取消', 'default'])
})

export const safetyTaskStatusPresentations = Object.freeze({
  [taskStatuses.draft]: Object.freeze(['草稿', 'default']),
  [taskStatuses.awaitingPlanConfirmation]: Object.freeze(['等待计划确认', 'warning']),
  [taskStatuses.runningReadonly]: Object.freeze(['只读执行中', 'processing']),
  [taskStatuses.awaitingChangeConfirmation]: Object.freeze(['等待修改确认', 'warning']),
  [taskStatuses.runningChange]: Object.freeze(['修改执行中', 'warning']),
  [taskStatuses.completed]: Object.freeze(['已完成', 'success']),
  [taskStatuses.failed]: Object.freeze(['失败', 'error']),
  [taskStatuses.cancelled]: Object.freeze(['已取消', 'default']),
  [taskStatuses.partiallyCompleted]: Object.freeze(['部分完成', 'warning'])
})
const unknownSafetyStatusPresentation = Object.freeze(['未知状态', 'default'])

export function getSafetyOperationStatusPresentation (status) {
  return safetyOperationStatusPresentations[status] || unknownSafetyStatusPresentation
}

export function getSafetyTaskStatusPresentation (status) {
  return safetyTaskStatusPresentations[status] || unknownSafetyStatusPresentation
}

function isRecord (value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    String(value.id || '').trim()
  )
}

function recordTime (record) {
  const value = new Date(record.updatedAt || record.createdAt).getTime()
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value
}

function stableNewestFirst (entries) {
  return entries
    .sort((left, right) => {
      const difference = recordTime(right.record) - recordTime(left.record)
      return difference || left.order - right.order
    })
    .map(entry => entry.record)
}

function claimsRecovery (record) {
  if ([operationStates.verificationPassed, operationStates.rollbackAvailable].includes(record?.state)) {
    return true
  }
  return record?.state === operationStates.failed && Boolean(
    record.reversible === true ||
    record.recoveryBinding ||
    record.plan ||
    record.artifacts ||
    record.recoveryReadyAt
  )
}

export function getSafetyRecoveryIntegrityError (record) {
  if (record?.metadata?.legacy === true || !claimsRecovery(record)) return ''
  const validation = validateRecoveryStructure(record)
  return validation.valid ? '' : validation.error
}

function recoveryIntegrityResult (integrityResults, id) {
  if (integrityResults instanceof Map) return integrityResults.get(id)
  return integrityResults && typeof integrityResults === 'object'
    ? integrityResults[id]
    : undefined
}

function isModernRecoveryCandidate (record) {
  return record?.metadata?.legacy !== true &&
    recoveryOperationStates.has(record?.state) &&
    claimsRecovery(record)
}

export async function buildSafetyRecoveryIntegrityResults (
  records,
  verify = verifyRecoveryBinding
) {
  const results = new Map()
  if (!Array.isArray(records) || typeof verify !== 'function') return results
  const candidates = records.filter(record => {
    return isRecord(record) && isModernRecoveryCandidate(record)
  })
  await Promise.all(candidates.map(async record => {
    const structure = validateRecoveryStructure(record)
    if (!structure.valid) {
      results.set(record.id, {
        valid: false,
        error: recoveryIntegrityFailureMessage
      })
      return
    }
    try {
      const result = await verify(record)
      results.set(record.id, result?.valid === true
        ? { valid: true, error: '' }
        : { valid: false, error: recoveryIntegrityFailureMessage })
    } catch {
      results.set(record.id, {
        valid: false,
        error: recoveryIntegrityFailureMessage
      })
    }
  }))
  return results
}

export function isSafetyOperationRollbackable (record, integrityResults) {
  if (!recoveryOperationStates.has(record?.state) ||
    !validateRecoveryStructure(record).valid) return false
  if (integrityResults === undefined) return true
  return recoveryIntegrityResult(integrityResults, record.id)?.valid === true
}

export function isSafetyOperationRunning (record) {
  return record?.metadata?.legacy !== true &&
    knownOperationStates.has(record?.state) &&
    !finalOperationStateSet.has(record.state) &&
    !recoveryOperationStates.has(record.state)
}

export function getLegacyClaimStatus (record, now = new Date()) {
  if (record?.metadata?.legacy !== true ||
    record?.state !== operationStates.rollingBack) return 'none'
  const claim = record.metadata?.safetyCenterLegacyClaim
  if (!claim || typeof claim !== 'object') return 'stale'
  const claimedAt = new Date(claim.claimedAt).getTime()
  const expiresAt = new Date(claim.expiresAt).getTime()
  const currentTime = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (Number.isNaN(claimedAt) || Number.isNaN(expiresAt) ||
    Number.isNaN(currentTime) || expiresAt <= claimedAt) return 'stale'
  return expiresAt <= currentTime ? 'stale' : 'active'
}

export function isLegacyOperationActionable (record, now = new Date()) {
  if (record?.metadata?.legacy !== true) return false
  if ([operationStates.rollbackAvailable, operationStates.failed].includes(record.state)) {
    return true
  }
  return getLegacyClaimStatus(record, now) === 'stale'
}

function operationGroup (record, integrityResults) {
  if (record.metadata?.legacy === true) return 'legacy'
  if (isSafetyOperationRollbackable(record, integrityResults)) return 'rollback'
  if (isSafetyOperationRunning(record)) return 'running'
  return 'history'
}

function taskGroup (record) {
  return knownTaskStatuses.has(record.status) && !finalTaskStatusSet.has(record.status)
    ? 'running'
    : 'history'
}

export function groupSafetyCenterRecords (records, tasks, integrityResults) {
  const groups = {
    running: [],
    rollback: [],
    history: [],
    legacy: []
  }
  let order = 0
  const operations = Array.isArray(records) ? records : []
  const agentTasks = Array.isArray(tasks) ? tasks : []

  for (const record of operations) {
    if (!isRecord(record)) continue
    groups[operationGroup(record, integrityResults)].push({
      order: order++,
      record: { ...record, recordType: 'operation' }
    })
  }
  for (const record of agentTasks) {
    if (!isRecord(record)) continue
    groups[taskGroup(record)].push({
      order: order++,
      record: { ...record, recordType: 'task' }
    })
  }
  for (const key of Object.keys(groups)) {
    groups[key] = stableNewestFirst(groups[key])
  }
  return groups
}

function safeText (value, limit = maxTextPreview) {
  const redacted = redactAuditText(String(value ?? ''))
  if (redacted.length <= limit) return redacted
  return `${redacted.slice(0, Math.max(0, limit - 1))}…`
}

function compactText (value, limit = maxCommandPreview) {
  return safeText(value, limit).replace(/\s+/g, ' ').trim()
}

function endpointHost (record) {
  return record?.endpoint?.host || record?.host || ''
}

function recordStatus (record) {
  return record?.recordType === 'task'
    ? record.status
    : record.state || record.status
}

export function filterSafetyCenterRecords (records, filters = {}) {
  if (!Array.isArray(records)) return []
  const keyword = String(filters.keyword || '').trim().toLowerCase()
  return records.filter(record => {
    if (!isRecord(record)) return false
    if (filters.host && endpointHost(record) !== filters.host) return false
    if (filters.source && record.source !== filters.source) return false
    if (filters.status && recordStatus(record) !== filters.status) return false
    if (!keyword) return true
    const legacy = getLegacySafetyRecord(record)
    return [
      record.id,
      record.title,
      record.command,
      endpointHost(record),
      record.endpoint?.username,
      record.plan?.operationDir,
      record.artifacts?.backupDir,
      legacy?.target,
      legacy?.sourcePath,
      legacy?.backupPath,
      legacy?.rollbackPath
    ].some(value => String(value || '').toLowerCase().includes(keyword))
  })
}

function formatEndpoint (record) {
  const endpoint = record?.endpoint || {}
  try {
    return safeText(buildEndpointKey(endpoint), 512)
  } catch {
    const host = endpoint.host || record?.host || '未记录'
    const username = endpoint.username || record?.username || ''
    const port = endpoint.port || record?.port || 22
    return safeText(`${username ? `${username}@` : ''}${host}:${port}`, 512)
  }
}

function auditView (audit) {
  const entries = Array.isArray(audit) ? audit.slice(-maxAuditEntries) : []
  return entries.filter(entry => entry && typeof entry === 'object').map(entry => {
    const phase = safeText(entry.phase, 80)
    return {
      phase,
      phaseLabel: auditPhaseLabels[phase] || '其他',
      timestamp: safeText(entry.timestamp, 80),
      code: Number.isFinite(entry.code) ? entry.code : null,
      preview: safeText(entry.preview ?? entry.output, maxTextPreview)
    }
  })
}

function timelineView (record, audit) {
  const timeline = []
  if (record.createdAt) {
    timeline.push({ label: '已创建', timestamp: safeText(record.createdAt, 80) })
  }
  if (record.recoveryReadyAt) {
    timeline.push({ label: '恢复点已就绪', timestamp: safeText(record.recoveryReadyAt, 80) })
  }
  for (const entry of audit) {
    if (!entry.timestamp) continue
    timeline.push({
      label: entry.phase === 'verify' ? '已验证' : `${entry.phaseLabel}阶段`,
      timestamp: entry.timestamp
    })
  }
  if (record.updatedAt && record.updatedAt !== record.createdAt) {
    timeline.push({
      label: safeText(recordStatus(record) || '已更新', 80),
      timestamp: safeText(record.updatedAt, 80)
    })
  }
  return timeline.slice(-8)
}

function verificationView (record, audit) {
  const verification = [...audit].reverse().find(entry => entry.phase === 'verify')
  if (verification) {
    return verification.code === 0 ? '验证通过' : '验证失败'
  }
  if (record.state === 'restored') return '验证通过'
  if (record.metadata?.verificationResult) {
    return safeText(record.metadata.verificationResult, 240)
  }
  return '暂无验证结果'
}

export function getLegacySafetyRecord (record) {
  return record?.metadata?.legacy === true &&
    record.metadata.legacyRecord &&
    typeof record.metadata.legacyRecord === 'object'
    ? record.metadata.legacyRecord
    : null
}

export function buildSafetyRecordViewModel (record = {}, integrityResults, now = new Date()) {
  const legacy = getLegacySafetyRecord(record)
  const audit = auditView(record.audit)
  const operationDir = record.plan?.operationDir || ''
  const backupPath = record.artifacts?.backupDir || legacy?.backupPath || ''
  const recoveryPath = operationDir || legacy?.rollbackPath || legacy?.path || ''
  const verifiedIntegrity = recoveryIntegrityResult(integrityResults, record.id)
  const recoveryIntegrityError = verifiedIntegrity?.valid === false
    ? verifiedIntegrity.error || recoveryIntegrityFailureMessage
    : getSafetyRecoveryIntegrityError(record)
  const legacyClaimError = getLegacyClaimStatus(record, now) === 'stale'
    ? legacyClaimUnknownResultMessage
    : ''
  const resourcePaths = Array.isArray(record.effect?.resources)
    ? record.effect.resources.slice(0, 64)
      .map(resource => safeText(resource?.path, 1024))
      .filter(Boolean)
    : []
  const artifactPaths = record.artifacts && typeof record.artifacts === 'object'
    ? Object.values(record.artifacts).slice(0, 64)
      .filter(value => typeof value === 'string')
      .map(value => safeText(value, 1024))
    : []
  const effectSummary = record.operationKind === 'side-effect'
    ? [record.effect?.adapter, record.effect?.action, ...resourcePaths]
        .filter(Boolean)
        .join(' | ')
    : ''
  return {
    id: safeText(record.id, 256),
    recordType: record.recordType === 'task' ? 'task' : 'operation',
    source: safeText(record.source || 'unknown', 80),
    title: safeText(record.title || legacy?.title || '未命名安全操作', 320),
    endpoint: formatEndpoint(record),
    commandSummary: compactText(
      effectSummary || record.command || legacy?.target || legacy?.sourcePath || '未记录命令'
    ),
    effectAdapter: safeText(record.effect?.adapter, 80),
    effectAction: safeText(record.effect?.action, 80),
    resourcePaths,
    artifactPaths,
    provider: safeText(record.recoveryProvider || record.plan?.provider || '无', 80),
    backupPath: safeText(backupPath, 1024),
    recoveryPath: safeText(recoveryPath, 1024),
    status: safeText(recordStatus(record) || 'unknown', 80),
    createdAt: safeText(record.createdAt, 80),
    updatedAt: safeText(record.updatedAt || record.createdAt, 80),
    timeline: timelineView(record, audit),
    verification: verificationView(record, audit),
    error: safeText(
      record.integrityError || recoveryIntegrityError || legacyClaimError || record.error,
      maxTextPreview
    ),
    audit,
    auditCount: Array.isArray(record.audit) ? record.audit.length : 0,
    legacy: Boolean(legacy)
  }
}

export function summarizeSafetyTaskProgress (task = {}) {
  const sourceSteps = Array.isArray(task.steps) ? task.steps : []
  const steps = sourceSteps
    .filter(step => step && typeof step === 'object')
    .map((step, index) => ({
      id: safeText(step.id || `step-${index + 1}`, 128),
      title: safeText(step.title || step.purpose || `步骤 ${index + 1}`, 320),
      status: safeText(step.status || 'pending', 80),
      commandSummary: compactText(step.command || ''),
      outputPreview: safeText(step.output || step.audit?.at?.(-1)?.preview || '', maxTextPreview),
      error: safeText(step.error || '', maxTextPreview)
    }))
  const successCount = steps.filter(step => successfulStepStatuses.has(step.status)).length
  const failedCount = steps.filter(step => step.status === 'failed').length
  const cancelledCount = steps.filter(step => step.status === 'cancelled').length
  const finishedCount = steps.filter(step => finalStepStatuses.has(step.status)).length
  const currentStep = steps.find(step => step.status === 'running') ||
    steps.find(step => step.status === 'awaiting-confirmation') || null
  return {
    id: safeText(task.id, 256),
    source: safeText(task.source || 'unknown', 80),
    title: safeText(task.title || '安全任务', 320),
    endpoint: formatEndpoint(task),
    status: safeText(task.status || 'unknown', 80),
    total: steps.length,
    successCount,
    failedCount,
    cancelledCount,
    finishedCount,
    percent: steps.length ? Math.round(finishedCount / steps.length * 100) : 0,
    currentStep,
    steps,
    error: safeText(task.error, maxTextPreview)
  }
}

function terminalMatchesOperation (operation, terminal) {
  if (!terminal?.pid || terminal.isSsh?.() !== true ||
    typeof terminal.getTerminalSafetyEndpoint !== 'function') {
    return false
  }
  try {
    assertSameSessionEndpoint(
      operation.endpoint,
      terminal.getTerminalSafetyEndpoint()
    )
    return true
  } catch {
    return false
  }
}

export function findMatchingSafetyTerminal (operation, tabIds, getTerminal) {
  if (!isRecord(operation) || typeof getTerminal !== 'function') return undefined
  const ids = [operation.endpoint?.tabId, ...(Array.isArray(tabIds) ? tabIds : [])]
  for (const id of [...new Set(ids.filter(Boolean))]) {
    let terminal
    try {
      terminal = getTerminal(id)
    } catch {
      continue
    }
    if (terminalMatchesOperation(operation, terminal)) return terminal
  }
}

function sftpMatchesOperation (operation, entry) {
  if (!entry?.sftp || typeof entry.getSftpSafetyEndpoint !== 'function' ||
    typeof entry.rollbackSafetyOperation !== 'function') {
    return false
  }
  try {
    assertSameSessionEndpoint(
      operation.endpoint,
      entry.getSftpSafetyEndpoint()
    )
    return true
  } catch {
    return false
  }
}

export function findMatchingSafetySftp (operation, tabIds, getEntry) {
  if (!isRecord(operation) || operation.effect?.adapter !== 'sftp' ||
    typeof getEntry !== 'function') return undefined
  const ids = [operation.endpoint?.tabId, ...(Array.isArray(tabIds) ? tabIds : [])]
  for (const id of [...new Set(ids.filter(Boolean))]) {
    let entry
    try {
      entry = getEntry(id)
    } catch {
      continue
    }
    if (sftpMatchesOperation(operation, entry)) return entry
  }
}

export async function routeSafetyCenterAction ({
  action,
  record,
  terminal,
  taskCapability
}) {
  if (!isRecord(record)) throw new Error('安全记录无效。')
  if (record.recordType === 'task') {
    if (action !== 'cancel' || taskCapability?.canCancel !== true ||
      typeof taskCapability.cancel !== 'function') {
      throw new Error('任务取消能力不可用。')
    }
    const result = await taskCapability.cancel(record.id)
    if (result?.status !== 'cancelled') {
      throw new Error('任务取消未完成。')
    }
    return result
  }

  const methodName = {
    rollback: 'rollbackSafetyOperation',
    keep: 'keepSafetyOperation',
    cancel: 'cancelSafetyOperation'
  }[action]
  if (!methodName || typeof terminal?.[methodName] !== 'function') {
    throw new Error('当前终端不支持该安全操作。')
  }
  const result = await terminal[methodName](record.id)
  const expectedState = {
    rollback: 'restored',
    keep: 'kept',
    cancel: 'cancelled'
  }[action]
  if (result?.state !== expectedState) {
    throw new Error('安全操作未完成。')
  }
  return result
}

export function safetyRecordActionLockKey (record = {}) {
  const recordType = record.recordType === 'task' ? 'task' : 'operation'
  return `${recordType}:${String(record.id || '')}`
}

export function createSafetyActionLock (onChange = () => {}) {
  const locked = new Set()
  const notify = () => onChange([...locked])
  return {
    isLocked: key => locked.has(String(key)),
    async run (key, action) {
      const lockKey = String(key)
      if (locked.has(lockKey)) return { started: false }
      locked.add(lockKey)
      notify()
      try {
        return { started: true, value: await action() }
      } finally {
        locked.delete(lockKey)
        notify()
      }
    }
  }
}

export function subscribeSafetyCenterRefresh ({
  eventTarget,
  refresh
}) {
  if (!eventTarget?.addEventListener || !eventTarget?.removeEventListener ||
    typeof refresh !== 'function') {
    return () => {}
  }
  const listener = () => refresh()
  const eventNames = [
    safetyTransactionUpdatedEvent,
    legacySafetyOperationUpdatedEvent
  ]
  for (const eventName of eventNames) {
    eventTarget.addEventListener(eventName, listener)
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const eventName of eventNames) {
      eventTarget.removeEventListener(eventName, listener)
    }
  }
}
