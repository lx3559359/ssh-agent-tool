import { systemCommands } from './system.js'
import { storageCommands } from './storage.js'
import { networkCommands } from './network.js'
import { securityCommands } from './security.js'
import { servicesCommands } from './services.js'
import { containersCommands } from './containers.js'

const LEGACY_ORDER = [
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

const DOMAIN_COMMANDS = [
  systemCommands,
  storageCommands,
  networkCommands,
  securityCommands,
  servicesCommands,
  containersCommands
]

export function getServerMaintenanceQuickCommands () {
  const commands = DOMAIN_COMMANDS.flat()
  const commandById = new Map()

  for (const command of commands) {
    if (commandById.has(command.id)) {
      throw new Error('Duplicate server maintenance quick command ID: ' + command.id)
    }
    commandById.set(command.id, command)
  }

  const legacyCommands = LEGACY_ORDER.map(id => {
    const command = commandById.get(id)
    if (!command) {
      throw new Error('Missing legacy server maintenance quick command ID: ' + id)
    }
    return command
  })
  const legacyIds = new Set(LEGACY_ORDER)
  const newCommands = commands.filter(command => !legacyIds.has(command.id))

  return [...legacyCommands, ...newCommands]
}
