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

const validStates = new Set(Object.values(operationStates))
const validSources = new Set(operationSources)
const endpointIdentityFields = [
  'tabId', 'host', 'port', 'username', 'title', 'pid', 'terminalPid', 'sessionType'
]
const normalizedOperationFields = [
  'id', 'source', 'command', 'title', 'state', 'createdAt', 'updatedAt',
  'metadata', 'risk', 'reversible', 'recoveryProvider',
  'requiresConfirmation', 'reason'
]
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
