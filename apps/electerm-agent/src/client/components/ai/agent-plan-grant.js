export const agentPlanGrantSchemaVersion = 1
export const agentPlanGrantAlgorithm = 'SHA-256'

const payloadFields = Object.freeze([
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

function invalidPlan (message) {
  const error = new Error(message)
  error.code = 'AGENT_PLAN_INVALID'
  throw error
}

function isPlainObject (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function cloneJsonValue (value, path = 'plan') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidPlan(`${path} must contain finite JSON numbers`)
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).map(key => {
      const child = value[key]
      if (child === undefined) invalidPlan(`${path}.${key} must not be undefined`)
      return [key, cloneJsonValue(child, `${path}.${key}`)]
    }))
  }
  invalidPlan(`${path} must contain JSON values only`)
}

function requireArray (value, field) {
  if (!Array.isArray(value)) invalidPlan(`${field} must be an array`)
}

function requireObject (value, field) {
  if (!isPlainObject(value)) invalidPlan(`${field} must be an object`)
}

export function createPlanPayload (plan = {}) {
  if (plan.schemaVersion !== agentPlanGrantSchemaVersion) {
    invalidPlan('Unsupported Agent plan schema version')
  }
  requireObject(plan.endpoint, 'endpoint')
  if (!String(plan.goal || '').trim()) invalidPlan('goal is required')
  requireArray(plan.orderedCalls, 'orderedCalls')
  requireArray(plan.skillBindings, 'skillBindings')
  requireArray(plan.artifactDigests, 'artifactDigests')
  requireArray(plan.impactTargets, 'impactTargets')
  requireObject(plan.resourceImpact, 'resourceImpact')
  if (plan.recovery !== null) requireObject(plan.recovery, 'recovery')
  requireArray(plan.verification, 'verification')

  return Object.fromEntries(payloadFields.map(field => [
    field,
    cloneJsonValue(plan[field], field)
  ]))
}

function stableSerialize (value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

function deepFreeze (value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

async function sha256 (text) {
  if (!globalThis.crypto?.subtle) {
    const error = new Error('SHA-256 is unavailable in this runtime')
    error.code = 'AGENT_PLAN_CRYPTO_UNAVAILABLE'
    throw error
  }
  const digest = await globalThis.crypto.subtle.digest(
    agentPlanGrantAlgorithm,
    new TextEncoder().encode(text)
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function digestPlanPayload (plan) {
  return sha256(stableSerialize(createPlanPayload(plan)))
}

function confirmedTimestamp (now) {
  const value = typeof now === 'function' ? now() : (now ?? new Date())
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) invalidPlan('confirmedAt is invalid')
  return date.toISOString()
}

export async function createPlanGrant (plan, options = {}) {
  const payload = createPlanPayload(plan)
  const confirmedBy = String(options.confirmedBy || '').trim()
  if (!confirmedBy) invalidPlan('confirmedBy is required')
  return deepFreeze({
    schemaVersion: agentPlanGrantSchemaVersion,
    algorithm: agentPlanGrantAlgorithm,
    digest: await sha256(stableSerialize(payload)),
    confirmedAt: confirmedTimestamp(options.now),
    confirmedBy,
    payload
  })
}

export async function verifyPlanGrant (plan, grant) {
  if (grant?.schemaVersion !== agentPlanGrantSchemaVersion ||
    grant?.algorithm !== agentPlanGrantAlgorithm ||
    !/^[a-f0-9]{64}$/.test(String(grant?.digest || '')) ||
    !String(grant?.confirmedBy || '').trim()) {
    return false
  }
  try {
    const payload = createPlanPayload(plan)
    const digest = await sha256(stableSerialize(payload))
    return digest === grant.digest &&
      stableSerialize(payload) === stableSerialize(grant.payload)
  } catch {
    return false
  }
}
