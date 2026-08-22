const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modelPath = path.resolve(
  __dirname,
  '../../src/client/components/sftp/sftp-transfer-progress-model.js'
)

function importModel () {
  return import(pathToFileURL(modelPath).href)
}

test('SFTP transfer progress aggregates only the current tab by bytes', async () => {
  const { buildSftpTransferProgress } = await importModel()
  const result = buildSftpTransferProgress([
    {
      id: 'a',
      tabId: 'tab-a',
      status: 'running',
      transferred: 40,
      total: 100,
      speedBytesPerSecond: 10
    },
    {
      id: 'b',
      tabId: 'tab-a',
      status: 'paused',
      transferred: 50,
      total: 100,
      speedBytesPerSecond: 0
    },
    {
      id: 'c',
      tabId: 'tab-b',
      status: 'running',
      transferred: 100,
      total: 100,
      speedBytesPerSecond: 99
    }
  ], 'tab-a')

  assert.equal(result.transferred, 90)
  assert.equal(result.total, 200)
  assert.equal(result.percent, 45)
  assert.equal(result.speedBytesPerSecond, 10)
  assert.equal(result.count, 2)
  assert.equal(result.current.id, 'a')
})

test('SFTP transfer progress visibly starts after the first transferred bytes', async () => {
  const { buildSftpTransferProgress } = await importModel()
  const started = buildSftpTransferProgress([{
    id: 'large-upload',
    tabId: 'tab-a',
    status: 'running',
    transferred: 32 * 1024,
    total: 64 * 1024 * 1024
  }], 'tab-a')
  const queued = buildSftpTransferProgress([{
    id: 'queued-upload',
    tabId: 'tab-a',
    status: 'queued',
    transferred: 0,
    total: 64 * 1024 * 1024
  }], 'tab-a')

  assert.equal(started.percent, 1)
  assert.equal(queued.percent, 0)
})

test('SFTP progress classifies upload and download direction', async () => {
  const { getSftpTransferDirection } = await importModel()

  assert.equal(getSftpTransferDirection({
    typeFrom: 'local',
    typeTo: 'remote'
  }), 'upload')
  assert.equal(getSftpTransferDirection({
    typeFrom: 'remote',
    typeTo: 'local'
  }), 'download')
  assert.equal(getSftpTransferDirection({
    typeFrom: 'remote',
    typeTo: 'remote'
  }), 'transfer')
  assert.equal(getSftpTransferDirection(), 'transfer')
})

test('SFTP transfer progress is indeterminate when an active total is unknown', async () => {
  const { buildSftpTransferProgress } = await importModel()
  const result = buildSftpTransferProgress([
    {
      id: 'folder',
      tabId: 'tab-a',
      status: 'running',
      transferred: 12,
      total: 0
    }
  ], 'tab-a')

  assert.equal(result.determinate, false)
  assert.equal(result.percent, null)
  assert.equal(result.transferred, 12)
})

test('SFTP transfer progress clamps retry rollback and prioritizes running work', async () => {
  const { buildSftpTransferProgress } = await importModel()
  const result = buildSftpTransferProgress([
    {
      id: 'paused',
      tabId: 'tab-a',
      status: 'paused',
      transferred: 999,
      total: 100
    },
    {
      id: 'retry',
      tabId: 'tab-a',
      status: 'running',
      retrying: true,
      transferred: -10,
      total: 100
    },
    {
      id: 'hidden',
      tabId: 'tab-a',
      status: 'success',
      transferred: 10,
      total: 10
    }
  ], 'tab-a')

  assert.equal(result.transferred, 100)
  assert.equal(result.total, 200)
  assert.equal(result.percent, 50)
  assert.equal(result.current.id, 'retry')
})

test('SFTP progress publishes status transitions immediately and throttles bytes', async () => {
  const { shouldPublishSftpProgress } = await importModel()

  assert.equal(shouldPublishSftpProgress({
    previousStatus: 'running',
    nextStatus: 'running',
    elapsedMs: 50
  }), false)
  assert.equal(shouldPublishSftpProgress({
    previousStatus: 'running',
    nextStatus: 'failed',
    elapsedMs: 5
  }), true)
  assert.equal(shouldPublishSftpProgress({
    previousStatus: 'running',
    nextStatus: 'running',
    elapsedMs: 100
  }), true)
  assert.equal(shouldPublishSftpProgress({
    previousStatus: 'running',
    nextStatus: 'running',
    previousTransferred: 0,
    nextTransferred: 1,
    elapsedMs: 5
  }), true)
  assert.equal(shouldPublishSftpProgress({
    previousStatus: '',
    nextStatus: 'queued',
    elapsedMs: 0
  }), true)
})

