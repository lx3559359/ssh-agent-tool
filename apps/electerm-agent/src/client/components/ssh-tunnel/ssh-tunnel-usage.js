import {
  normalizeTunnelPort,
  tunnelTypes
} from './ssh-tunnel-definition.js'

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

function isValidIPv6 (host) {
  const [address, ...zones] = host.split('%')
  if (zones.length > 1 || (zones.length === 1 && !/^[A-Za-z0-9_.-]+$/.test(zones[0]))) {
    return false
  }
  if (!address || !/^[0-9A-Fa-f:.]+$/.test(address) || !address.includes(':')) {
    return false
  }
  try {
    const parsed = new URL(`http://[${address}]`)
    return Boolean(parsed.hostname)
  } catch {
    return false
  }
}

function isUnspecifiedIPv6 (host) {
  if (host.includes('%')) return false
  try {
    return new URL(`http://[${host}]`).hostname === '[::]'
  } catch {
    return false
  }
}

function isValidHostName (host) {
  if (host.length > 253 || host.includes('..')) return false
  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    return host.split('.').every(part => Number(part) <= 255)
  }
  return host.split('.').every(part => {
    return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part)
  })
}

function hasUnsafeHostCharacters (host) {
  return Array.from(host).some(character => {
    return character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127 ||
      /\s/.test(character) ||
      '@/?#\\'.includes(character)
  })
}

function normalizeAccessHost (value, local) {
  const raw = value === undefined || value === null ? '' : String(value)
  if (
    !raw || raw !== raw.trim() || hasUnsafeHostCharacters(raw)
  ) {
    return undefined
  }
  let host = raw
  if (local && (host === '0.0.0.0' || host === '*')) host = '127.0.0.1'
  if (local && (host === '::' || host === '[::]')) host = '::1'

  if (host.startsWith('[') || host.endsWith(']')) {
    if (!host.startsWith('[') || !host.endsWith(']')) return undefined
    const unbracketed = host.slice(1, -1)
    if (!isValidIPv6(unbracketed)) return undefined
    return local && isUnspecifiedIPv6(unbracketed)
      ? '[::1]'
      : `[${unbracketed}]`
  }
  if (host.includes('[') || host.includes(']')) return undefined
  if (host.includes(':')) {
    if (!isValidIPv6(host)) return undefined
    return local && isUnspecifiedIPv6(host) ? '[::1]' : `[${host}]`
  }
  return isValidHostName(host) ? host : undefined
}

function normalizeAccessAddress (hostValue, portValue, { local = false } = {}) {
  const host = normalizeAccessHost(hostValue, local)
  const port = normalizeTunnelPort(portValue)
  if (!host || port === undefined) return { host, port }
  return { host, port, endpoint: `${host}:${port}` }
}

function normalizeBindAddress (hostValue, portValue) {
  const raw = hostValue === undefined || hostValue === null
    ? ''
    : String(hostValue)
  if (raw === '*') {
    const port = normalizeTunnelPort(portValue)
    return port === undefined
      ? { host: '*', port }
      : { host: '*', port, endpoint: `*:${port}` }
  }
  return normalizeAccessAddress(hostValue, portValue)
}

function isWildcardBindHost (host) {
  if (host === '0.0.0.0' || host === '*') return true
  if (typeof host !== 'string') return false
  const unbracketed = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host
  return isValidIPv6(unbracketed) && isUnspecifiedIPv6(unbracketed)
}

function connectHostForBind (bindHost) {
  if (bindHost === '0.0.0.0' || bindHost === '*') return '127.0.0.1'
  return isWildcardBindHost(bindHost) ? '[::1]' : bindHost
}

function getBoundUsage (kind, profile, hostValue, portValue, requiresProxy) {
  const bindAddress = normalizeBindAddress(hostValue, portValue)
  const usesWildcardBind = isWildcardBindHost(bindAddress.host)
  const address = normalizeAccessAddress(
    connectHostForBind(bindAddress.host),
    bindAddress.port
  )
  return {
    ...getUsageBase(kind, profile, address, requiresProxy),
    bindHost: bindAddress.host,
    bindPort: bindAddress.port,
    ...(bindAddress.endpoint ? { bindEndpoint: bindAddress.endpoint } : {}),
    usesWildcardBind
  }
}

function getProfile (definition) {
  const profile = String(definition.usageProfile || '').trim().toLowerCase()
  if (usageProfiles.has(profile)) return profile
  if (profile) return 'generic'
  return legacyProfiles[String(definition.name || '').trim()] || 'generic'
}

function getUsageBase (kind, profile, address, requiresProxy) {
  return {
    kind,
    profile,
    host: address.host,
    port: address.port,
    ...(address.endpoint ? { endpoint: address.endpoint } : {}),
    requiresProxy,
    canOpen: false
  }
}

