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
const successfulTerminalStatuses = new Set(['success', 'completed'])
const failedTerminalStatuses = new Set(['failed', 'exception'])
const recognizedTerminalStatuses = new Set([
  ...successfulTerminalStatuses,
  'skipped',
  ...failedTerminalStatuses
])

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

function countItemOutcomes (itemResults) {
  if (!Array.isArray(itemResults) || itemResults.length === 0) return null
  const counts = {
    successful: 0,
    skipped: 0,
    failed: 0
  }
  for (const item of itemResults) {
    const status = String(item?.status || '')
    if (successfulTerminalStatuses.has(status)) {
      counts.successful += 1
    } else if (status === 'skipped') {
      counts.skipped += 1
    } else if (failedTerminalStatuses.has(status)) {
      counts.failed += 1
    } else {
      return null
    }
  }
  return counts
}

function buildTerminalRecordById (history, tabId) {
  const result = {}
  const items = Array.isArray(history) ? history.slice(0, 100) : []
  for (const item of items) {
    if (String(item?.tabId || '') !== String(tabId || '')) continue
    const outcomeCounts = countItemOutcomes(item.itemResults)
    const record = {
      status: String(item.error ? 'failed' : (item.status || '')),
      error: String(item.error || ''),
      ...(outcomeCounts ? { outcomeCounts } : {})
    }
    if (item.id) result[item.id] = record
    if (item.originalId) result[item.originalId] = record
  }
  return result
}

function terminalOutcome (previous, recordById) {
  const records = previous.items.map(item => (
    recordById[item.id] || { status: '', error: '' }
  ))
  if (records.some(record => !recognizedTerminalStatuses.has(record.status))) {
    return null
  }
  const outcomeCounts = records.reduce((counts, record) => {
    if (record.outcomeCounts) {
      counts.successful += record.outcomeCounts.successful
      counts.skipped += record.outcomeCounts.skipped
      counts.failed += record.outcomeCounts.failed
    } else if (successfulTerminalStatuses.has(record.status)) {
      counts.successful += 1
    } else if (record.status === 'skipped') {
      counts.skipped += 1
    } else if (failedTerminalStatuses.has(record.status)) {
      counts.failed += 1
    }
    return counts
  }, {
    successful: 0,
    skipped: 0,
    failed: 0
  })
  const status = outcomeCounts.failed > 0
    ? 'failed'
    : outcomeCounts.skipped > 0
      ? 'partial'
      : 'completed'
  return {
    ...previous,
    status,
    statusKey: `${status}:${previous.statusKey}`,
    outcomeCounts,
    items: previous.items.map(item => ({
      ...item,
      status: recordById[item.id]?.status || item.status,
      error: recordById[item.id]?.error || item.error,
      outcomeCounts: recordById[item.id]?.outcomeCounts || null
    })),
    speedBytesPerSecond: 0,
    determinate: status === 'completed' && previous.determinate,
    percent: status === 'completed' && previous.determinate ? 100 : null,
    transferred: status === 'completed' && previous.determinate
      ? previous.total
      : previous.transferred
  }
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
  const terminalRecordById = buildTerminalRecordById(history, tabId)
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
    terminalRecordById,
    terminalStatusById: Object.fromEntries(
      Object.entries(terminalRecordById).map(([id, record]) => [
        id,
        record.status
      ])
    )
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
  terminalHoldMs = 8000
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
        const recordById = summary.terminalRecordById || Object.fromEntries(
          Object.entries(summary.terminalStatusById || {}).map(([id, status]) => [
            id,
            { status, error: '' }
          ])
        )
        const outcome = terminalOutcome(previous, recordById)
        if (outcome) {
          cancelPending()
          latest = outcome
          publish()
          if (outcome.status === 'completed') {
            timer = setTimer(() => {
              latest = summary
              publish()
            }, terminalHoldMs)
          }
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
    dismiss () {
      cancelPending()
      const empty = {
        items: [],
        count: 0,
        transferred: 0,
        total: 0,
        determinate: false,
        percent: null,
        speedBytesPerSecond: 0,
        status: '',
        statusKey: '',
        current: null,
        terminalRecordById: {},
        terminalStatusById: {}
      }
      latest = empty
      previous = empty
      onPublish(empty)
    },
    dispose () {
      disposed = true
      cancelPending()
      latest = null
      previous = null
    }
  }
}
