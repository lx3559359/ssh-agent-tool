const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const parser = require('@babel/parser')
const generate = require('@babel/generator').default
const t = require('@babel/types')

const root = path.resolve(__dirname, '../..')

function loadCopyTextWithFeedback () {
  const filename = path.join(root, 'src/client/common/clipboard.js')
  const ast = parser.parse(fs.readFileSync(filename, 'utf8'), {
    sourceType: 'module'
  })
  const exported = ast.program.body.find(node => (
    t.isExportNamedDeclaration(node) &&
    t.isFunctionDeclaration(node.declaration) &&
    node.declaration.id.name === 'copyTextWithFeedback'
  ))
  assert.ok(exported, 'copyTextWithFeedback must be exported')
  const assignment = parser.parse('module.exports = copyTextWithFeedback').program.body[0]
  const module = { exports: null }
  vm.runInNewContext(
    generate(t.file(t.program([exported.declaration, assignment]))).code,
    { module },
    { filename: 'clipboard.copyTextWithFeedback.js' }
  )
  return module.exports
}

test('clipboard success appears only after synchronous write succeeds', () => {
  const copyTextWithFeedback = loadCopyTextWithFeedback()
  const events = []
  const result = copyTextWithFeedback(
    'safe value',
    value => {
      events.push(`write:${value}`)
    },
    () => events.push('success')
  )

  assert.equal(result, true)
  assert.deepEqual(events, ['write:safe value', 'success'])
})

test('clipboard failures never report success', async () => {
  const copyTextWithFeedback = loadCopyTextWithFeedback()
  let successes = 0
  let failures = 0
  const notify = () => { successes += 1 }
  const notifyFailure = () => { failures += 1 }

  assert.equal(copyTextWithFeedback('sync', () => { throw new Error('denied') }, notify, notifyFailure), false)
  assert.equal(await copyTextWithFeedback('async', () => Promise.reject(new Error('denied')), notify, notifyFailure), false)
  assert.equal(successes, 0)
  assert.equal(failures, 2)
})

test('clipboard asynchronous success reports only after resolution', async () => {
  const copyTextWithFeedback = loadCopyTextWithFeedback()
  const events = []
  let resolveWrite
  const result = copyTextWithFeedback(
    'async value',
    () => new Promise(resolve => { resolveWrite = resolve }),
    () => events.push('success')
  )

  assert.deepEqual(events, [])
  resolveWrite()
  assert.equal(await result, true)
  assert.deepEqual(events, ['success'])
})
