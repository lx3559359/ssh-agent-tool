export const tunnelTypes = Object.freeze([
  'forwardLocalToRemote',
  'forwardRemoteToLocal',
  'dynamicForward'
])

const templateSource = {
  http: {
    name: 'HTTP',
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalPort: 8080,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 80
  },
  https: {
    name: 'HTTPS',
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalPort: 8443,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 443
  },
  mysql: {
    name: 'MySQL',
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalPort: 3307,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 3306
  },
  postgresql: {
    name: 'PostgreSQL',
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalPort: 5433,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 5432
  },
  redis: {
    name: 'Redis',
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalPort: 6380,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 6379
  },
  socks5: {
    name: 'SOCKS5',
    sshTunnel: 'dynamicForward',
    sshTunnelLocalPort: 1080
  }
}

export const tunnelTemplates = Object.freeze(
  Object.fromEntries(
    Object.entries(templateSource).map(([key, value]) => [
      key,
      Object.freeze({ ...value })
    ])
  )
)

const publicBindHosts = new Set(['0.0.0.0', '::', '*', '[::]'])
const runtimeOnlyKeys = new Set([
  'state',
  'error',
  'controller',
  'lastTestAt',
  'startedAt',
  'stoppedAt',
  'sessionId'
])

function normalizeHost (value, fallback = '127.0.0.1') {
  const host = String(value || '').trim()
  return host || fallback
}

function normalizePort (value) {
  if (value === '' || value === undefined || value === null) return undefined
  return Number(value)
}

function stableTunnelId (tunnel) {
  const source = [
    tunnel.sshTunnel,
    tunnel.sshTunnelLocalHost,
    tunnel.sshTunnelLocalPort,
    tunnel.sshTunnelRemoteHost,
    tunnel.sshTunnelRemotePort,
    tunnel.name
  ].join('|')
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `tunnel-${(hash >>> 0).toString(36)}`
}

function validateHost (host, label) {
  const hasControlOrSpace = Array.from(host || '').some(character => {
    return character.charCodeAt(0) < 32 || /\s/.test(character)
  })
  if (!host || host.length > 255 || hasControlOrSpace) {
    throw new Error(`${label}无效`)
  }
}

function validatePort (port, label) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label}端口必须是 1 到 65535 之间的整数`)
  }
}

export function normalizeTunnel (input = {}) {
  const tunnel = {
    ...input,
    sshTunnel: input.sshTunnel || 'forwardLocalToRemote',
    sshTunnelLocalHost: normalizeHost(input.sshTunnelLocalHost),
    sshTunnelLocalPort: normalizePort(input.sshTunnelLocalPort),
    sshTunnelRemoteHost: normalizeHost(input.sshTunnelRemoteHost),
    sshTunnelRemotePort: normalizePort(input.sshTunnelRemotePort),
    name: String(input.name || '').trim().slice(0, 80),
    autoStart: input.autoStart !== false
  }
  tunnel.id = String(input.id || '').trim() || stableTunnelId(tunnel)
  return tunnel
}

export function validateTunnel (input = {}) {
  const tunnel = normalizeTunnel(input)
  if (!tunnelTypes.includes(tunnel.sshTunnel)) {
    throw new Error('不支持的 SSH 隧道类型')
  }
  if (String(input.name || '').trim().length > 80) {
    throw new Error('隧道名称不能超过 80 个字符')
  }
  validateHost(tunnel.sshTunnelLocalHost, '本地监听地址')
  validatePort(tunnel.sshTunnelLocalPort, '本地')
  if (tunnel.sshTunnel !== 'dynamicForward') {
    validateHost(tunnel.sshTunnelRemoteHost, '远程地址')
    validatePort(tunnel.sshTunnelRemotePort, '远程')
  }
  return tunnel
}

export function getTunnelRisk (input = {}) {
  const type = input.sshTunnel || 'forwardLocalToRemote'
  const exposedHost = type === 'forwardRemoteToLocal'
    ? normalizeHost(input.sshTunnelRemoteHost)
    : normalizeHost(input.sshTunnelLocalHost)
  const requiresConfirmation = publicBindHosts.has(exposedHost.toLowerCase())
  return {
    requiresConfirmation,
    level: requiresConfirmation ? 'exposed' : 'loopback',
    message: requiresConfirmation
      ? '该监听地址会向其他设备开放端口，请确认防火墙和访问来源。'
      : '仅监听回环地址，不会直接向局域网或公网开放。'
  }
}

export function getTunnelFlowText (input = {}) {
  const tunnel = normalizeTunnel(input)
  if (tunnel.sshTunnel === 'dynamicForward') {
    return `本机 ${tunnel.sshTunnelLocalHost}:${tunnel.sshTunnelLocalPort} → SOCKS5 → SSH 服务器`
  }
  if (tunnel.sshTunnel === 'forwardRemoteToLocal') {
    return `SSH 服务器 ${tunnel.sshTunnelRemoteHost}:${tunnel.sshTunnelRemotePort} → 本机 ${tunnel.sshTunnelLocalHost}:${tunnel.sshTunnelLocalPort}`
  }
  return `本机 ${tunnel.sshTunnelLocalHost}:${tunnel.sshTunnelLocalPort} → SSH 服务器 ${tunnel.sshTunnelRemoteHost}:${tunnel.sshTunnelRemotePort}`
}

export function getTunnelTemplate (name) {
  const template = tunnelTemplates[name]
  if (!template) {
    throw new Error('未找到指定的 SSH 隧道模板')
  }
  return normalizeTunnel(template)
}

export function serializeTunnelForBookmark (input = {}) {
  const normalized = validateTunnel(input)
  const serialized = {}
  for (const [key, value] of Object.entries(normalized)) {
    if (!runtimeOnlyKeys.has(key) && value !== undefined) {
      serialized[key] = value
    }
  }
  return serialized
}
