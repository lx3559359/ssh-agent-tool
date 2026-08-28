function safeSftpErrorCode (value) {
  if (Number.isSafeInteger(value) && value >= 0 && value <= 255) return value
  if (typeof value === 'string' &&
    /^[A-Za-z][A-Za-z0-9_:-]{0,63}$/.test(value)) {
    return value
  }
  return undefined
}

function projectSftpError (error) {
  const code = safeSftpErrorCode(error?.code)
  return {
    message: String(error?.message || ''),
    stack: error?.stack,
    ...(code === undefined ? {} : { code })
  }
}

module.exports = {
  projectSftpError,
  safeSftpErrorCode
}
