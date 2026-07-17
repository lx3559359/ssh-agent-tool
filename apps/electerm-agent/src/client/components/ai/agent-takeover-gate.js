const sessionScopes = new Set([
  'session-read',
  'session-write',
  'session-control'
])

function takeoverRequiredError (cause) {
  if (cause?.code === 'AI_TAKEOVER_REQUIRED') return cause
  const error = new Error('AI takeover must be enabled for this SSH session')
  error.code = 'AI_TAKEOVER_REQUIRED'
  if (cause) error.cause = cause
  return error
}

export function assertAgentExecutionAllowed ({
  descriptor,
  endpoint,
  registry
} = {}) {
  const scope = descriptor?.scope
  if (scope === 'conversation') return true
  if (!sessionScopes.has(scope)) {
    const error = new Error(`Invalid Agent tool scope: ${String(scope)}`)
    error.code = 'INVALID_AGENT_TOOL_SCOPE'
    throw error
  }
  if (typeof registry?.assertActive !== 'function') {
    throw takeoverRequiredError()
  }
  try {
    registry.assertActive(endpoint)
  } catch (error) {
    throw takeoverRequiredError(error)
  }
  return true
}

export async function executeAgentToolWithGate ({
  descriptor,
  endpoint,
  resolveEndpoint,
  registry,
  risk = false,
  prepare,
  execute
} = {}) {
  if (typeof execute !== 'function') {
    throw new TypeError('Agent tool executor must be a function')
  }
  const currentEndpoint = () => typeof resolveEndpoint === 'function'
    ? resolveEndpoint()
    : endpoint
  const changing = risk || descriptor?.scope === 'session-write' ||
    descriptor?.scope === 'session-control'
  let verifiedEndpoint = currentEndpoint()
  assertAgentExecutionAllowed({
    descriptor,
    endpoint: verifiedEndpoint,
    registry
  })

  const transition = (from, to) => {
    if (typeof registry?.get !== 'function' ||
      typeof registry?.transition !== 'function') return false
    const record = registry.get(verifiedEndpoint)
    const expected = Array.isArray(from) ? from : [from]
    if (!record || !expected.includes(record.state)) return false
    registry.transition(verifiedEndpoint, to)
    return true
  }

  if (changing) {
    transition(['failed', 'partially-completed'], 'active-idle')
    transition('active-idle', 'awaiting-risk-confirmation')
  }

  try {
    const prepared = typeof prepare === 'function'
      ? await prepare()
      : undefined

    verifiedEndpoint = currentEndpoint()
    assertAgentExecutionAllowed({
      descriptor,
      endpoint: verifiedEndpoint,
      registry
    })
    if (prepared?.handled === true) {
      if (changing) transition('awaiting-risk-confirmation', 'active-idle')
      return prepared.result
    }

    if (changing) {
      transition('awaiting-risk-confirmation', 'running-confirmed-change')
    } else if (descriptor?.scope === 'session-read') {
      transition(['failed', 'partially-completed'], 'active-idle')
      transition('active-idle', 'running-readonly')
    }

    const result = await execute()
    if (changing && transition('running-confirmed-change', 'verifying')) {
      transition('verifying', 'active-idle')
    } else if (!changing) {
      transition('running-readonly', 'active-idle')
    }
    return result
  } catch (error) {
    transition([
      'running-readonly',
      'awaiting-risk-confirmation',
      'running-confirmed-change',
      'verifying'
    ], 'failed')
    throw error
  }
}
