const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const transportModule =
  'src/client/components/terminal/managed-terminal-transport.js'

test('managed transport negotiates version and resolves accepted then written', async () => {
  const { createManagedTerminalTransport } = await importModule(transportModule)
  const sent = []
  const acknowledgements = []
  let now = 100
  const transport = createManagedTerminalTransport({
    send: message => sent.push(message),
    createRequestId: () => 'f'.repeat(32),
    now: () => now,
    recordAck: durationMs => acknowledgements.push(durationMs),
    ackTimeoutMs: 50
  })

  transport.requestCapabilities()
  assert.deepEqual(sent.shift(), {
    action: 'managed-input-capabilities-request'
  })
  assert.equal(transport.handleControlMessage({
    action: 'managed-input-capabilities',
    protocolVersion: 2
  }), true)
  assert.equal(await transport.ready(), true)

  const submission = transport.submit('printf managed')
  assert.deepEqual(sent.shift(), {
    action: 'managed-input',
    requestId: 'f'.repeat(32),
    command: 'printf managed'
  })
  now = 125
  transport.handleControlMessage({
    action: 'managed-input-status',
    requestId: submission.requestId,
    status: 'accepted'
  })
  assert.equal(await submission.accepted, true)
  assert.deepEqual(acknowledgements, [25])
  transport.handleControlMessage({
    action: 'managed-input-status',
    requestId: submission.requestId,
    status: 'written'
  })
  assert.equal(await submission.written, true)
})

test('managed transport rejects readiness when capability response is missing', async () => {
  const { createManagedTerminalTransport } = await importModule(transportModule)
  const transport = createManagedTerminalTransport({
    send: () => {},
    capabilityTimeoutMs: 10
  })

  transport.requestCapabilities()
  await assert.rejects(transport.ready(), error => (
    error.name === 'ManagedInputTransportError' &&
    /能力确认超时/.test(error.message)
  ))
})

test('managed transport rejects accepted and written after acknowledgement timeout', async () => {
  const { createManagedTerminalTransport } = await importModule(transportModule)
  const transport = createManagedTerminalTransport({
    send: () => {},
    createRequestId: () => 'a'.repeat(32),
    ackTimeoutMs: 10
  })
  transport.requestCapabilities()
  transport.handleControlMessage({
    action: 'managed-input-capabilities',
    protocolVersion: 2
  })
  await transport.ready()
  const submission = transport.submit('printf timeout')

  await assert.rejects(submission.accepted, error => (
    error.name === 'ManagedInputTransportError' &&
    /确认超时/.test(error.message)
  ))
  await assert.rejects(submission.written, /确认超时/)
})

test('managed transport maps rejected and interrupted terminal states', async () => {
  const { createManagedTerminalTransport } = await importModule(transportModule)
  let sequence = 0
  const transport = createManagedTerminalTransport({
    send: () => {},
    createRequestId: () => `${sequence++}`.padStart(32, 'a'),
    ackTimeoutMs: 50
  })
  transport.requestCapabilities()
  transport.handleControlMessage({
    action: 'managed-input-capabilities',
    protocolVersion: 2
  })
  await transport.ready()

  const rejected = transport.submit('first')
  transport.handleControlMessage({
    action: 'managed-input-status',
    requestId: rejected.requestId,
    status: 'rejected'
  })
  await assert.rejects(rejected.accepted, /拒绝/)
  await assert.rejects(rejected.written, /拒绝/)

  const interrupted = transport.submit('second')
  transport.handleControlMessage({
    action: 'managed-input-status',
    requestId: interrupted.requestId,
    status: 'accepted'
  })
  await interrupted.accepted
  transport.handleControlMessage({
    action: 'managed-input-status',
    requestId: interrupted.requestId,
    status: 'interrupted'
  })
  await assert.rejects(interrupted.written, error => error.name === 'AbortError')
})

test('managed transport consumes only bounded controls and disposes pending work', async () => {
  const { createManagedTerminalTransport } = await importModule(transportModule)
  const transport = createManagedTerminalTransport({
    send: () => {},
    createRequestId: () => 'b'.repeat(32),
    ackTimeoutMs: 50
  })
  transport.requestCapabilities()
  assert.equal(transport.handleControlMessage({
    action: 'managed-input-capabilities',
    protocolVersion: 2
  }), true)
  await transport.ready()
  assert.equal(transport.handleControlMessage({
    action: 'managed-input-status',
    requestId: 'invalid',
    status: 'accepted'
  }), true)
  const submission = transport.submit('pending')
  transport.dispose()
  await assert.rejects(submission.accepted, /已关闭/)
  await assert.rejects(submission.written, /已关闭/)
})
