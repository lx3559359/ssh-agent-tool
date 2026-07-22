const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const registryUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/server-maintenance/index.js')
).href
const legacyEntryUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/server-maintenance-commands.js')
).href

const LEGACY_IDS = [
  'builtin-server-overview',
  'builtin-server-disk',
  'builtin-server-memory',
  'builtin-server-process-top',
  'builtin-server-network-listen',
  'builtin-server-port-process',
  'builtin-server-ip-query',
  'builtin-server-network-change-ip',
  'builtin-server-dns-check',
  'builtin-server-time-query',
  'builtin-server-firewall-status',
  'builtin-server-firewall-open-port',
  'builtin-server-service-logs',
  'builtin-server-service-status',
  'builtin-server-log-search',
  'builtin-server-nginx',
  'builtin-server-docker',
  'builtin-server-connectivity-check',
  'builtin-server-http-check',
  'builtin-server-tls-check',
  'builtin-server-directory-analysis',
  'builtin-server-process-detail',
  'builtin-server-service-action',
  'builtin-server-docker-action',
  'builtin-server-file-permission',
  'builtin-server-packet-capture'
]

const legacyFixture = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../fixtures/server-maintenance-legacy-commands.json'),
  'utf8'
))

function legacyPrefixSummary (commands) {
  return commands.map(({ id, name, inputOnly }) => ({ id, name, inputOnly }))
}

test('server maintenance registry preserves the complete legacy command prefix', async () => {
  const registry = await import(registryUrl)
  const legacyEntry = await import(legacyEntryUrl)

  const commands = registry.getServerMaintenanceQuickCommands()
  const ids = commands.map(command => command.id)
  const legacyCommands = commands.slice(0, LEGACY_IDS.length)

  assert.deepEqual(ids.slice(0, LEGACY_IDS.length), LEGACY_IDS)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepStrictEqual(
    legacyPrefixSummary(legacyCommands),
    legacyPrefixSummary(legacyFixture)
  )
  assert.deepStrictEqual(
    legacyPrefixSummary(
      legacyEntry.getServerMaintenanceQuickCommands().slice(0, LEGACY_IDS.length)
    ),
    legacyPrefixSummary(legacyCommands)
  )
})

test('server maintenance registry returns an isolated object tree on every call', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const first = getServerMaintenanceQuickCommands()
  const second = getServerMaintenanceQuickCommands()

  for (const id of LEGACY_IDS) {
    const firstCommand = first.find(command => command.id === id)
    const secondCommand = second.find(command => command.id === id)

    assert.notStrictEqual(firstCommand, secondCommand, `${id} object is shared`)
    assert.notStrictEqual(firstCommand.labels, secondCommand.labels, `${id} labels are shared`)
    assert.notStrictEqual(firstCommand.commands, secondCommand.commands, `${id} commands are shared`)
    assert.notStrictEqual(firstCommand.params, secondCommand.params, `${id} params are shared`)

    for (let index = 0; index < firstCommand.commands.length; index++) {
      assert.notStrictEqual(
        firstCommand.commands[index],
        secondCommand.commands[index],
        `${id} command step is shared`
      )
    }

    for (let index = 0; index < firstCommand.params.length; index++) {
      const firstParam = firstCommand.params[index]
      const secondParam = secondCommand.params[index]
      const firstOptions = firstParam.options
      const secondOptions = secondParam.options
      assert.notStrictEqual(firstParam, secondParam, `${id} param is shared`)
      if (Array.isArray(firstOptions)) {
        assert.notStrictEqual(firstOptions, secondOptions, `${id} param options are shared`)
        for (let optionIndex = 0; optionIndex < firstOptions.length; optionIndex++) {
          assert.notStrictEqual(firstOptions[optionIndex], secondOptions[optionIndex], `${id} option is shared`)
        }
      }
    }
  }

  const firstOverview = first.find(command => command.id === 'builtin-server-overview')
  const secondOverview = second.find(command => command.id === 'builtin-server-overview')
  const firstDns = first.find(command => command.id === 'builtin-server-dns-check')
  const secondDns = second.find(command => command.id === 'builtin-server-dns-check')
  const firstRecordType = firstDns.params.find(param => Array.isArray(param.options))
  const secondRecordType = secondDns.params.find(param => Array.isArray(param.options))

  firstOverview.labels.push('mutated')
  firstOverview.commands[0].command = 'mutated'
  firstDns.params.push({ name: 'mutated' })
  firstRecordType.options[0].label = 'mutated'

  assert.equal(secondOverview.labels.includes('mutated'), false)
  assert.equal(secondOverview.commands[0].command, 'uptime')
  assert.equal(secondDns.params.some(param => param.name === 'mutated'), false)
  assert.equal(secondRecordType.options[0].label, 'A')
})

test('server maintenance registry fails fast on duplicate IDs', async () => {
  const { buildServerMaintenanceQuickCommands } = await import(registryUrl)

  assert.throws(
    () => buildServerMaintenanceQuickCommands([
      () => legacyFixture,
      () => [legacyFixture[0]]
    ]),
    /Duplicate server maintenance quick command ID: builtin-server-overview/
  )
})

test('server maintenance registry fails fast when a legacy ID is missing', async () => {
  const { buildServerMaintenanceQuickCommands } = await import(registryUrl)

  assert.throws(
    () => buildServerMaintenanceQuickCommands([
      () => legacyFixture.slice(1)
    ]),
    /Missing legacy server maintenance quick command ID: builtin-server-overview/
  )
})
