const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

async function loadUsage () {
  return importModule('src/client/components/ssh-tunnel/ssh-tunnel-usage.js')
}

test('web profiles open safe loopback URLs for local forwards', async () => {
  const { getTunnelUsage } = await loadUsage()

  assert.deepEqual(getTunnelUsage({
    sshTunnel: 'forwardLocalToRemote',
    usageProfile: 'http',
    sshTunnelLocalHost: '0.0.0.0',
    sshTunnelLocalPort: '8080'
  }), {
    kind: 'web',
    profile: 'http',
    host: '127.0.0.1',
    port: 8080,
    endpoint: '127.0.0.1:8080',
    url: 'http://127.0.0.1:8080',
    requiresProxy: false,
    canOpen: true
  })
  assert.deepEqual(getTunnelUsage({
    sshTunnel: 'forwardLocalToRemote',
    usageProfile: 'https',
    sshTunnelLocalHost: '::',
    sshTunnelLocalPort: 8443
  }), {
    kind: 'web',
    profile: 'https',
    host: '[::1]',
    port: 8443,
    endpoint: '[::1]:8443',
    url: 'https://[::1]:8443',
    requiresProxy: false,
    canOpen: true
  })
})

test('dynamic forwarding is always a SOCKS5 proxy and cannot be opened as a page', async () => {
  const { getTunnelUsage } = await loadUsage()

  assert.deepEqual(getTunnelUsage({
    sshTunnel: 'dynamicForward',
    usageProfile: 'http',
    sshTunnelLocalHost: '::',
    sshTunnelLocalPort: '1080'
  }), {
    kind: 'proxy',
    profile: 'socks5',
    host: '[::1]',
    port: 1080,
    endpoint: '[::1]:1080',
    bindHost: '[::]',
    bindPort: 1080,
    bindEndpoint: '[::]:1080',
    usesWildcardBind: true,
    requiresProxy: true,
    canOpen: false
  })
})

test('dynamic wildcard listeners preserve exposure while commands use a loopback connect endpoint', async () => {
  const { getTunnelGuideData, getTunnelUsage } = await loadUsage()

  for (const [sshTunnelLocalHost, bindEndpoint, endpoint] of [
    ['0.0.0.0', '0.0.0.0:19090', '127.0.0.1:19090'],
    ['*', '*:19090', '127.0.0.1:19090'],
    ['::', '[::]:19090', '[::1]:19090']
  ]) {
    const definition = {
      sshTunnel: 'dynamicForward',
      sshTunnelLocalHost,
      sshTunnelLocalPort: 19090
    }
    const usage = getTunnelUsage(definition)
    assert.equal(usage.bindEndpoint, bindEndpoint)
    assert.equal(usage.endpoint, endpoint)
    assert.equal(usage.usesWildcardBind, true)

    const guide = getTunnelGuideData({ definition }).socks
    assert.equal(guide.isExample, false)
    assert.equal(guide.bindEndpoint, bindEndpoint)
    assert.equal(guide.endpoint, endpoint)
    const escapedEndpoint = endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(guide.chromeCommand, new RegExp(`--proxy-server="socks5://${escapedEndpoint}"`))
  }
})

test('database profiles provide local endpoints without a browser action', async () => {
  const { getTunnelUsage } = await loadUsage()

  for (const profile of ['mysql', 'postgresql', 'redis']) {
    assert.deepEqual(getTunnelUsage({
      sshTunnel: 'forwardLocalToRemote',
      usageProfile: profile,
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: '3307'
    }), {
      kind: 'database',
      profile,
      host: '127.0.0.1',
      port: 3307,
      endpoint: '127.0.0.1:3307',
      requiresProxy: false,
      canOpen: false
    })
  }
})

test('remote forwarding describes the SSH-server endpoint without a local URL', async () => {
  const { getTunnelUsage } = await loadUsage()

  assert.deepEqual(getTunnelUsage({
    sshTunnel: 'forwardRemoteToLocal',
    usageProfile: 'http',
    sshTunnelRemoteHost: '2001:db8::10',
    sshTunnelRemotePort: '9000'
  }), {
    kind: 'remote',
    profile: 'generic',
    host: '[2001:db8::10]',
    port: 9000,
    endpoint: '[2001:db8::10]:9000',
    bindHost: '[2001:db8::10]',
    bindPort: 9000,
    bindEndpoint: '[2001:db8::10]:9000',
    usesWildcardBind: false,
    requiresServerAddressForExternalAccess: false,
    requiresProxy: false,
    canOpen: false
  })
})

