process.env.NODE_ENV = 'development'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { parseTerminalControlMessage } = require('../../src/app/server/terminal-control-message')

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

  test('ignores marked messages with unknown actions', () => {
    assert.equal(
      parseTerminalControlMessage('{"__aigshellTerminalControl":true,"action":"paste"}'),
      null
    )
  })
})
