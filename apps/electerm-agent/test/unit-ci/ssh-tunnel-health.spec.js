const test = require('node:test')
const assert = require('node:assert/strict')

const {
  tunnelHealthStates,
  getReconnectDelayMs,
  appendTunnelEvent,
  classifyTunnelFailure
} = require('../../src/app/server/ssh-tunnel-health')

test('tunnel health exposes stable states and bounded reconnect delays', () => {
  assert.deepEqual(tunnelHealthStates, [
    'starting',
    'healthy',
    'reconnecting',
    'port-conflict',
    'session-lost',
    'stopped',
    'failed'
  ])
  assert.equal(getReconnectDelayMs(0), 1000)
  assert.equal(getReconnectDelayMs(1), 3000)
  assert.equal(getReconnectDelayMs(2), 10000)
  assert.equal(getReconnectDelayMs(3), null)
})

test('tunnel events retain the latest 50 safe records', () => {
  let events = []
  for (let index = 0; index < 55; index += 1) {
    events = appendTunnelEvent(events, {
      at: index,
      state: 'session-lost',
      code: 'ECONNRESET',
      message: `disconnect ${index}`,
      stack: 'must not leak',
      password: 'must not leak'
    })
  }

  assert.equal(events.length, 50)
  assert.equal(events[0].at, 5)
  assert.deepEqual(events.at(-1), {
    at: 54,
    state: 'session-lost',
    code: 'ECONNRESET',
    message: 'disconnect 54'
  })
})

test('tunnel failure classification separates conflicts and session loss', () => {
  assert.equal(
    classifyTunnelFailure({ code: 'EADDRINUSE' }),
    'port-conflict'
  )
  assert.equal(
    classifyTunnelFailure({ code: 'SSH_TUNNEL_PORT_IN_USE' }),
    'port-conflict'
  )
  assert.equal(
    classifyTunnelFailure({ code: 'ECONNRESET' }),
    'session-lost'
  )
  assert.equal(
    classifyTunnelFailure({ code: 'SSH_CONNECTION_CLOSED' }),
    'session-lost'
  )
  assert.equal(
    classifyTunnelFailure({ code: 'UNKNOWN' }),
    'failed'
  )
})
