import { AGENT_TOOL_SCOPES } from './agent-tool-scopes.js'

export const agentVerificationToolNames = Object.freeze([
  'read_service_status',
  'read_recent_logs',
  'verify_listening_port',
  'read_file_range'
])
const supportedVerificationTools = new Set(agentVerificationToolNames)

const verificationPredicateRegistry = Object.freeze({
  exitCode: Object.freeze({
    schema: Object.freeze({ type: 'integer' }),
    valid: value => Number.isInteger(value),
    matches: (expected, result) => result?.exitCode === expected,
    failure: name => `Verification ${name} exit code did not match`
  }),
  contains: Object.freeze({
    schema: Object.freeze({ type: 'string', minLength: 1 }),
    valid: value => typeof value === 'string' && value.length > 0,
    matches: (expected, result) => String(result?.output ?? '').includes(expected),
    failure: name => `Verification ${name} output did not contain expected text`
  }),
  notContains: Object.freeze({
    schema: Object.freeze({ type: 'string', minLength: 1 }),
    valid: value => typeof value === 'string' && value.length > 0,
    matches: (expected, result) => !String(result?.output ?? '').includes(expected),
    failure: name => `Verification ${name} output contained forbidden text`
  })
})

export const agentVerificationExpectedSchema = deepFreeze({
  type: 'object',
  properties: Object.fromEntries(Object.entries(verificationPredicateRegistry)
    .map(([name, predicate]) => [name, predicate.schema])),
  minProperties: 1,
  additionalProperties: false
})

function cloneJson (value) {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value))
}

function deepFreeze (value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function riskContextRequiredError () {
  const error = new Error(
    'Agent risky operations require purpose, impact targets and applicable verification'
  )
  error.code = 'AGENT_RISK_CONTEXT_REQUIRED'
  return error
}

function normalizeVerificationExpected (expected) {
  if (expected === undefined) return { exitCode: 0 }
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    throw riskContextRequiredError()
  }
  const keys = Object.keys(expected)
  if (keys.length === 0 || keys.some(key => !verificationPredicateRegistry[key])) {
    throw riskContextRequiredError()
  }
  const normalized = { exitCode: 0 }
  for (const key of keys) {
    if (!verificationPredicateRegistry[key].valid(expected[key])) {
      throw riskContextRequiredError()
    }
    normalized[key] = expected[key]
  }
  return normalized
}

export function assertAgentVerificationExpectation (step, result) {
  if (!step || !supportedVerificationTools.has(step.name)) {
    throw riskContextRequiredError()
  }
  const expected = normalizeVerificationExpected(step.expected)
  for (const [name, value] of Object.entries(expected)) {
    const predicate = verificationPredicateRegistry[name]
    if (!predicate.matches(value, result)) {
      throw new Error(predicate.failure(step.name))
    }
  }
  return true
}

function verificationSchema ({ minItems, maxItems } = {}) {
  return {
    type: 'array',
    minItems,
    ...(maxItems === undefined ? {} : { maxItems }),
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: [...agentVerificationToolNames] },
        args: { type: 'object' },
        expected: agentVerificationExpectedSchema
      },
      required: ['name', 'args'],
      additionalProperties: false
    }
  }
}

function contextSchema (verification) {
  return deepFreeze({
    type: 'object',
    properties: {
      purpose: { type: 'string', minLength: 1 },
      impactTargets: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 }
      },
      verification
    },
    required: ['purpose', 'impactTargets', 'verification'],
    additionalProperties: false
  })
}

export const agentRemoteRiskContextSchema = contextSchema(
  verificationSchema({ minItems: 1 })
)

export const agentSessionControlRiskContextSchema = contextSchema(
  verificationSchema({ minItems: 0, maxItems: 0 })
)

export const agentArtifactRiskContextSchema = contextSchema(
  verificationSchema({ minItems: 0 })
)

export const agentRiskContextSchema = agentRemoteRiskContextSchema

function assertRiskContextEnvelope (context) {
  const contextKeys = context && typeof context === 'object' &&
    !Array.isArray(context)
    ? Object.keys(context)
    : []
  const valid = contextKeys.length === 3 &&
    contextKeys.every(key => [
      'purpose',
      'impactTargets',
      'verification'
    ].includes(key)) &&
    typeof context.purpose === 'string' && Boolean(context.purpose.trim()) &&
    Array.isArray(context.impactTargets) && context.impactTargets.length > 0 &&
    context.impactTargets.every(item => (
      typeof item === 'string' && Boolean(item.trim())
    )) &&
    Array.isArray(context.verification) && context.verification.every(step => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return false
    const stepKeys = Object.keys(step)
    return stepKeys.every(key => ['name', 'args', 'expected'].includes(key)) &&
      stepKeys.includes('name') && stepKeys.includes('args') &&
      supportedVerificationTools.has(step.name) &&
      step.args && typeof step.args === 'object' && !Array.isArray(step.args)
  })
  if (!valid) throw riskContextRequiredError()
  try {
    return deepFreeze({
      purpose: context.purpose,
      impactTargets: cloneJson(context.impactTargets),
      verification: context.verification.map(step => ({
        name: step.name,
        args: cloneJson(step.args),
        expected: normalizeVerificationExpected(step.expected)
      }))
    })
  } catch {
    throw riskContextRequiredError()
  }
}

export function assertAgentRemoteRiskContext (context) {
  const validated = assertRiskContextEnvelope(context)
  if (validated.verification.length < 1) throw riskContextRequiredError()
  return validated
}

export function assertAgentSessionControlRiskContext (context) {
  const validated = assertRiskContextEnvelope(context)
  if (validated.verification.length !== 0) throw riskContextRequiredError()
  return validated
}

export function assertAgentArtifactRiskContext (context) {
  return assertRiskContextEnvelope(context)
}

export const assertAgentRiskContext = assertAgentRemoteRiskContext

export function resolveAgentRiskContextMode ({
  toolName,
  descriptor,
  classification,
  skillArtifact
} = {}) {
  if (classification?.outcome !== 'risky') return null
  if (skillArtifact?.target === 'remote') return 'remote-verification'
  if (skillArtifact?.target === 'local') return 'session-control'
  if (String(toolName || descriptor?.function?.name || descriptor?.name) ===
    'run_skill_artifact') return 'artifact'
  const name = String(toolName || descriptor?.function?.name || descriptor?.name)
  const scope = descriptor?.scope || AGENT_TOOL_SCOPES[name]
  if (scope === 'session-control') return 'session-control'
  return 'remote-verification'
}

export function agentRiskCallsRequireVerification (calls = []) {
  if (!Array.isArray(calls) || calls.length === 0) return true
  return calls.some(call => resolveAgentRiskContextMode({
    toolName: call?.name,
    descriptor: call?.descriptor,
    classification: call?.classification,
    skillArtifact: call?.skillArtifact
  }) !== 'session-control')
}

export function assertAgentRiskContextForCall ({
  toolName,
  args,
  descriptor,
  classification,
  skillArtifact
} = {}) {
  const mode = resolveAgentRiskContextMode({
    toolName,
    descriptor,
    classification,
    skillArtifact
  })
  if (mode === null) return null
  if (mode === 'artifact') return assertAgentArtifactRiskContext(args?.riskContext)
  if (mode === 'session-control') {
    return assertAgentSessionControlRiskContext(args?.riskContext)
  }
  return assertAgentRemoteRiskContext(args?.riskContext)
}
