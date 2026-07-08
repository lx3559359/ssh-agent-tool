const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const retryModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/common/transfer-retry.js')
).href

test('sftp transfer retry policy retries transient failures only within the limit', async () => {
  const {
    createTransferRetryState,
    shouldRetryTransfer
  } = await import(retryModuleUrl)

  const state = createTransferRetryState({ maxRetries: 2 })

  assert.equal(shouldRetryTransfer(new Error('socket closed during transfer'), state), true)
  assert.equal(state.attempt, 1)
  assert.equal(shouldRetryTransfer(new Error('read ECONNRESET'), state), true)
  assert.equal(state.attempt, 2)
  assert.equal(shouldRetryTransfer(new Error('read ECONNRESET'), state), false)
})

test('sftp transfer retry policy does not retry user or permission failures', async () => {
  const {
    createTransferRetryState,
    shouldRetryTransfer
  } = await import(retryModuleUrl)

  assert.equal(shouldRetryTransfer(new Error('Permission denied'), createTransferRetryState()), false)
  assert.equal(shouldRetryTransfer(new Error('No such file'), createTransferRetryState()), false)
  assert.equal(shouldRetryTransfer(new Error('cancelled by user'), createTransferRetryState()), false)
})

test('file transfer component wires retry policy before marking a transfer failed', () => {
  const fs = require('node:fs')
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/file-transfer/transfer.jsx'),
    'utf8'
  )

  assert.match(source, /from '..\/..\/common\/transfer-retry'/)
  assert.match(source, /this\.transferRetryState\s*=\s*createTransferRetryState/)
  assert.match(source, /shouldRetryTransfer\(e,\s*this\.transferRetryState\)/)
  assert.match(source, /setTimeout\(\(\)\s*=>\s*this\.startTransfer\(\)/)
})
