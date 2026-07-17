const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const moduleUrl = pathToFileURL(path.join(
  aiRoot,
  'agent-risk-verification-gate.js'
)).href
const registryUrl = pathToFileURL(path.join(
  aiRoot,
  'agent-takeover-registry.js'
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

async function activeRegistry () {
  const { createTakeoverRegistry } = await import(registryUrl)
  const registry = createTakeoverRegistry()
  registry.enable(endpoint())
  registry.transition(endpoint(), 'active-idle')
  return registry
}

test('risk verification requires the exact still-active takeover endpoint', async () => {
  const { assertAgentRiskVerificationAllowed } = await import(moduleUrl)
  const registry = await activeRegistry()
  const runtime = {
    endpoint: endpoint(),
    resolveEndpoint: endpoint,
    takeoverRegistry: registry
  }
  const descriptor = { name: 'read_service_status', scope: 'session-read' }

  assert.deepEqual(assertAgentRiskVerificationAllowed({
    expectedEndpoint: endpoint(),
    runtime,
    descriptor
  }), endpoint())

  registry.disable(endpoint())
  assert.throws(() => assertAgentRiskVerificationAllowed({
    expectedEndpoint: endpoint(),
    runtime,
    descriptor
  }), error => error.code === 'AI_TAKEOVER_REQUIRED')
})

test('risk verification rejects endpoint replacement before any read can start', async () => {
  const { assertAgentRiskVerificationAllowed } = await import(moduleUrl)
  const registry = await activeRegistry()
  const replacement = endpoint({
    tabId: 'tab-b',
    pid: 'pid-b',
    terminalPid: 'terminal-b',
    hostKeyFingerprint: 'SHA256:b'
  })
  registry.enable(replacement)
  registry.transition(replacement, 'active-idle')

  assert.throws(() => assertAgentRiskVerificationAllowed({
    expectedEndpoint: endpoint(),
    runtime: {
      endpoint: endpoint(),
      resolveEndpoint: () => replacement,
      takeoverRegistry: registry
    },
    descriptor: { name: 'read_file_range', scope: 'session-read' }
  }), error => error.code === 'AI_TAKEOVER_REQUIRED' ||
    error.code === 'SAFETY_ENDPOINT_CHANGED')
})
