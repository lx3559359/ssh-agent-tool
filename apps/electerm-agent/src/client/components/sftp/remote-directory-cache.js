export const remoteDirectoryCacheTtlMs = 30 * 1000
export const remoteDirectoryCacheMaxEntries = 32

function cloneDirectoryValue (value) {
  if (!Array.isArray(value)) {
    throw new TypeError('Remote directory cache requires an array')
  }
  return value.map(item => ({ ...item }))
}

export function buildRemoteDirectoryCacheKey (identity = {}) {
  return [
    identity.sshSessionGeneration,
    identity.sshTerminalPid,
    identity.host,
    Number(identity.port || 22),
    identity.username,
    identity.channel,
    identity.effectiveUid,
    identity.effectiveUsername,
    identity.path
  ].map(value => String(value || '')).join('\u0000')
}

export function createRemoteDirectoryCache (options = {}) {
  const entries = new Map()
  const now = typeof options.now === 'function' ? options.now : Date.now
  const requestedTtlMs = Number(options.ttlMs)
  const ttlMs = Number.isFinite(requestedTtlMs)
    ? Math.max(0, requestedTtlMs)
    : remoteDirectoryCacheTtlMs
  const requestedMaxEntries = Number(options.maxEntries)
  const maxEntries = Number.isFinite(requestedMaxEntries)
    ? Math.max(1, Math.floor(requestedMaxEntries))
    : remoteDirectoryCacheMaxEntries

  function get (key) {
    const requestKey = String(key || '')
    const entry = entries.get(requestKey)
    if (!entry) return null
    const ageMs = Math.max(0, Number(now()) - entry.cachedAt)
    if (ageMs > ttlMs) {
      entries.delete(requestKey)
      return null
    }
    entries.delete(requestKey)
    entries.set(requestKey, entry)
    return {
      value: cloneDirectoryValue(entry.value),
      cachedAt: entry.cachedAt,
      ageMs
    }
  }

  function set (key, value) {
    const requestKey = String(key || '')
    const entry = {
      value: cloneDirectoryValue(value),
      cachedAt: Number(now())
    }
    entries.delete(requestKey)
    entries.set(requestKey, entry)
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value)
    }
    return cloneDirectoryValue(entry.value)
  }

  function clear () {
    entries.clear()
  }

  return Object.freeze({
    get,
    set,
    clear
  })
}
