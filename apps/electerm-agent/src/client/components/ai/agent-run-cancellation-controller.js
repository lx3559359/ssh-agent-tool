function cancellationFailure (errors) {
  const error = new AggregateError(errors, 'Agent cancellation was not confirmed')
  error.code = 'AGENT_CANCELLATION_FAILED'
  return error
}

export function createAgentRunCancellationController ({ abort } = {}) {
  const stops = new Set()
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
      abort?.()
      cancellation = Promise.allSettled(
        [...stops].map(entry => Promise.resolve()
          .then(entry.stop)
          .then(value => {
            if (!entry.confirm(value)) {
              throw new Error('Cancellation acknowledgement was false')
            }
            return value
          }))
      ).then(results => {
        const errors = results.flatMap(result => (
          result.status === 'rejected' ? [result.reason] : []
        ))
        if (errors.length) {
          state = 'cancel_failed'
          throw cancellationFailure(errors)
        }
        state = 'cancelled'
        return { cancelled: true, status: 'cancelled' }
      })
      return cancellation
    }
  }
}
