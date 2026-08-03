export function createAgentRuntimeServices (overrides = {}) {
  const browser = globalThis.window || {}
  const store = overrides.store || browser.store
  return Object.freeze({
    store,
    pre: overrides.pre || browser.pre,
    refs: overrides.refs || browser.refs,
    translate: overrides.translate || browser.translate || (key => key),
    now: overrides.now || Date.now,
    reportError: overrides.reportError || (error => store?.onError?.(error))
  })
}
