const log = require('../common/log')
const { EventEmitter } = require('node:events')
const {
  createProbeResult,
  createProbeStage,
  probeStagesForError,
  withProbeTimeout
} = require('./ssh-tunnel-probe')

const probeTimeoutMs = 3000
const maxProbeTimeoutMs = 10000

function normalizeProbeTimeout (value) {
  return Number.isFinite(value) && value >= 1 && value <= maxProbeTimeoutMs
    ? value
    : probeTimeoutMs
}

function probeCancelledError (stage) {
  const error = new Error('SSH 隧道检测已取消')
  error.code = 'SSH_TUNNEL_PROBE_CANCELLED'
  error.stage = stage
  return error
}

function createProbeManager () {
  const cancellations = new Set()
  let closed = false
  return {
    add (cancel) {
      if (closed) {
        cancel()
        return () => {}
      }
      cancellations.add(cancel)
      return () => cancellations.delete(cancel)
    },
    cancelAll () {
      if (closed) return
      closed = true
      for (const cancel of Array.from(cancellations)) cancel()
      cancellations.clear()
    }
  }
}

function createProbeOperation ({ manager, stage, start, disposer }) {
  let cancel = () => {}
  const promise = new Promise((resolve, reject) => {
    let settled = false
    let completionScheduled = false
    let resource
    let disposedResource
    let unregister = () => {}
    const disposeOnce = value => {
      if (!value || disposedResource === value) return
      disposedResource = value
      disposer(value)
    }
    const finish = (error, value) => {
      if (settled) {
        if (value) disposeOnce(value)
        return
      }
      if (error) {
        settled = true
        unregister()
        if (resource) disposeOnce(resource)
        reject(error)
        return
      }
      if (completionScheduled) {
        if (value && value !== resource) disposeOnce(value)
        return
      }
      completionScheduled = true
      resource = value
      queueMicrotask(() => {
        if (settled) return
        settled = true
        unregister()
        resolve(value)
      })
    }
    cancel = (reason = probeCancelledError(stage)) => {
      if (settled) return
      settled = true
      unregister()
      reject(reason)
      if (resource) disposeOnce(resource)
    }
    unregister = manager.add(() => cancel())
    if (settled) return
    try {
      start(
        (error, value) => finish(error, value),
        value => { resource = value }
      )
    } catch (error) {
      finish(error)
    }
  })
  return { promise, cancel }
}

function tunnelDescriptor (options) {
  return {
    id: options.id,
    name: options.name || '',
    sshTunnel: options.sshTunnel,
    sshTunnelLocalHost: options.sshTunnelLocalHost || '127.0.0.1',
    sshTunnelLocalPort: Number(options.sshTunnelLocalPort),
    sshTunnelRemoteHost: options.sshTunnelRemoteHost || '127.0.0.1',
    sshTunnelRemotePort: options.sshTunnelRemotePort === undefined
      ? undefined
      : Number(options.sshTunnelRemotePort),
    autoStart: options.autoStart !== false
  }
}

function destroySocket (socket) {
  if (!socket) return
  try {
    socket.destroy()
  } catch (error) {
    log.error('Failed to close SSH tunnel socket:', error)
  }
}

function normalizeForwardingError (error = {}) {
  const message = String(error.message || error)
  const reason = Number(error.reason)
  let code = String(error.code || 'SSH_TUNNEL_FORWARDING_FAILED')
  let readable = message || 'SSH 隧道转发失败'

  if (
    reason === 1 ||
    /administratively prohibited|forwarding.*(?:disabled|denied|prohibited)|port forwarding.*(?:disabled|denied|prohibited)/i.test(message)
  ) {
    code = 'SSH_TUNNEL_FORWARDING_PROHIBITED'
    readable = 'SSH 服务器禁止端口转发；请检查 AllowTcpForwarding、PermitOpen 或服务器安全策略。'
  } else if (
    reason === 2 ||
    code === 'ECONNREFUSED' ||
    /connection refused|connect failed/i.test(message)
  ) {
    code = 'SSH_TUNNEL_DESTINATION_REFUSED'
    readable = '目标服务拒绝连接；请确认目标地址、端口及目标服务当前可访问。'
  }

  const normalized = new Error(readable)
  normalized.code = code
  normalized.cause = error
  return normalized
}

