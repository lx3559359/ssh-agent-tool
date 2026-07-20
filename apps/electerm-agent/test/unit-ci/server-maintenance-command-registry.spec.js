const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
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

test('server maintenance registry preserves legacy IDs, order, and uniqueness', async () => {
  const registry = await import(registryUrl)
  const legacyEntry = await import(legacyEntryUrl)

  const commands = registry.getServerMaintenanceQuickCommands()
  const ids = commands.map(command => command.id)

  assert.deepEqual(ids, LEGACY_IDS)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(legacyEntry.getServerMaintenanceQuickCommands(), commands)
})
