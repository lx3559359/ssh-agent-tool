const authoritativeMissingCodes = new Set([
  2,
  'ENOENT',
  'SFTP_NO_SUCH_FILE'
])

const authoritativeExistsCodes = new Set([
  11,
  'EEXIST',
  'SFTP_FILE_ALREADY_EXISTS'
])

export function isAuthoritativeRemoteMissingError (error) {
  return authoritativeMissingCodes.has(error?.code)
}

export function isAuthoritativeRemoteExistsError (error) {
  return authoritativeExistsCodes.has(error?.code)
}
