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
  assert.match(diagnostic.checksText, /sudo sshd -T \| grep -Ei 'allowtcpforwarding\|permitopen\|disableforwarding'/)
  assert.equal(diagnostic.configExample, [
    '# Minimal scoped example; replace ssh-login-user before use:',
    'Match User ssh-login-user',
    '    AllowTcpForwarding local',
    '    PermitOpen 127.0.0.1:6060'
  ].join('\n'))
  assert.notEqual(diagnostic.checksText, diagnostic.configExample)
  assert.equal(diagnostic.steps.every(step => typeof step.key === 'string' && step.values && typeof step.values === 'object'), true)
})

test('forwarding prohibited supplies only a scoped remote policy or a conservative dynamic hint', async () => {
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
  assert.match(dynamic.configExample, /AllowTcpForwarding local/)
  assert.doesNotMatch(dynamic.configExample, /PermitOpen|PermitListen/)
})

test('destination refused checks the valid remote listener from the SSH server perspective', async () => {
  const { getTunnelDiagnostic } = await loadDiagnostics()
  const diagnostic = getTunnelDiagnostic(
    { code: 'SSH_TUNNEL_DESTINATION_REFUSED' },
    localDefinition()
  )

  assert.equal(diagnostic.layer, 'target-service')
  assert.equal(diagnostic.severity, 'error')
  assert.match(diagnostic.checksText, /ss -lntp \| grep ':6060'/)
  assert.equal(diagnostic.configExample, '')
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
  assert.match(diagnostic.checksText, /Get-NetTCPConnection -LocalPort 16060 -ErrorAction SilentlyContinue/)
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
    assert.equal(diagnostic.checksText.includes('restart'), false)
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
  assert.match(diagnostic.configExample, /127\.0\.0\.1:6060/)
  assert.match(refused.checksText, /ss -lntp \| grep ':6060'/)
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
  assert.doesNotMatch(JSON.stringify(diagnostic), /leak-me|leak-stack/)
  assert.ok(JSON.stringify(diagnostic).length <= 4000)
  assert.doesNotMatch(source, /child_process|node-pty|session\s*\.|\.exec\s*\(/i)
})
