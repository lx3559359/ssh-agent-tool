const dns = require('node:dns/promises')
const net = require('node:net')
const {
  WebAccessError
} = require('./web-access-errors')

const ADDRESS_CLASS_PRIORITY = {
  public: 0,
  private: 1,
  loopback: 2,
  dangerous: 3
}

function parseIpv4 (address) {
  const parts = String(address || '').split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some(value => (
      !Number.isInteger(value) ||
      value < 0 ||
      value > 255
    ))
  ) {
    return null
  }
  return parts
}

function ipv4InRange (parts, base, prefix) {
  const value = parts.reduce((result, part) => (
    ((result << 8) | part) >>> 0
  ), 0)
  const baseValue = base.reduce((result, part) => (
    ((result << 8) | part) >>> 0
  ), 0)
  const mask = prefix === 0
    ? 0
    : (0xffffffff << (32 - prefix)) >>> 0
  return (value & mask) === (baseValue & mask)
}

function classifyIpv4 (parts) {
  if (ipv4InRange(parts, [127, 0, 0, 0], 8)) {
    return 'loopback'
  }
  if (
    ipv4InRange(parts, [100, 100, 100, 200], 32) ||
    ipv4InRange(parts, [0, 0, 0, 0], 8) ||
    ipv4InRange(parts, [169, 254, 0, 0], 16) ||
    ipv4InRange(parts, [192, 0, 0, 0], 24) ||
    ipv4InRange(parts, [192, 0, 2, 0], 24) ||
    ipv4InRange(parts, [192, 88, 99, 0], 24) ||
    ipv4InRange(parts, [198, 18, 0, 0], 15) ||
    ipv4InRange(parts, [198, 51, 100, 0], 24) ||
    ipv4InRange(parts, [203, 0, 113, 0], 24) ||
    ipv4InRange(parts, [224, 0, 0, 0], 4) ||
    ipv4InRange(parts, [240, 0, 0, 0], 4)
  ) {
    return 'dangerous'
  }
  if (
    ipv4InRange(parts, [10, 0, 0, 0], 8) ||
    ipv4InRange(parts, [100, 64, 0, 0], 10) ||
    ipv4InRange(parts, [172, 16, 0, 0], 12) ||
    ipv4InRange(parts, [192, 168, 0, 0], 16)
  ) {
    return 'private'
  }
  return 'public'
}

function parseIpv6 (address) {
  let value = String(address || '')
    .toLowerCase()
    .split('%')[0]
    .replace(/^\[|\]$/g, '')
  if (value.includes('.')) {
    const separator = value.lastIndexOf(':')
    const ipv4 = parseIpv4(value.slice(separator + 1))
    if (!ipv4) return null
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16)
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16)
    value = value.slice(0, separator) + ':' + high + ':' + low
  }

  const halves = value.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1]
    ? halves[1].split(':')
    : []
  const missing = 8 - head.length - tail.length
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null
  }
  const groups = [
    ...head,
    ...Array(missing).fill('0'),
    ...tail
  ]
  if (
    groups.length !== 8 ||
    groups.some(group => !/^[0-9a-f]{1,4}$/i.test(group))
  ) {
    return null
  }
  return groups.flatMap(group => {
    const number = Number.parseInt(group, 16)
    return [number >> 8, number & 0xff]
  })
}

function matchesBytes (bytes, expected, prefixBits) {
  const wholeBytes = Math.floor(prefixBits / 8)
  const remainingBits = prefixBits % 8
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== expected[index]) return false
  }
  if (!remainingBits) return true
  const mask = (0xff << (8 - remainingBits)) & 0xff
  return (bytes[wholeBytes] & mask) === (expected[wholeBytes] & mask)
}

