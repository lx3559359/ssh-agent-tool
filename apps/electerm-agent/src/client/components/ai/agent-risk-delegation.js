import { classifyCommand } from '../../common/safety-transactions/command-classifier.js'

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

export function shouldDelegateAgentSafetyConfirmation (toolName, args = {}) {
  const name = String(toolName || '')
  if (delegatedStructuredTools.has(name)) return true
  if (!delegatedCommandTools.has(name)) return false
  return classifyCommand(args.command).reversible === true
}

export function createDelegatedAgentSafetyPreparation (toolName, args = {}) {
  if (!shouldDelegateAgentSafetyConfirmation(toolName, args)) {
    throw confirmationRequiredError()
  }
  return deepFreeze({
    delegatedSafetyConfirmation: true,
    toolName: String(toolName),
    confirmedArgs: cloneJson(args)
  })
}

export function validateDelegatedAgentSafetyPreparation ({
  toolName,
  args,
  delegatedPreparation
} = {}) {
  if (
    delegatedPreparation?.delegatedSafetyConfirmation !== true ||
    delegatedPreparation.toolName !== String(toolName || '') ||
    !shouldDelegateAgentSafetyConfirmation(toolName, delegatedPreparation.confirmedArgs) ||
    stableSerialize(args || {}) !== stableSerialize(delegatedPreparation.confirmedArgs)
  ) {
    throw confirmationRequiredError()
  }
  return deepFreeze({
    name: String(toolName),
    args: cloneJson(delegatedPreparation.confirmedArgs)
  })
}
