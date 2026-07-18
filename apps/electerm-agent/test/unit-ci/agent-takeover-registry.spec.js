const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const registryUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-takeover-registry.js'
)).href

function endpoint (overrides = {}) {
  return {
    tabId: 'tab-a',
    pid: 'pid-a',
    terminalPid: 'terminal-a',
    sessionType: 'ssh',
    host: 'srv.test',
    port: 22,
    username: 'ops',
    hostKeyFingerprint: 'SHA256:abc',
    ...overrides
  }
}

test('keeps takeover grants isolated by exact verified session identity', async () => {
  const { createTakeoverRegistry } = await import(registryUrl)
  const registry = createTakeoverRegistry({
    now: () => new Date('2026-07-17T10:00:00.000Z')
  })
  const first = endpoint()
  const second = endpoint({
    tabId: 'tab-b',
    pid: 'pid-b',
    terminalPid: 'terminal-b'
  })
  const replacementHost = endpoint({
    hostKeyFingerprint: 'SHA256:replacement'
  })

  const enabled = registry.enable({
    ...first,
    password: 'must-not-survive',
    privateKey: 'must-not-survive'
  })
  assert.equal(enabled.state, 'enabling')
  assert.equal(registry.isActive(first), true)
  assert.equal(registry.isActive(second), false)
  assert.equal(registry.isActive(replacementHost), false)
  assert.throws(
    () => registry.assertActive(second),
    error => error.code === 'AI_TAKEOVER_REQUIRED'
  )
  assert.doesNotMatch(JSON.stringify(registry.snapshot()), /must-not-survive/)
})

test('freezes normalized records and rejects duplicate or invalid grants', async () => {
  const { createTakeoverRegistry } = await import(registryUrl)
  const registry = createTakeoverRegistry()
  const raw = endpoint({ host: 'SRV.TEST.', port: '22' })
  const record = registry.enable(raw)

  assert.equal(Object.isFrozen(record), true)
  assert.equal(Object.isFrozen(record.endpoint), true)
  assert.deepEqual(record.endpoint, {
    host: 'srv.test',
    port: 22,
    username: 'ops',
    tabId: 'tab-a',
    pid: 'pid-a',
    terminalPid: 'terminal-a',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:abc'
  })
  assert.throws(
    () => registry.enable(raw),
    error => error.code === 'AI_TAKEOVER_ALREADY_ACTIVE'
  )
  assert.throws(
    () => registry.enable(endpoint({ hostKeyFingerprint: '' })),
    error => error.code === 'INCOMPLETE_SSH_SESSION_IDENTITY'
  )
  assert.throws(
    () => registry.enable(endpoint({ sessionType: 'telnet' })),
    error => error.code === 'SSH_SESSION_REQUIRED'
  )
})

test('publishes immutable event-driven snapshots and supports unsubscribe', async () => {
  const { createTakeoverRegistry } = await import(registryUrl)
  let tick = 0
  const registry = createTakeoverRegistry({
    now: () => new Date(1700000000000 + tick++ * 1000)
  })
  const snapshots = []
  const unsubscribe = registry.subscribe(snapshot => snapshots.push(snapshot))

  registry.enable(endpoint())
  registry.transition(endpoint(), 'active-idle')
  unsubscribe()
  registry.transition(endpoint(), 'running-readonly')

  assert.equal(snapshots.length, 2)
  assert.equal(snapshots[0][0].state, 'enabling')
  assert.equal(snapshots[1][0].state, 'active-idle')
  assert.equal(Object.isFrozen(snapshots[0]), true)
  assert.equal(Object.isFrozen(snapshots[0][0]), true)
  assert.notEqual(snapshots[0][0], snapshots[1][0])
})

test('stop and disable follow stopping to off without retaining grants', async () => {
  const { createTakeoverRegistry } = await import(registryUrl)
  const registry = createTakeoverRegistry()
  registry.enable(endpoint())
  registry.transition(endpoint(), 'active-idle')

  assert.equal(registry.stop(endpoint()).state, 'stopping')
  const disabled = registry.disable(endpoint(), 'manual-stop')
  assert.equal(disabled.state, 'off')
  assert.equal(disabled.reason, 'manual-stop')
  assert.equal(registry.isActive(endpoint()), false)
  assert.equal(registry.get(endpoint()), undefined)
  assert.deepEqual(registry.snapshot(), [])
})

test('invalid endpoints fail closed for reads without creating state', async () => {
  const { createTakeoverRegistry } = await import(registryUrl)
  const registry = createTakeoverRegistry()
  const incomplete = endpoint({ terminalPid: '' })

  assert.equal(registry.get(incomplete), undefined)
  assert.equal(registry.isActive(incomplete), false)
  assert.throws(
    () => registry.assertActive(incomplete),
    error => error.code === 'AI_TAKEOVER_REQUIRED'
  )
  assert.deepEqual(registry.snapshot(), [])
})
