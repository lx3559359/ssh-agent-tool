const DEFAULT_CANCELLATION_TIMEOUT_MS = 30 * 1000

function cancellationFailure (errors) {
  const error = new AggregateError(errors, 'Agent cancellation was not confirmed')
  error.code = 'AGENT_CANCELLATION_FAILED'
  return error
}

function cancellationTimeoutFailure (timeoutMs) {
  const error = new Error(`Agent cancellation timed out after ${timeoutMs} ms`)
  error.code = 'AGENT_CANCELLATION_TIMEOUT'
  error.timeoutMs = timeoutMs
  return error
}

function normalizeCancellationTimeout (value) {
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_CANCELLATION_TIMEOUT_MS
}

export function waitForAgentCancellationDeadline (value, {
  cancellationTimeoutMs,
  setTimeout: scheduleTimeout = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: cancelTimeout = handle => globalThis.clearTimeout(handle)
} = {}) {
  const timeoutMs = normalizeCancellationTimeout(cancellationTimeoutMs)
  let timeoutHandle
  const timeout = new Promise((resolve, reject) => {
    timeoutHandle = scheduleTimeout(
      () => reject(cancellationTimeoutFailure(timeoutMs)),
      timeoutMs
    )
  })
  return Promise.race([Promise.resolve(value), timeout])
    .finally(() => cancelTimeout(timeoutHandle))
}

export function createAgentRunCancellationController ({
  abort,
  observer,
  cancellationTimeoutMs,
  setTimeout: scheduleTimeout = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: cancelTimeout = handle => globalThis.clearTimeout(handle)
} = {}) {
  const stops = new Set()
  const timeoutMs = normalizeCancellationTimeout(cancellationTimeoutMs)
  let state = 'running'
  let cancellation

  return {
    get state () {
      return state
    },
    register (stop, { confirm = () => true } = {}) {
      if (typeof stop !== 'function') return () => {}
      const entry = { stop, confirm }
      stops.add(entry)
      return () => stops.delete(entry)
    },
    cancel () {
      if (cancellation) return cancellation
      state = 'cancelling'
      try {
        observer?.cancellation?.('cancelling')
      } catch (error) {}
      abort?.()
      const stopBarrier = Promise.allSettled(
        [...stops].map(entry => Promise.resolve()
          .then(entry.stop)
          .then(value => {
            if (!entry.confirm(value)) {
              throw new Error('Cancellation acknowledgement was false')
            }
            return value
          }))
      )
      const attempt = waitForAgentCancellationDeadline(stopBarrier, {
        cancellationTimeoutMs: timeoutMs,
        setTimeout: scheduleTimeout,
        clearTimeout: cancelTimeout
      }).then(results => {
        const errors = results.flatMap(result => (
          result.status === 'rejected' ? [result.reason] : []
        ))
        if (errors.length) {
          throw cancellationFailure(errors)
        }
        state = 'cancelled'
        try {
          observer?.cancellation?.('cancel_confirmed')
        } catch (error) {}
        return { cancelled: true, status: 'cancelled' }
      }).catch(error => {
        state = 'cancel_failed'
        const failure = error?.code === 'AGENT_CANCELLATION_FAILED'
          ? error
          : cancellationFailure([error])
        try {
          observer?.cancellation?.('cancel_failed', failure.code)
        } catch (observerError) {}
        throw failure
      }).finally(() => {
        if (state === 'cancel_failed' && cancellation === attempt) {
          cancellation = undefined
        }
      })
      cancellation = attempt
      return attempt
    }
  }
}
