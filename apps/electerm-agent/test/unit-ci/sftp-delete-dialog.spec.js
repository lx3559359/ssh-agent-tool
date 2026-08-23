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

test('safe delete dialog starts disabled and exposes ready, fail, and retry states', () => {
  const source = fs.readFileSync(path.join(
    projectRoot,
    'src/client/components/sftp/sftp-delete-dialog.jsx'
  ), 'utf8')
  assert.match(source, /shellpilotSftpSafeDeletePreparing/)
  assert.match(source, /okButtonProps:\s*\{\s*disabled:\s*true/)
  assert.match(source, /ready\s*\(/)
  assert.match(source, /fail\s*\(/)
  assert.match(source, /'retry'/)
  assert.match(source, /keyboardConfirm:\s*false/)
  assert.match(source, /aria-busy/)
})
