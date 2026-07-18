const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { isCredentialLikeValue } = require('./trace-context')

const SCHEMA_VERSION = 1
const MAX_RECORDS = 1000
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MEMORY_INTERVAL_MS = 60 * 1000
const DIMENSION_VALUE_LIMIT = 32

const MILESTONE_NAMES = new Set([
  'app_start',
  'window_loaded',
  'config_interactive',
  'first_terminal_ready'
])

const DURATION_NAMES = new Set([
  'app_start_ms',
  'first_window_interactive_ms',
  'first_terminal_ready_ms',
  'ai_first_token_ms',
  'ai_total_ms'
])

const MEMORY_FIELDS = {
  mainMb: 'memory_main_mb',
  rendererMb: 'memory_renderer_mb',
  totalMb: 'memory_total_mb'
}

const METRIC_NAMES = new Set([
  ...DURATION_NAMES,
  ...Object.values(MEMORY_FIELDS)
])

const DIMENSION_KEYS = new Set([
  'outcome',
  'requestType',
  'terminalType',
  'windowRole'
])

const DIMENSION_VALUE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]*$/
const SENSITIVE_KEY_PATTERN = /(?:api.?key|authorization|command|content|host|output|password|path|private.?key|prompt|secret|token|user)/i

function defaultFileSystem () {
  return {
    readFileSync: fs.readFileSync.bind(fs),
    mkdir: fs.promises.mkdir.bind(fs.promises),
    writeFile: fs.promises.writeFile.bind(fs.promises),
    rename: fs.promises.rename.bind(fs.promises)
  }
}

function finiteNonNegative (value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function safeNow (now) {
  try {
    const value = now()
    return finiteNonNegative(value) ? Math.trunc(value) : Date.now()
  } catch (error) {
    return Date.now()
  }
}

function normalizeDimensions (dimensions = {}) {
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) {
    return null
  }
  const result = {}
  for (const [key, value] of Object.entries(dimensions)) {
    if (
      !DIMENSION_KEYS.has(key) ||
      SENSITIVE_KEY_PATTERN.test(key) ||
      typeof value !== 'string'
    ) {
      return null
    }
    const normalized = value.trim()
    if (
      !normalized ||
      normalized.length > DIMENSION_VALUE_LIMIT ||
      !DIMENSION_VALUE_PATTERN.test(normalized) ||
      isCredentialLikeValue(normalized)
    ) {
      return null
    }
    result[key] = normalized
  }
  return result
}

function normalizeRunId (runId) {
  const value = String(runId || '').trim()
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value)
    ? value
    : crypto.randomUUID()
}

function normalizeRecord (record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  if (!METRIC_NAMES.has(record.name) || !finiteNonNegative(record.value)) return null
  if (!finiteNonNegative(record.at)) return null
  const dimensions = normalizeDimensions(record.dimensions)
  if (!dimensions) return null
  return {
    name: record.name,
    value: Math.round(record.value * 1000) / 1000,
    at: Math.trunc(record.at),
    runId: normalizeRunId(record.runId),
    dimensions
  }
}

function readPersistedRecords (fileSystem, storagePath) {
  if (!storagePath) return []
  try {
    const parsed = JSON.parse(fileSystem.readFileSync(storagePath, 'utf8'))
    const source = Array.isArray(parsed) ? parsed : parsed.records
    return Array.isArray(source) ? source : []
  } catch (error) {
    return []
  }
}

