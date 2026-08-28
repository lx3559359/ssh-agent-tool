function safeSftpErrorCode (value) {
  if (Number.isSafeInteger(value) && value >= 0 && value <= 255) return value
  if (typeof value === 'string' &&
    /^[A-Za-z][A-Za-z0-9_:-]{0,63}$/.test(value)) {
    return value
  }
  return undefined
}

export function reconstructSftpError (remoteError = {}, fallback) {
  const message = String(remoteError?.message || '').trim() || fallback
  const error = new Error(message)
  const code = safeSftpErrorCode(remoteError?.code)
  if (code !== undefined) error.code = code
  return error
}
