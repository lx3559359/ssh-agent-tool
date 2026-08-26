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
    requiresProxy: true,
    canOpen: false
  })
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
    profile: 'http',
    host: '[2001:db8::10]',
    port: 9000,
    endpoint: '[2001:db8::10]:9000',
    requiresProxy: false,
    canOpen: false
  })
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
    url: 'http://[2001:db8::1]:8080',
    requiresProxy: false,
    canOpen: true
  })
  assert.deepEqual(getTunnelUsage({
    sshTunnel: 'forwardLocalToRemote',
    name: 'HTTPS dashboard',
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
