const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '../..')

function read (file) {
  return fs.readFileSync(path.join(appRoot, file), 'utf8')
}

test('SFTP transfer lifecycle records progress and confirmed pause checkpoints', () => {
  const source = read('src/client/components/file-transfer/transfer.jsx')
  assert.match(source, /createTransferTaskAdapter/)
  assert.match(source, /onPaused:\s*this\.onPauseAcknowledged/)
  assert.match(source, /describeResumeEntry\(transfer\.fromPath\)/)
  assert.match(source, /sftp\.describeResumeEntry\(checkpoint\.partialPath\)/)
  assert.match(source, /buildTransferResumeCheckpoint/)
  assert.match(source, /buildTransferResumeOptions\(transfer\.checkpoint\)/)
  assert.match(source, /runTransferTask\('onProgress'/)
  assert.match(source, /runTransferTask\('onCompleted'/)
  assert.match(source, /runTransferTask\('onFailed'/)
})

test('explicit cancellation removes partial data while unmount preserves restart checkpoint', () => {
  const source = read('src/client/components/file-transfer/transfer.jsx')
  assert.match(source, /transport\?\.cancel\(\)/)
  assert.match(source, /transport\?\.interrupt\(\)/)
})

test('startup marks unfinished operation tasks interrupted without auto-resume', () => {
  const source = read('src/client/store/load-data.js')
  assert.match(source, /markUnfinishedOperationTasksInterrupted/)
  assert.doesNotMatch(source, /autoResumeOperationTasks/)
})
