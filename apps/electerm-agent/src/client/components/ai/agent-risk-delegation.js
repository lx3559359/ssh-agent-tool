import {
  createInternalCommandRiskDelegation
} from '../../common/safety-transactions/command-risk-delegation.js'

const delegatedStructuredTools = new Set(['sftp_del'])
const delegatedCommandTools = new Set([
  'send_terminal_command',
  'run_background_command'
])
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

function stableSerialize (value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

function confirmationRequiredError () {
  const error = new Error(
    'Agent safety confirmation may be delegated only to an exact lower safety transaction'
  )
  error.code = 'AGENT_RISK_CONFIRMATION_REQUIRED'
  return error
}

export function shouldDelegateAgentSafetyConfirmation (
  toolName,
  args = {},
  options = {}
) {
  const name = String(toolName || '')
  if (!delegatedStructuredTools.has(name) && !delegatedCommandTools.has(name)) {
    return false
  }
  const sessionType = options.endpoint?.sessionType || options.endpoint?.type
  return String(sessionType || '').toLowerCase() === 'ssh'
}

function riskContextRequiredError () {
  const error = new Error(
    'Agent risky operations require purpose, impact targets and verification'
  )
  error.code = 'AGENT_RISK_CONTEXT_REQUIRED'
  return error
}

export const agentRiskContextSchema = deepFreeze({
  type: 'object',
  properties: {
    purpose: { type: 'string', minLength: 1 },
    impactTargets: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 }
    },
    verification: {
      type: 'array',
      minItems: 1,
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
  },
  required: ['purpose', 'impactTargets', 'verification'],
  additionalProperties: false
})

export function assertAgentRiskContext (context) {
  const valid = context && typeof context === 'object' && !Array.isArray(context) &&
    typeof context.purpose === 'string' && Boolean(context.purpose.trim()) &&
    Array.isArray(context.impactTargets) && context.impactTargets.length > 0 &&
    context.impactTargets.every(item => (
      typeof item === 'string' && Boolean(item.trim())
    )) &&
    Array.isArray(context.verification) && context.verification.length > 0 &&
    context.verification.every(step => (
      step && typeof step === 'object' && !Array.isArray(step) &&
      supportedVerificationTools.has(step.name) &&
      step.args && typeof step.args === 'object' && !Array.isArray(step.args) &&
      (step.expected === undefined || (
        step.expected && typeof step.expected === 'object' &&
        !Array.isArray(step.expected)
      ))
    ))
  if (!valid) throw riskContextRequiredError()
  try {
    return deepFreeze(cloneJson(context))
  } catch {
    throw riskContextRequiredError()
  }
}

export function assertAgentRiskContextForCall ({ args, classification } = {}) {
  if (classification?.outcome !== 'risky') return null
  return assertAgentRiskContext(args?.riskContext)
}

export function createDelegatedAgentSafetyPreparation (
  toolName,
  args = {},
  options = {}
) {
  if (!shouldDelegateAgentSafetyConfirmation(toolName, args, options)) {
    throw confirmationRequiredError()
  }
  const confirmedArgs = deepFreeze(cloneJson(args))
  const riskContext = assertAgentRiskContext(confirmedArgs.riskContext)
  const classification = deepFreeze(cloneJson(options.classification || {}))
  const endpoint = deepFreeze(cloneJson(options.endpoint || {}))
  const safetyDelegationCapability = delegatedCommandTools.has(String(toolName))
    ? createInternalCommandRiskDelegation({
      toolName,
      command: confirmedArgs.command,
      endpoint,
      riskContext,
      classification
    })
    : undefined
  return Object.freeze({
    delegatedSafetyConfirmation: true,
    toolName: String(toolName),
    confirmedArgs,
    endpoint,
    verification: deepFreeze(cloneJson(
      options.verification ?? riskContext.verification
    )),
    ...(safetyDelegationCapability ? { safetyDelegationCapability } : {}),
    executionState: { result: undefined }
  })
}

export function validateDelegatedAgentSafetyPreparation ({
  toolName,
  args,
  endpoint,
  delegatedPreparation
} = {}) {
  if (
    delegatedPreparation?.delegatedSafetyConfirmation !== true ||
    delegatedPreparation.toolName !== String(toolName || '') ||
    !shouldDelegateAgentSafetyConfirmation(
      toolName,
      delegatedPreparation.confirmedArgs,
      { endpoint }
    ) ||
    stableSerialize(args || {}) !== stableSerialize(delegatedPreparation.confirmedArgs) ||
    stableSerialize(endpoint || {}) !== stableSerialize(delegatedPreparation.endpoint || {}) ||
    stableSerialize(delegatedPreparation.verification || []) !== stableSerialize(
      delegatedPreparation.confirmedArgs?.riskContext?.verification || []
    )
  ) {
    throw confirmationRequiredError()
  }
  return deepFreeze({
    name: String(toolName),
    args: cloneJson(delegatedPreparation.confirmedArgs)
  })
}