function getWebUrl (profile, address) {
  if (!address.endpoint) return undefined
  try {
    const parsed = new URL(`${profile}://${address.endpoint}`)
    const isIPv6 = address.host.startsWith('[') && address.host.endsWith(']')
    const expectedPort = (profile === 'http' && address.port === 80) ||
      (profile === 'https' && address.port === 443)
      ? ''
      : String(address.port)
    if (
      parsed.protocol !== `${profile}:` ||
      (!isIPv6 && parsed.hostname.toLowerCase() !== address.host.toLowerCase()) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.port !== expectedPort
    ) {
      return undefined
    }
    return `${profile}://${address.endpoint}`
  } catch {
    return undefined
  }
}

export function getTunnelUsage (definition = {}) {
  const type = definition.sshTunnel === undefined ||
    definition.sshTunnel === null ||
    definition.sshTunnel === ''
    ? 'forwardLocalToRemote'
    : definition.sshTunnel
  if (!tunnelTypes.includes(type)) {
    return getUsageBase('tcp', 'generic', {}, false)
  }
  if (type === 'dynamicForward') {
    return getBoundUsage(
      'proxy',
      'socks5',
      definition.sshTunnelLocalHost,
      definition.sshTunnelLocalPort,
      true
    )
  }

  if (type === 'forwardRemoteToLocal') {
    const usage = getBoundUsage(
      'remote',
      'generic',
      definition.sshTunnelRemoteHost,
      definition.sshTunnelRemotePort,
      false
    )
    return {
      ...usage,
      requiresServerAddressForExternalAccess: usage.usesWildcardBind
    }
  }

  const requestedProfile = getProfile(definition)
  const profile = requestedProfile === 'socks5' ? 'generic' : requestedProfile
  const address = normalizeAccessAddress(
    definition.sshTunnelLocalHost,
    definition.sshTunnelLocalPort,
    { local: true }
  )
  if (profile === 'http' || profile === 'https') {
    const usage = getUsageBase('web', profile, address, false)
    const url = getWebUrl(profile, address)
    return url
      ? { ...usage, url, canOpen: true }
      : usage
  }

  const kind = ['mysql', 'postgresql', 'redis'].includes(profile)
    ? 'database'
    : 'tcp'
  return getUsageBase(kind, profile, address, false)
}

function profileHostPath (host) {
  const encoded = host
    .replaceAll('_', '__')
    .replace(/[A-Z]/g, character => `_u${character.toLowerCase()}`)
    .replaceAll('%', '_p')
    .replaceAll('[', '_l')
    .replaceAll(']', '_r')
    .replaceAll(':', '_c')
    .replaceAll('.', '_d')
    .replaceAll('-', '_h')
  return encoded.match(/.{1,100}/g)
    .map(component => `h-${component}`)
    .join('\\')
}

function browserCommandsFor (usage) {
  if (!usage.endpoint || !usage.host || !usage.port) return {}
  const profilePath = `${profileHostPath(usage.host)}\\p-${usage.port}`
  const proxyArgument = `--proxy-server="socks5://${usage.endpoint}"`
  return {
    chromeCommand: `chrome.exe --user-data-dir="%TEMP%\\shellpilot-chrome-socks\\${profilePath}" ${proxyArgument}`,
    edgeCommand: `msedge.exe --user-data-dir="%TEMP%\\shellpilot-edge-socks\\${profilePath}" ${proxyArgument}`
  }
}

function socksGuideData (definition) {
  const current = getTunnelUsage(definition)
  const isCurrent = current.kind === 'proxy' && Boolean(current.endpoint)
  const usage = isCurrent
    ? current
    : getTunnelUsage({
      sshTunnel: 'dynamicForward',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 1080
    })
  return {
    ...usage,
    ...browserCommandsFor(usage),
    isExample: !isCurrent
  }
}

function remoteTargetFor (definition) {
  return getTunnelUsage({
    sshTunnel: 'forwardLocalToRemote',
    usageProfile: 'generic',
    sshTunnelLocalHost: definition.sshTunnelLocalHost,
    sshTunnelLocalPort: definition.sshTunnelLocalPort
  })
}

function remoteGuideData (definition) {
  const current = getTunnelUsage(definition)
  const currentTarget = remoteTargetFor(definition)
  const isCurrent = current.kind === 'remote' &&
    Boolean(current.bindEndpoint) && Boolean(current.endpoint) &&
    Boolean(currentTarget.endpoint)
  const usage = isCurrent
    ? current
    : getTunnelUsage({
      sshTunnel: 'forwardRemoteToLocal',
      sshTunnelRemoteHost: '127.0.0.1',
      sshTunnelRemotePort: 18080
    })
  const target = isCurrent
    ? currentTarget
    : remoteTargetFor({
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 8080
    })
  return {
    ...usage,
    targetHost: target.host,
    targetPort: target.port,
    targetEndpoint: target.endpoint,
    isExample: !isCurrent
  }
}

export function getTunnelGuideData (context = {}) {
  const definition = context?.definition && typeof context.definition === 'object'
    ? context.definition
    : {}
  return {
    socks: socksGuideData(definition),
    remote: remoteGuideData(definition)
  }
}
