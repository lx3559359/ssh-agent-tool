const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const runtimeUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-runtime-context.js'
)).href

function endpoint (overrides = {}) {
  return {
    host: 'srv.test',
    port: 22,
    username: 'ops',
    tabId: 'tab-a',
    pid: 'pid-a',
    terminalPid: 'terminal-a',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:a',
    ...overrides
  }
}

test('Agent execution accepts the same endpoint captured at start', async () => {
  const { resolveAgentExecutionEndpoint } = await import(runtimeUrl)
  const initial = Object.freeze(endpoint())
  assert.deepEqual(resolveAgentExecutionEndpoint({
    descriptor: { scope: 'session' },
    runtime: {
      sourceTabId: 'tab-a',
      endpoint: initial,
      resolveEndpoint: () => endpoint()
    }
  }), initial)
})

test('Agent runtime captures a frozen endpoint copy at start', async () => {
  const { captureAgentRuntimeEndpoint } = await import(runtimeUrl)
  const live = endpoint()
  const captured = captureAgentRuntimeEndpoint(() => live)
  assert.notEqual(captured, live)
  assert.equal(Object.isFrozen(captured), true)
  live.host = 'changed.test'
  assert.equal(captured.host, 'srv.test')
})

test('Agent execution reports a stable endpoint-changed error', async () => {
  const { resolveAgentExecutionEndpoint } = await import(runtimeUrl)
  assert.throws(() => resolveAgentExecutionEndpoint({
    descriptor: { scope: 'session' },
    runtime: {
      sourceTabId: 'tab-a',
      endpoint: endpoint(),
      resolveEndpoint: () => endpoint({ hostKeyFingerprint: 'SHA256:b' })
    }
  }), error => (
    error.code === 'AGENT_ENDPOINT_CHANGED' && Boolean(error.cause)
  ))
})

test('a tab-scoped Agent cannot bind to an endpoint that appeared after start', async () => {
  const { resolveAgentExecutionEndpoint } = await import(runtimeUrl)
  assert.throws(() => resolveAgentExecutionEndpoint({
    descriptor: { scope: 'session' },
    runtime: {
      sourceTabId: 'tab-a',
      endpoint: null,
      resolveEndpoint: () => endpoint()
    }
  }), error => error.code === 'AGENT_ENDPOINT_UNAVAILABLE_AT_START')
})
