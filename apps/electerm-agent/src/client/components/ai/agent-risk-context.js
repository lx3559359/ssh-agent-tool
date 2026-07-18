import { AGENT_TOOL_SCOPES } from './agent-tool-scopes.js'

const supportedVerificationTools = new Set([
  'read_service_status',
  'read_recent_logs',
  'verify_listening_port',
  'read_file_range'
])

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

function verificationSchema ({ minItems, maxItems } = {}) {
  return {
    type: 'array',
    minItems,
    ...(maxItems === undefined ? {} : { maxItems }),
    items: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          enum: [...supportedVerificationTools]
        },
        args: { type: 'object' },
        expected: { type: 'object' }
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
    Array.isArray(context.verification) &&
    context.verification.every(step => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return false
      const stepKeys = Object.keys(step)
      return stepKeys.every(key => ['name', 'args', 'expected'].includes(key)) &&
        stepKeys.includes('name') && stepKeys.includes('args') &&
        supportedVerificationTools.has(step.name) &&
        step.args && typeof step.args === 'object' && !Array.isArray(step.args) &&
        (step.expected === undefined || (
          step.expected && typeof step.expected === 'object' &&
          !Array.isArray(step.expected)
        ))
    })
  if (!valid) throw riskContextRequiredError()
  try {
    return deepFreeze(cloneJson(context))
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