test('remote wildcard listeners expose a server-local connect endpoint without copying the wildcard', async () => {
  const { getTunnelUsage } = await loadUsage()
  const cases = [
    ['0.0.0.0', '0.0.0.0:18080', '127.0.0.1:18080'],
    ['*', '*:18080', '127.0.0.1:18080'],
    ['::', '[::]:18080', '[::1]:18080'],
    ['[::]', '[::]:18080', '[::1]:18080'],
    ['0:0:0:0:0:0:0:0', '[0:0:0:0:0:0:0:0]:18080', '[::1]:18080']
  ]

  for (const [sshTunnelRemoteHost, bindEndpoint, endpoint] of cases) {
    const usage = getTunnelUsage({
      sshTunnel: 'forwardRemoteToLocal',
      sshTunnelRemoteHost,
      sshTunnelRemotePort: 18080
    })
    assert.equal(usage.bindEndpoint, bindEndpoint)
    assert.equal(usage.endpoint, endpoint)
    assert.equal(usage.usesWildcardBind, true)
    assert.equal(usage.requiresServerAddressForExternalAccess, true)
    assert.notEqual(usage.endpoint, usage.bindEndpoint)
  }
})

test('guide data uses current safe SOCKS and remote settings and labels fallbacks as examples', async () => {
  const { getTunnelGuideData } = await loadUsage()

  const socks = getTunnelGuideData({
    definition: {
      sshTunnel: 'dynamicForward',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 19090
    }
  }).socks
  assert.equal(socks.isExample, false)
  assert.equal(socks.host, '127.0.0.1')
  assert.equal(socks.port, 19090)
  assert.equal(socks.endpoint, '127.0.0.1:19090')
  assert.equal(socks.bindEndpoint, '127.0.0.1:19090')
  assert.match(socks.chromeCommand, /^chrome\.exe --user-data-dir="%TEMP%\\shellpilot-chrome-socks-[0-9a-f]{8}" --proxy-server="socks5:\/\/127\.0\.0\.1:19090"$/)
  assert.match(socks.edgeCommand, /^msedge\.exe --user-data-dir="%TEMP%\\shellpilot-edge-socks-[0-9a-f]{8}" --proxy-server="socks5:\/\/127\.0\.0\.1:19090"$/)

  const otherSocks = getTunnelGuideData({
    definition: {
      sshTunnel: 'dynamicForward',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 1080
    }
  }).socks
  const profileDirectory = command => command.match(/--user-data-dir="([^"]+)"/)[1]
  assert.notEqual(profileDirectory(socks.chromeCommand), profileDirectory(otherSocks.chromeCommand))
  assert.notEqual(profileDirectory(socks.edgeCommand), profileDirectory(otherSocks.edgeCommand))

  const remote = getTunnelGuideData({
    definition: {
      sshTunnel: 'forwardRemoteToLocal',
      sshTunnelRemoteHost: '0.0.0.0',
      sshTunnelRemotePort: 28080,
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 9080
    }
  }).remote
  assert.equal(remote.isExample, false)
  assert.equal(remote.bindEndpoint, '0.0.0.0:28080')
  assert.equal(remote.endpoint, '127.0.0.1:28080')
  assert.equal(remote.targetHost, '127.0.0.1')
  assert.equal(remote.targetPort, 9080)
  assert.equal(remote.targetEndpoint, '127.0.0.1:9080')

  const fallback = getTunnelGuideData({
    definition: {
      sshTunnel: 'dynamicForward',
      sshTunnelLocalHost: '127.0.0.1; shutdown',
      sshTunnelLocalPort: '1080 && whoami'
    }
  }).socks
  assert.equal(fallback.isExample, true)
  assert.equal(fallback.endpoint, '127.0.0.1:1080')
  assert.doesNotMatch(fallback.chromeCommand, /shutdown|whoami|&&|;/)
})

test('legacy names are matched exactly and unknown services stay generic', async () => {
  const { getTunnelUsage } = await loadUsage()

  assert.deepEqual(getTunnelUsage({
    sshTunnel: 'forwardLocalToRemote',
    name: 'HTTP',
    sshTunnelLocalHost: '2001:db8::1',
    sshTunnelLocalPort: '8080'
  }), {
    kind: 'web',
    profile: 'http',
    host: '[2001:db8::1]',
    port: 8080,
    endpoint: '[2001:db8::1]:8080',
    url: 'http://[2001:db8::1]:8080',
    requiresProxy: false,
    canOpen: true
  })
  assert.deepEqual(getTunnelUsage({
    sshTunnel: 'forwardLocalToRemote',
    name: 'HTTPS dashboard',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 8443
  }), {
    kind: 'tcp',
    profile: 'generic',
    host: '127.0.0.1',
    port: 8443,
    endpoint: '127.0.0.1:8443',
    requiresProxy: false,
    canOpen: false
  })
})

