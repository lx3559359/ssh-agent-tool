const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { importModule } = require('./helpers/import-esm')

async function loadDiagnostics () {
  return importModule(
    'src/client/components/ssh-tunnel/ssh-tunnel-diagnostics.js'
  )
}

function localDefinition (overrides = {}) {
  return {
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 16060,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 6060,
    ...overrides
  }
}

function hasStep (diagnostic, key) {
  return diagnostic.steps.some(step => step.key === key)
}

function findStep (diagnostic, key) {
  return diagnostic.steps.find(step => step.key === key)
}

test('forwarding prohibited uses a read-only check and separate scoped local policy example', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const diagnostic = getTunnelDiagnostic(
    { code: 'SSH_TUNNEL_FORWARDING_PROHIBITED' },
    localDefinition()
  )

  assert.deepEqual(
    Object.keys(diagnostic).sort(),
    ['checksText', 'code', 'configExample', 'helpSection', 'layer', 'severity', 'steps', 'summaryKey', 'titleKey']
  )
  assert.equal(diagnostic.code, 'SSH_TUNNEL_FORWARDING_PROHIBITED')
  assert.equal(diagnostic.layer, 'ssh-forwarding')
  assert.equal(diagnostic.severity, 'warning')
  assert.equal(diagnostic.helpSection, 'forwarding-prohibited')
  assert.equal(
    diagnostic.checksText.trim(),
    "sudo sshd -T | grep -Ei 'allowtcpforwarding|permitopen|disableforwarding'"
  )
  assert.equal(diagnostic.configExample, [
    '# Minimal scoped example; replace ssh-login-user before use:',
    'Match User ssh-login-user',
    '    AllowTcpForwarding local',
    '    PermitOpen 127.0.0.1:6060'
  ].join('\n'))
  assert.notEqual(diagnostic.checksText, diagnostic.configExample)
  assert.equal(diagnostic.steps.every(step => typeof step.key === 'string' && step.values && typeof step.values === 'object'), true)
  const baseline = findStep(
    diagnostic,
    'sshTunnel.diagnostic.forwardingProhibited.checkPolicy'
  )
  const restrictions = findStep(
    diagnostic,
    'sshTunnel.diagnostic.forwardingProhibited.reviewKeyRestrictions'
  )
  assert.equal(baseline.values.scope, 'global-baseline')
  assert.equal(baseline.values.requiresSshdDashCContext, true)
  assert.deepEqual(restrictions.values.authorizedKeys, [
    'restrict',
    'no-port-forwarding',
    'permitopen',
    'permitlisten'
  ])
  assert.deepEqual(restrictions.values.certificateOptions, [
    'no-port-forwarding',
    'permitopen',
    'permitlisten'
  ])
})

test('forwarding prohibited scopes remote policy checks and keeps dynamic forwarding unconfigured', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const remote = getTunnelDiagnostic(
    { code: 'SSH_TUNNEL_FORWARDING_PROHIBITED' },
    localDefinition({
      sshTunnel: 'forwardRemoteToLocal',
      sshTunnelRemoteHost: '[fe80::1]',
      sshTunnelRemotePort: 26060
    })
  )
  const dynamic = getTunnelDiagnostic(
    { code: 'SSH_TUNNEL_FORWARDING_PROHIBITED' },
    localDefinition({ sshTunnel: 'dynamicForward' })
  )

  assert.match(remote.configExample, /AllowTcpForwarding remote/)
  assert.match(remote.configExample, /PermitListen \[fe80::1\]:26060/)
  assert.equal(
    remote.checksText,
    "sudo sshd -T | grep -Ei 'allowtcpforwarding|permitlisten|disableforwarding'"
  )
  assert.equal(dynamic.configExample, '')
  assert.equal(dynamic.checksText, "sudo sshd -T | grep -Ei 'allowtcpforwarding|permitopen|disableforwarding'")
  assert.equal(
    hasStep(dynamic, 'sshTunnel.diagnostic.forwardingProhibited.dynamicNeedsApprovedTargetScope'),
    true
  )
  assert.equal(
    hasStep(remote, 'sshTunnel.diagnostic.forwardingProhibited.reviewKeyRestrictions'),
    true
  )
})