function closeServer (server) {
  return new Promise(resolve => {
    if (!server) return resolve()
    try {
      server.close(() => resolve())
    } catch (error) {
      if (error?.code !== 'ERR_SERVER_NOT_RUNNING') {
        log.error('Failed to close SSH tunnel server:', error)
      }
      resolve()
    }
  })
}

function createController ({
  descriptor,
  close,
  probe,
  cancelProbes,
  lifecycle = new EventEmitter()
}) {
  let closed = false
  lifecycle.state = 'running'
  lifecycle.descriptor = descriptor
  if (typeof probe === 'function') lifecycle.probe = probe
  lifecycle.close = async () => {
    if (closed) return
    closed = true
    cancelProbes?.()
    await close()
  }
  return lifecycle
}

function passedProbe (stages, startedAt) {
  const latencyMs = Date.now() - startedAt
  return createProbeResult(
    stages.map(stage => createProbeStage(
      stage.id,
      stage.status,
      stage.code,
      stage.message,
      latencyMs
    )),
    { latencyMs }
  )
}

function probeSocksHandshake (
  host,
  port,
  netImpl,
  timeoutMs = probeTimeoutMs,
  probeManager
) {
  return new Promise((resolve, reject) => {
    let settled = false
    let connected = false
    let response = Buffer.alloc(0)
    const socket = netImpl.connect({ host, port })
    const timer = setTimeout(() => {
      const error = new Error('SSH 隧道连通性检测超时')
      error.code = 'SSH_TUNNEL_TEST_TIMEOUT'
      error.stage = connected ? 'proxy-protocol' : 'local-listener'
      finish(reject, error)
    }, normalizeProbeTimeout(timeoutMs))
    let unregister = () => {}
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      unregister()
      destroySocket(socket)
      callback(value)
    }
    socket.once('connect', () => {
      if (settled) return
      connected = true
      socket.write(Buffer.from([5, 1, 0]))
    })
    socket.on('data', chunk => {
      if (settled) return
      response = Buffer.concat([response, Buffer.from(chunk)]).subarray(0, 2)
      if (response.length < 2) return
      if (response[0] !== 5 || response[1] !== 0) {
        const error = new Error('SOCKS5 代理协议握手失败')
        error.code = 'SSH_TUNNEL_PROXY_PROTOCOL_FAILED'
        error.stage = 'proxy-protocol'
        finish(reject, error)
        return
      }
      finish(resolve, true)
    })
    socket.once('error', error => {
      error.stage = connected ? 'proxy-protocol' : 'local-listener'
      finish(reject, error)
    })
    socket.once('close', () => {
      if (settled) return
      const error = new Error('SOCKS5 代理连接提前关闭')
      error.code = 'SSH_TUNNEL_PROXY_CONNECTION_CLOSED'
      error.stage = connected ? 'proxy-protocol' : 'local-listener'
      finish(reject, error)
    })
    if (probeManager) {
      unregister = probeManager.add(() => {
        finish(reject, probeCancelledError(
          connected ? 'proxy-protocol' : 'local-listener'
        ))
      })
    }
  })
}

