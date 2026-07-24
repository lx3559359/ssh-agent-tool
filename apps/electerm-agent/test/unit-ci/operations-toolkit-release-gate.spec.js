const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { importModule } = require('./helpers/import-esm')

test('operations catalog keeps diagnostics and runbooks complete and read-only', async () => {
  const { getOperationsCatalog } = await importModule(
    'src/client/components/operations-toolkit/catalog/index.js'
  )
  const catalog = getOperationsCatalog()
  const diagnostics = catalog.filter(tool => tool.type === 'diagnostic')
  const runbooks = catalog.filter(tool => tool.type === 'script')

  assert.equal(diagnostics.length, 24)
  assert.equal(runbooks.length, 10)
  assert.equal(catalog.length, 34)
  assert.equal(new Set(catalog.map(tool => tool.id)).size, catalog.length)
  assert.equal(catalog.every(tool => tool.risk === 'read-only'), true)
  assert.equal(catalog.every(tool => tool.steps.length > 0), true)
  assert.equal(runbooks.every(tool => tool.steps.length >= 3), true)
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
