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
  createSshTunnelRuntime,
  serializeTunnelError
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
  let sessionLost = 0
  controller.on('close', event => {
    if (event.code === 'SSH_CONNECTION_CLOSED') sessionLost += 1
  })
  conn.emit('close')
  assert.equal(sessionLost, 1)
  await controller.close()
  await controller.close()
  assert.equal(localServer.closeCount, 1)
  assert.equal(clientSocket.destroyCount, 1)
  assert.equal(remoteSocket.destroyCount, 1)
})

test('local forwarding reports a refused remote destination to its runtime', async () => {
  const conn = new EventEmitter()
  conn.forwardOut = (srcHost, srcPort, host, port, callback) => {
    callback(new Error('Channel open failure: Connection refused'))
  }
  let connectionHandler
  const netImpl = {
    createServer (handler) {
      connectionHandler = handler
      return createServer(handler)
    }
  }

  const controller = await forwardLocalToRemote({
    id: 'local-refused',
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 43001,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 43002,
    netImpl
  })
  const failures = []
  controller.on('error', error => failures.push(error))

  connectionHandler(createSocket())
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(failures.length, 1)
  assert.equal(failures[0].code, 'SSH_TUNNEL_DESTINATION_REFUSED')
  assert.match(failures[0].message, /目标服务拒绝连接/)
  await controller.close()
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

test('remote forwarding distinguishes server policy prohibition', async () => {
  const conn = new EventEmitter()
  conn.forwardIn = (host, port, callback) => {
    callback(new Error('Channel open failure: administratively prohibited'))
  }

  await assert.rejects(
    forwardRemoteToLocal({
      id: 'remote-prohibited',
      conn,
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 43003,
      sshTunnelRemoteHost: '127.0.0.1',
      sshTunnelRemotePort: 43004
    }),
    error => {
      assert.equal(error.code, 'SSH_TUNNEL_FORWARDING_PROHIBITED')
      assert.match(error.message, /服务器禁止端口转发/)
      return true
    }
  )
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

  assert.equal(started.state, 'healthy')
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

test('runtime records session loss and reconnects with bounded backoff', async () => {
  const controllers = []
  const scheduled = []
  const runtime = createSshTunnelRuntime({
    startController: async definition => {
      const controller = new EventEmitter()
      controller.descriptor = definition
      controller.close = async () => {}
      controllers.push(controller)
      return controller
    },
    schedule: (callback, delay) => {
      const task = { callback, delay, cancelled: false }
      scheduled.push(task)
      return task
    },
    cancelSchedule: task => {
      task.cancelled = true
    }
  })

  await runtime.start({ id: 'unstable', sshTunnel: 'dynamicForward' })
  controllers[0].emit('close', { code: 'SSH_CONNECTION_CLOSED' })

  assert.equal(runtime.list()[0].state, 'session-lost')
  assert.equal(scheduled[0].delay, 1000)
  assert.equal(runtime.list()[0].events.at(-1).code, 'SSH_CONNECTION_CLOSED')

  await scheduled[0].callback()
  assert.equal(controllers.length, 2)
  assert.equal(runtime.list()[0].state, 'healthy')
  assert.ok(runtime.list()[0].events.some(event => event.state === 'reconnecting'))
})

test('runtime does not reconnect after manual stop or port conflict', async () => {
  const scheduled = []
  const controller = new EventEmitter()
  controller.close = async () => {}
  const runtime = createSshTunnelRuntime({
    startController: async definition => {
      controller.descriptor = definition
      return controller
    },
    schedule: (callback, delay) => {
      const task = { callback, delay, cancelled: false }
      scheduled.push(task)
      return task
    },
    cancelSchedule: task => {
      task.cancelled = true
    }
  })

  await runtime.start({ id: 'manual', sshTunnel: 'dynamicForward' })
  controller.emit('error', { code: 'EADDRINUSE', message: 'busy' })
  assert.equal(runtime.list()[0].state, 'port-conflict')
  assert.equal(scheduled.length, 0)

  await runtime.stop('manual')
  controller.emit('close', { code: 'SSH_CONNECTION_CLOSED' })
  assert.equal(scheduled.length, 0)
  assert.deepEqual(runtime.list(), [])
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

test('runtime preserves only safe structured details from start errors', async () => {
  const cause = Object.assign(new Error('本地端口 3307 已被占用'), {
    code: 'SSH_TUNNEL_PORT_IN_USE',
    details: {
      requestedPort: 3307,
      suggestedPort: 3308,
      host: '127.0.0.1',
      stack: 'should not leak',
      localPath: 'C:\\private\\file'
    }
  })
  const runtime = createSshTunnelRuntime({
    startController: async () => {
      throw cause
    }
  })

  await assert.rejects(
    runtime.start({ id: 'conflict', sshTunnel: 'forwardLocalToRemote' }),
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
})

test('serializeTunnelError returns safe structured details', () => {
  const error = Object.assign(new Error('本地端口已被占用'), {
    code: 'SSH_TUNNEL_PORT_IN_USE',
    details: {
      requestedPort: 3307,
      suggestedPort: 3308,
      host: '127.0.0.1',
      unsafe: { stack: 'hidden' }
    }
  })

  assert.deepEqual(serializeTunnelError(error), {
    code: 'SSH_TUNNEL_PORT_IN_USE',
    message: '本地端口已被占用',
    details: {
      requestedPort: 3307,
      suggestedPort: 3308,
      host: '127.0.0.1'
    }
  })
})
