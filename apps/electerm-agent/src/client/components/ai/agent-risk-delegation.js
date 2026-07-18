const delegatedStructuredTools = new Set(['sftp_del'])
const delegatedCommandTools = new Set([
  'send_terminal_command',
  'run_background_command'
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

export function createDelegatedAgentSafetyPreparation (
  toolName,
  args = {},
  options = {}
) {
  if (!shouldDelegateAgentSafetyConfirmation(toolName, args, options)) {
    throw confirmationRequiredError()
  }
  const confirmedArgs = deepFreeze(cloneJson(args))
  return Object.freeze({
    delegatedSafetyConfirmation: true,
    toolName: String(toolName),
    confirmedArgs,
    endpoint: deepFreeze(cloneJson(options.endpoint || {})),
    verification: deepFreeze(cloneJson(
      options.verification ?? confirmedArgs?.riskContext?.verification ?? []
    )),
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