function forwardRemoteToLocal (options, probeDependencies = {}) {
  const {
    conn,
    sshTunnelRemotePort,
    sshTunnelLocalPort,
    sshTunnelRemoteHost = '127.0.0.1',
    sshTunnelLocalHost = '127.0.0.1',
    netImpl = require('net')
  } = options
  const timeoutMs = normalizeProbeTimeout(probeDependencies.probeTimeoutMs)
  const descriptor = tunnelDescriptor({
    ...options,
    sshTunnel: 'forwardRemoteToLocal'
  })
  const result = `remote:${sshTunnelRemoteHost}:${sshTunnelRemotePort} => local:${sshTunnelLocalHost}:${sshTunnelLocalPort}`
  const sockets = new Set()
  let connectionClosed = false
  let trafficEvidenceEmitted = false
  const probeManager = createProbeManager()
  const lifecycle = new EventEmitter()
  lifecycle.on('error', () => {})

  return new Promise((resolve, reject) => {
    const trackSocket = socket => {
      if (!socket) return socket
      sockets.add(socket)
      socket.once?.('close', () => sockets.delete(socket))
      return socket
    }
    const handleTcpConnection = (info, accept) => {
      if (Number(info.destPort) !== Number(sshTunnelRemotePort)) return
      const source = trackSocket(accept())
      if (!source) {
        log.error(`Failed to accept connection for tunnel ${result}`)
        return
      }
      source.on('error', error => {
        log.error(`Source stream error for tunnel ${result}:`, error)
      })
      const target = trackSocket(
        netImpl.connect(sshTunnelLocalPort, sshTunnelLocalHost)
      )
      target.on('error', error => {
        trafficEvidenceEmitted = false
        log.error(`Target connection error for tunnel ${result}:`, error)
        lifecycle.emit('error', normalizeForwardingError(error))
        destroySocket(source)
        destroySocket(target)
      })
      target.once?.('connect', () => {
        trafficEvidenceEmitted = true
        lifecycle.emit('listening')
        lifecycle.emit('evidence', createProbeResult([
          createProbeStage('server-listener', 'passed', 'SSH_TUNNEL_SERVER_LISTENER_READY', 'SSH 远程监听正常'),
          createProbeStage('local-target', 'passed', 'SSH_TUNNEL_LOCAL_TARGET_READY', '本地目标服务可连接'),
          createProbeStage('end-to-end', 'passed', 'SSH_TUNNEL_END_TO_END_READY', '真实远程转发流量已接通')
        ]))
      })
      target.on('close', () => source.end?.())
      source.on('close', () => destroySocket(target))
      source.pipe(target).pipe(source)
    }
    const handleConnectionClose = () => {
      connectionClosed = true
      trafficEvidenceEmitted = false
      for (const socket of sockets) destroySocket(socket)
      sockets.clear()
      lifecycle.emit('close', {
        code: 'SSH_CONNECTION_CLOSED',
        message: 'SSH 会话已断开'
      })
    }
    const detach = () => {
      conn.removeListener('tcp connection', handleTcpConnection)
      conn.removeListener('close', handleConnectionClose)
    }
    conn.on('tcp connection', handleTcpConnection)
    conn.on('close', handleConnectionClose)
    conn.forwardIn(sshTunnelRemoteHost, sshTunnelRemotePort, error => {
      if (error) {
        detach()
        return reject(normalizeForwardingError(error))
      }
      log.log(`Port forwarded: ${result}`)
      resolve(createController({
        descriptor,
        lifecycle,
        probe: async () => {
          const startedAt = Date.now()
          const operation = createProbeOperation({
            manager: probeManager,
            stage: 'local-target',
            disposer: destroySocket,
            start: (finish, setResource) => {
              const socket = netImpl.connect(
                sshTunnelLocalPort,
                sshTunnelLocalHost
              )
              setResource(socket)
              socket.once('connect', () => finish(null, socket))
              socket.once('error', finish)
              socket.once('close', () => {
                const error = new Error('本地目标连接提前关闭')
                error.code = 'SSH_TUNNEL_LOCAL_TARGET_CLOSED'
                finish(error)
              })
            }
          })
          try {
            const target = await withProbeTimeout(
              operation.promise,
              timeoutMs,
              'local-target',
              destroySocket
            )
            destroySocket(target)
            return passedProbe([
              { id: 'server-listener', status: 'passed', code: 'SSH_TUNNEL_SERVER_LISTENER_READY', message: 'SSH 远程监听正常' },
              { id: 'local-target', status: 'passed', code: 'SSH_TUNNEL_LOCAL_TARGET_READY', message: '本地目标服务可连接' },
              trafficEvidenceEmitted
                ? { id: 'end-to-end', status: 'passed', code: 'SSH_TUNNEL_END_TO_END_READY', message: '真实远程转发流量已接通' }
                : { id: 'end-to-end', status: 'unverified', code: 'SSH_TUNNEL_STAGE_NOT_REACHED', message: '尚无真实远程流量验证完整链路' }
            ], startedAt)
          } catch (error) {
            operation.cancel(error)
            trafficEvidenceEmitted = false
            const normalized = normalizeForwardingError(error)
            return createProbeResult([
              createProbeStage('server-listener', 'passed', 'SSH_TUNNEL_SERVER_LISTENER_READY', 'SSH 远程监听正常'),
              createProbeStage('local-target', 'failed', normalized.code, normalized.message),
              createProbeStage('end-to-end', 'unverified', 'SSH_TUNNEL_STAGE_NOT_REACHED', '本地目标失败，尚未验证完整链路')
            ])
          }
        },
        cancelProbes: () => probeManager.cancelAll(),
        close: async () => {
          detach()
          for (const socket of sockets) destroySocket(socket)
          sockets.clear()
          if (connectionClosed || typeof conn.unforwardIn !== 'function') return
          await new Promise((resolve, reject) => {
            conn.unforwardIn(
              sshTunnelRemoteHost,
              sshTunnelRemotePort,
              error => error ? reject(error) : resolve()
            )
          })
        }
      }))
    })
  })
}

