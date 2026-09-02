const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createManagedTerminalChannel
} = require('../../src/app/server/managed-terminal-channel')

function deferred () {
  let resolveDeferred
  const promise = new Promise(resolve => {
    resolveDeferred = resolve
  })
  return { promise, resolve: resolveDeferred }
}

test('managed channel advertises capabilities and sends monotonic status', async () => {
  const gate = deferred()
  const sent = []
  const requestId = 'a'.repeat(32)
  const writer = {
    submit: () => ({ requestId, completion: gate.promise }),
    interrupt: () => true,
    dispose: () => {}
  }
  const channel = createManagedTerminalChannel({
    writer,
    send: message => sent.push(JSON.parse(message))
  })

  assert.equal(channel.handle({
    __aigshellTerminalControl: true,
    action: 'managed-input-capabilities-request'
  }), true)
  assert.deepEqual(sent.shift(), {
    __aigshellTerminalControl: true,
    action: 'managed-input-capabilities',
    protocolVersion: 2
  })
  assert.equal(channel.handle({
    __aigshellTerminalControl: true,
    action: 'managed-input',
    requestId,
    command: 'printf managed'
  }), true)
  assert.equal(sent[0].status, 'accepted')
  gate.resolve({ requestId, status: 'written' })
  await gate.promise
  await Promise.resolve()
  assert.deepEqual(sent.map(message => message.status), [
    'accepted',
    'written'
  ])
})

test('managed channel rejects a request the writer cannot accept', () => {
  const sent = []
  const channel = createManagedTerminalChannel({
    writer: {
      submit: () => null,
      interrupt: () => true,
      dispose: () => {}
    },
    send: message => sent.push(JSON.parse(message))
  })
  const requestId = 'b'.repeat(32)

  assert.equal(channel.handle({
    __aigshellTerminalControl: true,
    action: 'managed-input',
    requestId,
    command: 'second'
  }), true)
  assert.deepEqual(sent.map(message => message.status), ['rejected'])
})

test('managed channel consumes invalid controls and routes interrupt', () => {
  let submissions = 0
  let interrupts = 0
  const writer = {
    submit: () => { submissions += 1 },
    interrupt: () => { interrupts += 1; return true },
    dispose: () => {}
  }
  const channel = createManagedTerminalChannel({ writer, send: () => {} })

  assert.equal(channel.handle({
    __aigshellTerminalControl: true,
    action: 'invalid-control'
  }), true)
  assert.equal(channel.handle({
    __aigshellTerminalControl: true,
    action: 'managed-input-interrupt'
  }), true)
  assert.equal(submissions, 0)
  assert.equal(interrupts, 1)
})
