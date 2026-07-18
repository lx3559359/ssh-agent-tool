const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const aiRoot = path.join(root, 'src/client/components/ai')
const runtimeUrl = pathToFileURL(path.join(aiRoot, 'agent-runtime-context.js')).href
const gateUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-gate.js')).href
const registryUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-registry.js')).href

function endpoint () {
  return {
    host: 'concrete.example.test',
    port: 22,
    username: 'ops',
    tabId: 'tab-concrete',
    pid: 'pid-concrete',
    terminalPid: 'pid-concrete',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:concrete'
  }
}

test('Fleet conversation can use observations but cannot borrow a concrete tab grant', async () => {
  const { resolveAgentRuntimeEndpoint } = await import(runtimeUrl)
  const { executeAgentToolWithGate } = await import(gateUrl)
  const { createTakeoverRegistry } = await import(registryUrl)
  const registry = createTakeoverRegistry()
  registry.enable(endpoint())
  registry.transition(endpoint(), 'active-idle')

  assert.equal(resolveAgentRuntimeEndpoint('fleet-status', { refs: new Map() }), null)
  await assert.rejects(
    executeAgentToolWithGate({
      descriptor: { scope: 'session-read' },
      endpoint: null,
      registry,
      execute: () => assert.fail('Fleet must not execute a remote tool')
    }),
    error => error.code === 'AI_TAKEOVER_REQUIRED'
  )
  assert.equal(await executeAgentToolWithGate({
    descriptor: { scope: 'conversation' },
    execute: () => 'observation-summary'
  }), 'observation-summary')
})

test('Fleet workspace receives an isolated conversation scope and no SSH tab id', () => {
  const main = fs.readFileSync(path.join(
    root,
    'src/client/components/main/main.jsx'
  ), 'utf8')
  const chat = fs.readFileSync(path.join(aiRoot, 'ai-chat.jsx'), 'utf8')
  const fleetContext = fs.readFileSync(path.join(
    root,
    'src/client/components/fleet-status/fleet-status-ai-context.js'
  ), 'utf8')

  assert.match(main, /aiSessionTabId\s*=\s*fleetStatusActive\s*\?\s*''\s*:\s*activeTabId/)
  assert.match(main, /aiConversationScopeId\s*=\s*fleetStatusActive[\s\S]*?'fleet-status'/)
  assert.match(chat, /props\.conversationScopeId \|\| props\.activeTabId \|\| 'global'/)
  assert.match(fleetContext, /buildFleetStatusAiPrompt/)
  assert.doesNotMatch(fleetContext, /agentTakeoverRegistry|takeoverGrants/)
})
