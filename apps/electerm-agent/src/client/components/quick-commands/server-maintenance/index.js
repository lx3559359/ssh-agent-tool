import { getSystemCommands } from './system.js'
import { getStorageCommands } from './storage.js'
import { getNetworkCommands } from './network.js'
import { getSecurityCommands } from './security.js'
import { getServicesCommands } from './services.js'
import { getContainersCommands } from './containers.js'

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

const DOMAIN_COMMAND_FACTORIES = [
  getSystemCommands,
  getStorageCommands,
  getNetworkCommands,
  getSecurityCommands,
  getServicesCommands,
  getContainersCommands
]

export function buildServerMaintenanceQuickCommands (commandFactories = DOMAIN_COMMAND_FACTORIES) {
  const commands = commandFactories.flatMap(getCommands => getCommands())
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

export function getServerMaintenanceQuickCommands () {
  return buildServerMaintenanceQuickCommands()
}
