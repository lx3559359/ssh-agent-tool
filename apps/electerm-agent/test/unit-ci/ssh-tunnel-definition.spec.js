const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

async function loadDefinitions () {
  return importModule(
    'src/client/components/ssh-tunnel/ssh-tunnel-definition.js'
  )
}

test('SSH tunnel definition normalizes safe defaults and stable ids', async () => {
  const { normalizeTunnel } = await loadDefinitions()
  const input = {
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalHost: '',
    sshTunnelLocalPort: '3307',
    sshTunnelRemoteHost: '',
    sshTunnelRemotePort: '3306',
    name: 'MySQL'
  }
  const first = normalizeTunnel(input)
  const second = normalizeTunnel(input)

  assert.equal(first.sshTunnelLocalHost, '127.0.0.1')
  assert.equal(first.sshTunnelRemoteHost, '127.0.0.1')
  assert.equal(first.sshTunnelLocalPort, 3307)
  assert.equal(first.sshTunnelRemotePort, 3306)
  assert.equal(first.id, second.id)
  assert.equal(input.id, undefined)
})

test('SSH tunnel definition identifies public exposure risk', async () => {
  const { getTunnelRisk } = await loadDefinitions()

  assert.equal(getTunnelRisk({
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalHost: '0.0.0.0'
  }).requiresConfirmation, true)
  assert.equal(getTunnelRisk({
    sshTunnel: 'forwardRemoteToLocal',
    sshTunnelRemoteHost: '::'
  }).requiresConfirmation, true)
  assert.equal(getTunnelRisk({
    sshTunnel: 'dynamicForward',
    sshTunnelLocalHost: '127.0.0.1'
  }).requiresConfirmation, false)
})

test('SSH tunnel templates cover common services and SOCKS5', async () => {
  const { getTunnelTemplate } = await loadDefinitions()

  assert.deepEqual(
    {
      localPort: getTunnelTemplate('mysql').sshTunnelLocalPort,
      remotePort: getTunnelTemplate('mysql').sshTunnelRemotePort
    },
    { localPort: 3307, remotePort: 3306 }
  )
  assert.equal(getTunnelTemplate('socks5').sshTunnel, 'dynamicForward')
  assert.equal(getTunnelTemplate('socks5').sshTunnelLocalPort, 1080)
  assert.notStrictEqual(getTunnelTemplate('http'), getTunnelTemplate('http'))
})

test('SSH tunnel templates, normalization, and bookmarks keep only supported usage profiles', async () => {
  const {
    getTunnelTemplate,
    normalizeTunnel,
    serializeTunnelForBookmark
  } = await loadDefinitions()

  const expectedProfiles = {
    http: 'http',
    https: 'https',
    mysql: 'mysql',
    postgresql: 'postgresql',
    redis: 'redis',
    socks5: 'socks5'
  }
  for (const [template, profile] of Object.entries(expectedProfiles)) {
    assert.equal(getTunnelTemplate(template).usageProfile, profile)
  }

  const legacyInput = {
    sshTunnelLocalPort: 8080,
    sshTunnelRemotePort: 80,
    name: 'HTTP'
  }
  const legacy = normalizeTunnel(legacyInput)
  const profiled = normalizeTunnel({
    ...legacyInput,
    usageProfile: 'http'
  })
  assert.equal(profiled.id, legacy.id)
  assert.equal(normalizeTunnel({ usageProfile: 'generic' }).usageProfile, 'generic')
  assert.equal(normalizeTunnel({ usageProfile: 'custom-service' }).usageProfile, undefined)
  assert.equal(normalizeTunnel({ usageProfile: '' }).usageProfile, undefined)
  assert.equal(serializeTunnelForBookmark({
    ...profiled,
    usageProfile: 'https'
  }).usageProfile, 'https')
  assert.equal('usageProfile' in serializeTunnelForBookmark({
    ...profiled,
    usageProfile: 'untrusted'
  }), false)
})

test('SSH tunnel validation rejects unsupported types and invalid ports', async () => {
  const { validateTunnel } = await loadDefinitions()

  assert.throws(() => validateTunnel({
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalPort: 70000,
    sshTunnelRemotePort: 80
  }), /端口/)
  assert.throws(() => validateTunnel({
    sshTunnel: 'unknown',
    sshTunnelLocalPort: 8080,
    sshTunnelRemotePort: 80
  }), /类型/)
  assert.throws(() => validateTunnel({
    sshTunnel: 'dynamicForward',
    sshTunnelLocalPort: 1080,
    name: 'x'.repeat(81)
  }), /名称/)
})

test('bookmark serialization strips runtime-only fields and preserves legacy auto-start', async () => {
  const {
    normalizeTunnel,
    serializeTunnelForBookmark
  } = await loadDefinitions()
  const legacy = normalizeTunnel({
    sshTunnel: 'dynamicForward',
    sshTunnelLocalPort: 1080
  })
  const serialized = serializeTunnelForBookmark({
    ...legacy,
    state: 'running',
    error: { message: 'hidden' },
    controller: { close () {} },
    lastTestAt: Date.now()
  })

  assert.equal(serialized.autoStart, true)
  assert.equal('state' in serialized, false)
  assert.equal('error' in serialized, false)
  assert.equal('controller' in serialized, false)
  assert.equal('lastTestAt' in serialized, false)
})