test('file and folder transfer callbacks expose numeric byte speed', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')
  const speedFields = source.match(/speedBytesPerSecond/g) || []

  assert.ok(speedFields.length >= 2)
})

test('SFTP progress publish gate coalesces byte updates but flushes status changes', async () => {
  const { createSftpProgressPublishGate } = await importModel()
  let currentTime = 0
  const scheduled = []
  const published = []
  const gate = createSftpProgressPublishGate({
    now: () => currentTime,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cancelled: false }
      scheduled.push(timer)
      return timer
    },
    clearTimer: timer => {
      timer.cancelled = true
    },
    onPublish: summary => published.push(summary)
  })

  gate.update({ count: 1, statusKey: 'a:running:', transferred: 0 })
  currentTime = 20
  gate.update({ count: 1, statusKey: 'a:running:', transferred: 10 })
  currentTime = 40
  gate.update({ count: 1, statusKey: 'a:running:', transferred: 20 })

  assert.equal(published.length, 2)
  assert.equal(published.at(-1).transferred, 10)
  assert.equal(scheduled.filter(timer => !timer.cancelled).length, 1)
  assert.equal(scheduled[0].delay, 80)

  currentTime = 120
  scheduled[0].callback()
  assert.equal(published.at(-1).transferred, 20)

  currentTime = 125
  gate.update({ count: 1, statusKey: 'a:paused:', transferred: 20 })
  assert.equal(published.at(-1).statusKey, 'a:paused:')

  gate.dispose()
})

test('SFTP workspace mounts an accessible tab-scoped progress dock', () => {
  const entry = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-entry.jsx'
  ), 'utf8')
  const dock = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transfer-progress-dock.jsx'
  ), 'utf8')
  const i18n = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/common/shellpilot-i18n-overrides.js'
  ), 'utf8')

  assert.match(entry, /SftpTransferProgressDock/)
  assert.match(entry, /tabId=\{this\.props\.tab\.id\}/)
  assert.match(dock, /buildSftpTransferProgress/)
  assert.match(dock, /createSftpProgressPublishGate/)
  assert.match(dock, /aria-expanded/)
  assert.match(dock, /role='progressbar'/)
  assert.match(dock, /aria-valuemax=\{100\}/)
  assert.match(dock, /Transporter/)
  assert.match(dock, /compact/)
  assert.match(dock, /readOnly=\{terminal\}/)
  assert.match(dock, /getSftpTransferDirection/)
  assert.match(dock, /sftp-transfer-dock-direction/)
  assert.match(i18n, /shellpilotSftpTransferUploading/)
  assert.match(i18n, /shellpilotSftpTransferDownloading/)
})

test('SFTP transfer dock keeps an obvious active progress presentation', () => {
  const dock = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transfer-progress-dock.jsx'
  ), 'utf8')
  const styles = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp.styl'
  ), 'utf8')

  assert.match(styles, /height calc\(100% - 64px\) !important/)
  assert.match(styles, /\.sftp-transfer-progress-dock\s+[\s\S]*?min-height 50px/)
  assert.match(styles, /\.sftp-transfer-dock-leading\s+[\s\S]*?display flex/)
  assert.match(styles, /\.sftp-transfer-dock-direction\s+[\s\S]*?background var\(--sp-primary-soft\)/)
  assert.match(styles, /\.sftp-transfer-dock-progress\s+[\s\S]*?height 8px/)
  assert.match(styles, /\.sftp-transfer-progress-dock-running,[\s\S]*?border-color var\(--sp-primary\)/)
  assert.match(dock, /sftp-transfer-dock-percent/)
  assert.match(dock, /sftp-transfer-dock-metrics-detail/)
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.sftp-transfer-dock-metrics-detail\s+[\s\S]*?display none/)
})