test('destination refused checks only a local SSH-server target from the SSH server perspective', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const diagnostic = getTunnelDiagnostic(
    { code: 'SSH_TUNNEL_DESTINATION_REFUSED' },
    localDefinition()
  )

  assert.equal(diagnostic.layer, 'target-service')
  assert.equal(diagnostic.severity, 'error')
  assert.equal(diagnostic.checksText, "ss -lntp | grep ':6060'")
  assert.equal(diagnostic.configExample, '')
  assert.equal(
    hasStep(diagnostic, 'sshTunnel.diagnostic.destinationRefused.checkTargetFromSshServer'),
    true
  )
})

test('destination refused does not suggest an SSH-server listener command for an external target', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const diagnostic = getTunnelDiagnostic(
    { code: 'SSH_TUNNEL_DESTINATION_REFUSED' },
    localDefinition({ sshTunnelRemoteHost: 'db.example.com' })
  )

  assert.equal(diagnostic.checksText, '')
  assert.equal(
    hasStep(diagnostic, 'sshTunnel.diagnostic.destinationRefused.checkTargetFromSshServer'),
    true
  )
})

test('destination refused checks a remote forward loopback target from the local Windows machine', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const diagnostic = getTunnelDiagnostic(
    { code: 'SSH_TUNNEL_DESTINATION_REFUSED' },
    localDefinition({
      sshTunnel: 'forwardRemoteToLocal',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 16060
    })
  )

  assert.equal(
    diagnostic.checksText,
    'Get-NetTCPConnection -LocalPort 16060 -ErrorAction SilentlyContinue'
  )
  assert.equal(
    hasStep(diagnostic, 'sshTunnel.diagnostic.destinationRefused.checkTargetFromLocalMachine'),
    true
  )
})

test('destination refused does not claim an external remote-forward target is local', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const diagnostic = getTunnelDiagnostic(
    { code: 'SSH_TUNNEL_DESTINATION_REFUSED' },
    localDefinition({
      sshTunnel: 'forwardRemoteToLocal',
      sshTunnelLocalHost: 'db.example.com',
      sshTunnelLocalPort: 16060
    })
  )

  assert.equal(diagnostic.checksText, '')
  assert.equal(
    hasStep(diagnostic, 'sshTunnel.diagnostic.destinationRefused.checkTargetFromClientMachine'),
    true
  )
  assert.equal(
    hasStep(diagnostic, 'sshTunnel.diagnostic.destinationRefused.checkTargetFromLocalMachine'),
    false
  )
})

test('destination refused does not disclose invalid remote-forward local targets', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const invalidHost = 'db.example.com; read secret'
  const diagnostic = getTunnelDiagnostic(
    { code: 'SSH_TUNNEL_DESTINATION_REFUSED' },
    localDefinition({
      sshTunnel: 'forwardRemoteToLocal',
      sshTunnelLocalHost: invalidHost
    })
  )

  assert.equal(diagnostic.checksText, '')
  assert.equal(JSON.stringify(diagnostic).includes(invalidHost), false)
  assert.equal(
    hasStep(diagnostic, 'sshTunnel.diagnostic.destinationRefused.invalidTarget'),
    true
  )
})

test('destination refused leaves a dynamic target command empty', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const diagnostic = getTunnelDiagnostic(
    { code: 'SSH_TUNNEL_DESTINATION_REFUSED' },
    localDefinition({ sshTunnel: 'dynamicForward' })
  )

  assert.equal(diagnostic.checksText, '')
  assert.equal(
    hasStep(diagnostic, 'sshTunnel.diagnostic.destinationRefused.reviewActualDynamicTarget'),
    true
  )
})

test('port-in-use reads only the valid Windows local listener port', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const diagnostic = getTunnelDiagnostic(
    { code: 'EADDRINUSE' },
    localDefinition()
  )
  const alias = getTunnelDiagnostic(
    { code: 'SSH_TUNNEL_PORT_IN_USE' },
    localDefinition()
  )

  assert.equal(diagnostic.layer, 'local-listener')
  assert.equal(diagnostic.severity, 'error')
  assert.equal(
    diagnostic.checksText,
    'Get-NetTCPConnection -LocalPort 16060 -ErrorAction SilentlyContinue'
  )
  assert.equal(alias.code, 'SSH_TUNNEL_PORT_IN_USE')
})

test('timeout maps known stages and offers warning-only safe retry guidance', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const cases = [
    ['local-listener', 'local-listener'],
    ['ssh-forwarding', 'ssh-forwarding'],
    ['target-service', 'target-service'],
    ['proxy', 'proxy'],
    ['unrecognized-stage', 'unknown']
  ]

  for (const [stage, layer] of cases) {
    const diagnostic = getTunnelDiagnostic(
      { code: 'SSH_TUNNEL_TEST_TIMEOUT', stage },
      localDefinition()
    )
    assert.equal(diagnostic.layer, layer)
    assert.equal(diagnostic.severity, 'warning')
    assert.equal(diagnostic.configExample, '')
    assert.equal(diagnostic.checksText, '')
  }
})

