const internalHooks = new WeakMap()

function optionalFunction (value, name) {
  if (value !== undefined && typeof value !== 'function') {
    throw new TypeError(`${name} 必须是函数。`)
  }
  return value || (() => {})
}

export function createInternalSubmissionHooks (hooks = {}) {
  const capability = Object.freeze({})
  internalHooks.set(capability, Object.freeze({
    beforeSubmit: optionalFunction(hooks.beforeSubmit, 'beforeSubmit'),
    onAbort: optionalFunction(hooks.onAbort, 'onAbort')
  }))
  return capability
}

export function resolveInternalSubmissionHooks (capability) {
  return internalHooks.get(capability)
}
