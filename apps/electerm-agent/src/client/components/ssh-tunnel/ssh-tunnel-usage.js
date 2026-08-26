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

const sha256Constants = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

function rotateRight (value, amount) {
  return (value >>> amount) | (value << (32 - amount))
}

function sha256Hex (value) {
  const input = new TextEncoder().encode(value)
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64
  const bytes = new Uint8Array(paddedLength)
  const view = new DataView(bytes.buffer)
  const bitLength = input.length * 8
  bytes.set(input)
  bytes[input.length] = 0x80
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(paddedLength - 4, bitLength >>> 0)

  const digest = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ])
  const words = new Uint32Array(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) {
      words[index] = view.getUint32(offset + (index * 4))
    }
    for (let index = 16; index < 64; index++) {
      const previous15 = words[index - 15]
      const previous2 = words[index - 2]
      const sigma0 = rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^ (previous15 >>> 3)
      const sigma1 = rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^ (previous2 >>> 10)
      words[index] = (words[index - 16] + sigma0 +
        words[index - 7] + sigma1) >>> 0
    }

    let a = digest[0]
    let b = digest[1]
    let c = digest[2]
    let d = digest[3]
    let e = digest[4]
    let f = digest[5]
    let g = digest[6]
    let h = digest[7]
    for (let index = 0; index < 64; index++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temp1 = (h + sum1 + choice + sha256Constants[index] + words[index]) >>> 0
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    digest[0] = (digest[0] + a) >>> 0
    digest[1] = (digest[1] + b) >>> 0
    digest[2] = (digest[2] + c) >>> 0
    digest[3] = (digest[3] + d) >>> 0
    digest[4] = (digest[4] + e) >>> 0
    digest[5] = (digest[5] + f) >>> 0
    digest[6] = (digest[6] + g) >>> 0
    digest[7] = (digest[7] + h) >>> 0
  }

  return Array.from(digest)
    .map(part => part.toString(16).padStart(8, '0'))
    .join('')
}

function browserCommandsFor (usage) {
  if (!usage.endpoint || !usage.host || !usage.port) return {}
  const profileId = sha256Hex(usage.endpoint)
  const proxyArgument = `--proxy-server="socks5://${usage.endpoint}"`
  return {
    chromeCommand: `chrome.exe --user-data-dir="%TEMP%\\shellpilot-chrome-socks-${profileId}" ${proxyArgument}`,
    edgeCommand: `msedge.exe --user-data-dir="%TEMP%\\shellpilot-edge-socks-${profileId}" ${proxyArgument}`
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