test('SFTP progress gate briefly publishes a verified successful terminal state', async () => {
  const { createSftpProgressPublishGate } = await importModel()
  let currentTime = 0
  const scheduled = []
  const published = []
  const gate = createSftpProgressPublishGate({
    now: () => currentTime,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cancelled: false }
      scheduled.push(timer)
      return timer
    },
    clearTimer: timer => {
      timer.cancelled = true
    },
    onPublish: summary => published.push(summary)
  })
  gate.update({
    count: 1,
    statusKey: 'upload:running:',
    status: 'running',
    transferred: 0,
    total: 100,
    determinate: true,
    percent: 0,
    items: [{ id: 'upload' }]
  })

  currentTime = 20
  gate.update({
    count: 0,
    statusKey: '',
    status: '',
    transferred: 0,
    total: 0,
    determinate: false,
    percent: null,
    items: [],
    terminalStatusById: { upload: 'success' }
  })

  assert.equal(published.at(-1).status, 'completed')
  assert.equal(published.at(-1).percent, 100)
  assert.equal(published.at(-1).transferred, 100)
  assert.equal(scheduled.filter(timer => !timer.cancelled).length, 1)
  assert.equal(scheduled.at(-1).delay, 2000)

  currentTime = 2020
  scheduled.at(-1).callback()
  assert.equal(published.at(-1).count, 0)
})

test('SFTP progress gate holds a root-skipped transfer as completed without inventing uploaded bytes', async () => {
  const { createSftpProgressPublishGate } = await importModel()
  let currentTime = 0
  const scheduled = []
  const published = []
  const gate = createSftpProgressPublishGate({
    now: () => currentTime,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cancelled: false }
      scheduled.push(timer)
      return timer
    },
    clearTimer: timer => {
      timer.cancelled = true
    },
    onPublish: summary => published.push(summary)
  })
  gate.update({
    count: 1,
    statusKey: 'root-skip:queued:',
    status: 'queued',
    transferred: 0,
    total: 128,
    determinate: true,
    percent: 0,
    items: [{ id: 'root-skip' }]
  })

  currentTime = 20
  gate.update({
    count: 0,
    statusKey: '',
    status: '',
    transferred: 0,
    total: 0,
    determinate: false,
    percent: null,
    items: [],
    terminalStatusById: { 'root-skip': 'skipped' }
  })

  assert.equal(published.at(-1).status, 'completed')
  assert.equal(published.at(-1).transferred, 0)
  assert.equal(published.at(-1).percent, 0)
  assert.equal(published.at(-1).total, 128)
  assert.equal(scheduled.filter(timer => !timer.cancelled).length, 1)
  assert.equal(scheduled.at(-1).delay, 2000)

  currentTime = 2020
  scheduled.at(-1).callback()
  assert.equal(published.at(-1).count, 0)
})

test('SFTP progress never reports a cancelled transfer as completed', async () => {
  const { createSftpProgressPublishGate } = await importModel()
  const published = []
  const gate = createSftpProgressPublishGate({
    onPublish: summary => published.push(summary)
  })
  gate.update({
    count: 1,
    statusKey: 'cancel:running:',
    status: 'running',
    transferred: 25,
    total: 100,
    determinate: true,
    percent: 25,
    items: [{ id: 'cancel' }]
  })
  gate.update({
    count: 0,
    statusKey: '',
    status: '',
    transferred: 0,
    total: 0,
    determinate: false,
    percent: null,
    items: [],
    terminalStatusById: { cancel: 'cancelled' }
  })

  assert.equal(published.at(-1).count, 0)
  assert.notEqual(published.at(-1).status, 'completed')
  gate.dispose()
})

test('SFTP progress reads the newest bounded transfer history entries', async () => {
  const { buildSftpTransferProgress } = await importModel()
  const history = [
    { id: 'fresh', tabId: 'tab-a', status: 'success' },
    ...Array.from({ length: 1000 }, (_, index) => ({
      id: `old-${index}`,
      tabId: 'tab-a',
      status: 'success'
    }))
  ]

  const result = buildSftpTransferProgress([], 'tab-a', history)

  assert.equal(result.terminalStatusById.fresh, 'success')
  assert.equal(result.terminalStatusById['old-999'], undefined)
})

test('SFTP progress treats a history error as failed even with stale running status', async () => {
  const { buildSftpTransferProgress } = await importModel()
  const result = buildSftpTransferProgress([], 'tab-a', [{
    id: 'failed-upload',
    tabId: 'tab-a',
    status: 'running',
    error: 'Permission denied'
  }])

  assert.equal(result.terminalStatusById['failed-upload'], 'failed')
})
