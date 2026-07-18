const {
  createTraceContext,
  isCredentialLikeValue,
  toLogFields
} = require('./trace-context')

const EVENT_STRING_LIMITS = {
  module: 64,
  action: 64,
  phase: 64,
  result: 64,
  messageCode: 128,
  reasonCode: 128,
  status: 64,
  type: 64,
  metric: 64,
  unit: 32
}

const EVENT_NUMBER_FIELDS = new Set([
  'durationMs',
  'count',
  'itemCount',
  'byteLength',
  'inputLength',
  'outputLength',
  'attachmentCount',
  'value'
])

const STABLE_VALUE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]*$/

function normalizeEventString (value, maxLength) {
  if (typeof value !== 'string') {
    return undefined
  }
  const source = value.trim()
  if (isCredentialLikeValue(source)) {
    return undefined
  }
  const normalized = source.slice(0, maxLength)
  if (!STABLE_VALUE_PATTERN.test(normalized)) {
    return undefined
  }
  if (isCredentialLikeValue(normalized)) {
    return undefined
  }
  return normalized
}

function normalizeEventNumber (value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(value))
}

function normalizeQualityEvent (event = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return {}
  }
  const result = {}
  for (const [key, maxLength] of Object.entries(EVENT_STRING_LIMITS)) {
    const normalized = normalizeEventString(event[key], maxLength)
    if (normalized !== undefined) {
      result[key] = normalized
    }
  }
  for (const key of EVENT_NUMBER_FIELDS) {
    const normalized = normalizeEventNumber(event[key])
    if (normalized !== undefined) {
      result[key] = normalized
    }
  }
  return result
}

function sanitizeContextEventNames (fields) {
  for (const key of ['module', 'action']) {
    const normalized = normalizeEventString(
      fields[key],
      EVENT_STRING_LIMITS[key]
    )
    if (normalized === undefined) {
      delete fields[key]
    } else {
      fields[key] = normalized
    }
  }
  return fields
}

function sanitizeCredentialBoundary (fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string' && isCredentialLikeValue(value)) {
      delete fields[key]
    }
  }
  return fields
}

function createQualityLogger (logger) {
  return function recordQualityEvent (context = {}, event = {}) {
    try {
      const fields = sanitizeCredentialBoundary(sanitizeContextEventNames({
        ...toLogFields(createTraceContext(context)),
        ...normalizeQualityEvent(event)
      }))
      logger.warn('quality_event', fields)
      // Acceptance is synchronous; the async file transport owns persistence.
      return true
    } catch (error) {
      try {
        logger.warn('quality_event_enqueue_failed')
      } catch (fallbackError) {
        // Quality logging must never interrupt the operation being observed.
      }
      return false
    }
  }
}

module.exports = {
  createQualityLogger,
  normalizeQualityEvent
}
