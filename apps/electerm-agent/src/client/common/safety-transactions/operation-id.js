const trustedOperationIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/

export function assertTrustedOperationId (value) {
  if (typeof value !== 'string' ||
    value !== value.normalize('NFKC') ||
    !trustedOperationIdPattern.test(value)) {
    throw new Error('安全事务标识无效，只允许 ASCII 字母、数字、下划线和连字符。')
  }
  return value
}

export function createTrustedOperationId (prefix, options = {}) {
  const now = typeof options.now === 'function' ? options.now() : Date.now()
  const timestamp = now instanceof Date ? now.getTime() : Number(now)
  const random = typeof options.random === 'function'
    ? options.random()
    : Math.random().toString(36).slice(2, 12)
  return assertTrustedOperationId(
    `${String(prefix || 'operation')}-${timestamp}-${String(random)}`
  )
}

export { trustedOperationIdPattern }