function forwardLocalToRemote (options, probeDependencies = {}) {
  const {
    conn,
    sshTunnelRemotePort,
    sshTunnelLocalPort,
    sshTunnelRemoteHost = '127.0.0.1',
    sshTunnelLocalHost = '127.0.0.1',
    netImpl = require('net')
  } = options
  const timeoutMs = normalizeProbeTimeout(probeDependencies.probeTimeoutMs)
  const descriptor = tunnelDescriptor({
    ...options,
    sshTunnel: 'forwardLocalToRemote'
  })
  const sockets = new Set()
  let ready = false
  let resourcesClosed = false
  const lifecycle = new EventEmitter()
  const probeManager = createProbeManager()
  lifecycle.on('error', () => {})

  return new Promise((resolve, reject) => {
    const localServer = netImpl.createServer(socket => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      socket.on('error', error => {
        log.error('SSH tunnel client socket error:', error)
        destroySocket(socket)
      })
      conn.forwardOut(
        sshTunnelLocalHost,
        sshTunnelLocalPort,
        sshTunnelRemoteHost,
        sshTunnelRemotePort,
        (error, remoteSocket) => {
          if (error) {
            log.error('SSH tunnel target connection failed:', error)
            lifecycle.emit('error', normalizeForwardingError(error))
            destroySocket(socket)
            return
          }
          lifecycle.emit('listening')
          sockets.add(remoteSocket)
          remoteSocket.once('close', () => sockets.delete(remoteSocket))
          remoteSocket.on('error', remoteError => {
            log.error('SSH tunnel remote socket error:', remoteError)
            destroySocket(socket)
            destroySocket(remoteSocket)
          })
          socket.on('close', () => destroySocket(remoteSocket))
          socket.pipe(remoteSocket).pipe(socket)
        }
      )
    })
    const closeLocalResources = async () => {
      if (resourcesClosed) return
      resourcesClosed = true
      for (const socket of sockets) destroySocket(socket)
      sockets.clear()
      await closeServer(localServer)
    }
    const handleConnectionClose = () => {
      closeLocalResources().catch(error => {
        log.error('Failed to close local SSH tunnel:', error)
      })
      lifecycle.emit('close', {
        code: 'SSH_CONNECTION_CLOSED',
        message: 'SSH 会话已断开'
      })
    }
    const handleServerError = error => {
      log.error('SSH tunnel listener error:', error)
      if (!ready) reject(error)
      if (ready) lifecycle.emit('error', error)
    }
    localServer.on('error', handleServerError)
    conn.on('close', handleConnectionClose)
    localServer.listen(
      sshTunnelLocalPort,
      sshTunnelLocalHost,
      () => {
        ready = true
        log.log(`Local tunnel listening on ${sshTunnelLocalHost}:${sshTunnelLocalPort}`)
        resolve(createController({
          descriptor,
          lifecycle,
          probe: async () => {
            const startedAt = Date.now()
            const operation = createProbeOperation({
              manager: probeManager,
              stage: 'ssh-forwarding',
              disposer: destroySocket,
              start: finish => {
                conn.forwardOut(
                  sshTunnelLocalHost,
                  sshTunnelLocalPort,
                  sshTunnelRemoteHost,
                  sshTunnelRemotePort,
                  (error, stream) => finish(
                    error ? normalizeForwardingError(error) : null,
                    stream
                  )
                )
              }
            })
            try {
              const remoteSocket = await withProbeTimeout(
                operation.promise,
                timeoutMs,
                'ssh-forwarding',
                destroySocket
              )
              destroySocket(remoteSocket)
              return passedProbe([
                { id: 'local-listener', status: 'passed', code: 'SSH_TUNNEL_LOCAL_LISTENER_READY', message: '本机监听正常' },
                { id: 'ssh-forwarding', status: 'passed', code: 'SSH_TUNNEL_FORWARDING_READY', message: 'SSH 转发通道已建立' },
                { id: 'target-service', status: 'passed', code: 'SSH_TUNNEL_TARGET_READY', message: '目标服务可连接' }
              ], startedAt)
            } catch (error) {
              operation.cancel(error)
              const normalized = normalizeForwardingError(error)
              return createProbeResult(
                probeStagesForError('forwardLocalToRemote', normalized)
              )
            }
          },
          cancelProbes: () => probeManager.cancelAll(),
          close: async () => {
            conn.removeListener('close', handleConnectionClose)
            localServer.removeListener('error', handleServerError)
            await closeLocalResources()
          }
        }))
      }
    )
  })
}

