const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const clientRoot = path.resolve(__dirname, '../../src/client')
const queueUrl = pathToFileURL(path.join(
  clientRoot,
  'components/file-transfer/transfer-operation-queue.js'
)).href

test('busy transfer queue resolves each enqueue only after its operation completes', async () => {
  const { createTransferOperationQueue } = await import(queueUrl)
  const releases = []
  const calls = []
  const queue = createTransferOperationQueue({
    execute: value => new Promise(resolve => {
      calls.push(value)
      releases.push(resolve)
    })
  })

  let firstDone = false
  let secondDone = false
  const first = queue.add('first').then(() => { firstDone = true })
  const second = queue.add('second').then(() => { secondDone = true })
  await Promise.resolve()

  assert.deepEqual(calls, ['first'])
  assert.equal(firstDone, false)
  assert.equal(secondDone, false)

  releases.shift()()
  await first
  await Promise.resolve()
  assert.deepEqual(calls, ['first', 'second'])
  assert.equal(secondDone, false)

  releases.shift()()
  await second
  assert.equal(secondDone, true)
})

test('transfer queue rejects the caller when cancellation processing fails', async () => {
  const { createTransferOperationQueue } = await import(queueUrl)
  const queue = createTransferOperationQueue({
    execute: async () => { throw new Error('transport stop failed') }
  })

  await assert.rejects(queue.add('delete', 'transfer-a'), /transport stop failed/)
})

test('Agent SFTP cancellation awaits the mounted transfer adapter and queue fallback', () => {
  const handler = fs.readFileSync(path.join(clientRoot, 'store/mcp-handler.js'), 'utf8')
  const transfer = fs.readFileSync(path.join(
    clientRoot,
    'components/file-transfer/transfer.jsx'
  ), 'utf8')
  assert.match(handler, /await activeTransfer\.cancelAndWait\(\)/)
  assert.match(handler, /await queue\.addToQueue\('delete', id\)/)
  assert.match(transfer, /this\.queueRemovalPromise\s*=\s*this\.removeTransferFromQueue\(\)/)
  assert.match(transfer, /await this\.queueRemovalPromise/)
})
