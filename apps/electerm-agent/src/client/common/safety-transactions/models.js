import { classifyCommand } from './command-classifier.js'
import { redactSensitiveData } from './audit-redaction.js'
import { buildEndpointKey, normalizeEndpoint } from './endpoint-guard.js'

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
  'tabId', 'host', 'port', 'username', 'title', 'pid', 'terminalPid', 'sessionType'
]
const normalizedOperationFields = [
  'id', 'source', 'command', 'title', 'state', 'createdAt', 'updatedAt',
  'metadata', 'risk', 'reversible', 'recoveryProvider',
  'requiresConfirmation', 'reason', 'plan', 'recoveryBinding', 'artifacts', 'audit',
  'recoveryReadyAt', 'executionId', 'error', 'failedAt', 'completedAt',
  'timeoutMs', 'prepareTimeoutMs', 'executeTimeoutMs',
  'rollbackTimeoutMs', 'verifyTimeoutMs'
]
const redactedOperationFields = new Set([
  'plan', 'artifacts', 'audit', 'error'
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
  if (provider !== undefined && provider !== null && !validRecoveryProviders.has(provider)) {
    throw new Error('安全事务恢复提供方不受支持')
  }
  const reversible = operation.risk === operationRisks.change &&
    operation.reversible === true && validRecoveryProviders.has(provider)
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
    reversible: classification.reversible,
    recoveryProvider: classification.provider,
    requiresConfirmation: classification.requiresConfirmation,
    reason: classification.reason
  }, options)
}
