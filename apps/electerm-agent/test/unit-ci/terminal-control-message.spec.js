process.env.NODE_ENV = 'development'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const {
  buildManagedInputCapabilities,
  buildManagedInputStatus,
  parseTerminalControlMessage
} = require('../../src/app/server/terminal-control-message')

describe('terminal websocket control message parsing', () => {
  test('treats user pasted json as regular terminal input', () => {
    assert.equal(
      parseTerminalControlMessage('{"action":"keepalive"}'),
      null
    )
    assert.equal(
      parseTerminalControlMessage('{"action":"zmodem-event","event":"cancel"}'),
      null
    )
  })

  test('accepts marked internal terminal control messages', () => {
    const parsed = parseTerminalControlMessage('{"__aigshellTerminalControl":true,"action":"keepalive"}')

    assert.deepEqual(parsed, {
      __aigshellTerminalControl: true,
      action: 'keepalive'
    })
  })

  test('accepts validated managed input and interrupt messages', () => {
    const requestId = 'a'.repeat(32)
    assert.deepEqual(
      parseTerminalControlMessage(JSON.stringify({
        __aigshellTerminalControl: true,
        action: 'managed-input',
        requestId,
        command: 'printf managed'
      })),
      {
        __aigshellTerminalControl: true,
        action: 'managed-input',
        requestId,
        command: 'printf managed'
      }
    )
    assert.deepEqual(
      parseTerminalControlMessage(JSON.stringify({
        __aigshellTerminalControl: true,
        action: 'managed-input-interrupt'
      })),
      {
        __aigshellTerminalControl: true,
        action: 'managed-input-interrupt'
      }
    )
    assert.deepEqual(
      parseTerminalControlMessage(JSON.stringify({
        __aigshellTerminalControl: true,
        action: 'managed-input',
        requestId: 'invalid',
        command: 'printf forged'
      })),
      {
        __aigshellTerminalControl: true,
        action: 'invalid-control'
      }
    )
  })

  test('accepts websocket text frames delivered as Node buffers', () => {
    const message = Buffer.from(JSON.stringify({
      __aigshellTerminalControl: true,
      action: 'managed-input',
      requestId: 'b'.repeat(32),
      command: 'printf buffered'
    }))

    assert.deepEqual(parseTerminalControlMessage(message), {
      __aigshellTerminalControl: true,
      action: 'managed-input',
      requestId: 'b'.repeat(32),
      command: 'printf buffered'
    })
  })

  test('consumes marked messages with unknown actions', () => {
    assert.deepEqual(
      parseTerminalControlMessage('{"__aigshellTerminalControl":true,"action":"paste"}'),
      {
        __aigshellTerminalControl: true,
        action: 'invalid-control'
      }
    )
  })

  test('accepts managed input capability requests', () => {
    assert.deepEqual(
      parseTerminalControlMessage('{"__aigshellTerminalControl":true,"action":"managed-input-capabilities-request"}'),
      {
        __aigshellTerminalControl: true,
        action: 'managed-input-capabilities-request'
      }
    )
  })

  test('builds bounded capability and managed input status messages', () => {
    assert.deepEqual(JSON.parse(buildManagedInputCapabilities()), {
      __aigshellTerminalControl: true,
      action: 'managed-input-capabilities',
      protocolVersion: 2
    })
    assert.deepEqual(
      JSON.parse(buildManagedInputStatus('a'.repeat(32), 'accepted')),
      {
        __aigshellTerminalControl: true,
        action: 'managed-input-status',
        requestId: 'a'.repeat(32),
        status: 'accepted'
      }
    )
    assert.throws(
      () => buildManagedInputStatus('a'.repeat(32), 'command-body'),
      /status/
    )
  })
})
