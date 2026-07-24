const legacyToolMap = Object.freeze({
  'builtin-server-overview': 'system.overview',
  'builtin-server-cpu-pressure': 'system.cpu-pressure',
  'builtin-server-memory': 'system.memory-oom',
  'builtin-server-kernel-errors': 'system.boot-events',
  'builtin-server-boot-history': 'system.boot-events',
  'builtin-server-disk': 'storage.capacity-inode',
  'builtin-server-inode-mount': 'storage.capacity-inode',
  'builtin-server-disk-io': 'storage.io-latency',
  'builtin-server-deleted-open-files': 'storage.deleted-open-files',
  'builtin-server-directory-analysis': 'storage.large-directory-growth',
  'builtin-server-network-errors': 'network.interface-health',
  'builtin-server-tcp-states': 'network.tcp-connections',
  'builtin-server-dns-check': 'network.dns-chain',
  'builtin-server-route-mtu': 'network.route-mtu',
  'builtin-server-connectivity-check': 'network.loss-latency',
  'builtin-server-firewall-status': 'security.firewall-exposure',
  'builtin-server-ssh-security-events': 'security.ssh-login',
  'builtin-server-packet-capture': 'network.udp-comprehensive-check',
  'builtin-server-service-status': 'service.inventory-health',
  'builtin-server-service-logs': 'service.failed-related-logs',
  'builtin-server-log-search': 'logs.system-anomaly-summary',
  'builtin-server-nginx': 'web.nginx-apache-diagnostic',
  'builtin-server-http-check': 'web.http-tls-check',
  'builtin-server-tls-check': 'web.http-tls-check',
  'builtin-server-docker': 'container.runtime-health',
  'builtin-server-docker-health-storage': 'container.storage-resources',
  'builtin-server-scheduled-tasks': 'service.scheduled-tasks'
})

export const hiddenQuickActionIds = Object.freeze(
  new Set(Object.keys(legacyToolMap))
)

export function resolveLegacyOperationsTool (legacyId) {
  return legacyToolMap[legacyId] || null
}
