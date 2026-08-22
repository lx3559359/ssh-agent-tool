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

test('folder results retain planned skipped entries without treating them as failures', async () => {
  const { createSkippedFolderResults } = await import(moduleUrl)

  assert.deepEqual(createSkippedFolderResults([
    { relativePath: 'locked.dat', code: 'EBUSY', reason: 'locked' },
    { relativePath: 'nested/child.log', code: 'EACCES', reason: 'unreadable' }
  ]), [
    {
      name: 'locked.dat',
      relativePath: 'locked.dat',
      size: 0,
      status: 'skipped',
      error: 'EBUSY'
    },
    {
      name: 'child.log',
      relativePath: 'nested/child.log',
      size: 0,
      status: 'skipped',
      error: 'EACCES'
    }
  ])
})
