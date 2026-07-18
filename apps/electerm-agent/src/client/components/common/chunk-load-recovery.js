const CHUNK_ERROR_PATTERN = /loading (?:css )?chunk|chunkloaderror|failed to fetch dynamically imported module|importing a module script failed|module script.*failed|\/assets\/[^\s)]+\.(?:js|css)(?:\?|\b)/i
const RECOVERY_PREFIX = 'shellpilot:chunk-reload:'

export function isChunkLoadError (error) {
  const message = [error?.name, error?.message, error?.stack]
    .filter(Boolean)
    .join(' ')
  return CHUNK_ERROR_PATTERN.test(message)
}

function getChunkRecoveryKey (error) {
  const message = String(error?.message || error || '')
  const asset = message.match(/(?:https?:\/\/[^\s)]+|\/assets\/[^\s)]+)/i)?.[0] || message
  let hash = 0
  for (let index = 0; index < asset.length; index += 1) {
    hash = ((hash << 5) - hash + asset.charCodeAt(index)) | 0
  }
  return `${RECOVERY_PREFIX}${Math.abs(hash)}`
}

export function tryAutoRecoverChunkLoad (error, options = {}) {
  if (!isChunkLoadError(error)) return false
  const storage = options.storage || globalThis.sessionStorage
  const reload = options.reload || (() => globalThis.location?.reload?.())
  const key = getChunkRecoveryKey(error)
  try {
    if (storage?.getItem?.(key)) return false
    storage?.setItem?.(key, String(Date.now()))
    reload()
    return true
  } catch (_) {
    return false
  }
}
