const log = require('../common/log')

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
  close
}) {
  let closed = false
  return {
    state: 'running',
    descriptor,
    async close () {
      if (closed) return
      closed = true
      await close()
    }
  }
}

function forwardRemoteToLocal (options) {
  const {
    conn,
    sshTunnelRemotePort,
    sshTunnelLocalPort,
    sshTunnelRemoteHost = '127.0.0.1',
    sshTunnelLocalHost = '127.0.0.1',
    netImpl = require('net')
  } = options
  const descriptor = tunnelDescriptor({
    ...options,
    sshTunnel: 'forwardRemoteToLocal'
  })
  const result = `remote:${sshTunnelRemoteHost}:${sshTunnelRemotePort} => local:${sshTunnelLocalHost}:${sshTunnelLocalPort}`
  const sockets = new Set()
  let connectionClosed = false

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
        log.error(`Target connection error for tunnel ${result}:`, error)
        destroySocket(source)
        destroySocket(target)
      })
      target.on('close', () => source.end?.())
      source.on('close', () => destroySocket(target))
      source.pipe(target).pipe(source)
    }
    const handleConnectionClose = () => {
      connectionClosed = true
      for (const socket of sockets) destroySocket(socket)
      sockets.clear()
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
        return reject(error)
      }
      log.log(`Port forwarded: ${result}`)
      resolve(createController({
        descriptor,
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

function forwardLocalToRemote (options) {
  const {
    conn,
    sshTunnelRemotePort,
    sshTunnelLocalPort,
    sshTunnelRemoteHost = '127.0.0.1',
    sshTunnelLocalHost = '127.0.0.1',
    netImpl = require('net')
  } = options
  const descriptor = tunnelDescriptor({
    ...options,
    sshTunnel: 'forwardLocalToRemote'
  })
  const sockets = new Set()
  let ready = false

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
            destroySocket(socket)
            return
          }
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
      for (const socket of sockets) destroySocket(socket)
      sockets.clear()
      await closeServer(localServer)
    }
    const handleConnectionClose = () => {
      closeLocalResources().catch(error => {
        log.error('Failed to close local SSH tunnel:', error)
      })
    }
    const handleServerError = error => {
      log.error('SSH tunnel listener error:', error)
      if (!ready) reject(error)
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

function dynamicForward (options) {
  const {
    conn,
    sshTunnelLocalPort,
    sshTunnelLocalHost = '127.0.0.1',
    socksImpl = require('socksv5-server')
  } = options
  const descriptor = tunnelDescriptor({
    ...options,
    sshTunnel: 'dynamicForward'
  })
  const sockets = new Set()
  let ready = false

  return new Promise((resolve, reject) => {
    const proxyServer = socksImpl.createServer((info, accept, deny) => {
      conn.forwardOut(
        info.srcAddr,
        info.srcPort,
        info.dstAddr,
        info.dstPort,
        (error, stream) => {
          if (error) {
            log.error('SOCKS5 target connection failed:', error)
            deny()
            return
          }
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
      for (const socket of sockets) destroySocket(socket)
      sockets.clear()
      await closeServer(proxyServer)
    }
    const handleConnectionClose = () => {
      closeProxyResources().catch(error => {
        log.error('Failed to close SOCKS5 tunnel:', error)
      })
    }
    const handleServerError = error => {
      log.error('SOCKS5 listener error:', error)
      if (!ready) reject(error)
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
