const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

process.env.NODE_ENV = 'development'

const {
  dynamicForward,
  forwardLocalToRemote,
  forwardRemoteToLocal
} = require('../../src/app/server/ssh-tunnel')
const {
  createSshTunnelRuntime
} = require('../../src/app/server/ssh-tunnel-runtime')

function createSocket () {
  const socket = new EventEmitter()
  socket.destroyCount = 0
  socket.end = () => {}
  socket.destroy = () => {
    socket.destroyCount += 1
    socket.emit('close')
  }
  socket.pipe = () => socket
  return socket
}

function createServer (onConnection) {
  const server = new EventEmitter()
  server.closeCount = 0
  server.listen = (port, host, callback) => {
    server.port = port
    server.host = host
    queueMicrotask(callback)
    return server
  }
  server.close = callback => {
    server.closeCount += 1
    callback?.()
  }
  server.connect = onConnection
  return server
}

test('local forwarding returns an idempotent closeable controller', async () => {
  const conn = new EventEmitter()
  const remoteSocket = createSocket()
  conn.forwardOut = (srcHost, srcPort, host, port, callback) => {
    callback(null, remoteSocket)
  }
  let connectionHandler
  let localServer
  const netImpl = {
    createServer (handler) {
      connectionHandler = handler
      localServer = createServer(handler)
      return localServer
    }
  }

  const controller = await forwardLocalToRemote({
    id: 'local-1',
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 3307,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 3306,
    netImpl
  })
  const clientSocket = createSocket()
  connectionHandler(clientSocket)

  assert.equal(controller.state, 'running')
  assert.equal(controller.descriptor.id, 'local-1')
  await controller.close()
  await controller.close()
  assert.equal(localServer.closeCount, 1)
  assert.equal(clientSocket.destroyCount, 1)
  assert.equal(remoteSocket.destroyCount, 1)
})

test('remote forwarding unregisters the listener and remote port', async () => {
  const conn = new EventEmitter()
  let unforwardCount = 0
  conn.forwardIn = (host, port, callback) => callback()
  conn.unforwardIn = (host, port, callback) => {
    unforwardCount += 1
    callback()
  }
  const netImpl = {
    connect: () => createSocket()
  }
  const controller = await forwardRemoteToLocal({
    id: 'remote-1',
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 8080,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 18080,
    netImpl
  })

  assert.equal(conn.listenerCount('tcp connection'), 1)
  await controller.close()
  await controller.close()
  assert.equal(unforwardCount, 1)
  assert.equal(conn.listenerCount('tcp connection'), 0)
})

test('SOCKS5 forwarding closes its server without closing SSH', async () => {
  const conn = new EventEmitter()
  let closeCount = 0
  let authConfigured = false
  const server = new EventEmitter()
  server.useAuth = () => {
    authConfigured = true
    return server
  }
  server.listen = (port, host, callback) => {
    queueMicrotask(callback)
    return server
  }
  server.close = callback => {
    closeCount += 1
    callback?.()
  }
  const socksImpl = {
    auth: { None: () => ({}) },
    createServer: () => server
  }

  const controller = await dynamicForward({
    id: 'socks-1',
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 1080,
    socksImpl
  })
  server.emit('error', Object.assign(new Error('client failed'), {
    code: 'ECONNRESET'
  }))
  await controller.close()

  assert.equal(authConfigured, true)
  assert.equal(closeCount, 1)
  assert.equal(conn.listenerCount('close'), 0)
})

test('runtime isolates controllers, rejects duplicates, and serializes state', async () => {
  const closed = []
  const runtime = createSshTunnelRuntime({
    startController: async definition => ({
      state: 'running',
      descriptor: definition,
      close: async () => closed.push(definition.id)
    }),
    probe: async definition => ({
      ok: definition.id !== 'bad',
      latencyMs: 12
    })
  })
  const started = await runtime.start({
    id: 'one',
    sshTunnel: 'dynamicForward',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 1080
  })

  assert.equal(started.state, 'running')
  await assert.rejects(
    runtime.start({ id: 'one', sshTunnel: 'dynamicForward' }),
    error => error.code === 'SSH_TUNNEL_EXISTS'
  )
  assert.deepEqual(await runtime.test('one'), {
    id: 'one',
    ok: true,
    latencyMs: 12
  })
  assert.equal('close' in runtime.list()[0], false)
  assert.equal('controller' in runtime.list()[0], false)
  await runtime.stop('one')
  await runtime.stop('one')
  assert.deepEqual(closed, ['one'])
})

test('runtime closeAll continues when one controller cleanup fails', async () => {
  const closed = []
  const runtime = createSshTunnelRuntime({
    startController: async definition => ({
      state: 'running',
      descriptor: definition,
      close: async () => {
        closed.push(definition.id)
        if (definition.id === 'broken') throw new Error('cleanup failed')
      }
    })
  })
  await runtime.start({ id: 'broken', sshTunnel: 'dynamicForward' })
  await runtime.start({ id: 'healthy', sshTunnel: 'dynamicForward' })

  const result = await runtime.closeAll('disconnect')
  assert.deepEqual(closed.sort(), ['broken', 'healthy'])
  assert.equal(result.closed, 1)
  assert.equal(result.failed, 1)
  assert.deepEqual(runtime.list(), [])
})
