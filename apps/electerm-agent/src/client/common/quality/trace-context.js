const CONTEXT_FIELDS = [
  'traceId',
  'operationId',
  'taskId',
  'requestId',
  'sessionId',
  'tabId',
  'module',
  'action'
]

const FIELD_LIMITS = {
  traceId: 64,
  operationId: 128,
  taskId: 128,
  requestId: 128,
  sessionId: 128,
  tabId: 128,
  module: 64,
  action: 64
}

const CONTEXT_VALUE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]*$/
const TRACE_ID_PATTERN = /^sp-\d{13}-[0-9a-f]{8}$/
const TIMESTAMP_RANGE = 10000000000000
const DELIMITED_CREDENTIAL_PATTERN = /(?:^|[._:@-])(?:sk-|ghp_|github_pat_|xox[a-z0-9]*-)/i
const CASE_SENSITIVE_CREDENTIAL_PATTERN = /(?:^|[._:@-])(?:AKIA|ASIA|AIza)/
const NAMED_CREDENTIAL_PATTERN = /^(?:bearer(?:[:._@-]|$)|(?:x[-_.])?api[-_.]?key(?:[:._@-]|$)|token(?:[:._@-]|$)|password(?:[:._@-]|$)|private[-_.]?key(?:[:._@-]|$)|authorization(?:[:._@-]|$))/i
const BASE64URL_PATTERN = /^[a-zA-Z0-9_-]+$/
const PASETO_PATTERN = /^v[1-4]\.(?:local|public)\.[a-zA-Z0-9_-]{32,}(?:\.[a-zA-Z0-9_-]+)?$/i

function parseJoseHeader (segment) {
  if (!BASE64URL_PATTERN.test(segment)) return null
  try {
    const encoded = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = encoded.padEnd(Math.ceil(segment.length / 4) * 4, '=')
    const header = JSON.parse(globalThis.atob(padded))
    return (
      header && typeof header === 'object' && !Array.isArray(header) &&
      header
    ) || null
  } catch (error) {
    return null
  }
}

function isCompactJwt (value) {
  const parts = value.split('.')
  if (parts.length !== 3) return false
  const header = parseJoseHeader(parts[0])
  if (!header || typeof header.alg !== 'string') return false
  if (parts[1].length < 2 || !BASE64URL_PATTERN.test(parts[1])) return false
  if (/^none$/i.test(header.alg)) return parts[2] === ''
  return parts[2].length >= 16 && BASE64URL_PATTERN.test(parts[2])
}

function isCompactJwe (value) {
  const parts = value.split('.')
  if (parts.length !== 5) return false
  const header = parseJoseHeader(parts[0])
  if (!header || typeof header.alg !== 'string' ||
    typeof header.enc !== 'string') return false
  if (parts[1] === '' && !/^(?:dir|ECDH-ES)$/i.test(header.alg)) return false
  return (parts[1] === '' || BASE64URL_PATTERN.test(parts[1])) &&
    parts[2].length >= 8 && BASE64URL_PATTERN.test(parts[2]) &&
    parts[3].length >= 1 && BASE64URL_PATTERN.test(parts[3]) &&
    parts[4].length >= 16 && BASE64URL_PATTERN.test(parts[4])
}

export function isCredentialLikeValue (value) {
  return typeof value === 'string' && (
    DELIMITED_CREDENTIAL_PATTERN.test(value) ||
    CASE_SENSITIVE_CREDENTIAL_PATTERN.test(value) ||
    NAMED_CREDENTIAL_PATTERN.test(value) ||
    isCompactJwt(value) ||
    isCompactJwe(value) ||
    PASETO_PATTERN.test(value)
  )
}

function normalizeField (key, value) {
  if (typeof value !== 'string') {
    return undefined
  }
  const source = key === 'traceId' ? value : value.trim()
  if (isCredentialLikeValue(source)) {
    return undefined
  }
  const normalized = source.slice(0, FIELD_LIMITS[key])
  if (!CONTEXT_VALUE_PATTERN.test(normalized)) {
    return undefined
  }
  if (key === 'traceId' && !TRACE_ID_PATTERN.test(normalized)) {
    return undefined
  }
  if (isCredentialLikeValue(normalized)) {
    return undefined
  }
  return normalized
}

export function normalizeTraceContext (value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const result = {}
  for (const key of CONTEXT_FIELDS) {
    const normalized = normalizeField(key, value[key])
    if (normalized !== undefined) {
      result[key] = normalized
    }
  }
  return result
}

function finiteTimestamp (value) {
  try {
    const timestamp = Math.trunc(Number(value))
    if (Number.isFinite(timestamp) && timestamp >= 0) {
      return timestamp % TIMESTAMP_RANGE
    }
  } catch (error) {
    return undefined
  }
}

function normalizeTimestamp (value) {
  let timestamp = finiteTimestamp(value)
  if (timestamp === undefined) {
    try {
      timestamp = finiteTimestamp(Date.now())
    } catch (error) {
      timestamp = undefined
    }
  }
  return String(timestamp ?? 0).padStart(13, '0')
}

function bytesToHex (value) {
  let source = []
  try {
    source = Array.from(value || []).slice(0, 4)
  } catch (error) {
    source = []
  }
  return Array.from({ length: 4 }, (_, index) => {
    const byte = source[index]
    return Number.isFinite(byte) && byte >= 0 && byte <= 255
      ? Math.trunc(byte)
      : 0
  }).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function browserRandomBytes (size) {
  const bytes = new Uint8Array(size)
  return globalThis.crypto.getRandomValues(bytes)
}

function readNow (adapters) {
  try {
    const now = adapters && typeof adapters.now === 'function'
      ? adapters.now
      : Date.now
    return now()
  } catch (error) {
    return undefined
  }
}

function readRandomBytes (adapters) {
  try {
    if (adapters && typeof adapters.randomBytes === 'function') {
      return adapters.randomBytes(4)
    }
  } catch (error) {
    // Fall through to the browser random source.
  }
  try {
    return browserRandomBytes(4)
  } catch (error) {
    return []
  }
}

function createTraceId (adapters) {
  return `sp-${normalizeTimestamp(readNow(adapters))}-${bytesToHex(readRandomBytes(adapters))}`
}

export function createTraceContext (seed = {}, adapters = {}) {
  const context = normalizeTraceContext(seed)
  if (!context.traceId) {
    context.traceId = createTraceId(adapters)
  }
  return context
}

export function childTraceContext (parent, patch = {}) {
  const parentContext = normalizeTraceContext(parent)
  const patchContext = normalizeTraceContext(patch)
  return createTraceContext({
    ...parentContext,
    ...patchContext,
    traceId: parentContext.traceId || patchContext.traceId
  })
}

export function toLogFields (context = {}) {
  return normalizeTraceContext(context)
}
