const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const expectedIds = [
  'process.abnormal-state',
  'system.file-descriptor-pressure',
  'storage.mount-filesystem-health',
  'storage.block-device-health',
  'system.time-synchronization'
]

test('field diagnostics expose five stable read-only tools', async () => {
  const { advancedSystemTools } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/advanced-system.js'
  )
  assert.deepEqual(advancedSystemTools.map(tool => tool.id), expectedIds)
  assert.equal(advancedSystemTools.every(tool => tool.risk === 'read-only'), true)
  assert.equal(advancedSystemTools.every(tool => tool.steps.length > 0), true)
})

test('process detail accepts optional PID without reading secrets', async () => {
  const {
    buildProcessAbnormalStateCommand,
    normalizeProcessParameters
  } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/advanced-system.js'
  )
  assert.equal(normalizeProcessParameters({ pid: '' }).pid, 0)
  assert.equal(normalizeProcessParameters({ pid: 123 }).pid, 123)
  assert.throws(() => normalizeProcessParameters({ pid: '1;id' }), /PID/)
  const overview = buildProcessAbnormalStateCommand()
  assert.match(overview, /--sort=-%cpu/)
  assert.match(overview, /--sort=-%mem/)
  const command = buildProcessAbnormalStateCommand({ pid: 123 })
  assert.match(command, /\/proc\/123\/status/)
  assert.doesNotMatch(command, /\/environ|\/cmdline/)
})

test('field diagnostics stay bounded and non-mutating', async () => {
  const { advancedSystemTools } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/advanced-system.js'
  )
  const commands = advancedSystemTools
    .flatMap(tool => tool.steps.map(step => step.command))
    .join('\n')
  assert.match(commands, /head -n|tail -n|timeout/)
  assert.doesNotMatch(
    commands,
    /\b(?:rm|mv|mount|umount|kill|renice|fsck)\b|systemctl\s+(?:restart|stop|start)|timedatectl\s+set|smartctl\s+-t/
  )
  assert.match(commands, /smartctl -H -A/)
  assert.match(commands, /smart_status=unconfirmed/)
  assert.match(commands, /\/proc\/self\/mountstats/)
  assert.match(commands, /chronyc tracking/)
  assert.match(commands, /command -v lsof/)
  assert.match(commands, /LSOF_COUNTS\[\$1\]\+\+/)
  assert.doesNotMatch(commands, /lsof -nP 2>\/dev\/null \| head/)
  for (const suggestion of ['nfs-common/nfs-utils', 'mdadm', 'smartmontools', 'chrony']) {
    assert.match(commands, new RegExp(suggestion.replace('/', '\\/')))
  }
  for (const optionalTool of ['nfsstat', 'mdadm', 'chronyc', 'ntpq']) {
    assert.match(commands, new RegExp(`if command -v ${optionalTool}`))
  }
})
