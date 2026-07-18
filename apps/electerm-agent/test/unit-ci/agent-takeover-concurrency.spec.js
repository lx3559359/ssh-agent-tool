const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const registryUrl = pathToFileURL(path.join(
  root,
  'src/client/components/ai/agent-task-registry.js'
)).href

function endpoint (suffix = 'a') {
  return {
    host: `${suffix}.example.test`,
    port: 22,
    username: 'ops',
    tabId: `tab-${suffix}`,
    pid: `pid-${suffix}`,
    terminalPid: `pid-${suffix}`,
    sessionType: 'ssh',
    hostKeyFingerprint: `SHA256:${suffix}`
  }
}

function registration (taskId, suffix, cancellations) {
  return {
    taskId,
    endpoint: endpoint(suffix),
    scopeId: `tab-${suffix}`,
    controller: new AbortController(),
    runner: {
      cancel: async id => {
        cancellations.push(id)
        return { id, status: 'cancelled' }
      }
    }
  }
}

test('one exact SSH identity has one Agent task while different sessions coexist', async () => {
  const { createAgentTaskRegistry } = await import(registryUrl)
  const registry = createAgentTaskRegistry()
  const cancellations = []
  registry.register(registration('task-a', 'a', cancellations))

  assert.throws(
    () => registry.register(registration('task-a-duplicate', 'a', cancellations)),
    error => error.code === 'AI_AGENT_SESSION_BUSY'
  )
  assert.doesNotThrow(
    () => registry.register(registration('task-b', 'b', cancellations))
  )
  assert.equal(registry.isEndpointBusy(endpoint('a')), true)
  assert.equal(registry.isEndpointBusy(endpoint('b')), true)
  assert.equal(registry.isScopeBusy('tab-a'), true)
  assert.equal(registry.size, 2)

  const cancelled = await registry.cancelByEndpoint(endpoint('a'))
  assert.equal(cancelled.length, 1)
  assert.deepEqual(cancellations, ['task-a'])
  assert.equal(registry.isEndpointBusy(endpoint('a')), false)
  assert.equal(registry.isEndpointBusy(endpoint('b')), true)
})

test('chat Agent concurrency and UI busy state derive from the task registry', () => {
  const agent = fs.readFileSync(path.join(
    root,
    'src/client/components/ai/agent.js'
  ), 'utf8')
  const chat = fs.readFileSync(path.join(
    root,
    'src/client/components/ai/ai-chat.jsx'
  ), 'utf8')
  const history = fs.readFileSync(path.join(
    root,
    'src/client/components/ai/ai-chat-history.jsx'
  ), 'utf8')

  assert.match(agent, /agentTaskRegistry\.register/)
  assert.match(agent, /agentTaskRegistry\.unregister/)
  assert.doesNotMatch(agent, /window\.store\.agentRunning/)
  assert.match(chat, /agentTaskRegistry\.subscribe/)
  assert.match(chat, /agentTaskRegistry\.isEndpointBusy/)
  assert.match(chat, /agentTaskRegistry\.isScopeBusy/)
  assert.match(history, /function AIChatHistory \(\{ history, agentRunning \}\)/)
  assert.doesNotMatch(history, /window\.store\?\.agentRunning/)
})