function classifyIpv6 (bytes) {
  const mappedIpv4 = bytes
    .slice(0, 10)
    .every(value => value === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  if (mappedIpv4) {
    return classifyIpv4(bytes.slice(12))
  }

  const allZero = bytes.every(value => value === 0)
  const loopback = bytes.slice(0, 15).every(value => value === 0) &&
    bytes[15] === 1
  if (loopback) return 'loopback'
  if (allZero) return 'dangerous'

  if (
    matchesBytes(bytes, [0xfe, 0x80], 10) ||
    matchesBytes(bytes, [0xfe, 0xc0], 10) ||
    matchesBytes(bytes, [0xff], 8) ||
    matchesBytes(bytes, [0x20, 0x01, 0x0d, 0xb8], 32)
  ) {
    return 'dangerous'
  }
  if (matchesBytes(bytes, [0xfc], 7)) return 'private'
  return 'public'
}

function normalizeAddress (address) {
  return String(address || '')
    .trim()
    .toLowerCase()
    .split('%')[0]
    .replace(/^\[|\]$/g, '')
}

function classifyAddress (address) {
  const value = normalizeAddress(address)
  const family = net.isIP(value)
  if (family === 4) return classifyIpv4(parseIpv4(value))
  if (family === 6) {
    const bytes = parseIpv6(value)
    return bytes ? classifyIpv6(bytes) : 'dangerous'
  }
  return 'dangerous'
}

function normalizeWebOrigin (input) {
  let parsed
  try {
    parsed = input instanceof URL ? input : new URL(String(input || '').trim())
  } catch {
    throw new WebAccessError(
      'WEB_ACCESS_BLOCKED',
      'Enter a valid HTTP or HTTPS web page address.'
    )
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new WebAccessError(
      'WEB_ACCESS_BLOCKED',
      'Only HTTP or HTTPS web pages are allowed.'
    )
  }
  return parsed.origin.toLowerCase()
}

function getSafeOrigin (url) {
  try {
    const origin = url.origin
    return origin && origin !== 'null' ? origin.toLowerCase() : ''
  } catch {
    return ''
  }
}

function normalizeLookupEntries (entries) {
  const seen = new Set()
  const addresses = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const address = normalizeAddress(
      typeof entry === 'string' ? entry : entry?.address
    )
    const detectedFamily = net.isIP(address)
    if (!detectedFamily || seen.has(address)) continue
    seen.add(address)
    addresses.push({
      address,
      family: detectedFamily
    })
  }
  return addresses
}

function strictestAddressClass (classes) {
  return classes.reduce((strictest, current) => (
    ADDRESS_CLASS_PRIORITY[current] > ADDRESS_CLASS_PRIORITY[strictest]
      ? current
      : strictest
  ), 'public')
}

async function resolveTargetAddresses (url, lookup) {
  const hostname = normalizeAddress(url.hostname)
  const literalFamily = net.isIP(hostname)
  if (literalFamily) {
    return [{ address: hostname, family: literalFamily }]
  }
  try {
    const result = await lookup(hostname, {
      all: true,
      verbatim: true
    })
    const entries = Array.isArray(result) ? result : [result]
    const addresses = normalizeLookupEntries(entries)
    if (!addresses.length) {
      throw new Error('empty DNS response')
    }
    return addresses
  } catch {
    throw new WebAccessError(
      'WEB_NETWORK_ERROR',
      'The web page host could not be resolved.',
      { origin: getSafeOrigin(url) }
    )
  }
}

async function inspectWebTarget (input, options = {}) {
  let url
  try {
    url = input instanceof URL
      ? new URL(input.toString())
      : new URL(String(input || '').trim())
  } catch {
    throw new WebAccessError(
      'WEB_ACCESS_BLOCKED',
      'Enter a valid HTTP or HTTPS web page address.'
    )
  }
  const origin = getSafeOrigin(url)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new WebAccessError(
      'WEB_ACCESS_BLOCKED',
      'Only HTTP or HTTPS web pages are allowed.',
      { origin }
    )
  }
  if (url.username || url.password) {
    throw new WebAccessError(
      'WEB_ACCESS_BLOCKED',
      'Web page addresses cannot contain account credentials.',
      { origin }
    )
  }
  if (url.port === '0') {
    throw new WebAccessError(
      'WEB_ACCESS_BLOCKED',
      'Web page port 0 is not allowed.',
      { origin }
    )
  }

  const lookup = options.lookup || dns.lookup
  const addresses = await resolveTargetAddresses(url, lookup)
  const classes = addresses.map(item => classifyAddress(item.address))
  if (normalizeAddress(url.hostname) === 'localhost') {
    classes.push('loopback')
  }
  const addressClass = strictestAddressClass(classes)
  const target = {
    url: url.toString(),
    origin: normalizeWebOrigin(url),
    hostname: normalizeAddress(url.hostname),
    port: url.port || (url.protocol === 'https:' ? '443' : '80'),
    addresses,
    addressClass
  }

  if (addressClass === 'dangerous') {
    return {
      decision: 'blocked',
      target,
      reason: 'dangerous-target'
    }
  }
  if (addressClass === 'public') {
    return {
      decision: 'allow-public',
      target,
      reason: 'public-target'
    }
  }

  const isOriginGranted = options.isOriginGranted || (() => false)
  const granted = await isOriginGranted(target.origin, target)
  return {
    decision: granted ? 'allow-granted' : 'authorization-required',
    target,
    reason: granted ? 'origin-granted' : 'origin-authorization-required'
  }
}

module.exports = {
  ADDRESS_CLASS_PRIORITY,
  classifyAddress,
  inspectWebTarget,
  normalizeWebOrigin
}
