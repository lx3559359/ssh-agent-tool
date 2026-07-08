const defaultMaxRetries = 1
const defaultRetryDelay = 1200

const nonRetryableTransferErrorPattern = /permission denied|access denied|no such file|not found|file exists|failure:.*permission|cancel(?:led|ed)? by user|user cancel/i
const retryableTransferErrorPattern = /timeout|timed out|econnreset|econnrefused|ehostunreach|enetunreach|epipe|socket closed|connection closed|connection lost|network|unexpected packet|channel.*closed|sftp.*closed/i

export function createTransferRetryState (options = {}) {
  return {
    attempt: 0,
    maxRetries: Number.isInteger(options.maxRetries) ? options.maxRetries : defaultMaxRetries,
    retryDelay: Number.isInteger(options.retryDelay) ? options.retryDelay : defaultRetryDelay
  }
}

export function isRetryableTransferError (error) {
  const message = String(error?.message || error || '')
  if (!message || nonRetryableTransferErrorPattern.test(message)) {
    return false
  }
  return retryableTransferErrorPattern.test(message)
}

export function shouldRetryTransfer (error, state = createTransferRetryState()) {
  if (!isRetryableTransferError(error)) {
    return false
  }
  if (state.attempt >= state.maxRetries) {
    return false
  }
  state.attempt += 1
  return true
}
