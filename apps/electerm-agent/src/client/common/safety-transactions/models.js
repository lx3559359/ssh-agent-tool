import { classifyCommand } from './command-classifier.js'
import { redactSensitiveData } from './audit-redaction.js'
import { buildEndpointKey, normalizeEndpoint } from './endpoint-guard.js'
import { assertTrustedOperationId } from './operation-id.js'

export const operationStates = Object.freeze({
  preparing: 'preparing',
  recoveryReady: 'recovery-ready',
  awaitingConfirmation: 'awaiting-confirmation',
  executing: 'executing',
  verificationPassed: 'verification-passed',
  rollbackAvailable: 'rollback-available',
  kept: 'kept',
  rollingBack: 'rolling-back',
  restored: 'restored',
  failed: 'failed',
  cancelled: 'cancelled'
})

export const finalOperationStates = Object.freeze([
  operationStates.kept,
  operationStates.restored,
  operationStates.failed,
  operationStates.cancelled
])

export const recoveryBindingSchemaVersion = 1
export const sideEffectRecoveryBindingSchemaVersion = 2
export const recoveryBindingAlgorithm = 'SHA-256'

const agentPlanPayloadFields = Object.freeze([
  'schemaVersion',
  'endpoint',
  'goal',
  'orderedCalls',
  'skillBindings',
  'artifactDigests',
  'impactTargets',
  'resourceImpact',
  'recovery',
  'verification'
])

export function validateAgentPlanGrantStructure (grant) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) return false
  if (grant.schemaVersion !== 1 || grant.algorithm !== 'SHA-256' ||
    !/^[a-f0-9]{64}$/.test(String(grant.digest || '')) ||
    !String(grant.confirmedBy || '').trim() ||
    Number.isNaN(new Date(grant.confirmedAt).getTime())) return false
  const payload = grant.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  if (Object.keys(payload).sort().join('\n') !== [...agentPlanPayloadFields].sort().join('\n')) {
    return false
  }
  return payload.schemaVersion === 1 &&
    payload.endpoint && typeof payload.endpoint === 'object' &&
    typeof payload.goal === 'string' && Boolean(payload.goal.trim()) &&
    Array.isArray(payload.orderedCalls) &&
    Array.isArray(payload.skillBindings) &&
    Array.isArray(payload.artifactDigests) &&
    Array.isArray(payload.impactTargets) &&
    payload.resourceImpact && typeof payload.resourceImpact === 'object' &&
    (payload.recovery === null || typeof payload.recovery === 'object') &&
    Array.isArray(payload.verification)
}

function invalidRecoveryStructure (reason) {
  return {
    valid: false,
    error: `恢复结构完整性错误：${reason}`
  }
}

export function validateRecoveryStructure (operation = {}) {
  if (operation.operationKind === 'side-effect') {
    const binding = operation.recoveryBinding
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
      return invalidRecoveryStructure('缺少恢复绑定。')
    }
    if (binding.schemaVersion !== sideEffectRecoveryBindingSchemaVersion) {
      return invalidRecoveryStructure('恢复绑定版本不受支持。')
    }
    if (binding.algorithm !== recoveryBindingAlgorithm ||
      typeof binding.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(binding.fingerprint)) {
      return invalidRecoveryStructure('恢复绑定指纹无效。')
    }
    const plan = operation.plan
    if (!plan || typeof plan !== 'object' || Array.isArray(plan) ||
      plan.adapter !== operation.effect?.adapter ||
      typeof plan.operationDir !== 'string' || !plan.operationDir.trim()) {
      return invalidRecoveryStructure('缺少 side-effect 恢复计划。')
    }
    if (!operation.artifacts || typeof operation.artifacts !== 'object' ||
      Array.isArray(operation.artifacts) || !Object.keys(operation.artifacts).length) {
      return invalidRecoveryStructure('缺少恢复产物。')
    }
    if (typeof operation.recoveryReadyAt !== 'string' ||
      Number.isNaN(new Date(operation.recoveryReadyAt).getTime())) {
      return invalidRecoveryStructure('缺少有效的恢复点时间。')
    }
    return { valid: true, error: '' }
  }
  const binding = operation.recoveryBinding
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return invalidRecoveryStructure('缺少恢复绑定。')
  }
  if (binding.schemaVersion !== recoveryBindingSchemaVersion) {
    return invalidRecoveryStructure('恢复绑定版本不受支持。')
  }
  if (binding.algorithm !== recoveryBindingAlgorithm) {
    return invalidRecoveryStructure('恢复绑定算法不受支持。')
  }
  if (typeof binding.fingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(binding.fingerprint)) {
    return invalidRecoveryStructure('恢复绑定指纹无效。')
  }

  const plan = operation.plan
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return invalidRecoveryStructure('缺少恢复计划。')
  }
  if (typeof plan.operationDir !== 'string' || !plan.operationDir.trim()) {
    return invalidRecoveryStructure('缺少恢复目录。')
  }
  if (typeof plan.rollbackCommand !== 'string' || !plan.rollbackCommand.trim()) {
    return invalidRecoveryStructure('缺少回滚命令。')
  }
  if (typeof plan.verifyCommand !== 'string' || !plan.verifyCommand.trim()) {
    return invalidRecoveryStructure('缺少验证命令。')
  }
  if (!operation.artifacts || typeof operation.artifacts !== 'object' ||
    Array.isArray(operation.artifacts) || !Object.keys(operation.artifacts).length) {
    return invalidRecoveryStructure('缺少恢复产物。')
  }
  if (typeof operation.recoveryReadyAt !== 'string' ||
    Number.isNaN(new Date(operation.recoveryReadyAt).getTime())) {
    return invalidRecoveryStructure('缺少有效的恢复点时间。')
  }
  return { valid: true, error: '' }
}

