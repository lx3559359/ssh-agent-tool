import { normalizeTunnelPort } from './ssh-tunnel-definition.js'

const localPortFallback = 16060
const remotePortFallback = 6060
const loopbackHost = '127.0.0.1'
const timeoutLayers = new Set([
  'local-listener',
  'ssh-forwarding',
  'target-service',
  'proxy'
])

function safePort (value, fallback) {
  return normalizeTunnelPort(value) || fallback
}

function isSafeDnsName (host) {
  if (host.length > 253 || host.endsWith('.')) {
    return false
  }
  return host.split('.').every(label => {
    return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)
  })
}

function isSafeIpv4 (host) {
  const octets = host.split('.')
  return octets.length === 4 && octets.every(octet => {
    return /^\d{1,3}$/.test(octet) && Number(octet) <= 255
  })
}

function isSafeIpv6 (host) {
  const zoneIndex = host.indexOf('%')
  const address = zoneIndex === -1 ? host : host.slice(0, zoneIndex)
  const zone = zoneIndex === -1 ? '' : host.slice(zoneIndex + 1)
  return address.includes(':') &&
    /^[0-9A-Fa-f:.]+$/.test(address) &&
    (!zone || /^[A-Za-z0-9._-]{1,32}$/.test(zone))
}

function normalizeBracketedIpv6 (host) {
  if (!host.startsWith('[') || !host.endsWith(']')) {
    return undefined
  }
  const unwrapped = host.slice(1, -1)
  return isSafeIpv6(unwrapped) ? host : undefined
}

function safeHost (value, fallback = loopbackHost) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    return fallback
  }
  const bracketed = normalizeBracketedIpv6(value)
  if (bracketed) {
    return bracketed
  }
  if (isSafeIpv4(value) || isSafeDnsName(value) || isSafeIpv6(value)) {
    return value
  }
  return fallback
}

function getTunnelType (definition) {
  const value = definition && typeof definition === 'object'
    ? definition.sshTunnel || definition.type
    : undefined
  return value === 'forwardRemoteToLocal' || value === 'remote'
    ? 'remote'
    : value === 'dynamicForward' || value === 'dynamic'
      ? 'dynamic'
      : 'local'
}

function step (key, values = {}) {
  return { key, values }
}

function safeDefinition (definition) {
  const input = definition && typeof definition === 'object' ? definition : {}
  return {
    type: getTunnelType(input),
    localPort: safePort(input.sshTunnelLocalPort, localPortFallback),
    remoteHost: safeHost(input.sshTunnelRemoteHost),
    remotePort: safePort(input.sshTunnelRemotePort, remotePortFallback)
  }
}

function forwardingConfigExample (definition) {
  const header = '# Minimal scoped example; replace ssh-login-user before use:'
  if (definition.type === 'remote') {
    return [
      header,
      'Match User ssh-login-user',
      '    AllowTcpForwarding remote',
      `    PermitListen ${definition.remoteHost}:${definition.remotePort}`
    ].join('\n')
  }
  if (definition.type === 'dynamic') {
    return [
      header,
      'Match User ssh-login-user',
      '    AllowTcpForwarding local',
      '# Dynamic forwarding has no fixed destination.'
    ].join('\n')
  }
  return [
    header,
    'Match User ssh-login-user',
    '    AllowTcpForwarding local',
    `    PermitOpen ${definition.remoteHost}:${definition.remotePort}`
  ].join('\n')
}

function timeoutLayer (error) {
  const stage = error && typeof error === 'object' && typeof error.stage === 'string'
    ? error.stage
    : ''
  return timeoutLayers.has(stage) ? stage : 'unknown'
}

function diagnostic (code, layer, severity, titleKey, summaryKey, helpSection, steps, checksText, configExample = '') {
  return {
    code,
    layer,
    severity,
    titleKey,
    summaryKey,
    helpSection,
    steps,
    checksText,
    configExample
  }
}

export function getTunnelDiagnostic (error = {}, definition = {}) {
  const code = error && typeof error === 'object' && typeof error.code === 'string'
    ? error.code
    : ''
  const tunnel = safeDefinition(definition)

  if (code === 'SSH_TUNNEL_FORWARDING_PROHIBITED') {
    return diagnostic(
      code,
      'ssh-forwarding',
      'warning',
      'sshTunnel.diagnostic.forwardingProhibited.title',
      'sshTunnel.diagnostic.forwardingProhibited.summary',
      'forwarding-prohibited',
      [
        step('sshTunnel.diagnostic.forwardingProhibited.checkPolicy'),
        step('sshTunnel.diagnostic.forwardingProhibited.reviewExample', {
          forwarding: tunnel.type
        })
      ],
      "Read-only SSH server policy check: sudo sshd -T | grep -Ei 'allowtcpforwarding|permitopen|disableforwarding'. The separate configuration example is only a minimal template and needs administrator review.",
      forwardingConfigExample(tunnel)
    )
  }

  if (code === 'SSH_TUNNEL_DESTINATION_REFUSED') {
    return diagnostic(
      code,
      'target-service',
      'error',
      'sshTunnel.diagnostic.destinationRefused.title',
      'sshTunnel.diagnostic.destinationRefused.summary',
      'destination-refused',
      [
        step('sshTunnel.diagnostic.destinationRefused.checkListener', {
          remotePort: tunnel.remotePort
        }),
        step('sshTunnel.diagnostic.destinationRefused.confirmTarget')
      ],
      `From the SSH server, read the target listener: ss -lntp | grep ':${tunnel.remotePort}'`
    )
  }

  if (code === 'EADDRINUSE' || code === 'SSH_TUNNEL_PORT_IN_USE') {
    return diagnostic(
      code,
      'local-listener',
      'error',
      'sshTunnel.diagnostic.portInUse.title',
      'sshTunnel.diagnostic.portInUse.summary',
      'local-port-in-use',
      [
        step('sshTunnel.diagnostic.portInUse.checkListener', {
          localPort: tunnel.localPort
        }),
        step('sshTunnel.diagnostic.portInUse.chooseDifferentPort')
      ],
      `Windows read-only listener check: Get-NetTCPConnection -LocalPort ${tunnel.localPort} -ErrorAction SilentlyContinue`
    )
  }

  if (code === 'SSH_TUNNEL_TEST_TIMEOUT') {
    const layer = timeoutLayer(error)
    return diagnostic(
      code,
      layer,
      'warning',
      'sshTunnel.diagnostic.timeout.title',
      'sshTunnel.diagnostic.timeout.summary',
      'test-timeout',
      [
        step('sshTunnel.diagnostic.timeout.checkStage', { layer }),
        step('sshTunnel.diagnostic.timeout.retrySafely')
      ],
      'No action was run. Confirm the selected endpoint and retry the tunnel test when the network is stable.'
    )
  }

  return diagnostic(
    'SSH_TUNNEL_UNKNOWN',
    'unknown',
    'error',
    'sshTunnel.diagnostic.unknown.title',
    'sshTunnel.diagnostic.unknown.summary',
    'unknown',
    [
      step('sshTunnel.diagnostic.unknown.reviewDefinition'),
      step('sshTunnel.diagnostic.unknown.retrySafely')
    ],
    'No action was run. Review the tunnel definition and retry after confirming the endpoint.'
  )
}
