const net = require('net')

const localListenerTypes = new Set([
  'forwardLocalToRemote',
  'dynamicForward'
])

function canListen (host, port, netImpl = net) {
  return new Promise(resolve => {
    const server = netImpl.createServer()
    let settled = false
    const finish = available => {
      if (settled) return
      settled = true
      server.removeAllListeners()
      if (!available) {
        resolve(false)
        return
      }
      server.close(() => resolve(true))
    }
    server.once('error', () => finish(false))
    server.listen({
      host,
      port,
      exclusive: true
    }, () => finish(true))
  })
}

async function inspectTunnelLocalPort (definition = {}, options = {}) {
  if (!localListenerTypes.has(definition.sshTunnel)) {
    return { required: false }
  }
  const requestedPort = Number(definition.sshTunnelLocalPort)
  const host = definition.sshTunnelLocalHost || '127.0.0.1'
  const inspect = options.canListen || canListen
  const maxOffset = Math.max(0, Number(options.maxOffset ?? 20))
  if (await inspect(host, requestedPort)) {
    return {
      required: true,
      available: true,
      requestedPort
    }
  }
  let suggestedPort = null
  for (let offset = 1; offset <= maxOffset; offset += 1) {
    const candidate = requestedPort + offset
    if (candidate > 65535) break
    if (await inspect(host, candidate)) {
      suggestedPort = candidate
      break
    }
  }
  return {
    required: true,
    available: false,
    requestedPort,
    suggestedPort
  }
}

async function ensureTunnelLocalPort (definition = {}, options = {}) {
  const inspected = await inspectTunnelLocalPort(definition, options)
  if (!inspected.required || inspected.available) {
    return definition
  }
  const host = definition.sshTunnelLocalHost || '127.0.0.1'
  const error = new Error(`本地端口 ${inspected.requestedPort} 已被占用`)
  error.code = 'SSH_TUNNEL_PORT_IN_USE'
  error.details = {
    requestedPort: inspected.requestedPort,
    suggestedPort: inspected.suggestedPort,
    host
  }
  throw error
}

exports.canListen = canListen
exports.ensureTunnelLocalPort = ensureTunnelLocalPort
exports.inspectTunnelLocalPort = inspectTunnelLocalPort
exports.localListenerTypes = localListenerTypes
