const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

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
