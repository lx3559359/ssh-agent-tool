const test = require('node:test')
const assert = require('node:assert/strict')

const {
  inspectTunnelLocalPort,
  ensureTunnelLocalPort
} = require('../../src/app/server/ssh-tunnel-port')

test('returns requested port when it is available', async () => {
  const inspected = []
  const result = await inspectTunnelLocalPort({
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 3307
  }, {
    canListen: async (host, port) => {
      inspected.push([host, port])
      return true
    }
  })

  assert.deepEqual(result, {
    required: true,
    available: true,
    requestedPort: 3307
  })
  assert.deepEqual(inspected, [['127.0.0.1', 3307]])
})

test('returns the first available suggestion after a conflict', async () => {
  const inspected = []
  const result = await inspectTunnelLocalPort({
    sshTunnel: 'dynamicForward',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 1080
  }, {
    canListen: async (host, port) => {
      inspected.push([host, port])
      return port === 1082
    },
    maxOffset: 4
  })

  assert.deepEqual(result, {
    required: true,
    available: false,
    requestedPort: 1080,
    suggestedPort: 1082
  })
  assert.deepEqual(inspected, [
    ['127.0.0.1', 1080],
    ['127.0.0.1', 1081],
    ['127.0.0.1', 1082]
  ])
})

test('does not suggest a port when the bounded range is exhausted', async () => {
  const result = await inspectTunnelLocalPort({
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 65534
  }, {
    canListen: async () => false,
    maxOffset: 20
  })

  assert.deepEqual(result, {
    required: true,
    available: false,
    requestedPort: 65534,
    suggestedPort: null
  })
})

test('skips local inspection for remote forwarding', async () => {
  let calls = 0
  const result = await inspectTunnelLocalPort({
    sshTunnel: 'forwardRemoteToLocal',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 8080,
    sshTunnelRemotePort: 18080
  }, {
    canListen: async () => {
      calls += 1
      return false
    }
  })

  assert.deepEqual(result, { required: false })
  assert.equal(calls, 0)
})

test('throws a structured conflict without mutating the tunnel definition', async () => {
  const definition = {
    id: 'local-conflict',
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 3307
  }
  const original = { ...definition }

  await assert.rejects(
    ensureTunnelLocalPort(definition, {
      canListen: async (host, port) => port === 3308
    }),
    error => {
      assert.equal(error.code, 'SSH_TUNNEL_PORT_IN_USE')
      assert.deepEqual(error.details, {
        requestedPort: 3307,
        suggestedPort: 3308,
        host: '127.0.0.1'
      })
      return true
    }
  )
  assert.deepEqual(definition, original)
})

test('returns the original definition when its local port is available', async () => {
  const definition = {
    id: 'local-available',
    sshTunnel: 'dynamicForward',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 1080
  }

  const result = await ensureTunnelLocalPort(definition, {
    canListen: async () => true
  })

  assert.equal(result, definition)
})
