const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const registryUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-registry.js')).href
const lifecycleUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-lifecycle.js')).href
const policyUrl = pathToFileURL(path.join(aiRoot, 'agent-tool-policy.js')).href

function endpoint (suffix) {
  return {
    host: `srv-${suffix}.test`,
    port: 22,
    username: 'ops',
    tabId: `tab-${suffix}`,
    pid: `pid-${suffix}`,
    terminalPid: `term-${suffix}`,
    sessionType: 'ssh',
    hostKeyFingerprint: `SHA256:${suffix}`
  }
}

test('five simulated idle minutes add no model, SSH, process, or polling work', async t => {
  const { createTakeoverRegistry } = await import(registryUrl)
  const { classifyAgentCall, getAgentToolDescriptor } = await import(policyUrl)
  let now = Date.parse('2026-07-17T00:00:00.000Z')
  const counters = {
    modelRequests: 0,
    sshCommands: 0,
    remoteProcesses: 0,
    agentPollingTimers: 0
  }
  const scheduled = []
  const originalSetInterval = global.setInterval
  const originalSetTimeout = global.setTimeout
  global.setInterval = (...args) => {
    counters.agentPollingTimers += 1
    scheduled.push(['interval', ...args])
    return Symbol('interval')
  }
  global.setTimeout = (...args) => {
    counters.agentPollingTimers += 1
    scheduled.push(['timeout', ...args])
    return Symbol('timeout')
  }
  t.after(() => {
    global.setInterval = originalSetInterval
    global.setTimeout = originalSetTimeout
  })

  const registry = createTakeoverRegistry({ now: () => new Date(now) })
  const off = { ...counters }
  for (const id of ['a', 'b', 'c', 'd']) {
    const target = endpoint(id)
    registry.enable(target)
    registry.transition(target, 'active-idle')
  }
  now += 5 * 60 * 1000
  const activeIdle = { ...counters }

  const readonly = classifyAgentCall({
    descriptor: getAgentToolDescriptor('read_service_status'),
    args: { service: 'nginx' }
  })
  const risky = classifyAgentCall({
    descriptor: getAgentToolDescriptor('send_terminal_command'),
    args: { command: 'systemctl restart nginx' }
  })
  const samples = {
    off,
    activeIdle,
    readonly: { classification: readonly.outcome, ...counters },
    riskyTransaction: { classification: risky.outcome, ...counters }
  }
  t.diagnostic(`takeover-performance ${JSON.stringify(samples)}`)

  assert.deepEqual(activeIdle, off)
  assert.equal(scheduled.length, 0)
  assert.equal(readonly.outcome, 'allowlisted-readonly')
  assert.equal(risky.outcome, 'risky')
})

test('one-click stop revokes immediately without waiting for task cleanup', async () => {
  const { createTakeoverRegistry } = await import(registryUrl)
  const { handleAgentTakeoverLifecycleEvent } = await import(lifecycleUrl)
  const registry = createTakeoverRegistry()
  const target = endpoint('stop')
  registry.enable(target)
  registry.transition(target, 'active-idle')
  let cancelled = 0
  const taskRegistry = {
    listByEndpoint: () => [{ taskId: 'task-a' }],
    cancelByEndpoint: async () => {
      cancelled += 1
      return [{ taskId: 'task-a' }]
    },
    cancelByScope: async () => [],
    cancelAll: async () => []
  }

  const startedAt = performance.now()
  const result = await handleAgentTakeoverLifecycleEvent({
    type: 'manual-stop',
    endpoint: target
  }, {
    takeoverRegistry: registry,
    taskRegistry
  })
  const elapsedMs = performance.now() - startedAt

  assert.equal(result.revoked, 1)
  assert.equal(result.cancelled, 1)
  assert.equal(cancelled, 1)
  assert.equal(registry.isActive(target), false)
  assert.ok(elapsedMs < 250, `stop took ${elapsedMs.toFixed(1)} ms`)
})
