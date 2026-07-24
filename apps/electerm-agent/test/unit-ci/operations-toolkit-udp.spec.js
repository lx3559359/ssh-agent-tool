const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

test('udp silence is inconclusive instead of closed', async () => {
  const {
    parseUdpCheckResult,
    udpCheckTools
  } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/udp-check.js'
  )
  const result = parseUdpCheckResult({
    listener: 'none',
    firewall: 'unknown',
    probe: 'timeout',
    capture: 'no-packet'
  })
  assert.equal(result.status, 'inconclusive')
  assert.doesNotMatch(result.summary, /关闭/)
  assert.equal(udpCheckTools[0].id, 'network.udp-comprehensive-check')
  assert.equal(udpCheckTools[0].steps.length, 4)
})

test('udp parameters are bounded', async () => {
  const { normalizeUdpParameters } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/udp-check.js'
  )
  const value = normalizeUdpParameters({
    host: '127.0.0.1',
    port: 53,
    attempts: 10,
    timeout: 30,
    packetCount: 1000,
    interfaceName: 'eth0'
  })
  assert.equal(value.packetCount, 1000)
  assert.throws(
    () => normalizeUdpParameters({ host: 'x;id', port: 53 }),
    /目标/
  )
})
