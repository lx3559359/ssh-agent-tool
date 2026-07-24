const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { importModule } = require('./helpers/import-esm')

test('phase one operations catalog is complete and read-only', async () => {
  const { getOperationsCatalog } = await importModule(
    'src/client/components/operations-toolkit/catalog/index.js'
  )
  const catalog = getOperationsCatalog()

  assert.equal(catalog.length, 24)
  assert.equal(new Set(catalog.map(tool => tool.id)).size, 24)
  assert.equal(catalog.every(tool => tool.risk === 'read-only'), true)
  assert.equal(catalog.every(tool => tool.steps.length > 0), true)
})

test('public operations completion waits for history synchronization', () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../src/client/store/operations-toolkit.js'
    ),
    'utf8'
  )

  assert.match(source, /const completion = active\.completion\.then/)
  assert.match(source, /store\.operationsHistory = .*taskStore\.list\(\)/)
  assert.match(source, /return \{ \.\.\.active, completion \}/)
})