test('invalid access hosts and ports never produce URLs or endpoints', async () => {
  const { getTunnelUsage } = await loadUsage()
  const invalidPorts = [undefined, '', NaN, 0, -1, 65536, 1.5]
  const invalidHosts = [
    '',
    '127.0.0.1@evil.example',
    'localhost?query',
    'localhost#fragment',
    'localhost\\path',
    'local host',
    '\u0000localhost',
    '[::1',
    '::1]',
    '[localhost]'
  ]

  for (const sshTunnelLocalPort of invalidPorts) {
    const usage = getTunnelUsage({
      usageProfile: 'http',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort
    })
    assert.equal(usage.kind, 'web')
    assert.equal(usage.profile, 'http')
    assert.equal(usage.canOpen, false)
    for (const key of ['host', 'port', 'requiresProxy']) {
      assert.equal(key in usage, true)
    }
    assert.equal('endpoint' in usage, false)
    assert.equal('url' in usage, false)
  }
  for (const sshTunnelLocalHost of invalidHosts) {
    const usage = getTunnelUsage({
      usageProfile: 'https',
      sshTunnelLocalHost,
      sshTunnelLocalPort: 8443
    })
    assert.equal(usage.kind, 'web')
    assert.equal(usage.profile, 'https')
    assert.equal(usage.canOpen, false)
    for (const key of ['host', 'port', 'requiresProxy']) {
      assert.equal(key in usage, true)
    }
    assert.equal('endpoint' in usage, false)
    assert.equal('url' in usage, false)
  }
})

test('every invalid tunnel kind keeps its stable structure without an endpoint', async () => {
  const { getTunnelUsage } = await loadUsage()
  const usages = [
    getTunnelUsage({
      sshTunnel: 'dynamicForward',
      sshTunnelLocalHost: '127.0.0.1@evil.example',
      sshTunnelLocalPort: 1080
    }),
    getTunnelUsage({
      sshTunnel: 'forwardRemoteToLocal',
      sshTunnelRemoteHost: '127.0.0.1',
      sshTunnelRemotePort: 0
    }),
    getTunnelUsage({
      usageProfile: 'mysql',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: undefined
    }),
    getTunnelUsage({
      usageProfile: 'generic',
      sshTunnelLocalHost: '[localhost]',
      sshTunnelLocalPort: 9000
    })
  ]

  for (const usage of usages) {
    for (const key of ['kind', 'profile', 'host', 'port', 'requiresProxy', 'canOpen']) {
      assert.equal(key in usage, true)
    }
    assert.equal(usage.canOpen, false)
    assert.equal('endpoint' in usage, false)
    assert.equal('url' in usage, false)
  }
})

test('IPv6 access addresses are bracketed once and zone IDs remain copyable', async () => {
  const { getTunnelUsage } = await loadUsage()

  for (const sshTunnelLocalHost of ['2001:db8::1', '[2001:db8::1]']) {
    assert.deepEqual(getTunnelUsage({
      usageProfile: 'https',
      sshTunnelLocalHost,
      sshTunnelLocalPort: 8443
    }), {
      kind: 'web',
      profile: 'https',
      host: '[2001:db8::1]',
      port: 8443,
      endpoint: '[2001:db8::1]:8443',
      url: 'https://[2001:db8::1]:8443',
      requiresProxy: false,
      canOpen: true
    })
  }
  const zoned = getTunnelUsage({
    usageProfile: 'http',
    sshTunnelLocalHost: 'fe80::1%eth0',
    sshTunnelLocalPort: 8080
  })
  assert.equal(zoned.host, '[fe80::1%eth0]')
  assert.equal(zoned.endpoint, '[fe80::1%eth0]:8080')
  assert.equal(zoned.canOpen, false)
  assert.equal('url' in zoned, false)
})

