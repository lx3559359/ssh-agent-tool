const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const expected = [
  'network.interface-health',
  'network.tcp-connections',
  'network.dns-chain',
  'network.route-mtu',
  'network.loss-latency',
  'security.firewall-exposure',
  'security.ssh-login'
]

test('network and security catalog has seven readonly tools', async () => {
  const { networkSecurityTools } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/network-security.js'
  )
  assert.deepEqual(networkSecurityTools.map(tool => tool.id), expected)
  assert.equal(networkSecurityTools.every(tool => tool.risk === 'read-only'), true)
})

test('network validators reject shell injection', async () => {
  const {
    assertHost,
    assertInterface,
    assertPort
  } = await importModule(
    'src/client/components/operations-toolkit/shared/validation.js'
  )
  assert.equal(assertHost('example.com', '目标'), 'example.com')
  assert.equal(assertPort('65535'), 65535)
  assert.equal(assertInterface('eth0.10'), 'eth0.10')
  for (const value of ['example.com;rm -rf /', '8.8.8.8 && id', '$(id)']) {
    assert.throws(() => assertHost(value, '目标'), /目标/)
  }
})
