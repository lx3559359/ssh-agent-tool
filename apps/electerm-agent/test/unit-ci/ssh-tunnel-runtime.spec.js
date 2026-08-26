const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

process.env.NODE_ENV = 'development'

const {
  dynamicForward,
  forwardLocalToRemote,
  forwardRemoteToLocal,
  probeSocksHandshake
} = require('../../src/app/server/ssh-tunnel')
const {
  createSshTunnelRuntime,
  serializeTunnelError
} = require('../../src/app/server/ssh-tunnel-runtime')
const {
  createProbeResult,
  createProbeStage
} = require('../../src/app/server/ssh-tunnel-probe')

function createSocket () {
  const socket = new EventEmitter()
  socket.destroyCount = 0
  socket.end = () => {}
  socket.destroy = () => {
    if (socket.destroyed) return
    socket.destroyed = true
    socket.destroyCount += 1
    socket.emit('close')
  }
  socket.pipe = () => socket
  socket.write = value => {
    socket.lastWrite = Buffer.from(value)
    return true
  }
  return socket
}

function observeDestroyCalls (socket) {
  const destroy = socket.destroy.bind(socket)
  let calls = 0
  socket.destroy = () => {
    calls += 1
    destroy()
  }
  return () => calls
}

function passedLocalProbe (checkedAt = 1) {
  return createProbeResult([
    createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
    createProbeStage('ssh-forwarding', 'passed', 'SSH_TUNNEL_FORWARDING_READY', 'SSH 转发通道已建立'),
    createProbeStage('target-service', 'passed', 'SSH_TUNNEL_TARGET_READY', '目标服务可连接')
  ], { checkedAt })
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

test('socket test double models idempotent Node socket destruction', () => {
  const socket = createSocket()
  let closeCount = 0
  socket.on('close', () => { closeCount += 1 })

  socket.destroy()
  socket.destroy()

  assert.equal(socket.destroyCount, 1)
  assert.equal(closeCount, 1)
})

test('all three tunnel factories expose controller-owned probes', async () => {
  const localConn = new EventEmitter()
  localConn.forwardOut = () => {}
  const remoteConn = new EventEmitter()
  remoteConn.forwardIn = (host, port, callback) => callback()
  remoteConn.unforwardIn = (host, port, callback) => callback()
  const socksConn = new EventEmitter()
  const socksServer = new EventEmitter()
  socksServer.useAuth = () => socksServer
  socksServer.listen = (port, host, callback) => queueMicrotask(callback)
  socksServer.close = callback => callback?.()

  const controllers = await Promise.all([
    forwardLocalToRemote({
      conn: localConn,
      sshTunnelLocalPort: 44001,
      sshTunnelRemotePort: 80,
      netImpl: { createServer }
    }),
    forwardRemoteToLocal({
      conn: remoteConn,
      sshTunnelLocalPort: 44002,
      sshTunnelRemotePort: 44003,
      netImpl: { connect: createSocket }
    }),
    dynamicForward({
      conn: socksConn,
      sshTunnelLocalPort: 44004,
      socksImpl: {
        auth: { None: () => ({}) },
        createServer: () => socksServer
      },
      netImpl: { connect: createSocket }
    })
  ])

  assert.deepEqual(controllers.map(controller => typeof controller.probe), [
    'function', 'function', 'function'
  ])
  await Promise.all(controllers.map(controller => controller.close()))
})

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

test('local probe waits for SSH forwardOut and reports policy prohibition', async () => {
  const conn = new EventEmitter()
  let finishForward
  conn.forwardOut = (srcHost, srcPort, host, port, callback) => {
    finishForward = callback
  }
  const netImpl = {
    createServer: handler => createServer(handler)
  }
  const controller = await forwardLocalToRemote({
    id: 'local-probe',
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 43010,
    sshTunnelRemoteHost: 'private.internal',
    sshTunnelRemotePort: 43011,
    netImpl
  })

  let settled = false
  const pending = controller.probe().then(result => {
    settled = true
    return result
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  finishForward(Object.assign(new Error('Channel open failure'), { reason: 1 }))

  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.verdict, 'limited')
  assert.deepEqual(result.stages.map(stage => stage.status), [
    'passed', 'limited', 'unverified'
  ])
  assert.equal(result.stages[1].code, 'SSH_TUNNEL_FORWARDING_PROHIBITED')
  assert.equal(JSON.stringify(result).includes('Channel open failure'), false)
  await controller.close()
})

test('local probe passes every stage and releases its forwarding stream', async () => {
  const conn = new EventEmitter()
  const stream = createSocket()
  conn.forwardOut = (srcHost, srcPort, host, port, callback) => {
    callback(null, stream)
  }
  const controller = await forwardLocalToRemote({
    id: 'local-probe-passed',
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 44010,
    sshTunnelRemoteHost: 'service.internal',
    sshTunnelRemotePort: 443,
    netImpl: { createServer }
  })

  const result = await controller.probe()

  assert.equal(result.verdict, 'passed')
  assert.deepEqual(result.stages.map(stage => stage.status), [
    'passed', 'passed', 'passed'
  ])
  assert.equal(stream.destroyCount, 1)
  await controller.close()
})

test('controller close wins a synchronous forwardOut callback race', async () => {
  const conn = new EventEmitter()
  const stream = createSocket()
  const destroyCalls = observeDestroyCalls(stream)
  conn.forwardOut = (srcHost, srcPort, host, port, callback) => {
    callback(null, stream)
  }
  let finishServerClose
  const netImpl = {
    createServer (handler) {
      const server = createServer(handler)
      server.close = callback => { finishServerClose = callback }
      return server
    }
  }
  const controller = await forwardLocalToRemote({
    id: 'local-probe-close-race',
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 44012,
    sshTunnelRemoteHost: 'service.internal',
    sshTunnelRemotePort: 443,
    netImpl
  })

  const probePromise = controller.probe()
  const closing = controller.close()
  const destroyCountAtClose = stream.destroyCount
  finishServerClose()
  await closing
  const result = await probePromise

  assert.equal(destroyCountAtClose, 1)
  assert.equal(result.stages[1].code, 'SSH_TUNNEL_PROBE_CANCELLED')
  assert.equal(stream.destroyCount, 1)
  assert.equal(destroyCalls(), 1)
})

test('local probe times out quickly and disposes a late forwarding stream once', async () => {
  const conn = new EventEmitter()
  let finishForward
  conn.forwardOut = (srcHost, srcPort, host, port, callback) => {
    finishForward = callback
  }
  const controller = await forwardLocalToRemote({
    id: 'local-probe-timeout',
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 44011,
    sshTunnelRemoteHost: 'service.internal',
    sshTunnelRemotePort: 443,
    netImpl: { createServer }
  }, { probeTimeoutMs: 5 })

  const probePromise = controller.probe()
  const outcome = await Promise.race([
    probePromise,
    new Promise(resolve => setTimeout(() => resolve('still-pending'), 30))
  ])
  if (outcome === 'still-pending') {
    finishForward(null, createSocket())
    await probePromise
  }
  assert.notEqual(outcome, 'still-pending')
  assert.equal(outcome.verdict, 'failed')
  assert.deepEqual(outcome.stages.map(stage => stage.status), [
    'passed', 'failed', 'unverified'
  ])
  assert.equal(outcome.stages[1].code, 'SSH_TUNNEL_TEST_TIMEOUT')

  const lateStream = createSocket()
  const destroyCalls = observeDestroyCalls(lateStream)
  finishForward(null, lateStream)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(lateStream.destroyCount, 1)
  assert.equal(destroyCalls(), 1)
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

test('remote probe verifies the local target and real traffic emits safe evidence', async () => {
  const conn = new EventEmitter()
  conn.forwardIn = (host, port, callback) => callback()
  conn.unforwardIn = (host, port, callback) => callback()
  const targets = []
  const netImpl = {
    connect: () => {
      const socket = createSocket()
      targets.push(socket)
      return socket
    }
  }
  const controller = await forwardRemoteToLocal({
    id: 'remote-probe',
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 43020,
    sshTunnelRemoteHost: '0.0.0.0',
    sshTunnelRemotePort: 43021,
    netImpl
  })

  const probePromise = controller.probe()
  targets[0].emit('connect')
  const probe = await probePromise
  assert.equal(probe.verdict, 'unverified')
  assert.deepEqual(probe.stages.map(stage => stage.status), [
    'passed', 'passed', 'unverified'
  ])

  const evidencePromise = new Promise(resolve => controller.once('evidence', resolve))
  conn.emit('tcp connection', {
    destPort: 43021,
    srcAddr: 'sensitive-client',
    payload: 'sensitive-payload'
  }, () => createSocket())
  targets[1].emit('connect')
  const evidence = await evidencePromise
  assert.equal(evidence.verdict, 'passed')
  assert.deepEqual(evidence.stages.map(stage => stage.status), [
    'passed', 'passed', 'passed'
  ])
  assert.equal(JSON.stringify(evidence).includes('sensitive'), false)

  const verifiedAgain = controller.probe()
  targets[2].emit('connect')
  assert.equal((await verifiedAgain).verdict, 'passed')
  await controller.close()
})

test('remote probe destroys a failed local target socket and leaves end-to-end unverified', async () => {
  const conn = new EventEmitter()
  conn.forwardIn = (host, port, callback) => callback()
  conn.unforwardIn = (host, port, callback) => callback()
  const target = createSocket()
  const controller = await forwardRemoteToLocal({
    id: 'remote-probe-failed',
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 43022,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 43023,
    netImpl: { connect: () => target }
  })

  const probePromise = controller.probe()
  target.emit('error', Object.assign(new Error('refused'), {
    code: 'ECONNREFUSED'
  }))
  const result = await probePromise
  assert.deepEqual(result.stages.map(stage => stage.status), [
    'passed', 'failed', 'unverified'
  ])
  assert.equal(target.destroyCount, 1)
  await controller.close()
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

test('SOCKS5 probe requires a successful fragmented no-auth handshake', async () => {
  const conn = new EventEmitter()
  let requestHandler
  const server = new EventEmitter()
  server.useAuth = () => server
  server.listen = (port, host, callback) => queueMicrotask(callback)
  server.close = callback => callback?.()
  const socksImpl = {
    auth: { None: () => ({}) },
    createServer: handler => {
      requestHandler = handler
      return server
    }
  }
  const probeSocket = createSocket()
  const netImpl = {
    connect: () => {
      queueMicrotask(() => probeSocket.emit('connect'))
      return probeSocket
    }
  }
  const controller = await dynamicForward({
    id: 'socks-probe',
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 1081,
    socksImpl,
    netImpl
  })

  const probePromise = controller.probe()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(probeSocket.lastWrite, Buffer.from([5, 1, 0]))
  probeSocket.emit('data', Buffer.from([5]))
  probeSocket.emit('data', Buffer.from([0, 99]))
  const result = await probePromise
  assert.equal(result.ok, false)
  assert.equal(result.verdict, 'unverified')
  assert.deepEqual(result.stages.map(stage => stage.status), [
    'passed', 'passed', 'unverified'
  ])
  assert.equal(probeSocket.destroyCount, 1)

  const stream = createSocket()
  conn.forwardOut = (srcHost, srcPort, host, port, callback) => callback(null, stream)
  const evidencePromise = new Promise(resolve => controller.once('evidence', resolve))
  requestHandler({
    srcAddr: 'sensitive-source',
    srcPort: 50000,
    dstAddr: 'secret.example',
    dstPort: 443,
    url: 'https://secret.example/path',
    payload: 'secret body'
  }, () => createSocket(), () => {})
  const evidence = await evidencePromise
  assert.equal(evidence.verdict, 'passed')
  assert.equal(JSON.stringify(evidence).includes('secret'), false)
  assert.equal(JSON.stringify(evidence).includes('sensitive'), false)

  const verifiedAgain = controller.probe()
  await new Promise(resolve => setImmediate(resolve))
  probeSocket.emit('data', Buffer.from([5, 0]))
  assert.equal((await verifiedAgain).verdict, 'passed')
  await controller.close()
})

test('SOCKS5 probe connects to loopback when the listener uses a wildcard address', async () => {
  const conn = new EventEmitter()
  const server = new EventEmitter()
  server.useAuth = () => server
  server.listen = (port, host, callback) => queueMicrotask(callback)
  server.close = callback => callback?.()
  const socket = createSocket()
  let connectOptions
  const controller = await dynamicForward({
    id: 'socks-wildcard',
    conn,
    sshTunnelLocalHost: '0.0.0.0',
    sshTunnelLocalPort: 1082,
    socksImpl: {
      auth: { None: () => ({}) },
      createServer: () => server
    },
    netImpl: {
      connect: options => {
        connectOptions = options
        queueMicrotask(() => socket.emit('connect'))
        return socket
      }
    }
  })

  const probePromise = controller.probe()
  await new Promise(resolve => setImmediate(resolve))
  socket.emit('data', Buffer.from([5, 0]))
  await probePromise
  assert.equal(connectOptions.host, '127.0.0.1')
  await controller.close()
})

test('SOCKS5 handshake timeout settles once and cleans its socket', async () => {
  const socket = createSocket()
  const pending = probeSocksHandshake('127.0.0.1', 1080, {
    connect: () => socket
  }, 5)
  const outcome = await Promise.race([
    pending.then(() => ({ passed: true }), error => error),
    new Promise(resolve => setTimeout(() => resolve('still-pending'), 30))
  ])
  if (outcome === 'still-pending') socket.emit('close')

  assert.notEqual(outcome, 'still-pending')
  assert.equal(outcome.code, 'SSH_TUNNEL_TEST_TIMEOUT')
  assert.equal(outcome.stage, 'local-listener')
  socket.emit('data', Buffer.from([5, 0]))
  assert.equal(socket.destroyCount, 1)
})

test('SOCKS5 handshake socket error settles once without a false pass', async () => {
  const socket = createSocket()
  const pending = probeSocksHandshake('127.0.0.1', 1080, {
    connect: () => socket
  }, 50)
  const failure = Object.assign(new Error('listener refused'), {
    code: 'ECONNREFUSED'
  })
  socket.emit('error', failure)

  await assert.rejects(pending, error => (
    error === failure && error.stage === 'local-listener'
  ))
  socket.emit('data', Buffer.from([5, 0]))
  assert.equal(socket.destroyCount, 1)
})

test('SOCKS5 handshake early close settles once without a false pass', async () => {
  const socket = createSocket()
  const pending = probeSocksHandshake('127.0.0.1', 1080, {
    connect: () => socket
  }, 50)
  socket.emit('close')

  await assert.rejects(pending, error => (
    error.code === 'SSH_TUNNEL_PROXY_CONNECTION_CLOSED' &&
    error.stage === 'local-listener'
  ))
  socket.emit('data', Buffer.from([5, 0]))
  assert.equal(socket.destroyCount, 1)
})

test('SOCKS5 handshake accepts a fragmented no-auth response and settles once', async () => {
  const socket = createSocket()
  const pending = probeSocksHandshake('127.0.0.1', 1080, {
    connect: () => socket
  }, 50)
  socket.emit('connect')
  assert.deepEqual(socket.lastWrite, Buffer.from([5, 1, 0]))
  socket.emit('data', Buffer.from([5]))
  socket.emit('data', Buffer.from([0]))

  assert.equal(await pending, true)
  socket.emit('data', Buffer.from([5, 255]))
  assert.equal(socket.destroyCount, 1)
})

test('public tunnel definitions cannot override the production probe timeout', async () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
    const conn = new EventEmitter()
    let finishForward
    conn.forwardOut = (srcHost, srcPort, host, port, callback) => {
      finishForward = callback
    }
    const controller = await forwardLocalToRemote({
      id: `timeout-definition-${String(value)}`,
      conn,
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 44100,
      sshTunnelRemoteHost: 'service.internal',
      sshTunnelRemotePort: 443,
      probeTimeoutMs: value,
      netImpl: { createServer }
    })
    const pending = controller.probe()
    const outcome = await Promise.race([
      pending,
      new Promise(resolve => setTimeout(() => resolve('still-pending'), 15))
    ])
    await controller.close()
    if (outcome === 'still-pending') {
      finishForward(Object.assign(new Error('cleanup'), {
        code: 'SSH_TUNNEL_PROBE_CANCELLED'
      }))
      await pending
    }

    assert.equal(outcome, 'still-pending')
    assert.equal('probeTimeoutMs' in controller.descriptor, false)
  }
})

test('runtime stop cancels an automatic local probe and disposes its late stream once', async () => {
  let finishForward
  let probePromise
  let controllerDefinition
  const conn = new EventEmitter()
  conn.forwardOut = (srcHost, srcPort, host, port, callback) => {
    finishForward = callback
  }
  const runtime = createSshTunnelRuntime({
    startController: async definition => {
      controllerDefinition = definition
      const controller = await forwardLocalToRemote({
        ...definition,
        conn,
        sshTunnelLocalHost: '127.0.0.1',
        sshTunnelLocalPort: 44110,
        sshTunnelRemoteHost: 'service.internal',
        sshTunnelRemotePort: 443,
        netImpl: { createServer }
      })
      const probe = controller.probe.bind(controller)
      controller.probe = () => {
        probePromise = probe()
        return probePromise
      }
      return controller
    }
  })

  const started = await runtime.start({
    id: 'cancel-local',
    sshTunnel: 'forwardLocalToRemote',
    probeTimeoutMs: Number.MAX_SAFE_INTEGER
  })
  await new Promise(resolve => setImmediate(resolve))
  await runtime.stop('cancel-local')
  const outcome = await Promise.race([
    probePromise,
    new Promise(resolve => setTimeout(() => resolve('still-pending'), 30))
  ])
  if (outcome === 'still-pending') {
    finishForward(Object.assign(new Error('cleanup'), {
      code: 'SSH_TUNNEL_PROBE_CANCELLED'
    }))
    await probePromise
  }

  assert.notEqual(outcome, 'still-pending')
  assert.equal(outcome.stages[1].code, 'SSH_TUNNEL_PROBE_CANCELLED')
  const lateStream = createSocket()
  const destroyCalls = observeDestroyCalls(lateStream)
  finishForward(null, lateStream)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(lateStream.destroyCount, 1)
  assert.equal(destroyCalls(), 1)
  assert.equal('probeTimeoutMs' in started.definition, false)
  assert.equal('probeTimeoutMs' in controllerDefinition, false)
})

test('runtime closeAll cancels SOCKS and remote probes and destroys their sockets', async () => {
  const probePromises = new Map()
  const remoteSocket = createSocket()
  const socksSocket = createSocket()
  const remoteConn = new EventEmitter()
  remoteConn.forwardIn = (host, port, callback) => callback()
  remoteConn.unforwardIn = (host, port, callback) => callback()
  const socksConn = new EventEmitter()
  const socksServer = new EventEmitter()
  socksServer.useAuth = () => socksServer
  socksServer.listen = (port, host, callback) => queueMicrotask(callback)
  socksServer.close = callback => callback?.()
  const runtime = createSshTunnelRuntime({
    startController: async definition => {
      const controller = definition.sshTunnel === 'forwardRemoteToLocal'
        ? await forwardRemoteToLocal({
          ...definition,
          conn: remoteConn,
          sshTunnelLocalPort: 44120,
          sshTunnelRemotePort: 44121,
          netImpl: { connect: () => remoteSocket }
        })
        : await dynamicForward({
          ...definition,
          conn: socksConn,
          sshTunnelLocalPort: 44122,
          socksImpl: {
            auth: { None: () => ({}) },
            createServer: () => socksServer
          },
          netImpl: { connect: () => socksSocket }
        })
      const probe = controller.probe.bind(controller)
      controller.probe = () => {
        const promise = probe()
        probePromises.set(definition.id, promise)
        return promise
      }
      return controller
    }
  })

  await runtime.start({ id: 'cancel-remote', sshTunnel: 'forwardRemoteToLocal' })
  await runtime.start({ id: 'cancel-socks', sshTunnel: 'dynamicForward' })
  await new Promise(resolve => setImmediate(resolve))
  const closed = await runtime.closeAll('test-cleanup')
  const destroyCountsAfterClose = [
    remoteSocket.destroyCount,
    socksSocket.destroyCount
  ]
  if (!remoteSocket.destroyCount) {
    remoteSocket.emit('error', Object.assign(new Error('cleanup'), {
      code: 'SSH_TUNNEL_PROBE_CANCELLED'
    }))
  }
  if (!socksSocket.destroyCount) {
    socksSocket.emit('error', Object.assign(new Error('cleanup'), {
      code: 'SSH_TUNNEL_PROBE_CANCELLED'
    }))
  }
  const [remoteResult, socksResult] = await Promise.all([
    probePromises.get('cancel-remote'),
    probePromises.get('cancel-socks')
  ])

  assert.deepEqual(closed, { reason: 'test-cleanup', closed: 2, failed: 0 })
  assert.deepEqual(destroyCountsAfterClose, [1, 1])
  assert.equal(remoteResult.stages[1].code, 'SSH_TUNNEL_PROBE_CANCELLED')
  assert.equal(socksResult.stages[0].code, 'SSH_TUNNEL_PROBE_CANCELLED')
})

test('runtime reconnect cancels the old controller probe and its late stream', async () => {
  const scheduled = []
  const finishForwards = []
  const probePromises = []
  const controllers = []
  const controllerDefinitions = []
  const runtime = createSshTunnelRuntime({
    startController: async definition => {
      controllerDefinitions.push(definition)
      const conn = new EventEmitter()
      conn.forwardOut = (srcHost, srcPort, host, port, callback) => {
        finishForwards.push(callback)
      }
      const controller = await forwardLocalToRemote({
        ...definition,
        conn,
        sshTunnelLocalHost: '127.0.0.1',
        sshTunnelLocalPort: 44130,
        sshTunnelRemoteHost: 'service.internal',
        sshTunnelRemotePort: 443,
        netImpl: { createServer }
      })
      const probe = controller.probe.bind(controller)
      controller.probe = () => {
        const promise = probe()
        probePromises.push(promise)
        return promise
      }
      if (controllers.length) {
        controller.descriptor = {
          ...controller.descriptor,
          probeTimeoutMs: Number.MAX_SAFE_INTEGER,
          probeHarness: 'reconnect-only'
        }
      }
      controllers.push(controller)
      return controller
    },
    schedule: (callback, delay) => {
      const task = { callback, delay }
      scheduled.push(task)
      return task
    }
  })

  await runtime.start({
    id: 'cancel-reconnect',
    sshTunnel: 'forwardLocalToRemote',
    probeTimeoutMs: Number.POSITIVE_INFINITY
  })
  await new Promise(resolve => setImmediate(resolve))
  controllers[0].emit('close', { code: 'SSH_CONNECTION_CLOSED' })
  await scheduled[0].callback()
  const oldOutcome = await Promise.race([
    probePromises[0],
    new Promise(resolve => setTimeout(() => resolve('still-pending'), 30))
  ])
  if (oldOutcome === 'still-pending') {
    finishForwards[0](Object.assign(new Error('cleanup'), {
      code: 'SSH_TUNNEL_PROBE_CANCELLED'
    }))
    await probePromises[0]
  }

  assert.notEqual(oldOutcome, 'still-pending')
  assert.equal(oldOutcome.stages[1].code, 'SSH_TUNNEL_PROBE_CANCELLED')
  const lateStream = createSocket()
  const destroyCalls = observeDestroyCalls(lateStream)
  finishForwards[0](null, lateStream)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(destroyCalls(), 1)

  const reconnectedDefinition = runtime.list()[0].definition
  await runtime.stop('cancel-reconnect')
  if (finishForwards[1]) {
    finishForwards[1](Object.assign(new Error('cleanup'), {
      code: 'SSH_TUNNEL_PROBE_CANCELLED'
    }))
  }
  assert.equal(
    controllerDefinitions.some(definition => 'probeTimeoutMs' in definition),
    false
  )
  assert.equal('probeTimeoutMs' in reconnectedDefinition, false)
  assert.equal(reconnectedDefinition.id, 'cancel-reconnect')
  assert.equal(reconnectedDefinition.sshTunnel, 'forwardLocalToRemote')
  assert.equal(reconnectedDefinition.sshTunnelLocalPort, 44130)
  assert.equal(reconnectedDefinition.sshTunnelRemotePort, 443)
})

test('runtime isolates controllers, rejects duplicates, and serializes state', async () => {
  const closed = []
  const runtime = createSshTunnelRuntime({
    startController: async definition => ({
      state: 'running',
      descriptor: definition,
      close: async () => closed.push(definition.id),
      probe: async () => createProbeResult([
        createProbeStage('tunnel', 'passed', 'SSH_TUNNEL_READY', '隧道正常')
      ], { latencyMs: 12 })
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
    verdict: 'passed',
    summary: '隧道正常',
    checkedAt: runtime.list()[0].lastTest.checkedAt,
    latencyMs: 12,
    stages: [{
      id: 'tunnel',
      status: 'passed',
      code: 'SSH_TUNNEL_READY',
      message: '隧道正常'
    }]
  })
  assert.equal('close' in runtime.list()[0], false)
  assert.equal('controller' in runtime.list()[0], false)
  await runtime.stop('one')
  await runtime.stop('one')
  assert.deepEqual(closed, ['one'])
})

test('runtime automatically probes once, deduplicates concurrent tests, and serializes test state', async () => {
  const controller = new EventEmitter()
  controller.descriptor = { id: 'dedupe', sshTunnel: 'forwardLocalToRemote' }
  controller.close = async () => {}
  let resolveProbe
  let probeCount = 0
  controller.probe = () => {
    probeCount += 1
    return new Promise(resolve => { resolveProbe = resolve })
  }
  const runtime = createSshTunnelRuntime({
    startController: async () => controller
  })

  await runtime.start(controller.descriptor)
  await new Promise(resolve => setImmediate(resolve))
  const first = runtime.test('dedupe')
  const second = runtime.test('dedupe')
  assert.equal(probeCount, 1)
  assert.equal(runtime.list()[0].testState, 'testing')
  resolveProbe(passedLocalProbe(10))
  assert.equal((await first).verdict, 'passed')
  assert.equal((await second).verdict, 'passed')
  assert.equal(runtime.list()[0].testState, 'passed')
})

test('runtime invalidates passed evidence immediately after a controller failure', async () => {
  const controller = new EventEmitter()
  controller.descriptor = { id: 'invalidate', sshTunnel: 'forwardLocalToRemote' }
  controller.close = async () => {}
  controller.probe = async () => passedLocalProbe(20)
  const runtime = createSshTunnelRuntime({
    startController: async () => controller
  })

  await runtime.start(controller.descriptor)
  await runtime.test('invalidate')
  assert.equal(runtime.list()[0].lastTest.verdict, 'passed')
  controller.emit('error', Object.assign(new Error('policy denied'), {
    code: 'SSH_TUNNEL_FORWARDING_PROHIBITED'
  }))

  const state = runtime.list()[0]
  assert.equal(state.lastTest.verdict, 'limited')
  assert.equal(state.lastTest.ok, false)
  assert.equal(state.lastTest.stages[1].code, 'SSH_TUNNEL_FORWARDING_PROHIBITED')
  assert.equal(state.testState, 'limited')
})

test('runtime successful manual probe recovers a failed lifecycle', async () => {
  const controller = new EventEmitter()
  controller.descriptor = { id: 'probe-recovery', sshTunnel: 'forwardLocalToRemote' }
  controller.close = async () => {}
  controller.probe = async () => passedLocalProbe(25)
  const runtime = createSshTunnelRuntime({
    startController: async () => controller
  })

  await runtime.start(controller.descriptor)
  await new Promise(resolve => setImmediate(resolve))
  controller.emit('error', Object.assign(new Error('temporary failure'), {
    code: 'SSH_TUNNEL_TEST_FAILED'
  }))
  assert.equal(runtime.list()[0].state, 'failed')

  const result = await runtime.test('probe-recovery')
  const recovered = runtime.list()[0]
  assert.equal(result.verdict, 'passed')
  assert.equal(recovered.lastTest.verdict, 'passed')
  assert.equal(recovered.testState, 'passed')
  assert.equal(recovered.state, 'healthy')
  assert.equal(recovered.events.at(-1).code, 'SSH_TUNNEL_PROBE_RECOVERED')
})

test('runtime successful probe cancels a stale reconnect after recovery', async () => {
  const scheduled = []
  const controller = new EventEmitter()
  controller.descriptor = { id: 'probe-reconnect-recovery', sshTunnel: 'forwardLocalToRemote' }
  controller.close = async () => {}
  controller.probe = async () => passedLocalProbe(26)
  const runtime = createSshTunnelRuntime({
    startController: async () => controller,
    schedule: (callback, delay) => {
      const task = { callback, delay, cancelled: false }
      scheduled.push(task)
      return task
    },
    cancelSchedule: task => {
      task.cancelled = true
    }
  })

  await runtime.start(controller.descriptor)
  await new Promise(resolve => setImmediate(resolve))
  controller.emit('close', { code: 'SSH_CONNECTION_CLOSED' })
  assert.equal(runtime.list()[0].state, 'session-lost')
  assert.equal(scheduled.length, 1)

  assert.equal((await runtime.test('probe-reconnect-recovery')).verdict, 'passed')
  assert.equal(runtime.list()[0].state, 'healthy')
  assert.equal(runtime.list()[0].reconnectAttempt, 0)
  assert.equal(scheduled[0].cancelled, true)
})

test('runtime returns current failure evidence to a probe invalidated while pending', async () => {
  const controller = new EventEmitter()
  controller.descriptor = { id: 'invalidated-return', sshTunnel: 'forwardLocalToRemote' }
  controller.close = async () => {}
  const resolvers = []
  let probeCount = 0
  controller.probe = () => {
    probeCount += 1
    return new Promise(resolve => resolvers.push(resolve))
  }
  const runtime = createSshTunnelRuntime({ startController: async () => controller })
  await runtime.start(controller.descriptor)
  await new Promise(resolve => setImmediate(resolve))

  const pending = runtime.test('invalidated-return')
  controller.emit('error', Object.assign(new Error('policy denied'), {
    code: 'SSH_TUNNEL_FORWARDING_PROHIBITED'
  }))
  const concurrent = runtime.test('invalidated-return')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(probeCount, 1)
  resolvers[0](passedLocalProbe(21))

  assert.equal((await pending).verdict, 'limited')
  assert.equal((await concurrent).verdict, 'limited')
  assert.equal(runtime.list()[0].lastTest.verdict, 'limited')
})

test('runtime normalizes controller evidence and drops sensitive fields', async () => {
  const controller = new EventEmitter()
  controller.descriptor = { id: 'evidence', sshTunnel: 'dynamicForward' }
  controller.close = async () => {}
  const runtime = createSshTunnelRuntime({ startController: async () => controller })
  await runtime.start(controller.descriptor)

  controller.emit('evidence', {
    ok: true,
    verdict: 'passed',
    destination: 'secret.example',
    payload: 'password=secret',
    stages: [{
      id: 'proxy-traffic',
      status: 'passed',
      code: 'SSH_TUNNEL_PROXY_TRAFFIC_READY',
      message: '真实代理流量已成功转发',
      dstAddr: 'secret.example'
    }]
  })

  const result = runtime.list()[0].lastTest
  assert.equal(result.verdict, 'passed')
  assert.equal(JSON.stringify(result).includes('secret.example'), false)
  assert.equal(JSON.stringify(result).includes('password'), false)
})

test('runtime does not let an older probe overwrite stronger traffic evidence', async () => {
  const controller = new EventEmitter()
  controller.descriptor = { id: 'evidence-race', sshTunnel: 'dynamicForward' }
  controller.close = async () => {}
  let resolveProbe
  controller.probe = () => new Promise(resolve => { resolveProbe = resolve })
  const runtime = createSshTunnelRuntime({ startController: async () => controller })
  await runtime.start(controller.descriptor)
  await new Promise(resolve => setImmediate(resolve))

  controller.emit('evidence', createProbeResult([
    createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
    createProbeStage('proxy-protocol', 'passed', 'SSH_TUNNEL_PROXY_PROTOCOL_READY', 'SOCKS5 协议握手正常'),
    createProbeStage('proxy-traffic', 'passed', 'SSH_TUNNEL_PROXY_TRAFFIC_READY', '真实代理流量已成功转发')
  ]))
  resolveProbe(createProbeResult([
    createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
    createProbeStage('proxy-protocol', 'passed', 'SSH_TUNNEL_PROXY_PROTOCOL_READY', 'SOCKS5 协议握手正常'),
    createProbeStage('proxy-traffic', 'unverified', 'SSH_TUNNEL_STAGE_NOT_REACHED', '尚无真实代理请求')
  ]))
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(runtime.list()[0].lastTest.verdict, 'passed')
  assert.equal(runtime.list()[0].testState, 'passed')
})

test('runtime preserves traffic evidence against a newly started weaker probe but accepts failure', async () => {
  const controller = new EventEmitter()
  controller.descriptor = { id: 'evidence-strength', sshTunnel: 'dynamicForward' }
  controller.close = async () => {}
  const runtime = createSshTunnelRuntime({ startController: async () => controller })
  await runtime.start(controller.descriptor)
  await new Promise(resolve => setImmediate(resolve))

  controller.emit('evidence', createProbeResult([
    createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
    createProbeStage('proxy-protocol', 'passed', 'SSH_TUNNEL_PROXY_PROTOCOL_READY', 'SOCKS5 协议握手正常'),
    createProbeStage('proxy-traffic', 'passed', 'SSH_TUNNEL_PROXY_TRAFFIC_READY', '真实代理流量已成功转发')
  ]))
  controller.probe = async () => createProbeResult([
    createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
    createProbeStage('proxy-protocol', 'passed', 'SSH_TUNNEL_PROXY_PROTOCOL_READY', 'SOCKS5 协议握手正常'),
    createProbeStage('proxy-traffic', 'unverified', 'SSH_TUNNEL_STAGE_NOT_REACHED', '尚无新的真实代理请求')
  ])

  assert.equal((await runtime.test('evidence-strength')).verdict, 'passed')
  assert.equal(runtime.list()[0].lastTest.verdict, 'passed')
  assert.equal(runtime.list()[0].testState, 'passed')

  controller.probe = async () => createProbeResult([
    createProbeStage('proxy-protocol', 'failed', 'SSH_TUNNEL_PROXY_PROTOCOL_FAILED', 'SOCKS5 协议握手失败')
  ])
  assert.equal((await runtime.test('evidence-strength')).verdict, 'failed')
  assert.equal(runtime.list()[0].lastTest.verdict, 'failed')
})

test('runtime reports unavailable probes and ignores late results from replaced controllers', async () => {
  const scheduled = []
  let resolveOldProbe = () => {}
  const oldController = new EventEmitter()
  oldController.descriptor = { id: 'replace', sshTunnel: 'forwardLocalToRemote' }
  oldController.close = async () => {}
  oldController.probe = () => new Promise(resolve => { resolveOldProbe = resolve })
  const newController = new EventEmitter()
  newController.descriptor = oldController.descriptor
  newController.close = async () => {}
  let startCount = 0
  const runtime = createSshTunnelRuntime({
    startController: async () => (++startCount === 1 ? oldController : newController),
    schedule: (callback, delay) => {
      const task = { callback, delay }
      scheduled.push(task)
      return task
    }
  })

  await runtime.start(oldController.descriptor)
  await new Promise(resolve => setImmediate(resolve))
  oldController.emit('close', { code: 'SSH_CONNECTION_CLOSED' })
  await scheduled[0].callback()
  resolveOldProbe(passedLocalProbe(30))
  await new Promise(resolve => setImmediate(resolve))
  assert.notEqual(runtime.list()[0].lastTest?.verdict, 'passed')

  const unavailable = await runtime.test('replace')
  assert.equal(unavailable.verdict, 'unverified')
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.stages[0].code, 'SSH_TUNNEL_PROBE_UNAVAILABLE')
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
