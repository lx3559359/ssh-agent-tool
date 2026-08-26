export function buildDeleteTargetPreview (files = [], options = {}) {
  const separator = options.separator || ', '
  const names = files.slice(0, 3)
    .map(file => String(file?.name || file?.path || ''))
    .filter(Boolean)
  return {
    count: files.length,
    names: names.join(separator),
    remaining: Math.max(0, files.length - names.length)
  }
}

export function redactDeletePreparationError (error) {
  return String(error?.message || error || '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi, '$1***@')
    .replace(
      /\bauthorization\s*[:=]\s*(?:bearer\s+)?[^\s;,]+/gi,
      'Authorization=***'
    )
    .replace(
      /\b(password|passwd|token|secret)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s;,]+)/gi,
      '$1=***'
    )
}

const safeDeletePhases = new Set([
  'source-scan',
  'snapshot-copy',
  'snapshot-verify',
  'ready',
  'deleting',
  'result-verify',
  'failed'
])

function nonNegativeNumber (value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

export function normalizeSafeDeleteProgress (progress = {}) {
  const phase = safeDeletePhases.has(progress.phase)
    ? progress.phase
    : 'source-scan'
  const completedBytes = nonNegativeNumber(progress.completedBytes)
  const rawTotal = progress.totalBytes
  const totalBytes = rawTotal === null || rawTotal === undefined
    ? null
    : nonNegativeNumber(rawTotal)
  const targetCount = Math.max(
    1,
    Math.trunc(nonNegativeNumber(progress.targetCount, 1))
  )
  const targetIndex = Math.min(
    targetCount,
    Math.max(1, Math.trunc(nonNegativeNumber(progress.targetIndex, 1)))
  )
  const determinate = totalBytes !== null && totalBytes > 0
  const boundedCompleted = determinate
    ? Math.min(completedBytes, totalBytes)
    : completedBytes
  return {
    phase,
    completedBytes: boundedCompleted,
    totalBytes,
    targetIndex,
    targetCount,
    determinate,
    percent: determinate
      ? Math.floor((boundedCompleted / totalBytes) * 100)
      : null
  }
}

export function createSafeDeleteProgressGate ({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onPublish,
  intervalMs = 100
} = {}) {
  let previous = null
  let latest = null
  let timer = null
  let lastPublishedAt = Number.NEGATIVE_INFINITY
  let disposed = false
  const publish = () => {
    timer = null
    if (disposed || !latest) return
    previous = latest
    lastPublishedAt = now()
    onPublish?.(latest)
  }
  const cancelPending = () => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }
  return {
    update (value) {
      if (disposed) return
      latest = normalizeSafeDeleteProgress(value)
      const elapsed = now() - lastPublishedAt
      const immediate = !previous ||
        previous.phase !== latest.phase ||
        elapsed >= intervalMs
      if (immediate) {
        cancelPending()
        publish()
      } else if (timer === null) {
        timer = setTimer(publish, Math.max(0, intervalMs - elapsed))
      }
    },
    dispose () {
      disposed = true
      cancelPending()
      previous = null
      latest = null
    }
  }
}
