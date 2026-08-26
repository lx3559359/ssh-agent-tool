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

function hasOwn (value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function portStatus (input, key, fallback) {
  if (!hasOwn(input, key)) {
    return { value: fallback, valid: true }
  }
  const port = normalizeTunnelPort(input[key])
  return port ? { value: port, valid: true } : { value: undefined, valid: false }
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

function canonicalIpv6Host (host) {
  const hasOpeningBracket = host.startsWith('[')
  const hasClosingBracket = host.endsWith(']')
  if (hasOpeningBracket !== hasClosingBracket) {
    return undefined
  }
  const address = hasOpeningBracket ? host.slice(1, -1) : host
  if (!address.includes(':') || address.includes('%') ||
    !/^[0-9A-Fa-f:.]+$/.test(address)) {
    return undefined
  }
  try {
    return new URL(`http://[${address}]/`).hostname
  } catch {
    return undefined
  }
}

function normalizedSafeHost (value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    return undefined
  }
  const ipv6 = canonicalIpv6Host(value)
  if (ipv6) {
    return ipv6
  }
  if (value.includes('[') || value.includes(']') || /[:%]/.test(value)) {
    return undefined
  }
  if (isSafeIpv4(value)) {
    return value
  }
  if (/^[0-9.]+$/.test(value)) {
    return undefined
  }
  if (isSafeDnsName(value)) {
    return value
  }
  return undefined
}

function hostStatus (input, key, fallback = loopbackHost) {
  if (!hasOwn(input, key)) {
    return { value: fallback, valid: true }
  }
  const host = normalizedSafeHost(input[key])
  return host ? { value: host, valid: true } : { value: undefined, valid: false }
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
    localHost: hostStatus(input, 'sshTunnelLocalHost'),
    localPort: portStatus(input, 'sshTunnelLocalPort', localPortFallback),
    remoteHost: hostStatus(input, 'sshTunnelRemoteHost'),
    remotePort: portStatus(input, 'sshTunnelRemotePort', remotePortFallback)
  }
}

function invalidFieldNames (definition) {
  return [
    ['local-host', definition.localHost],
    ['local-port', definition.localPort],
    ['remote-host', definition.remoteHost],
    ['remote-port', definition.remotePort]
  ].filter(([, status]) => !status.valid).map(([name]) => name)
}

function hasInvalidTarget (definition) {
  return invalidFieldNames(definition).length > 0
}

function isLoopbackHost (host) {
  if (host === 'localhost' || host === '[::1]') {
    return true
  }
  return /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host)
}

function forwardingConfigExample (definition) {
  const header = '# Minimal scoped example; replace ssh-login-user before use:'
  if (definition.type === 'dynamic' || hasInvalidTarget(definition)) {
    return ''
  }
  if (definition.type === 'remote') {
    return [
      header,
      'Match User ssh-login-user',
      '    AllowTcpForwarding remote',
      `    PermitListen ${definition.remoteHost.value}:${definition.remotePort.value}`
    ].join('\n')
  }
  return [
    header,
    'Match User ssh-login-user',
    '    AllowTcpForwarding local',
    `    PermitOpen ${definition.remoteHost.value}:${definition.remotePort.value}`
  ].join('\n')
}

function policyCheckCommand (type) {
  return type === 'remote'
    ? "sudo sshd -T | grep -Ei 'allowtcpforwarding|permitlisten|disableforwarding'"
    : "sudo sshd -T | grep -Ei 'allowtcpforwarding|permitopen|disableforwarding'"
}

function policyContextTemplate (type) {
  const policyNames = type === 'remote'
    ? 'allowtcpforwarding|permitlisten|disableforwarding'
    : 'allowtcpforwarding|permitopen|disableforwarding'
  return `sudo sshd -T -C user=SSH_LOGIN_USER,addr=CLIENT_IP,host=SSH_SERVER_HOST | grep -Ei '${policyNames}'`
}