test('untrusted ports hosts and error text never reach rendered diagnostics', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const payload = '6060; sudo systemctl restart sshd #'
  const hostPayload = '127.0.0.1; PermitOpen *:*'
  const errorPayload = 'message-payload $(whoami) private key'
  const diagnostic = getTunnelDiagnostic(
    {
      code: 'SSH_TUNNEL_FORWARDING_PROHIBITED',
      message: errorPayload,
      stack: errorPayload
    },
    localDefinition({
      sshTunnelLocalPort: payload,
      sshTunnelRemoteHost: hostPayload,
      sshTunnelRemotePort: payload
    })
  )
  const refused = getTunnelDiagnostic(
    { code: 'SSH_TUNNEL_DESTINATION_REFUSED', message: errorPayload },
    localDefinition({ sshTunnelRemotePort: payload })
  )
  const serialized = JSON.stringify([diagnostic, refused])

  for (const forbidden of [payload, hostPayload, errorPayload, 'systemctl restart', 'private key']) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.equal(diagnostic.configExample, '')
  assert.equal(refused.checksText, '')
  assert.equal(
    hasStep(diagnostic, 'sshTunnel.diagnostic.forwardingProhibited.invalidTarget'),
    true
  )
})

test('diagnostics reject explicit malformed hosts instead of changing a policy target', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const invalidHosts = [
    '::::',
    '999.1.1.1',
    'a..b',
    '[2001:db8::1',
    '[::1]]',
    'fe80::1%12',
    'db.example.com.',
    'db_name.example'
  ]

  for (const host of invalidHosts) {
    const diagnostic = getTunnelDiagnostic(
      { code: 'SSH_TUNNEL_FORWARDING_PROHIBITED' },
      localDefinition({ sshTunnelRemoteHost: host })
    )
    assert.equal(diagnostic.configExample, '')
    assert.equal(diagnostic.configExample.includes(host), false)
    assert.equal(
      hasStep(diagnostic, 'sshTunnel.diagnostic.forwardingProhibited.invalidTarget'),
      true
    )
  }

  for (const [host, expected] of [
    ['localhost', 'localhost'],
    ['203.0.113.7', '203.0.113.7'],
    ['db.example.com', 'db.example.com'],
    ['2001:db8::1', '[2001:db8::1]'],
    ['[2001:db8::1]', '[2001:db8::1]']
  ]) {
    const diagnostic = getTunnelDiagnostic(
      { code: 'SSH_TUNNEL_FORWARDING_PROHIBITED' },
      localDefinition({ sshTunnelRemoteHost: host })
    )
    assert.match(diagnostic.configExample, new RegExp(`PermitOpen ${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:6060`))
  }
})

test('diagnostics do not turn explicit invalid ports into authorization examples', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const invalidPorts = ['0', '65536', '6060; PermitOpen *:*', 80.5]

  for (const port of invalidPorts) {
    const diagnostic = getTunnelDiagnostic(
      { code: 'SSH_TUNNEL_FORWARDING_PROHIBITED' },
      localDefinition({ sshTunnelRemotePort: port })
    )
    assert.equal(diagnostic.configExample, '')
    assert.equal(JSON.stringify(diagnostic).includes(String(port)), false)
    assert.equal(
      hasStep(diagnostic, 'sshTunnel.diagnostic.forwardingProhibited.invalidTarget'),
      true
    )
  }
})

test('unknown failures are bounded, do not expose error details, and module has no execution dependency', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const diagnostic = getTunnelDiagnostic(
    { code: 'OTHER', message: 'leak-me', stack: 'leak-stack' },
    localDefinition()
  )
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/ssh-tunnel/ssh-tunnel-diagnostics.js'
  ), 'utf8')

  assert.equal(diagnostic.layer, 'unknown')
  assert.equal(diagnostic.severity, 'error')
  assert.equal(diagnostic.configExample, '')
  assert.equal(diagnostic.checksText, '')
  assert.doesNotMatch(JSON.stringify(diagnostic), /leak-me|leak-stack/)
  assert.ok(JSON.stringify(diagnostic).length <= 4000)
  assert.doesNotMatch(source, /child_process|node-pty|session\s*\.|\.exec\s*\(/i)
})
