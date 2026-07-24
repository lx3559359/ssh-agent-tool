const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

test('legacy diagnostics resolve without deleting stored quick commands', async () => {
  const {
    hiddenQuickActionIds,
    resolveLegacyOperationsTool
  } = await importModule(
    'src/client/components/operations-toolkit/catalog/migrations.js'
  )
  assert.equal(
    resolveLegacyOperationsTool('builtin-server-packet-capture'),
    'network.udp-comprehensive-check'
  )
  assert.equal(
    resolveLegacyOperationsTool('builtin-server-service-status'),
    'service.inventory-health'
  )
  assert.equal(hiddenQuickActionIds.has('builtin-server-packet-capture'), true)
  assert.equal(resolveLegacyOperationsTool('user-command'), null)
})
