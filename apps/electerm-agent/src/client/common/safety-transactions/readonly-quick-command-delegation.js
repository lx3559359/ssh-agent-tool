const readonlyQuickCommandDelegations = new WeakMap()

function cloneJson (value) {
  return JSON.parse(JSON.stringify(value))
}

function deepFreeze (value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export function createInternalReadonlyQuickCommandDelegation (details = {}) {
  const command = String(details.command || '')
  const quickCommandId = String(details.quickCommandId || '')
  if (!command.trim() || !quickCommandId ||
    !details.endpoint || typeof details.endpoint !== 'object') {
    throw new TypeError('Invalid internal readonly quick command delegation')
  }
  const capability = Object.freeze({})
  readonlyQuickCommandDelegations.set(capability, deepFreeze(cloneJson({
    command,
    quickCommandId,
    endpoint: details.endpoint
  })))
  return capability
}

export function consumeInternalReadonlyQuickCommandDelegation (capability) {
  const delegation = readonlyQuickCommandDelegations.get(capability)
  readonlyQuickCommandDelegations.delete(capability)
  return delegation
}
