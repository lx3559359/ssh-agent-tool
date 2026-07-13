import { classifyCommand } from './command-classifier.js'
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
  const endpoint = {
    ...operation.endpoint,
    ...normalizedIdentity
  }
  return {
    ...operation,
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
  return normalizeOperation({
    ...request,
    risk: classification.risk,
    reversible: classification.reversible,
    recoveryProvider: classification.provider,
    requiresConfirmation: classification.requiresConfirmation,
    reason: classification.reason
  }, options)
}
