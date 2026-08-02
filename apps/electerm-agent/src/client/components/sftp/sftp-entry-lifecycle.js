const TIMER_KEYS = ['timer', 'timer4', 'timer5', 'retryHandler']
const DEBOUNCE_KEYS = ['remoteListDebounce', 'localListDebounce']

export function shouldRetryUnexpectedSftpPacket (error, {
  expectedMessage,
  retryCount,
  maxRetries = 1
}) {
  return (
    typeof error?.message === 'string' &&
    error.message.includes(expectedMessage) &&
    Number.isInteger(retryCount) &&
    retryCount >= 0 &&
    retryCount < maxRetries
  )
}

export function replaceSftpEntryTimer (
  entry,
  key,
  callback,
  delay,
  options = {}
) {
  const clearTimer = options.clearTimer || clearTimeout
  const setTimer = options.setTimer || setTimeout
  if (entry[key] !== undefined && entry[key] !== null) {
    clearTimer(entry[key])
  }
  const timer = setTimer(callback, delay)
  entry[key] = timer
  return timer
}

export function disposeSftpEntryScheduling (entry, options = {}) {
  const clearTimer = options.clearTimer || clearTimeout
  for (const key of TIMER_KEYS) {
    if (entry[key] !== undefined && entry[key] !== null) {
      clearTimer(entry[key])
    }
    entry[key] = null
  }
  for (const key of DEBOUNCE_KEYS) {
    entry[key]?.cancel?.()
  }
}