function dynamicForward (options, probeDependencies = {}) {
  const {
    conn,
    sshTunnelLocalPort,
    sshTunnelLocalHost = '127.0.0.1',
    socksImpl = require('socksv5-server'),
    netImpl = require('net')
  } = options
  const timeoutMs = normalizeProbeTimeout(probeDependencies.probeTimeoutMs)
  const descriptor = tunnelDescriptor({
    ...options,
    sshTunnel: 'dynamicForward'
  })
  const sockets = new Set()
  let ready = false
  let resourcesClosed = false
  const lifecycle = new EventEmitter()
  let trafficEvidenceEmitted = false
  const probeManager = createProbeManager()
  lifecycle.on('error', () => {})

  return new Promise((resolve, reject) => {
    const proxyServer = socksImpl.createServer((info, accept, deny) => {
      conn.forwardOut(
        info.srcAddr,
        info.srcPort,
        info.dstAddr,
        info.dstPort,
        (error, stream) => {
          if (error) {
            trafficEvidenceEmitted = false
            log.error('SOCKS5 target connection failed:', error)
            lifecycle.emit('error', normalizeForwardingError(error))
            deny()
            return
          }
          if (!trafficEvidenceEmitted) {
            trafficEvidenceEmitted = true
            lifecycle.emit('evidence', createProbeResult([
              createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
              createProbeStage('proxy-protocol', 'passed', 'SSH_TUNNEL_PROXY_PROTOCOL_READY', 'SOCKS5 协议握手正常'),
              createProbeStage('proxy-traffic', 'passed', 'SSH_TUNNEL_PROXY_TRAFFIC_READY', '真实代理流量已成功转发')
            ]))
          }
          lifecycle.emit('listening')
          const clientSocket = accept(true)
          if (!clientSocket) {
            destroySocket(stream)
            return
          }
          sockets.add(stream)
          sockets.add(clientSocket)
          stream.once('close', () => sockets.delete(stream))
          clientSocket.once('close', () => sockets.delete(clientSocket))
          stream.on('error', streamError => {
            log.error('SOCKS5 stream error:', streamError)
            destroySocket(clientSocket)
          })
          clientSocket.on('error', clientError => {
            log.error('SOCKS5 client error:', clientError)
            destroySocket(stream)
          })
          stream.on('close', () => destroySocket(clientSocket))
          clientSocket.on('close', () => destroySocket(stream))
          stream.pipe(clientSocket).pipe(stream)
        }
      )
    })
    const closeProxyResources = async () => {
      if (resourcesClosed) return
      resourcesClosed = true
      for (const socket of sockets) destroySocket(socket)
      sockets.clear()
      await closeServer(proxyServer)
    }
    const handleConnectionClose = () => {
      trafficEvidenceEmitted = false
      closeProxyResources().catch(error => {
        log.error('Failed to close SOCKS5 tunnel:', error)
      })
      lifecycle.emit('close', {
        code: 'SSH_CONNECTION_CLOSED',
        message: 'SSH 会话已断开'
      })
    }
    const handleServerError = error => {
      trafficEvidenceEmitted = false
      log.error('SOCKS5 listener error:', error)
      if (!ready) reject(error)
      if (ready) lifecycle.emit('error', error)
    }
    proxyServer.on('error', handleServerError)
    proxyServer.useAuth(socksImpl.auth.None())
    conn.on('close', handleConnectionClose)
    proxyServer.listen(
      sshTunnelLocalPort,
      sshTunnelLocalHost,
      () => {
        ready = true
        log.log(`SOCKS5 tunnel listening on ${sshTunnelLocalHost}:${sshTunnelLocalPort}`)
        resolve(createController({
          descriptor,
          lifecycle,
          probe: async () => {
            const startedAt = Date.now()
            const probeHost = ['0.0.0.0', '*'].includes(sshTunnelLocalHost)
              ? '127.0.0.1'
              : ['::', '[::]'].includes(sshTunnelLocalHost)
                  ? '::1'
                  : sshTunnelLocalHost
            try {
              await probeSocksHandshake(
                probeHost,
                sshTunnelLocalPort,
                netImpl,
                timeoutMs,
                probeManager
              )
              return passedProbe([
                { id: 'local-listener', status: 'passed', code: 'SSH_TUNNEL_LOCAL_LISTENER_READY', message: '本机监听正常' },
                { id: 'proxy-protocol', status: 'passed', code: 'SSH_TUNNEL_PROXY_PROTOCOL_READY', message: 'SOCKS5 协议握手正常' },
                trafficEvidenceEmitted
                  ? { id: 'proxy-traffic', status: 'passed', code: 'SSH_TUNNEL_PROXY_TRAFFIC_READY', message: '真实代理流量已成功转发' }
                  : { id: 'proxy-traffic', status: 'unverified', code: 'SSH_TUNNEL_STAGE_NOT_REACHED', message: '尚无真实代理请求验证转发流量' }
              ], startedAt)
            } catch (error) {
              trafficEvidenceEmitted = false
              const localFailed = error.stage === 'local-listener'
              return createProbeResult([
                createProbeStage(
                  'local-listener',
                  localFailed ? 'failed' : 'passed',
                  localFailed ? error.code : 'SSH_TUNNEL_LOCAL_LISTENER_READY',
                  localFailed ? error.message : '本机监听正常'
                ),
                createProbeStage(
                  'proxy-protocol',
                  localFailed ? 'unverified' : 'failed',
                  localFailed ? 'SSH_TUNNEL_STAGE_NOT_REACHED' : error.code,
                  localFailed ? '本机监听失败，尚未验证 SOCKS5 协议' : error.message
                ),
                createProbeStage('proxy-traffic', 'unverified', 'SSH_TUNNEL_STAGE_NOT_REACHED', '尚未验证代理流量')
              ])
            }
          },
          cancelProbes: () => probeManager.cancelAll(),
          close: async () => {
            conn.removeListener('close', handleConnectionClose)
            proxyServer.removeListener('error', handleServerError)
            await closeProxyResources()
          }
        }))
      }
    )
  })
}

exports.dynamicForward = dynamicForward
exports.forwardLocalToRemote = forwardLocalToRemote
exports.forwardRemoteToLocal = forwardRemoteToLocal
exports.normalizeForwardingError = normalizeForwardingError
exports.probeSocksHandshake = probeSocksHandshake
