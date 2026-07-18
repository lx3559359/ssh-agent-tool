import {
  isCredentialLikeValue,
  normalizeTraceContext
} from './trace-context.js'

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
const PERFORMANCE_MARK_NAMES = new Set([
  'config_interactive',
  'first_terminal_ready'
])
const PERFORMANCE_DURATION_NAMES = new Set([
  'ai_first_token_ms',
  'ai_total_ms'
])
const PERFORMANCE_DIMENSION_KEYS = new Set([
  'outcome',
  'requestType',
  'terminalType',
  'windowRole'
])

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

export function normalizeQualityEvent (event = {}) {
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

export function recordQualityEvent (context, event) {
  // The result reports main-process acceptance, not async file persistence.
  const invoke = globalThis.window?.pre?.runGlobalAsync
  if (typeof invoke !== 'function') {
    return Promise.resolve(false)
  }
  try {
    return Promise.resolve(invoke(
      'recordQualityEvent',
      normalizeTraceContext(context),
      normalizeQualityEvent(event)
    )).catch(() => false)
  } catch (error) {
    return Promise.resolve(false)
  }
}

function normalizePerformanceDimensions (dimensions = {}) {
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) {
    return null
  }
  const result = {}
  for (const [key, value] of Object.entries(dimensions)) {
    if (!PERFORMANCE_DIMENSION_KEYS.has(key)) return null
    const normalized = normalizeEventString(value, 32)
    if (normalized === undefined) return null
    result[key] = normalized
  }
  return result
}

function invokePerformanceMetric (payload) {
  const invoke = globalThis.window?.pre?.runGlobalAsync
  if (typeof invoke !== 'function') return Promise.resolve(false)
  try {
    return Promise.resolve(invoke('recordPerformanceMetric', payload))
      .then(result => result === true)
      .catch(() => false)
  } catch (error) {
    return Promise.resolve(false)
  }
}

export function recordPerformanceMark (name, at = Date.now(), dimensions = {}) {
  if (!PERFORMANCE_MARK_NAMES.has(name)) return Promise.resolve(false)
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) {
    return Promise.resolve(false)
  }
  const normalizedDimensions = normalizePerformanceDimensions(dimensions)
  if (!normalizedDimensions) return Promise.resolve(false)
  return invokePerformanceMetric({
    kind: 'mark',
    name,
    at: Math.trunc(at),
    dimensions: normalizedDimensions
  })
}

export function recordPerformanceDuration (name, durationMs, dimensions = {}) {
  if (!PERFORMANCE_DURATION_NAMES.has(name)) return Promise.resolve(false)
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return Promise.resolve(false)
  }
  const normalizedDimensions = normalizePerformanceDimensions(dimensions)
  if (!normalizedDimensions) return Promise.resolve(false)
  return invokePerformanceMetric({
    kind: 'duration',
    name,
    value: Math.round(durationMs),
    dimensions: normalizedDimensions
  })
}

export function createAIRequestPerformanceTracker ({
  now = Date.now,
  recordDuration = recordPerformanceDuration,
  requestType = 'chat'
} = {}) {
  let startedAt
  try {
    startedAt = Number(now())
  } catch (error) {
    startedAt = Date.now()
  }
  let firstContentRecorded = false
  let finished = false

  function elapsed () {
    try {
      return Math.max(0, Number(now()) - startedAt)
    } catch (error) {
      return 0
    }
  }

  return {
    markContent (content) {
      if (firstContentRecorded || typeof content !== 'string' || !content.trim()) {
        return false
      }
      firstContentRecorded = true
      try {
        Promise.resolve(recordDuration('ai_first_token_ms', elapsed(), {
          requestType
        })).catch(() => false)
      } catch (error) {}
      return true
    },
    finish (outcome = 'completed') {
      if (finished) return false
      finished = true
      try {
        Promise.resolve(recordDuration('ai_total_ms', elapsed(), {
          requestType,
          outcome
        })).catch(() => false)
      } catch (error) {}
      return true
    }
  }
}
