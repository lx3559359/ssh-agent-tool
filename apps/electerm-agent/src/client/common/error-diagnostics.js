const MAX_SAFE_MESSAGE_LENGTH = 240

function hashText (value = '') {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase()
}

export function sanitizeRendererErrorMessage (value) {
  const firstLine = String(value || 'Unknown renderer error').split(/\r?\n/, 1)[0]
  return firstLine
    .replace(/file:\/{2,3}[^\r\n]*/gi, '[local path hidden]')
    .replace(/[A-Za-z]:[\\/][^\r\n]*/g, '[local path hidden]')
    .replace(/\/(?:Users|home|var|tmp|opt|usr)\/[^\r\n]*/g, '[local path hidden]')
    .slice(0, MAX_SAFE_MESSAGE_LENGTH)
}

export function createSafeErrorDiagnostic (
  error,
  {
    version = 'unknown',
    os = 'unknown',
    now = new Date()
  } = {}
) {
  const timestamp = new Date(now).toISOString()
  const rawMessage = error?.message || String(error || '')
  const rawStack = error?.stack || ''
  const safeMessage = sanitizeRendererErrorMessage(rawMessage)
  const date = timestamp.slice(0, 10).replace(/-/g, '')
  const id = `SP-${date}-${hashText(`${rawMessage}\n${rawStack}\n${timestamp}`)}`
  const text = [
    `Error ID: ${id}`,
    `Version: ${version}`,
    `OS: ${os}`,
    `Time: ${timestamp}`,
    `Message: ${safeMessage}`
  ].join('\n')

  return {
    id,
    safeMessage,
    timestamp,
    text
  }
}