function policySteps (definition) {
  const steps = [
    step('sshTunnel.diagnostic.forwardingProhibited.globalBaseline', {
      scope: 'global-baseline'
    }),
    step('sshTunnel.diagnostic.forwardingProhibited.matchContext', {
      requiredContext: ['user', 'addr', 'host'],
      commandTemplate: policyContextTemplate(definition.type),
      replaceWithRealSshContext: true
    }),
    step('sshTunnel.diagnostic.forwardingProhibited.authorizedKeysRestrictions', {
      restrictions: [
        'restrict',
        'no-port-forwarding',
        'permitopen',
        'permitlisten'
      ],
      requiresAdministratorReview: true
    }),
    step('sshTunnel.diagnostic.forwardingProhibited.certificateRestrictions', {
      restrictions: [
        'no-port-forwarding',
        'permit-port-forwarding'
      ],
      requiresAdministratorReview: true
    })
  ]
  if (definition.type === 'dynamic') {
    steps.push(step('sshTunnel.diagnostic.forwardingProhibited.dynamicNeedsApprovedTargetScope', {
      administratorDecisionRequired: true,
      requiresExplicitPermitOpenAllowlist: true
    }))
  }
  if (hasInvalidTarget(definition)) {
    steps.push(step('sshTunnel.diagnostic.forwardingProhibited.invalidTarget', {
      fields: invalidFieldNames(definition)
    }))
  }
  return steps
}

function invalidDestinationStep (definition) {
  return step('sshTunnel.diagnostic.destinationRefused.invalidTarget', {
    fields: invalidFieldNames(definition)
  })
}

function destinationRefusedDiagnostic (code, tunnel) {
  const common = [
    code,
    'target-service',
    'error',
    'sshTunnel.diagnostic.destinationRefused.title',
    'sshTunnel.diagnostic.destinationRefused.summary',
    'destination-refused'
  ]
  if (tunnel.type === 'dynamic') {
    return diagnostic(
      ...common,
      [step('sshTunnel.diagnostic.destinationRefused.reviewActualDynamicTarget')],
      ''
    )
  }
  if (hasInvalidTarget(tunnel)) {
    return diagnostic(...common, [invalidDestinationStep(tunnel)], '')
  }
  if (tunnel.type === 'remote') {
    const isClientLocalTarget = isLoopbackHost(tunnel.localHost.value)
    const stepKey = isClientLocalTarget
      ? 'sshTunnel.diagnostic.destinationRefused.checkTargetFromLocalMachine'
      : 'sshTunnel.diagnostic.destinationRefused.checkTargetFromClientMachine'
    return diagnostic(
      ...common,
      [step(stepKey, {
        localHost: tunnel.localHost.value,
        localPort: tunnel.localPort.value
      })],
      isClientLocalTarget
        ? `Get-NetTCPConnection -LocalPort ${tunnel.localPort.value} -ErrorAction SilentlyContinue`
        : ''
    )
  }
  return diagnostic(
    ...common,
    [step('sshTunnel.diagnostic.destinationRefused.checkTargetFromSshServer', {
      remoteHost: tunnel.remoteHost.value,
      remotePort: tunnel.remotePort.value,
      isSshServerLocalTarget: isLoopbackHost(tunnel.remoteHost.value)
    })],
    isLoopbackHost(tunnel.remoteHost.value)
      ? `ss -lntp | grep ':${tunnel.remotePort.value}'`
      : ''
  )
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
      policySteps(tunnel),
      policyCheckCommand(tunnel.type),
      forwardingConfigExample(tunnel)
    )
  }

  if (code === 'SSH_TUNNEL_DESTINATION_REFUSED') {
    return destinationRefusedDiagnostic(code, tunnel)
  }

  if (code === 'EADDRINUSE' || code === 'SSH_TUNNEL_PORT_IN_USE') {
    return diagnostic(
      code,
      'local-listener',
      'error',
      'sshTunnel.diagnostic.portInUse.title',
      'sshTunnel.diagnostic.portInUse.summary',
      'local-port-in-use',
      tunnel.localPort.valid
        ? [
            step('sshTunnel.diagnostic.portInUse.checkListener', {
              localPort: tunnel.localPort.value
            }),
            step('sshTunnel.diagnostic.portInUse.chooseDifferentPort')
          ]
        : [step('sshTunnel.diagnostic.portInUse.invalidTarget', {
            fields: invalidFieldNames(tunnel)
          })],
      tunnel.localPort.valid
        ? `Get-NetTCPConnection -LocalPort ${tunnel.localPort.value} -ErrorAction SilentlyContinue`
        : ''
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
      ''
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
    ''
  )
}
