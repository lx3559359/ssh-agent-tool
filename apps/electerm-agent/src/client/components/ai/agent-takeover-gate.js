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
  registry,
  execute
} = {}) {
  assertAgentExecutionAllowed({ descriptor, endpoint, registry })
  if (typeof execute !== 'function') {
    throw new TypeError('Agent tool executor must be a function')
  }
  return await execute()
}
