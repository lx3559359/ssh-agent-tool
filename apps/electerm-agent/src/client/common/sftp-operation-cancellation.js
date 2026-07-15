const cancellableSftpFunctions = new Set(['copyEntry', 'removeEntry'])
const cancelTokenPattern = /^[A-Za-z0-9_-]{1,128}$/

export function prepareSftpCancelableCall (func, args, token) {
  if (!cancellableSftpFunctions.has(func) || !Array.isArray(args)) {
    return { args }
  }
  const options = args[args.length - 1]
  const signal = options && typeof options === 'object'
    ? options.signal
    : undefined
  if (!signal) return { args }
  if (typeof token !== 'string' || !cancelTokenPattern.test(token)) {
    throw new Error('SFTP 取消令牌无效。')
  }
  const transportOptions = { ...options, cancelToken: token }
  delete transportOptions.signal
  return {
    args: [...args.slice(0, -1), transportOptions],
    signal,
    cancelToken: token
  }
}

export function createSftpAbortError () {
  const error = new Error('SFTP 操作已取消。')
  error.name = 'AbortError'
  return error
}
