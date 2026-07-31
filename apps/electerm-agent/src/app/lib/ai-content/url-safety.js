const dns = require('node:dns/promises')
const net = require('node:net')

function privateIpv4 (address) {
  const parts = String(address).split('.').map(Number)
  if (parts.length !== 4 || parts.some(value => (
    !Number.isInteger(value) || value < 0 || value > 255
  ))) {
    return false
  }
  const [a, b] = parts
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
}

function isPrivateAddress (address) {
  const value = String(address || '').toLowerCase().split('%')[0]
  const family = net.isIP(value)
  if (family === 4) return privateIpv4(value)
  if (family !== 6) return true
  if (value === '::' || value === '::1') return true
  if (value.startsWith('fc') || value.startsWith('fd')) return true
  if (/^fe[89ab]/.test(value)) return true
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? privateIpv4(mapped[1]) : false
}

async function assertSafePublicUrl (input) {
  let url
  try {
    url = new URL(String(input || '').trim())
  } catch {
    throw new Error('请输入有效的 HTTP 或 HTTPS 网页地址。')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('只允许读取 HTTP 或 HTTPS 网页。')
  }
  if (url.username || url.password) {
    throw new Error('网页地址不能包含账号凭据。')
  }
  if (!url.hostname || url.hostname.toLowerCase() === 'localhost') {
    throw new Error('只允许读取公网网页，不能访问本机或内网地址。')
  }

  const literalFamily = net.isIP(url.hostname)
  const addresses = literalFamily
    ? [{ address: url.hostname, family: literalFamily }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true })
  if (
    !addresses.length ||
    addresses.some(item => isPrivateAddress(item.address))
  ) {
    throw new Error('只允许读取公网网页，不能访问本机或内网地址。')
  }
  return { url, addresses }
}

module.exports = {
  assertSafePublicUrl,
  isPrivateAddress
}