export const operationSources = Object.freeze([
  'terminal',
  'agent',
  'quick-command',
  'server-status',
  'sftp'
])

export const operationRisks = Object.freeze({
  readonly: 'readonly',
  change: 'change',
  unknown: 'unknown',
  blocked: 'blocked'
})

export const recoveryProviders = Object.freeze({
  file: 'file',
  permissions: 'permissions',
  systemd: 'systemd',
  firewall: 'firewall',
  network: 'network',
  docker: 'docker'
})

const validStates = new Set(Object.values(operationStates))
const validSources = new Set(operationSources)
const validRisks = new Set(Object.values(operationRisks))
const validRecoveryProviders = new Set(Object.values(recoveryProviders))
const endpointIdentityFields = [
  'tabId', 'host', 'port', 'username', 'title', 'pid', 'terminalPid',
  'sessionType', 'hostKeyFingerprint'
]
const normalizedOperationFields = [
  'id', 'source', 'command', 'title', 'state', 'createdAt', 'updatedAt',
  'operationKind', 'effect', 'effectKey',
  'metadata', 'risk', 'provider', 'reversible', 'recoveryProvider',
  'requiresConfirmation', 'reason', 'plan', 'recoveryBinding', 'artifacts', 'audit',
  'recoveryReadyAt', 'executionId', 'error', 'integrityError', 'failedAt', 'completedAt',
  'mutationStarted', 'mutationStartedAt', 'commitPoint', 'commitPointAt',
  'timeoutMs', 'prepareTimeoutMs', 'executeTimeoutMs',
  'rollbackTimeoutMs', 'verifyTimeoutMs'
]
const redactedOperationFields = new Set([
  'plan', 'artifacts', 'audit', 'error', 'integrityError'
])
const safetyRequestInputFields = [
  'id', 'source', 'command', 'title', 'endpoint', 'state', 'createdAt',
  'updatedAt', 'metadata'
]

function projectDefinedFields (value, fields) {
  return Object.fromEntries(fields
    .filter(field => value[field] !== undefined)
    .map(field => [field, value[field]]))
}

function toTimestamp (value, fallback) {
  const date = value === undefined || value === null || value === ''
    ? fallback
    : new Date(value)
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('安全事务时间戳无效')
  }
  return date.toISOString()
}

function resolveNow (value) {
  const now = value instanceof Date ? value : new Date(value ?? Date.now())
  if (Number.isNaN(now.getTime())) throw new Error('安全事务当前时间无效')
  return now
}

function normalizeClassification (operation, normalized) {
  const hasClassification = operation.risk !== undefined ||
    operation.reversible !== undefined || operation.recoveryProvider !== undefined
  if (!hasClassification) return
  if (operation.risk !== undefined && !validRisks.has(operation.risk)) {
    throw new Error('安全事务风险等级不受支持')
  }
  const provider = operation.recoveryProvider
  const validProvider = validRecoveryProviders.has(provider) ||
    (operation.operationKind === 'side-effect' && provider === 'sftp')
  if (provider !== undefined && provider !== null && !validProvider) {
    throw new Error('安全事务恢复提供方不受支持')
  }
  const reversible = operation.risk === operationRisks.change &&
    operation.reversible === true && validProvider
  normalized.reversible = reversible
  normalized.recoveryProvider = reversible ? provider : null
}

export function normalizeOperation (operation = {}, options = {}) {
  if (!validSources.has(operation.source)) {
    throw new Error('安全事务来源不受支持')
  }
  const state = operation.state || operationStates.preparing
  if (!validStates.has(state)) {
    throw new Error('安全事务状态不受支持')
  }

  const now = resolveNow(options.now)
  const normalizedIdentity = normalizeEndpoint(operation.endpoint)
  const endpoint = Object.fromEntries(endpointIdentityFields
    .filter(field => operation.endpoint?.[field] !== undefined)
    .map(field => [field, operation.endpoint[field]]))
  Object.assign(endpoint, normalizedIdentity)
  const normalized = projectDefinedFields(operation, normalizedOperationFields)
  if (normalized.id !== undefined &&
    normalized.operationKind === 'side-effect') {
    normalized.id = options.allowLegacyId === true
      ? String(normalized.id)
      : assertTrustedOperationId(normalized.id)
  }
  if (normalized.metadata !== undefined) {
    normalized.metadata = redactSensitiveData(normalized.metadata)
  }
  for (const field of redactedOperationFields) {
    if (normalized[field] !== undefined) {
      normalized[field] = redactSensitiveData(normalized[field])
    }
  }
  normalizeClassification(operation, normalized)
  return {
    ...normalized,
    schemaVersion: 1,
    source: operation.source,
    endpoint,
    endpointKey: buildEndpointKey(normalizedIdentity),
    state,
    createdAt: toTimestamp(operation.createdAt, now),
    updatedAt: toTimestamp(operation.updatedAt, now)
  }
}

export function buildSafetyRequest (request = {}, options = {}) {
  const classification = classifyCommand(request.command)
  const safeRequest = projectDefinedFields(request, safetyRequestInputFields)
  return normalizeOperation({
    ...safeRequest,
    risk: classification.risk,
    provider: classification.provider,
    reversible: classification.reversible,
    recoveryProvider: classification.provider,
    requiresConfirmation: classification.requiresConfirmation,
    reason: classification.reason
  }, options)
}
