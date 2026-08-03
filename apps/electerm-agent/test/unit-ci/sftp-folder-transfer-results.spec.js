const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/folder-transfer-results.js'
  )
).href

test('folder batch keeps completed item results when another file fails', async () => {
  const { collectFolderTransferResults } = await import(moduleUrl)
  const files = [
    { name: 'ok.log', size: 12 },
    { name: 'failed.log', size: 20 }
  ]
  const failure = new Error('socket closed')

  const summary = collectFolderTransferResults(files, [
    { status: 'fulfilled', value: 12 },
    { status: 'rejected', reason: failure }
  ])

  assert.deepEqual(summary.items, [
    { name: 'ok.log', size: 12, status: 'completed' },
    { name: 'failed.log', size: 20, status: 'failed', error: 'socket closed' }
  ])
  assert.equal(summary.completedBytes, 12)
  assert.equal(summary.failed.length, 1)
  assert.equal(summary.failed[0].error, failure)
})
