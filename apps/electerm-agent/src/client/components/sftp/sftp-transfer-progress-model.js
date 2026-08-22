const visibleStatuses = new Set([
  'queued',
  'running',
  'pausing',
  'paused',
  'resuming',
  'interrupted',
  'failed',
  'exception'
])

const statusPriority = {
  running: 0,
  resuming: 1,
  pausing: 2,
  paused: 3,
  interrupted: 4,
  queued: 5,
  failed: 6,
  exception: 6
}

function finiteNumber (value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function normalizeStatus (transfer) {
  return String(transfer.status || (transfer.inited ? 'running' : 'queued'))
}

function normalizeTransfer (transfer) {
  const status = normalizeStatus(transfer)
  if (!visibleStatuses.has(status)) return null
  const declaredTotal = finiteNumber(transfer.total)
  const fallbackTotal = finiteNumber(transfer.fromFile?.size)
  const total = Math.max(0, declaredTotal > 0 ? declaredTotal : fallbackTotal)
  const rawTransferred = Math.max(0, finiteNumber(transfer.transferred))
  const transferred = total > 0
    ? Math.min(rawTransferred, total)
    : rawTransferred
  return {
    ...transfer,
    status,
    total,
    transferred,
    speedBytesPerSecond: Math.max(
      0,
      finiteNumber(transfer.speedBytesPerSecond)
    )
  }
}

function selectCurrent (items) {
  return items.reduce((current, item) => {
    if (!current) return item
    return statusPriority[item.status] < statusPriority[current.status]
      ? item
      : current
  }, null)
}

function summaryStatus (items) {
  if (items.some(item => ['failed', 'exception'].includes(item.status))) {
    return 'failed'
  }
  for (const status of [
    'running',
    'resuming',
    'pausing',
    'paused',
    'interrupted',
    'queued'
  ]) {
    if (items.some(item => item.status === status)) return status
  }
  return ''
}

export function buildSftpTransferProgress (transfers, tabId) {
  const items = (Array.isArray(transfers) ? transfers : [])
    .filter(transfer => String(transfer?.tabId || '') === String(tabId || ''))
    .map(normalizeTransfer)
    .filter(Boolean)
  const transferred = items.reduce(
    (total, item) => total + item.transferred,
    0
  )
  const total = items.reduce((sum, item) => sum + item.total, 0)
  const determinate = items.length > 0 && items.every(item => item.total > 0)
  const percent = determinate
    ? Math.max(0, Math.min(100, Math.floor(transferred / total * 100)))
    : null
  const speedBytesPerSecond = items.reduce(
    (sum, item) => sum + item.speedBytesPerSecond,
    0
  )
  const status = summaryStatus(items)
  return {
    items,
    count: items.length,
    transferred,
    total,
    determinate,
    percent,
    speedBytesPerSecond,
    status,
    statusKey: items.map(item => `${item.id}:${item.status}:${item.error || ''}`)
      .join('|'),
    current: selectCurrent(items)
  }
}

export function shouldPublishSftpProgress ({
  previousStatus = '',
  nextStatus = '',
  previousCount,
  nextCount,
  elapsedMs = 0
} = {}) {
  if (previousStatus !== nextStatus) return true
  if (previousCount !== undefined && nextCount !== undefined &&
    previousCount !== nextCount) return true
  return finiteNumber(elapsedMs) >= 100
}

export function createSftpProgressPublishGate ({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onPublish,
  intervalMs = 100
} = {}) {
  if (typeof onPublish !== 'function') {
    throw new Error('SFTP 进度发布器缺少发布回调。')
  }
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
    onPublish(latest)
  }

  const cancelPending = () => {
    if (!timer) return
    clearTimer(timer)
    timer = null
  }

  return {
    update (summary) {
      if (disposed) return
      latest = summary
      const elapsedMs = now() - lastPublishedAt
      const immediate = !previous || shouldPublishSftpProgress({
        previousStatus: previous.statusKey,
        nextStatus: summary.statusKey,
        previousCount: previous.count,
        nextCount: summary.count,
        elapsedMs
      })
      if (immediate) {
        cancelPending()
        publish()
      } else if (!timer) {
        timer = setTimer(publish, Math.max(0, intervalMs - elapsedMs))
      }
    },
    dispose () {
      disposed = true
      cancelPending()
      latest = null
      previous = null
    }
  }
}
