const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const runtimeUrl = pathToFileURL(path.join(aiRoot, 'agent-runtime-context.js')).href
const lifecycleUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-lifecycle.js')).href
const registryUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-registry.js')).href
const taskRegistryUrl = pathToFileURL(path.join(aiRoot, 'agent-task-registry.js')).href

function endpoint () {
  return {
    host: 'srv.test',
    port: 22,
    username: 'ops',
    tabId: 'tab-a',
    pid: 'pid-a',
    terminalPid: 'terminal-a',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:a',
    sshSessionGeneration: 'session-a',
    sshTerminalPid: 1001
  }
}

test('registered remote cancellation is awaited and runs once', async () => {
  const {
    cancelAgentRuntimeOperations,
    registerAgentCancellation
  } = await import(runtimeUrl)
  const runtime = { cancellations: new Set() }
  let release
  let calls = 0
  registerAgentCancellation(runtime, () => {
    calls += 1
    return new Promise(resolve => {
      release = resolve
    })
  })

  let settled = false
  const cancellation = cancelAgentRuntimeOperations(runtime)
    .then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  release({ success: true })
  await cancellation
  await cancelAgentRuntimeOperations(runtime)
  assert.equal(calls, 1)
})

test('resource cancellation registered before startup joins a late resource', async () => {
  const {
    cancelAgentRuntimeOperations,
    registerDeferredAgentCancellation
  } = await import(runtimeUrl)
  const runtime = { cancellations: new Set() }
  let publishResource
  let releaseStop
  const resource = new Promise(resolve => { publishResource = resolve })
  const stopped = []
  registerDeferredAgentCancellation(runtime, resource, value => (
    new Promise(resolve => {
      stopped.push(value)
      releaseStop = resolve
    })
  ))

  let settled = false
  const cancellation = cancelAgentRuntimeOperations(runtime)
    .then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  publishResource({ transferId: 'transfer-a' })
  await Promise.resolve()
  assert.deepEqual(stopped, [{ transferId: 'transfer-a' }])
  assert.equal(settled, false)
  releaseStop({ success: true })
  await cancellation
  assert.equal(settled, true)
})

test('late resource cancellation failure is reported by the joined barrier', async () => {
  const {
    cancelAgentRuntimeOperations,
    registerDeferredAgentCancellation
  } = await import(runtimeUrl)
  const runtime = { cancellations: new Set() }
  let publishResource
  const resource = new Promise(resolve => { publishResource = resolve })
  registerDeferredAgentCancellation(runtime, resource, async () => {
    throw new Error('late transfer stop failed')
  })

  const cancellation = cancelAgentRuntimeOperations(runtime)
  publishResource({ transferId: 'transfer-a' })
  await assert.rejects(cancellation, error => (
    error.code === 'AGENT_CANCELLATION_FAILED' &&
    error.errors?.[0]?.message === 'late transfer stop failed'
  ))
})

test('failed cancellation keeps the resource locked until owner cleanup', async () => {
  const { createAgentTaskRegistry } = await import(taskRegistryUrl)
  const registry = createAgentTaskRegistry()
  registry.register({
    taskId: 'task-a',
    endpoint: endpoint(),
    scopeId: 'tab-a',
    runner: { cancel: async () => { throw new Error('stop unconfirmed') } }
  })
  await assert.rejects(registry.cancel('task-a'), /stop unconfirmed/)
  assert.equal(registry.has('task-a'), true)
  assert.equal(registry.unregister('task-a'), false)
  assert.throws(() => registry.register({
    taskId: 'task-b',
    endpoint: endpoint(),
    scopeId: 'tab-a',
    runner: { cancel: async () => ({ status: 'cancelled' }) }
  }), error => error.code === 'AI_AGENT_SESSION_BUSY')
  assert.equal(registry.forceUnregister('task-a'), true)
})

test('lifecycle reports cancellation failure but still revokes authorization', async () => {
  const { handleAgentTakeoverLifecycleEvent } = await import(lifecycleUrl)
  const { createTakeoverRegistry } = await import(registryUrl)
  const { createAgentTaskRegistry } = await import(taskRegistryUrl)
  const takeoverRegistry = createTakeoverRegistry()
  const taskRegistry = createAgentTaskRegistry()
  takeoverRegistry.enable(endpoint())
  takeoverRegistry.transition(endpoint(), 'active-idle')
  taskRegistry.register({
    taskId: 'task-a',
    endpoint: endpoint(),
    scopeId: 'tab-a',
    runner: {
      cancel: async () => {
        throw new Error('remote stop could not be confirmed')
      }
    }
  })

  const result = await handleAgentTakeoverLifecycleEvent({
    type: 'manual-stop',
    endpoint: endpoint()
  }, { takeoverRegistry, taskRegistry })

  assert.equal(result.errors.length, 1)
  assert.equal(takeoverRegistry.get(endpoint()), undefined)
  assert.equal(taskRegistry.has('task-a'), true)
  taskRegistry.forceUnregister('task-a')
})

test('endpoint destruction force releases a lock after failed cancellation', async () => {
  const { handleAgentTakeoverLifecycleEvent } = await import(lifecycleUrl)
  const { createTakeoverRegistry } = await import(registryUrl)
  const { createAgentTaskRegistry } = await import(taskRegistryUrl)
  const takeoverRegistry = createTakeoverRegistry()
  const taskRegistry = createAgentTaskRegistry()
  takeoverRegistry.enable(endpoint())
  takeoverRegistry.transition(endpoint(), 'active-idle')
  taskRegistry.register({
    taskId: 'task-a',
    endpoint: endpoint(),
    scopeId: 'tab-a',
    runner: {
      cancel: async () => {
        throw new Error('remote stop could not be confirmed')
      }
    }
  })

  const result = await handleAgentTakeoverLifecycleEvent({
    type: 'disconnect',
    endpoint: endpoint()
  }, { takeoverRegistry, taskRegistry })

  assert.equal(result.errors.length, 1)
  assert.equal(taskRegistry.has('task-a'), false)
})
