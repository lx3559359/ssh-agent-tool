const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const nonce = 'nonce123456789012'
const fixture = [
  `__SHELLPILOT_OPERATIONS_BEGIN__:${nonce}`,
  'os.id=anolis',
  'os.idLike=rhel fedora',
  'os.version=23',
  'kernel=6.6.0',
  'arch=x86_64',
  'init=systemd',
  'tool=ss',
  'interface=eth0|UP|10.0.0.2/24|1500',
  'interface=eth1|DOWN||1500',
  'route=eth0|10.0.0.1',
  'service=nginx.service|loaded|active|enabled',
  'containerRuntime=docker',
  'platform=compose',
  `__SHELLPILOT_OPERATIONS_END__:${nonce}`
].join('\n')

test('maps domestic distributions to explicit compatibility families', async () => {
  const { getCompatibilityProfile } = await importModule(
    'src/client/components/operations-toolkit/shared/compatibility.js'
  )
  assert.deepEqual(
    getCompatibilityProfile({ id: 'openEuler', idLike: 'rhel fedora' }),
    {
      family: 'openeuler',
      level: 'A',
      packageManager: 'dnf'
    }
  )
  assert.equal(
    getCompatibilityProfile({ id: 'kylin', idLike: 'rhel centos' }).family,
    'rhel'
  )
  assert.equal(
    getCompatibilityProfile({ id: 'uos', idLike: 'debian' }).family,
    'debian'
  )
})

test('parses bounded discovery output with services and interfaces', async () => {
  const { parseOperationsDiscoveryOutput } = await importModule(
    'src/client/components/operations-toolkit/shared/capability-discovery.js'
  )
  const result = parseOperationsDiscoveryOutput(fixture, nonce)
  assert.equal(result.os.id, 'anolis')
  assert.deepEqual(result.interfaces.map(item => item.name), ['eth0', 'eth1'])
  assert.equal(result.services.some(item => item.name === 'nginx.service'), true)
  assert.deepEqual(result.routes, [{ interface: 'eth0', gateway: '10.0.0.1' }])
})

test('discovery rejects duplicate markers and unsafe service names', async () => {
  const { parseOperationsDiscoveryOutput } = await importModule(
    'src/client/components/operations-toolkit/shared/capability-discovery.js'
  )
  assert.throws(
    () => parseOperationsDiscoveryOutput(`${fixture}\n${fixture}`, nonce),
    /边界标记必须唯一/
  )
  assert.throws(
    () => parseOperationsDiscoveryOutput(
      fixture.replace('nginx.service', 'nginx;rm.service'),
      nonce
    ),
    /服务名称无效/
  )
})

test('discovery command uses unique boundaries and bounded service output', async () => {
  const { buildOperationsDiscoveryCommand } = await importModule(
    'src/client/components/operations-toolkit/shared/capability-discovery.js'
  )
  const command = buildOperationsDiscoveryCommand(nonce)
  assert.match(command, new RegExp(`__SHELLPILOT_OPERATIONS_BEGIN__:${nonce}`))
  assert.match(command, /head -n 500/)
  assert.match(command, /ip -o link/)
})
