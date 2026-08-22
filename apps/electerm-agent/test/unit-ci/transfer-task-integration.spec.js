const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '../..')

function read (file) {
  return fs.readFileSync(path.join(appRoot, file), 'utf8')
}

function sliceBody (source, startMarker, endMarker) {
  return source.slice(
    source.indexOf(startMarker),
    source.indexOf(endMarker, source.indexOf(startMarker))
  )
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

test('strict local source verification resolves prebound descriptors without reseeding live transfer state', () => {
  const source = read('src/client/components/file-transfer/transfer.jsx')
  const verifyBody = sliceBody(
    source,
    'verifyLocalSource =',
    'getTransferRuntimeTransport ='
  )

  assert.match(source, /resolveLocalTransferSourcePlan/)
  assert.match(verifyBody, /resolveLocalTransferSourcePlan\(/)
  assert.doesNotMatch(verifyBody, /transfer\.sourcePlan\s*=\s*null/)
  assert.doesNotMatch(verifyBody, /transfer\.sourceDescriptor\s*=\s*null/)
})

test('transfer cancellation paths finalize batch results before queue teardown', () => {
  const source = read('src/client/components/file-transfer/transfer.jsx')
  const cancelProtectedBody = sliceBody(
    source,
    'cancelProtectedTransport = async () => {',
    'cancelAndWait = () => {'
  )
  const cancelAndWaitBody = sliceBody(
    source,
    'cancelAndWait = () => {',
    'cancel = async'
  )

  assert.match(
    cancelProtectedBody,
    /recordTransferBatchResult\(\s*this\.props\.transfer,\s*\{\s*status:\s*'cancelled'/s
  )
  assert.match(
    cancelAndWaitBody,
    /recordTransferBatchResult\(\s*this\.props\.transfer,\s*\{\s*status:\s*'cancelled'/s
  )
  assert.ok(
    cancelProtectedBody.indexOf('recordTransferBatchResult') <
      cancelProtectedBody.indexOf('finishTransfer')
  )
  assert.ok(
    cancelAndWaitBody.indexOf('recordTransferBatchResult') <
      cancelAndWaitBody.indexOf('finishTransfer')
  )
})

test('batch result recording ignores legacy transfers before claiming the exactly-once flag', () => {
  const source = read('src/client/components/file-transfer/transfer.jsx')
  const recordBody = sliceBody(
    source,
    'recordTransferBatchResult =',
    'onEnd = async'
  )

  assert.match(source, /canRecordTransferBatchResult/)
  assert.ok(
    recordBody.indexOf('canRecordTransferBatchResult') <
      recordBody.indexOf('this.batchResultRecorded = true')
  )
})

test('unmount records exactly one cancelled batch result only when the transfer was externally removed', () => {
  const source = read('src/client/components/file-transfer/transfer.jsx')
  const unmountBody = sliceBody(
    source,
    'componentWillUnmount () {',
    'runTransferTask ='
  )

  assert.match(unmountBody, /window\.store\?\.fileTransfers\?\.some\(/)
  assert.match(
    unmountBody,
    /recordTransferBatchResult\(\s*this\.props\.transfer,\s*\{\s*status:\s*'cancelled'/s
  )
  assert.match(unmountBody, /runTransferTask\('onInterrupted',\s*'client-unmounted'\)/)
})

test('startup marks unfinished operation tasks interrupted without auto-resume', () => {
  const source = read('src/client/store/load-data.js')
  assert.match(source, /markUnfinishedOperationTasksInterrupted/)
  assert.doesNotMatch(source, /autoResumeOperationTasks/)
})
