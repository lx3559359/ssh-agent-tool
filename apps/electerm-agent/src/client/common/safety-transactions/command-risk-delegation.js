const internalRiskDelegations = new WeakMap()
const delegatedAgentTools = new Set([
  'send_terminal_command',
  'run_background_command'
])

function cloneJson (value) {
  return JSON.parse(JSON.stringify(value))
}

function deepFreeze (value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function hasRiskContextShape (context) {
  return context && typeof context === 'object' && !Array.isArray(context) &&
    typeof context.purpose === 'string' && Boolean(context.purpose.trim()) &&
    Array.isArray(context.impactTargets) && context.impactTargets.length > 0 &&
    context.impactTargets.every(item => (
      typeof item === 'string' && Boolean(item.trim())
    )) &&
    Array.isArray(context.verification) && context.verification.length > 0
}

export function createInternalCommandRiskDelegation (details = {}) {
  const command = String(details.command || '')
  const toolName = String(details.toolName || '')
  if (!command.trim() || !delegatedAgentTools.has(toolName) ||
    details.classification?.outcome !== 'risky' ||
    !hasRiskContextShape(details.riskContext) ||
    !details.endpoint || typeof details.endpoint !== 'object') {
    throw new TypeError('Invalid internal Agent command risk delegation')
  }
  const capability = Object.freeze({})
  internalRiskDelegations.set(capability, deepFreeze(cloneJson({
    toolName,
    command,
    endpoint: details.endpoint,
    riskContext: details.riskContext,
    classification: details.classification
  })))
  return capability
}

export function consumeInternalCommandRiskDelegation (capability) {
  const delegation = internalRiskDelegations.get(capability)
  internalRiskDelegations.delete(capability)
  return delegation
}
