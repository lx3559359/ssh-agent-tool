const hostPattern = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?|[a-fA-F0-9:]+)$/
const interfacePattern = /^[a-zA-Z0-9_.:-]{1,64}$/
const servicePattern = /^[a-zA-Z0-9@_.:-]{1,256}$/
const safePathPattern = /^\/[a-zA-Z0-9\u4e00-\u9fff._+ /-]*$/

function invalid (label) {
  throw new Error(`${label}格式无效`)
}

export function shellQuote (value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`
}

export function assertIntegerRange (value, minimum, maximum, label = '数值') {
  const number = Number(value)
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    invalid(label)
  }
  return number
}

export function assertHost (value, label = '主机') {
  const normalized = String(value || '').trim()
  if (!hostPattern.test(normalized) || normalized.includes('..')) invalid(label)
  return normalized
}

export function assertPort (value, label = '端口') {
  return assertIntegerRange(value, 1, 65535, label)
}

export function assertInterface (value, label = '网卡') {
  const normalized = String(value || '').trim()
  if (!interfacePattern.test(normalized)) invalid(label)
  return normalized
}

export function assertServiceName (value, label = '服务') {
  const normalized = String(value || '').trim()
  if (!servicePattern.test(normalized)) invalid(label)
  return normalized
}

export function assertAbsolutePath (value, label = '路径') {
  const normalized = String(value || '').trim()
  if (!safePathPattern.test(normalized) ||
    normalized.includes('/../') ||
    normalized.endsWith('/..')) {
    invalid(label)
  }
  return normalized
}
