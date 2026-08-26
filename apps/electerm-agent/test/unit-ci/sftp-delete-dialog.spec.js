const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '../..')

test('delete target preview lists three names and the remaining count', async () => {
  const { buildDeleteTargetPreview } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-delete-dialog-model.js'
  )).href)
  const preview = buildDeleteTargetPreview(
    ['a.log', 'b.log', 'c.log', 'd.log'].map(name => ({ name })),
    { separator: '、' }
  )
  assert.equal(preview.names, 'a.log、b.log、c.log')
  assert.equal(preview.remaining, 1)
  assert.equal(preview.count, 4)
})

test('safe delete preparation errors redact common credential forms', async () => {
  const { redactDeletePreparationError } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-delete-dialog-model.js'
  )).href)
  const result = redactDeletePreparationError(
    'sftp://root:secret@example.test failed; token=abc123; Authorization: Bearer auth456'
  )

  assert.doesNotMatch(result, /secret|abc123|auth456/)
  assert.match(result, /\*\*\*/)
})

test('safe delete progress normalizes bytes, target position, and percentage', async () => {
  const {
    normalizeSafeDeleteProgress
  } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-delete-dialog-model.js'
  )).href)
  assert.deepEqual(normalizeSafeDeleteProgress({
    phase: 'snapshot-copy',
    completedBytes: 75,
    totalBytes: 100,
    targetIndex: 2,
    targetCount: 3
  }), {
    phase: 'snapshot-copy',
    completedBytes: 75,
    totalBytes: 100,
    targetIndex: 2,
    targetCount: 3,
    determinate: true,
    percent: 75
  })
  assert.deepEqual(normalizeSafeDeleteProgress({
    phase: 'source-scan',
    completedBytes: 32,
    totalBytes: null,
    targetIndex: 9,
    targetCount: 2
  }), {
    phase: 'source-scan',
    completedBytes: 32,
    totalBytes: null,
    targetIndex: 2,
    targetCount: 2,
    determinate: false,
    percent: null
  })
})

test('safe delete progress publishes phase changes immediately and bytes at 100ms', async () => {
  const { createSafeDeleteProgressGate } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-delete-dialog-model.js'
  )).href)
  let now = 0
  const timers = []
  const published = []
  const gate = createSafeDeleteProgressGate({
    now: () => now,
    setTimer: (callback, delay) => {
      const timer = { callback, delay }
      timers.push(timer)
      return timer
    },
    clearTimer: () => {},
    onPublish: value => published.push(value)
  })
  gate.update({ phase: 'source-scan', completedBytes: 0 })
  now = 10
  gate.update({ phase: 'source-scan', completedBytes: 64 })
  gate.update({ phase: 'source-scan', completedBytes: 128 })
  assert.equal(published.length, 1)
  assert.equal(timers.at(-1).delay, 90)
  gate.update({ phase: 'snapshot-copy', completedBytes: 0 })
  assert.equal(published.at(-1).phase, 'snapshot-copy')
  gate.dispose()
})

test('safe delete dialog starts disabled and exposes staged progress controls', () => {
  const source = fs.readFileSync(path.join(
    projectRoot,
    'src/client/components/sftp/sftp-delete-dialog.jsx'
  ), 'utf8')
  assert.match(source, /phase='source-scan'|phase:\s*'source-scan'/)
  assert.match(source, /okButtonProps:\s*\{\s*disabled:\s*true/)
  assert.match(source, /ready\s*\(/)
  assert.match(source, /fail\s*\(/)
  assert.match(source, /'retry'/)
  assert.match(source, /keyboardConfirm:\s*false/)
  assert.match(source, /aria-busy/)
  assert.match(source, /role='progressbar'/)
  assert.match(source, /aria-valuenow/)
  assert.match(source, /targetIndex/)
  assert.match(source, /closeOnOk:\s*false/)
  assert.match(source, /progress\s*\(/)
  assert.match(source, /complete\s*\(/)
})
