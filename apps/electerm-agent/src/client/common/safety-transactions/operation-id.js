const trustedOperationIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/

export function assertTrustedOperationId (value) {
  if (typeof value !== 'string' ||
    value !== value.normalize('NFKC') ||
    !trustedOperationIdPattern.test(value)) {
    throw new Error('安全事务标识无效，只允许 ASCII 字母、数字、下划线和连字符。')
  }
  return value
}

export { trustedOperationIdPattern }
