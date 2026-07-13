const defaultSshPort = 22

function normalizeIpv6 (host) {
  const percentIndex = host.indexOf('%')
  let address = percentIndex === -1 ? host : host.slice(0, percentIndex)
  const zone = percentIndex === -1 ? '' : host.slice(percentIndex).toLowerCase()
  const embeddedIpv4 = address.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (embeddedIpv4) {
    const bytes = embeddedIpv4[2].split('.').map(Number)
    if (bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      return host.toLowerCase()
    }
    const high = ((bytes[0] << 8) | bytes[1]).toString(16)
    const low = ((bytes[2] << 8) | bytes[3]).toString(16)
    address = `${embeddedIpv4[1]}${high}:${low}`
  }
  const halves = address.toLowerCase().split('::')
  if (halves.length > 2) return host.toLowerCase()

  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const validParts = [...left, ...right].every(part => /^[0-9a-f]{1,4}$/.test(part))
  const missing = 8 - left.length - right.length
  if (!validParts || (halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return host.toLowerCase()
  }

  const parts = [
    ...left.map(part => Number.parseInt(part, 16).toString(16)),
    ...Array(missing).fill('0'),
    ...right.map(part => Number.parseInt(part, 16).toString(16))
  ]
  let bestStart = -1
  let bestLength = 0
  for (let index = 0; index < parts.length;) {
    if (parts[index] !== '0') {
      index += 1
      continue
    }
    let end = index
    while (end < parts.length && parts[end] === '0') end += 1
    if (end - index > bestLength) {
      bestStart = index
      bestLength = end - index
    }
    index = end
  }

  if (bestLength < 2) return `${parts.join(':')}${zone}`
  const before = parts.slice(0, bestStart).join(':')
  const after = parts.slice(bestStart + bestLength).join(':')
  return `${before}::${after}${zone}`
}

function normalizeHost (value) {
  let host = String(value || '').trim()
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1)
  }
  host = host.replace(/\.$/, '').toLowerCase()
  if (!host) throw new Error('服务器地址不能为空')
  return host.includes(':') ? normalizeIpv6(host) : host
}

function normalizePort (value) {
  const port = value === undefined || value === null || value === ''
    ? defaultSshPort
    : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SSH 端口必须是 1 到 65535 之间的整数')
  }
  return port
}

export function normalizeEndpoint (endpoint = {}) {
  const username = String(endpoint.username || '').trim()
  if (!username) throw new Error('SSH 用户名不能为空')
  return {
    host: normalizeHost(endpoint.host),
    port: normalizePort(endpoint.port),
    username
  }
}

export function buildEndpointKey (endpoint) {
  const normalized = normalizeEndpoint(endpoint)
  const host = normalized.host.includes(':')
    ? `[${normalized.host}]`
    : normalized.host
  return `${normalized.username}@${host}:${normalized.port}`
}

export function assertSameEndpoint (expected, actual) {
  let sameEndpoint = false
  try {
    sameEndpoint = buildEndpointKey(expected) === buildEndpointKey(actual)
  } catch {
    throw new Error('服务器端点不一致，已停止安全操作。')
  }
  const sessionFields = ['tabId', 'pid', 'terminalPid', 'sessionType']
  const sameSession = sessionFields.every(field => {
    if (expected?.[field] === undefined || expected[field] === '') return true
    return String(expected[field]) === String(actual?.[field])
  })
  if (!sameEndpoint || !sameSession) {
    throw new Error('服务器端点不一致，已停止安全操作。')
  }
  return true
}
