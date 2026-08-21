import { createTrustedOperationId } from '../../../common/safety-transactions/operation-id.js'

export const operationsResourceConfirmationTtlMs = 60 * 1000

function canonicalize (value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])])
    )
  }
  if (value === undefined) return null
  return value
}

export function serializeOperationsConfirmationParams (params = {}) {
  return JSON.stringify(canonicalize(params))
}

export function createOperationsResourceConfirmation ({
  toolId,
  endpointKey,
  params = {},
  now = Date.now,
  createNonce = () => createTrustedOperationId('operations-confirmation')
} = {}) {
  if (!toolId || !endpointKey) {
    throw new Error('资源敏感确认缺少工具或端点')
  }
  return Object.freeze({
    nonce: createNonce(),
    toolId,
    endpointKey,
    params: serializeOperationsConfirmationParams(params),
    createdAt: Number(now())
  })
}

export function assertOperationsResourceConfirmation ({
  confirmation,
  toolId,
  endpointKey,
  params = {},
  consumedNonces,
  now = Date.now
} = {}) {
  const age = Number(now()) - Number(confirmation?.createdAt)
  if (!confirmation?.nonce ||
    confirmation.toolId !== toolId ||
    confirmation.endpointKey !== endpointKey ||
    confirmation.params !== serializeOperationsConfirmationParams(params) ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > operationsResourceConfirmationTtlMs) {
    throw new Error('资源敏感任务确认无效或已过期')
  }
  if (!(consumedNonces instanceof Set)) {
    throw new Error('资源敏感任务确认存储不可用')
  }
  if (consumedNonces.has(confirmation.nonce)) {
    throw new Error('资源敏感任务确认已经使用')
  }
  consumedNonces.add(confirmation.nonce)
  return true
}
