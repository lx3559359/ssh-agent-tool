const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const capabilities = {
  interfaces: [{ name: 'eth0' }, { name: 'ens192' }]
}

test('packet capture parameters are typed bounded and discovery-backed', async () => {
  const { normalizePacketCaptureParameters } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  const value = normalizePacketCaptureParameters({
    interfaceName: 'eth0',
    protocol: 'tcp',
    host: '10.0.0.8',
    port: 443,
    packetCount: 1000,
    duration: 300,
    outputPath: '/tmp/capture.pcap'
  }, capabilities)
  assert.equal(value.port, 443)
  assert.equal(value.packetCount, 1000)
  assert.throws(
    () => normalizePacketCaptureParameters({
      interfaceName: 'unknown0',
      protocol: 'tcp',
      outputPath: '/tmp/capture.pcap'
    }, capabilities),
    /网卡/
  )
  assert.throws(
    () => normalizePacketCaptureParameters({
      interfaceName: 'eth0',
      protocol: 'icmp',
      port: 53,
      outputPath: '/tmp/capture.pcap'
    }, capabilities),
    /端口/
  )
  assert.throws(
    () => normalizePacketCaptureParameters({
      interfaceName: 'eth0',
      protocol: 'tcp',
      outputPath: '/tmp/capture.pcap;id'
    }, capabilities),
    /抓包文件/
  )
  for (const unsafe of [
    { host: 'example.com;id' },
    { protocol: 'tcp\nid' },
    { packetCount: 0 },
    { packetCount: 1001 },
    { duration: 0 },
    { duration: 301 },
    { outputPath: '/tmp/$(id).pcap' }
  ]) {
    assert.throws(() => normalizePacketCaptureParameters({
      interfaceName: 'eth0',
      protocol: 'tcp',
      outputPath: '/tmp/capture.pcap',
      ...unsafe
    }, capabilities))
  }
})

test('packet filter is constructed from validated fields', async () => {
  const { buildPacketCaptureFilter } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  assert.equal(buildPacketCaptureFilter({
    protocol: 'tcp',
    host: '10.0.0.8',
    port: 443
  }), 'tcp and host 10.0.0.8 and port 443')
  assert.equal(buildPacketCaptureFilter({
    protocol: 'any',
    host: '',
    port: ''
  }), '')
  assert.throws(() => buildPacketCaptureFilter({
    protocol: 'tcp',
    host: '10.0.0.8;id',
    port: 443
  }), /主机/)
})

test('capture command is bounded private and no-overwrite', async () => {
  const { buildPacketCaptureCommands } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  const commands = buildPacketCaptureCommands({
    interfaceName: 'eth0',
    protocol: 'tcp',
    host: '10.0.0.8',
    port: 443,
    packetCount: 100,
    duration: 30,
    outputPath: '/tmp/capture.pcap'
  }, capabilities)
  const source = commands.join('\n')
  assert.match(source, /umask 077/)
  assert.match(source, /timeout --signal=INT --kill-after=5 30/)
  assert.match(source, /tcpdump -nn -i 'eth0' -c 100/)
  assert.match(source, /ln -- "\$TEMP" "\$TARGET"/)
  assert.match(source, /sudo -n/)
  assert.match(source, /sudo -n tcpdump --version/)
  assert.doesNotMatch(source, /sudo -n true/)
  assert.match(source, /TEMP_INODE/)
  assert.match(source, /abort_capture \(\).*exit 130/s)
  assert.match(source, /trap abort_capture HUP INT TERM/)
  assert.match(source, /\[ ! -e "\$TARGET" \].*\[ ! -L "\$TARGET" \]/)
  assert.match(source, /\[ -w "\$PARENT" \]/)
  assert.match(source, /head -n 100/)
  assert.doesNotMatch(source, /\beval\b|\bsource\b|tcpdump .+ -[XxAa]/)
})

test('capture definition is resource-sensitive', async () => {
  const { packetCaptureTools } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  assert.equal(packetCaptureTools.length, 1)
  assert.equal(packetCaptureTools[0].id, 'network.packet-capture')
  assert.equal(packetCaptureTools[0].risk, 'resource-sensitive')
  assert.equal(packetCaptureTools[0].requiresConfirmation, true)
  const port = packetCaptureTools[0].parameters.find(item => item.id === 'port')
  assert.equal(Object.isFrozen(port.enabledWhen), true)
  assert.equal(Object.isFrozen(port.enabledWhen.values), true)
  assert.deepEqual(
    packetCaptureTools[0].steps.map(step => step.id),
    ['preflight', 'capture', 'summary']
  )
})
