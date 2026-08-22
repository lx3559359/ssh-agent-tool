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
