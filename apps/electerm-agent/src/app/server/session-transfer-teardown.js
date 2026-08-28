const sessionTransferDestroyTimeoutMs = 12000

function referencesError (value, target, seen = new Set()) {
  if (value === target) return true
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  return referencesError(value.cause, target, seen) ||
    referencesError(value.cleanupError, target, seen) ||
    (Array.isArray(value.cleanupErrors) && value.cleanupErrors.some(error => (
      referencesError(error, target, seen)
    )))
}

function appendSessionCleanupError (primary, cleanupError) {
  if (!primary || !cleanupError || primary === cleanupError ||
    referencesError(cleanupError, primary) ||
    !Object.isExtensible(primary)) return primary
  const errors = Array.isArray(primary.cleanupErrors)
    ? [...primary.cleanupErrors]
    : []
  if (!errors.includes(cleanupError)) errors.push(cleanupError)
  primary.cleanupErrors = Object.freeze(errors)
  return primary
}

function boundedTransferDestroy (destroyPromise, timeoutMs, id) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(
        `Transfer ${id} destroy timed out after ${timeoutMs}ms`
      ))
    }, timeoutMs)
  })
  return Promise.race([destroyPromise, timeout]).finally(() => {
    clearTimeout(timer)
  })
}

async function destroySessionTransfers (
  session,
  { timeoutMs = sessionTransferDestroyTimeoutMs } = {}
) {
  const transfers = session?.transfers || {}
  const entries = Object.entries(transfers)
  const settlements = await Promise.allSettled(entries.map(([
    id,
    instance
  ]) => boundedTransferDestroy(
    Promise.resolve().then(() => instance?.destroy?.()),
    timeoutMs,
    id
  ).finally(() => {
    if (transfers[id] === instance) delete transfers[id]
  })))
  const errors = settlements
    .filter(result => result.status === 'rejected')
    .map(result => result.reason)
  const primary = errors.shift()
  if (!primary) return true
  for (const cleanupError of errors) {
    appendSessionCleanupError(primary, cleanupError)
  }
  throw primary
}

module.exports = {
  appendSessionCleanupError,
  destroySessionTransfers,
  sessionTransferDestroyTimeoutMs
}
