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

export function appendTransferCleanupError (primary, cleanupError) {
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

export function preserveTransferCleanupError (primary, cleanupError) {
  if (!primary) return cleanupError
  appendTransferCleanupError(primary, cleanupError)
  return primary
}

export async function destroyTransferHandles (transports) {
  const settlements = await Promise.allSettled(
    [...transports].map(transport => Promise.resolve().then(() => (
      transport?.destroy?.()
    )))
  )
  const errors = settlements
    .filter(result => result.status === 'rejected')
    .map(result => result.reason)
  const primary = errors.shift()
  if (!primary) return true
  for (const cleanupError of errors) {
    appendTransferCleanupError(primary, cleanupError)
  }
  throw primary
}

export async function settleStaleTransferHandle (transport, staleError) {
  try {
    await destroyTransferHandles(transport ? [transport] : [])
  } catch (cleanupError) {
    appendTransferCleanupError(staleError, cleanupError)
  }
  return staleError
}
