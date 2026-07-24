const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const expected = [
  'system.overview',
  'system.cpu-pressure',
  'system.memory-oom',
  'system.boot-events',
  'storage.capacity-inode',
  'storage.io-latency',
  'storage.deleted-open-files',
  'storage.large-directory-growth'
]

test('system and storage catalog has eight readonly Chinese tools', async () => {
  const { systemStorageTools } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/system-storage.js'
  )
  assert.deepEqual(systemStorageTools.map(tool => tool.id), expected)
  assert.equal(systemStorageTools.every(tool => tool.risk === 'read-only'), true)
  assert.equal(systemStorageTools.every(tool => /[\u4e00-\u9fff]/.test(tool.title)), true)
  const io = systemStorageTools.find(tool => tool.id === 'storage.io-latency')
  assert.match(io.steps[0].command, /iostat|vmstat/)
})

test('large directory parameters are bounded and safely quoted', async () => {
  const {
    assertAbsolutePath,
    assertIntegerRange,
    shellQuote
  } = await importModule(
    'src/client/components/operations-toolkit/shared/validation.js'
  )
  assert.equal(assertIntegerRange('5', 1, 5, '深度'), 5)
  assert.throws(() => assertIntegerRange(6, 1, 5, '深度'), /深度/)
  assert.equal(assertAbsolutePath('/var/log', '路径'), '/var/log')
  assert.throws(() => assertAbsolutePath('/var;rm -rf /', '路径'), /路径/)
  assert.equal(shellQuote("a'b"), "'a'\"'\"'b'")
})
