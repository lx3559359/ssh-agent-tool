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

function buildTerminalStatusById (history, tabId) {
  const result = {}
  const items = Array.isArray(history) ? history.slice(0, 100) : []
  for (const item of items) {
    if (String(item?.tabId || '') !== String(tabId || '')) continue
    const status = String(item.error ? 'failed' : (item.status || ''))
    if (item.id) result[item.id] = status
    if (item.originalId) result[item.originalId] = status
  }
  return result
}

export function getSftpTransferDirection (current = {}) {
  if (current.typeFrom === 'local' && current.typeTo === 'remote') {
    return 'upload'
  }
  if (current.typeFrom === 'remote' && current.typeTo === 'local') {
    return 'download'
  }
  return 'transfer'
}

export function buildSftpTransferProgress (transfers, tabId, history) {
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
    ? Math.min(100, Math.max(
      transferred > 0 ? 1 : 0,
      Math.floor(transferred / total * 100)
    ))
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
    current: selectCurrent(items),
    terminalStatusById: buildTerminalStatusById(history, tabId)
  }
}

export function shouldPublishSftpProgress ({
  previousStatus = '',
  nextStatus = '',
  previousCount,
  nextCount,
  previousTransferred,
  nextTransferred,
  elapsedMs = 0
} = {}) {
  if (previousStatus !== nextStatus) return true
  if (previousCount !== undefined && nextCount !== undefined &&
    previousCount !== nextCount) return true
  if (finiteNumber(previousTransferred) <= 0 &&
    finiteNumber(nextTransferred) > 0) return true
  return finiteNumber(elapsedMs) >= 100
}

export function createSftpProgressPublishGate ({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onPublish,
  intervalMs = 100,
  terminalHoldMs = 2000
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
      if (summary.count === 0 && previous?.count > 0) {
        const statuses = previous.items
          .map(item => summary.terminalStatusById?.[item.id])
          .filter(Boolean)
        const completed = statuses.length === previous.items.length &&
          statuses.every(status => ['success', 'completed'].includes(status))
        const failed = statuses.some(status => ['failed', 'exception'].includes(status))
        if (completed || failed) {
          cancelPending()
          latest = {
            ...previous,
            status: completed ? 'completed' : 'failed',
            statusKey: `${completed ? 'completed' : 'failed'}:${previous.statusKey}`,
            speedBytesPerSecond: 0,
            ...(completed && previous.determinate
              ? {
                  transferred: previous.total,
                  percent: 100
                }
              : {})
          }
          publish()
          timer = setTimer(() => {
            latest = summary
            publish()
          }, terminalHoldMs)
          return
        }
      }
      latest = summary
      const elapsedMs = now() - lastPublishedAt
      const immediate = !previous || shouldPublishSftpProgress({
        previousStatus: previous.statusKey,
        nextStatus: summary.statusKey,
        previousCount: previous.count,
        nextCount: summary.count,
        previousTransferred: previous.transferred,
        nextTransferred: summary.transferred,
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