test('web URLs accept canonical IPv6 parsing and protocol default ports', async () => {
  const { getTunnelUsage } = await loadUsage()

  assert.deepEqual(getTunnelUsage({
    usageProfile: 'https',
    sshTunnelLocalHost: '2001:0db8::1',
    sshTunnelLocalPort: 8443
  }), {
    kind: 'web',
    profile: 'https',
    host: '[2001:0db8::1]',
    port: 8443,
    endpoint: '[2001:0db8::1]:8443',
    url: 'https://[2001:0db8::1]:8443',
    requiresProxy: false,
    canOpen: true
  })
  for (const [profile, port] of [['http', 80], ['https', 443]]) {
    const usage = getTunnelUsage({
      usageProfile: profile,
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: port
    })
    assert.equal(usage.endpoint, `127.0.0.1:${port}`)
    assert.equal(usage.url, `${profile}://127.0.0.1:${port}`)
    assert.equal(usage.canOpen, true)
  }
})

test('IPv6 wildcard addresses are converted semantically without changing other IPv6 hosts', async () => {
  const { getTunnelUsage } = await loadUsage()
  const expandedWildcard = '0:0:0:0:0:0:0:0'

  for (const sshTunnelLocalHost of [expandedWildcard, `[${expandedWildcard}]`]) {
    const usage = getTunnelUsage({
      usageProfile: 'http',
      sshTunnelLocalHost,
      sshTunnelLocalPort: 8080
    })
    assert.equal(usage.host, '[::1]')
    assert.equal(usage.endpoint, '[::1]:8080')
    assert.equal(usage.url, 'http://[::1]:8080')
    assert.equal(usage.canOpen, true)
  }
  const nonWildcard = getTunnelUsage({
    usageProfile: 'http',
    sshTunnelLocalHost: '0:0:0:0:0:0:0:1',
    sshTunnelLocalPort: 8080
  })
  assert.equal(nonWildcard.host, '[0:0:0:0:0:0:0:1]')
  assert.notEqual(nonWildcard.host, '[::1]')
})

test('usage rejects ambiguous port syntax and explicit unknown tunnel types', async () => {
  const { getTunnelUsage } = await loadUsage()
  const invalidPorts = [true, [80], {}, '0x50', '8e2', '80.5', '+80', '-80']

  for (const sshTunnelLocalPort of invalidPorts) {
    const usage = getTunnelUsage({
      usageProfile: 'https',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort
    })
    assert.equal(usage.canOpen, false)
    assert.equal('endpoint' in usage, false)
    assert.equal('url' in usage, false)
  }
  const bogus = getTunnelUsage({
    sshTunnel: 'ForwardLocalToRemote',
    usageProfile: 'https',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 8443
  })
  assert.deepEqual(bogus, {
    kind: 'tcp',
    profile: 'generic',
    host: undefined,
    port: undefined,
    requiresProxy: false,
    canOpen: false
  })
})

test('tunnel types control their usage profile and valid output structure', async () => {
  const { getTunnelUsage } = await loadUsage()
  const usages = [
    getTunnelUsage({
      sshTunnel: 'dynamicForward',
      usageProfile: 'http',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 1080
    }),
    getTunnelUsage({
      sshTunnel: 'forwardRemoteToLocal',
      usageProfile: 'https',
      sshTunnelRemoteHost: '127.0.0.1',
      sshTunnelRemotePort: 9000
    }),
    getTunnelUsage({
      sshTunnel: 'forwardLocalToRemote',
      usageProfile: 'socks5',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 1080
    })
  ]

  assert.deepEqual(usages.map(usage => [
    usage.kind,
    usage.profile,
    usage.requiresProxy,
    usage.canOpen
  ]), [
    ['proxy', 'socks5', true, false],
    ['remote', 'generic', false, false],
    ['tcp', 'generic', false, false]
  ])
  for (const usage of usages) {
    for (const key of ['kind', 'profile', 'host', 'port', 'requiresProxy', 'canOpen']) {
      assert.equal(key in usage, true)
    }
    assert.equal(typeof usage.endpoint, 'string')
    assert.equal('url' in usage, false)
  }
})

test('invalid profiles fall back to generic local access data', async () => {
  const { getTunnelUsage } = await loadUsage()

  assert.deepEqual(getTunnelUsage({
    sshTunnel: 'forwardLocalToRemote',
    usageProfile: 'telnet',
    sshTunnelLocalHost: 'localhost',
    sshTunnelLocalPort: '23'
  }), {
    kind: 'tcp',
    profile: 'generic',
    host: 'localhost',
    port: 23,
    endpoint: 'localhost:23',
    requiresProxy: false,
    canOpen: false
  })
})
