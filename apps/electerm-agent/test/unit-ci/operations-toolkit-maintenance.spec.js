const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

test('safe maintenance catalog only accepts fully protected mutations', async () => {
  const {
    getSafeMaintenanceCommands,
    isSafeMaintenanceCommand
  } = await importModule(
    'src/client/components/operations-toolkit/catalog/maintenance.js'
  )
  const complete = {
    id: 'complete',
    mutatesServer: true,
    editBeforeRun: true,
    confirmRequired: true,
    rollback: { title: '恢复' },
    safetyMetadata: { verifyCommands: ['test -f /tmp/result'] }
  }
  const incomplete = [
    { ...complete, id: 'readonly', mutatesServer: false },
    { ...complete, id: 'no-form', editBeforeRun: false },
    { ...complete, id: 'no-confirmation', confirmRequired: false },
    { ...complete, id: 'no-rollback', rollback: null },
    { ...complete, id: 'no-safety-metadata', safetyMetadata: null },
    {
      ...complete,
      id: 'no-verification',
      safetyMetadata: { verifyCommands: [] }
    }
  ]

  assert.equal(isSafeMaintenanceCommand(complete), true)
  assert.equal(incomplete.every(item => !isSafeMaintenanceCommand(item)), true)
  assert.deepEqual(
    getSafeMaintenanceCommands([...incomplete, complete]),
    [complete]
  )
})

test('all built-in mutating maintenance commands satisfy the safety contract', async () => {
  const { getSafeMaintenanceCommands } = await importModule(
    'src/client/components/operations-toolkit/catalog/maintenance.js'
  )
  const { getServerMaintenanceQuickCommands } = await importModule(
    'src/client/components/quick-commands/server-maintenance/index.js'
  )
  const commands = getServerMaintenanceQuickCommands()
  const mutating = commands.filter(item => item.mutatesServer)
  const safe = getSafeMaintenanceCommands(commands)

  assert.equal(mutating.length, 11)
  assert.deepEqual(
    safe.map(item => item.id),
    mutating.map(item => item.id)
  )
})