function mean (values) {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round (value, precision = 3) {
  if (!finiteNonNegative(value)) return value
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function createPerformanceMetrics (options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  const logger = options.logger || console
  const runId = normalizeRunId(options.runId)
  const storagePath = typeof options.storagePath === 'string'
    ? options.storagePath
    : ''
  const persist = options.persist !== false && !!storagePath
  const fileSystem = options.fileSystem || defaultFileSystem()
  const flushDelayMs = finiteNonNegative(options.flushDelayMs)
    ? options.flushDelayMs
    : 250
  const milestones = new Map()
  let persistenceDisabled = false
  let warned = false
  let flushPromise = null
  let flushTimer = null
  let dirty = false
  let revision = 0
  let lastMemoryAt = -Infinity

  const loaded = [
    ...readPersistedRecords(fileSystem, storagePath),
    ...(Array.isArray(options.initialRecords) ? options.initialRecords : [])
  ]
  let records = loaded.map(normalizeRecord).filter(Boolean)

  function prune () {
    const cutoff = safeNow(now) - MAX_AGE_MS
    records = records
      .filter(record => record.at >= cutoff)
      .slice(-MAX_RECORDS)
  }

  function warnPersistenceOnce () {
    if (warned) return
    warned = true
    try {
      logger.warn('performance_metrics_persistence_disabled')
    } catch (error) {
      // Performance telemetry must never affect application behavior.
    }
  }

  function scheduleFlush () {
    if (!persist || persistenceDisabled || flushTimer || flushPromise) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      flush().catch(() => false)
    }, flushDelayMs)
    flushTimer.unref?.()
  }

  function appendRecord (name, value, dimensions, at = safeNow(now)) {
    try {
      if (!METRIC_NAMES.has(name) || !finiteNonNegative(value) || !finiteNonNegative(at)) {
        return false
      }
      const normalizedDimensions = normalizeDimensions(dimensions)
      if (!normalizedDimensions) return false
      records.push({
        name,
        value: round(value),
        at: Math.trunc(at),
        runId,
        dimensions: normalizedDimensions
      })
      prune()
      dirty = true
      revision += 1
      scheduleFlush()
      return true
    } catch (error) {
      return false
    }
  }

  function mark (name, at = safeNow(now), dimensions = {}) {
    try {
      if (!MILESTONE_NAMES.has(name) || !finiteNonNegative(at) || milestones.has(name)) {
        return false
      }
      const normalizedDimensions = normalizeDimensions(dimensions)
      if (!normalizedDimensions) return false
      if (name === 'app_start') {
        milestones.set(name, Math.trunc(at))
        return true
      }
      const appStart = milestones.get('app_start')
      if (!finiteNonNegative(appStart) || at < appStart) return false
      const metricName = name === 'window_loaded'
        ? 'app_start_ms'
        : name === 'config_interactive'
          ? 'first_window_interactive_ms'
          : 'first_terminal_ready_ms'
      if (!appendRecord(metricName, at - appStart, normalizedDimensions, at)) {
        return false
      }
      milestones.set(name, Math.trunc(at))
      return true
    } catch (error) {
      return false
    }
  }

  function recordDuration (name, durationMs, dimensions = {}) {
    if (!DURATION_NAMES.has(name)) return false
    return appendRecord(name, durationMs, dimensions)
  }

  function recordMemory (snapshot = {}) {
    try {
      const at = safeNow(now)
      if (at - lastMemoryAt < MEMORY_INTERVAL_MS) return false
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
      const entries = Object.entries(MEMORY_FIELDS)
        .filter(([field]) => finiteNonNegative(snapshot[field]))
      if (!entries.length) return false
      for (const [field, metricName] of entries) {
        if (!appendRecord(metricName, snapshot[field], {}, at)) return false
      }
      lastMemoryAt = at
      return true
    } catch (error) {
      return false
    }
  }

  function getSummary () {
    try {
      prune()
      const metrics = {}
      for (const name of METRIC_NAMES) {
        const matching = records.filter(record => record.name === name)
        if (!matching.length) continue
        const latestRecord = matching[matching.length - 1]
        const values = matching.map(record => record.value)
        const baselineValues = matching
          .filter(record => record.runId !== runId)
          .map(record => record.value)
        const baseline = mean(baselineValues)
        metrics[name] = {
          latest: latestRecord.value,
          minimum: Math.min(...values),
          maximum: Math.max(...values),
          average: round(mean(values)),
          baseline: baseline === null ? null : round(baseline),
          relativeChange: baseline && baseline > 0
            ? round((latestRecord.value - baseline) / baseline, 4)
            : null,
          sampleCount: matching.length,
          dimensions: { ...latestRecord.dimensions },
          recordedAt: latestRecord.at
        }
      }
      return {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: safeNow(now),
        recordCount: records.length,
        metrics
      }
    } catch (error) {
      return {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: 0,
        recordCount: 0,
        metrics: {}
      }
    }
  }

  function flush () {
    if (!persist || persistenceDisabled) return Promise.resolve(false)
    if (flushPromise) return flushPromise
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (!dirty) return Promise.resolve(true)
    const flushRevision = revision
    const snapshot = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      records
    })
    const tempPath = `${storagePath}.tmp`
    flushPromise = Promise.resolve()
      .then(() => fileSystem.mkdir(path.dirname(storagePath), { recursive: true }))
      .then(() => fileSystem.writeFile(tempPath, snapshot, 'utf8'))
      .then(() => fileSystem.rename(tempPath, storagePath))
      .then(() => {
        dirty = revision !== flushRevision
        return true
      })
      .catch(() => {
        persistenceDisabled = true
        warnPersistenceOnce()
        return false
      })
      .finally(() => {
        flushPromise = null
        if (dirty && !persistenceDisabled) scheduleFlush()
      })
    return flushPromise
  }

  prune()

  return {
    mark,
    recordDuration,
    recordMemory,
    getSummary,
    flush
  }
}

module.exports = {
  createPerformanceMetrics
}
