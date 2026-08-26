const usageProfiles = new Set([
  'http',
  'https',
  'mysql',
  'postgresql',
  'redis',
  'socks5',
  'generic'
])

const legacyProfiles = Object.freeze({
  HTTP: 'http',
  HTTPS: 'https',
  MySQL: 'mysql',
  PostgreSQL: 'postgresql',
  Redis: 'redis',
  SOCKS5: 'socks5'
})

function normalizeHost (value) {
  return String(value || '').trim() || '127.0.0.1'
}

function normalizePort (value) {
  if (value === '' || value === undefined || value === null) return undefined
  return Number(value)
}

function formatHost (value) {
  const host = normalizeHost(value)
  if (host.startsWith('[') && host.endsWith(']')) return host
  return host.includes(':') ? `[${host}]` : host
}

function getProfile (definition) {
  const profile = String(definition.usageProfile || '').trim().toLowerCase()
  if (usageProfiles.has(profile)) return profile
  if (profile) return 'generic'
  return legacyProfiles[String(definition.name || '').trim()] || 'generic'
}

function getLocalEndpoint (definition) {
  const host = getWebHost(definition.sshTunnelLocalHost)
  const port = normalizePort(definition.sshTunnelLocalPort)
  return { host, port, endpoint: `${host}:${port}` }
}

function getWebHost (value) {
  const host = normalizeHost(value)
  if (host === '0.0.0.0' || host === '*') return '127.0.0.1'
  if (host === '::' || host === '[::]') return '[::1]'
  return formatHost(host)
}

export function getTunnelUsage (definition = {}) {
  const type = definition.sshTunnel || 'forwardLocalToRemote'
  if (type === 'dynamicForward') {
    const local = getLocalEndpoint(definition)
    return {
      kind: 'proxy',
      profile: 'socks5',
      ...local,
      requiresProxy: true,
      canOpen: false
    }
  }

  const profile = getProfile(definition)
  if (type === 'forwardRemoteToLocal') {
    const host = formatHost(definition.sshTunnelRemoteHost)
    const port = normalizePort(definition.sshTunnelRemotePort)
    return {
      kind: 'remote',
      profile,
      host,
      port,
      endpoint: `${host}:${port}`,
      requiresProxy: false,
      canOpen: false
    }
  }

  const port = normalizePort(definition.sshTunnelLocalPort)
  if (profile === 'http' || profile === 'https') {
    const host = getWebHost(definition.sshTunnelLocalHost)
    return {
      kind: 'web',
      profile,
      host,
      port,
      url: `${profile}://${host}:${port}`,
      requiresProxy: false,
      canOpen: true
    }
  }

  const local = getLocalEndpoint(definition)
  return {
    kind: ['mysql', 'postgresql', 'redis'].includes(profile)
      ? 'database'
      : 'tcp',
    profile,
    ...local,
    requiresProxy: false,
    canOpen: false
  }
}
