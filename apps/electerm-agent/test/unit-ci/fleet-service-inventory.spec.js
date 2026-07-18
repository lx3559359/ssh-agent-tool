process.env.NODE_ENV = 'development'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const inventoryPath = path.resolve(
  __dirname,
  '../../src/app/common/fleet-service-inventory.js'
)
const probesPath = require.resolve('../../src/app/common/fleet-status-probes')
const servicePath = require.resolve('../../src/app/server/fleet-status-service')
const sessionCommonPath = require.resolve('../../src/app/server/session-common')
const clientUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/fleet-status-client.js'
)).href

function optionalRequire (modulePath) {
  try {
    return require(modulePath)
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' && error.message.includes(modulePath)) {
      return {}
    }
    throw error
  }
}

function target (extra = {}) {
  return {
    id: 'inventory-target',
    title: 'Inventory target',
    connection: {
      host: 'inventory.internal',
      port: 22,
      username: 'ops',
      password: 'connection-password',
      privateKey: 'connection-private-key',
      ...extra
    }
  }
}

function assertInventoryContract (item) {
  assert.deepEqual(
    Object.keys(item).sort(),
    (item.sourceState === undefined
      ? ['id', 'name', 'type', 'group', 'state', 'autostart', 'description', 'source']
      : ['id', 'name', 'type', 'group', 'state', 'autostart', 'description', 'source', 'sourceState']
    ).sort()
  )
  assert.ok(['service', 'container', 'process'].includes(item.type))
  assert.ok(['system', 'container', 'process-manager'].includes(item.group))
  assert.ok([
    'running',
    'stopped',
    'failed',
    'starting',
    'restarting',
    'paused',
    'unknown'
  ].includes(item.state))
  assert.ok([
    'enabled',
    'disabled',
    'static',
    'masked',
    'unknown'
  ].includes(item.autostart))
  assert.ok([
    'systemd',
    'openrc',
    'sysv',
    'docker',
    'compose',
    'supervisor',
    'pm2'
  ].includes(item.source))
}

function delay (milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function waitFor (predicate, message) {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${message}`)
    await delay(2)
  }
}

test('parses and normalizes systemd service inventory', () => {
  const inventory = optionalRequire(inventoryPath)
  assert.equal(typeof inventory.parseSystemServiceInventory, 'function')

  const result = inventory.parseSystemServiceInventory([
    '__SYSTEMD_UNITS__',
    'ssh.service loaded active running OpenSSH server daemon',
    'database.service loaded failed failed Example database',
    'worker.service loaded activating start Worker service',
    '__SYSTEMD_UNIT_FILES__',
    'ssh.service enabled enabled',
    'database.service masked enabled',
    'worker.service static -',
    'idle.service disabled -',
    ''
  ].join('\n'))

  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.items, [
    {
      id: 'systemd:database.service',
      name: 'database.service',
      type: 'service',
      group: 'system',
      state: 'failed',
      autostart: 'masked',
      description: 'Example database',
      source: 'systemd',
      sourceState: 'failed/failed'
    },
    {
      id: 'systemd:idle.service',
      name: 'idle.service',
      type: 'service',
      group: 'system',
      state: 'unknown',
      autostart: 'disabled',
      description: '',
      source: 'systemd',
      sourceState: 'unit-file/disabled'
    },
    {
      id: 'systemd:ssh.service',
      name: 'ssh.service',
      type: 'service',
      group: 'system',
      state: 'running',
      autostart: 'enabled',
      description: 'OpenSSH server daemon',
      source: 'systemd',
      sourceState: 'active/running'
    },
    {
      id: 'systemd:worker.service',
      name: 'worker.service',
      type: 'service',
      group: 'system',
      state: 'starting',
      autostart: 'static',
      description: 'Worker service',
      source: 'systemd',
      sourceState: 'activating/start'
    }
  ])
  result.items.forEach(assertInventoryContract)
})

test('parses OpenRC service state and runlevel autostart metadata', () => {
  const inventory = optionalRequire(inventoryPath)
  assert.equal(typeof inventory.parseSystemServiceInventory, 'function')

  const result = inventory.parseSystemServiceInventory([
    '__OPENRC__',
    'Runlevel: default',
    ' nginx                         [  started  ]',
    ' redis                         [  stopped  ]',
    ' worker                        [  crashed  ]',
    '__OPENRC_AUTOSTART__',
    ' nginx                         | default',
    ' redis                         |',
    ''
  ].join('\n'))

  assert.deepEqual(result.items.map(item => [
    item.name,
    item.state,
    item.autostart,
    item.source
  ]), [
    ['nginx', 'running', 'enabled', 'openrc'],
    ['redis', 'stopped', 'disabled', 'openrc'],
    ['worker', 'failed', 'disabled', 'openrc']
  ])
  result.items.forEach(assertInventoryContract)
})

test('parses SysV status symbols and chkconfig autostart metadata', () => {
  const inventory = optionalRequire(inventoryPath)
  assert.equal(typeof inventory.parseSystemServiceInventory, 'function')

  const result = inventory.parseSystemServiceInventory([
    '__SYSV__',
    ' [ + ]  cron',
    ' [ - ]  apache2',
    ' [ ? ]  legacy-agent',
    '__SYSV_AUTOSTART__',
    'cron 0:off 1:off 2:on 3:on 4:on 5:on 6:off',
    'apache2 0:off 1:off 2:off 3:off 4:off 5:off 6:off',
    ''
  ].join('\n'))

  assert.deepEqual(result.items.map(item => [
    item.name,
    item.state,
    item.autostart,
    item.sourceState
  ]), [
    ['apache2', 'stopped', 'disabled', '-'],
    ['cron', 'running', 'enabled', '+'],
    ['legacy-agent', 'unknown', 'unknown', '?']
  ])
  result.items.forEach(assertInventoryContract)
})

test('parses Docker restart policy and Docker Compose project state safely', () => {
  const inventory = optionalRequire(inventoryPath)
  assert.equal(typeof inventory.parseContainerInventory, 'function')

  const result = inventory.parseContainerInventory([
    '__DOCKER__',
    'abc123\tweb\trunning\tUp 3 hours\tshop\tweb',
    'def456\tcache\texited\tExited (1) 2 hours ago\t\t',
    '__DOCKER_RESTART__',
    'abc123\t/web\trunning\t0\tunless-stopped',
    'def456\t/cache\texited\t1\tno',
    '__COMPOSE__',
    'shop\trunning(2)',
    ''
  ].join('\n'))

  assert.deepEqual(result.items.map(item => [
    item.name,
    item.state,
    item.autostart,
    item.source,
    item.description
  ]), [
    ['cache', 'failed', 'disabled', 'docker', 'Exited (1) 2 hours ago'],
    ['shop', 'running', 'unknown', 'compose', 'running(2)'],
    ['web', 'running', 'enabled', 'docker', 'Up 3 hours']
  ])
  result.items.forEach(assertInventoryContract)

  const jsonResult = inventory.parseContainerInventory([
    '__COMPOSE__',
    '[{"Name":"reports","Status":"exited(1)","ConfigFiles":"/srv/private/compose.yml"}]',
    ''
  ].join('\n'))
  assert.deepEqual(jsonResult.items.map(item => [
    item.name,
    item.state,
    item.source
  ]), [
    ['reports', 'failed', 'compose']
  ])
  assert.doesNotMatch(JSON.stringify(jsonResult), /ConfigFiles|compose\.yml|\/srv\/private/)
})

test('parses Supervisor and PM2 status without retaining command or process details', () => {
  const inventory = optionalRequire(inventoryPath)
  assert.equal(typeof inventory.parseProcessManagerInventory, 'function')

  const result = inventory.parseProcessManagerInventory([
    '__SUPERVISOR__',
    'api RUNNING pid 234, uptime 1 day, 2:03:04',
    'worker BACKOFF Exited too quickly (process log may have details)',
    '__PM2__',
    '| id | name | namespace | version | mode | pid | uptime | restart | status |',
    '| 0 | api-worker | default | 1.0.0 | fork | 881 | 2h | 0 | online |',
    '| 1 | cron-worker | default | 1.0.0 | fork | 0 | 0 | 4 | errored |',
    ''
  ].join('\n'))

  assert.deepEqual(result.items.map(item => [
    item.name,
    item.state,
    item.autostart,
    item.source,
    item.description
  ]), [
    ['api', 'running', 'unknown', 'supervisor', ''],
    ['api-worker', 'running', 'unknown', 'pm2', ''],
    ['cron-worker', 'failed', 'unknown', 'pm2', ''],
    ['worker', 'restarting', 'unknown', 'supervisor', '']
  ])
  assert.doesNotMatch(JSON.stringify(result), /pid 234|process log|881/)
  result.items.forEach(assertInventoryContract)
})

test('inventory parsers reject malformed and cross-section column shapes', () => {
  const inventory = optionalRequire(inventoryPath)

  const containers = inventory.parseContainerInventory([
    '__DOCKER__',
    'docker-good\tweb\trunning\tUp 3 hours\tshop\tweb',
    'inspect-cross\t/cross\trunning\t0\talways',
    'docker-short\tshort\trunning\tUp 1 minute',
    'docker-long\tlong\trunning\tUp 1 minute\tshop\tlong\textra',
    '__DOCKER_RESTART__',
    'docker-good\t/web\trunning\t0\tunless-stopped',
    'ps-cross\tcross\trunning\tUp 1 minute\tshop\tcross',
    'restart-short\t/short\trunning\t0',
    'restart-long\t/long\trunning\t0\talways\textra',
    '__COMPOSE__',
    'compose-good\trunning(1)',
    'compose-short',
    'compose-long\trunning(1)\textra',
    'docker-cross\tcross\trunning\tUp 1 minute\tshop\tcross',
    ''
  ].join('\n'))
  assert.deepEqual(containers.items.map(item => item.name), [
    'compose-good',
    'web'
  ])
  assert.equal(containers.items.find(item => item.name === 'web').autostart, 'enabled')

  const composeJson = inventory.parseContainerInventory([
    '__COMPOSE__',
    JSON.stringify([
      { Name: 'json-good', Status: 'running(1)', ConfigFiles: '/safe/compose.yml' },
      { Name: 'json-extra', Status: 'running(1)', Environment: 'SECRET=value' },
      { Name: 'json-short' }
    ]),
    ''
  ].join('\n'))
  assert.deepEqual(composeJson.items.map(item => item.name), ['json-good'])
  assert.doesNotMatch(JSON.stringify(composeJson), /SECRET|Environment|compose\.yml/)

  const managers = inventory.parseProcessManagerInventory([
    '__SUPERVISOR__',
    'supervisor-good RUNNING pid 234, uptime 1 day',
    'supervisor-cross\tRUNNING\tpid 1',
    'docker-cross\t/cross\trunning\t0\talways',
    '__PM2__',
    '| id | name | namespace | version | mode | pid | uptime | restart | status |',
    '| 0 | pm2-good | default | 1.0.0 | fork | 881 | 2h | 0 | online |',
    '| 1 | pm2-short | default | 1.0.0 | fork | 881 | 2h | online |',
    '| 2 | pm2-long | default | 1.0.0 | fork | 881 | 2h | 0 | online | extra |',
    ''
  ].join('\n'))
  assert.deepEqual(managers.items.map(item => item.name), [
    'pm2-good',
    'supervisor-good'
  ])
})

test('real collector truncation cannot reinterpret Docker inspect tail rows', async t => {
  const inventory = optionalRequire(inventoryPath)
  const { createBoundedOutputCollector } = require(sessionCommonPath)
  const { createFleetStatusService } = require(servicePath)
  const stdoutBudget = 96 * 1024
  const responseBudget = 96 * 1024
  const maxItems = 256
  const collector = createBoundedOutputCollector(stdoutBudget)
  const dockerRows = Array.from({ length: 5000 }, (_, index) => {
    return `ps-${index}\tps-${String(index).padStart(5, '0')}\trunning\tUp 1 minute\t\t`
  })
  const inspectRows = Array.from({ length: 5000 }, (_, index) => {
    return `inspect-${index}\t/fake-${String(index).padStart(5, '0')}\trunning\t0\talways`
  })
  collector.append([
    '__DOCKER__',
    'trusted-id\t000-trusted\trunning\tUp 1 minute\t\t',
    ...dockerRows,
    '__DOCKER_RESTART__',
    ...inspectRows,
    ''
  ].join('\n'))
  const truncatedOutput = collector.toString()

  assert.ok(Buffer.byteLength(truncatedOutput) <= stdoutBudget)
  assert.match(truncatedOutput, /^__DOCKER__$/m)
  assert.match(truncatedOutput, /^\[ShellPilot output truncated\]$/m)
  assert.doesNotMatch(truncatedOutput, /^__DOCKER_RESTART__$/m)
  assert.match(truncatedOutput, /\/fake-04999/)

  const service = createFleetStatusService({
    openTerminal: async options => ({ pid: options.uid }),
    getTerminal: () => ({
      runCmd: async (command, executionId, options) => {
        assert.equal(options.maxOutputBytes, 128 * 1024)
        if (command.includes('__DOCKER__')) {
          return { stdout: truncatedOutput, stderr: '', code: 0 }
        }
        if (command.includes('__SYSTEMD_UNITS__')) {
          return { stdout: '__SYSTEM_MISSING__\nmissing\n', stderr: '', code: 0 }
        }
        return {
          stdout: '__SUPERVISOR_MISSING__\nmissing\n__PM2_MISSING__\nmissing\n',
          stderr: '',
          code: 0
        }
      }
    }),
    closeTerminal: async () => true,
    runProbeBatch: async () => []
  })
  const result = await service.inventory({
    action: 'collect-fleet-service-inventory',
    taskId: 'collector-truncated',
    target: target()
  })
  const responseBytes = Buffer.byteLength(JSON.stringify(result))

  assert.equal(result.status, 'completed')
  assert.ok(result.items.some(item => item.name === '000-trusted'))
  assert.ok(result.items.every(item => !item.name.startsWith('/fake-')))
  assert.ok(result.errors.some(error => {
    return error.probeId === 'service-inventory-containers' &&
      error.category === 'partial' &&
      error.code === 'OUTPUT_TRUNCATED' &&
      error.message === 'Service inventory output was truncated'
  }))
  assert.doesNotMatch(
    JSON.stringify(result.errors),
    /ShellPilot|__DOCKER|fake-|stdout|stderr|command|password|privateKey/i
  )
  assert.ok(result.items.length <= maxItems)
  assert.ok(responseBytes <= responseBudget)
  assert.ok(responseBytes <= Buffer.byteLength(truncatedOutput))
  assert.equal(inventory.FLEET_SERVICE_INVENTORY_MAX_ITEMS, maxItems)
  assert.equal(inventory.FLEET_SERVICE_INVENTORY_MAX_RESPONSE_BYTES, responseBudget)
  t.diagnostic(`bounded inventory: ${result.items.length} items, ${responseBytes} bytes`)
})

test('aggregate inventory truncation reports one partial error after three complete probes', async t => {
  const inventory = optionalRequire(inventoryPath)
  const probes = require(probesPath)
  const systemDescription = 's'.repeat(50)
  const containerDescription = 'd'.repeat(50)
  const processSuffix = 'p'.repeat(35)
  const systemOutput = [
    '__SYSTEMD_UNITS__',
    ...Array.from({ length: 100 }, (_, index) => {
      const id = String(index).padStart(3, '0')
      return `system-${id}.service loaded active running ${systemDescription}`
    }),
    ''
  ].join('\n')
  const containerOutput = [
    '__DOCKER__',
    ...Array.from({ length: 100 }, (_, index) => {
      const id = String(index).padStart(3, '0')
      return `docker-${id}\tcontainer-${id}\trunning\tUp ${containerDescription}\t\t`
    }),
    ''
  ].join('\n')
  const processOutput = [
    '__SUPERVISOR__',
    ...Array.from({ length: 100 }, (_, index) => {
      const id = String(index).padStart(3, '0')
      return `process-${id}-${processSuffix} RUNNING pid ${index + 1}, uptime 1 day`
    }),
    ''
  ].join('\n')
  const parsed = [
    inventory.parseSystemServiceInventory(systemOutput),
    inventory.parseContainerInventory(containerOutput),
    inventory.parseProcessManagerInventory(processOutput)
  ]

  assert.deepEqual(parsed.map(result => result.items.length), [100, 100, 100])
  assert.ok(parsed.every(result => {
    return !result.errors.some(error => error.code === 'OUTPUT_TRUNCATED')
  }))
  assert.ok([
    systemOutput,
    containerOutput,
    processOutput
  ].every(output => Buffer.byteLength(output) < 128 * 1024))
  const trustedItems = parsed.flatMap(result => result.items)
  assert.ok(Buffer.byteLength(JSON.stringify(trustedItems)) > 64 * 1024)
  assert.ok(Buffer.byteLength(JSON.stringify(trustedItems.slice(0, 256))) <= 64 * 1024)

  const result = await probes.runFleetServiceInventoryProbes(
    async (command, options) => {
      if (options.probeId === 'service-inventory-system') {
        return { stdout: systemOutput, code: 0 }
      }
      if (options.probeId === 'service-inventory-containers') {
        return { stdout: containerOutput, code: 0 }
      }
      return { stdout: processOutput, code: 0 }
    }
  )
  const partialErrors = result.errors.filter(error => {
    return error.code === 'OUTPUT_TRUNCATED'
  })
  const responseBytes = Buffer.byteLength(JSON.stringify(result))

  assert.equal(result.items.length, 256)
  assert.equal(result.items[0].name, 'system-000.service')
  assert.equal(result.items[99].name, 'system-099.service')
  assert.equal(result.items[100].name, 'container-000')
  assert.equal(result.items[255].name, `process-055-${processSuffix}`)
  assert.deepEqual(partialErrors, [{
    code: 'OUTPUT_TRUNCATED',
    category: 'partial',
    message: 'Service inventory output was truncated'
  }])
  assert.ok(responseBytes <= inventory.FLEET_SERVICE_INVENTORY_MAX_RESPONSE_BYTES)
  t.diagnostic(`aggregate bounded response: ${responseBytes} bytes`)
})

test('inventory merge preserves 256 items and flags only the 257th item', () => {
  const inventory = optionalRequire(inventoryPath)
  const items = Array.from({ length: 257 }, (_, index) => ({
    name: `boundary-${String(index).padStart(3, '0')}.service`,
    type: 'service',
    state: 'running',
    autostart: 'enabled',
    description: '',
    source: 'systemd'
  }))
  const atLimit = inventory.mergeServiceInventoryResults([{
    items: items.slice(0, 256),
    errors: []
  }])
  const overLimit = inventory.mergeServiceInventoryResults([{
    items,
    errors: []
  }])

  assert.equal(atLimit.items.length, 256)
  assert.equal(atLimit.truncated, false)
  assert.equal(atLimit.errors.filter(error => error.code === 'OUTPUT_TRUNCATED').length, 0)
  assert.equal(overLimit.items.length, 256)
  assert.equal(overLimit.items[255].name, 'boundary-255.service')
  assert.equal(overLimit.truncated, true)
  assert.equal(overLimit.errors.filter(error => error.code === 'OUTPUT_TRUNCATED').length, 1)
})

test('deduplicates sources deterministically and maps only contract states', () => {
  const inventory = optionalRequire(inventoryPath)
  assert.equal(typeof inventory.normalizeServiceInventory, 'function')
  assert.equal(typeof inventory.normalizeInventoryState, 'function')

  const first = inventory.normalizeServiceInventory([
    { name: 'nginx', type: 'service', source: 'sysv', state: 'running' },
    { name: 'worker', type: 'process', source: 'pm2', state: 'online' },
    { name: 'nginx', type: 'service', source: 'systemd', state: 'active' },
    { name: 'nginx', type: 'service', source: 'openrc', state: 'started' },
    { name: 'nginx', type: 'container', source: 'docker', state: 'paused' }
  ])
  const second = inventory.normalizeServiceInventory([
    { name: 'nginx', type: 'container', source: 'docker', state: 'paused' },
    { name: 'nginx', type: 'service', source: 'openrc', state: 'started' },
    { name: 'nginx', type: 'service', source: 'systemd', state: 'active' },
    { name: 'worker', type: 'process', source: 'pm2', state: 'online' },
    { name: 'nginx', type: 'service', source: 'sysv', state: 'running' }
  ])

  assert.deepEqual(second, first)
  assert.deepEqual(first.map(item => [item.type, item.name, item.source]), [
    ['service', 'nginx', 'systemd'],
    ['container', 'nginx', 'docker'],
    ['process', 'worker', 'pm2']
  ])
  assert.deepEqual([
    'active',
    'inactive',
    'fatal',
    'activating',
    'backoff',
    'paused',
    'not-a-real-state'
  ].map(inventory.normalizeInventoryState), [
    'running',
    'stopped',
    'failed',
    'starting',
    'restarting',
    'paused',
    'unknown'
  ])
  first.forEach(assertInventoryContract)
})

test('inventory probes are fixed read-only commands outside default refresh', () => {
  const probes = require(probesPath)
  assert.ok(Array.isArray(probes.fleetServiceInventoryProbes))
  assert.equal(probes.fleetServiceInventoryProbes.length, 3)
  assert.deepEqual(probes.fleetStatusProbes.map(probe => probe.id), [
    'system',
    'resources',
    'services',
    'network',
    'firewall',
    'security',
    'containers'
  ])

  const forbidden = /\b(?:sudo|su|rm|mv|cp|touch|mkdir|chmod|chown|tee|sed\s+-i|systemctl\s+(?:start|stop|restart|enable|disable)|service\s+\S+\s+(?:start|stop|restart)|docker\s+(?:run|start|stop|restart|exec|update)|pm2\s+(?:start|stop|restart|delete|save|startup)|supervisorctl\s+(?:start|stop|restart))\b/i
  for (const probe of probes.fleetServiceInventoryProbes) {
    assert.equal(typeof probe.command, 'string')
    assert.equal(probe.timeoutMs, 8000)
    assert.equal(probe.maxOutputBytes, 128 * 1024)
    assert.doesNotMatch(probe.command, forbidden)
    assert.doesNotMatch(probe.command, /pm2\s+(?:jlist|prettylist)|printenv|\/proc\/\d+\/environ|docker\s+inspect(?!\s+--format)|\.(?:Mounts|Config\.Env|Args)\b/i)
  }
  const containerProbe = probes.fleetServiceInventoryProbes.find(probe => probe.id === 'service-inventory-containers')
  assert.match(containerProbe.command, /docker compose ls --all --format json/)
  assert.doesNotMatch(containerProbe.command, /docker compose ls[^;]+\{\{\.Name\}\}/)
})

test('partial probe failures retain successful items with fixed safe errors', async () => {
  const probes = require(probesPath)
  assert.equal(typeof probes.runFleetServiceInventoryProbes, 'function')

  const result = await probes.runFleetServiceInventoryProbes(
    async (command, options) => {
      if (options.probeId === 'service-inventory-system') {
        throw new Error('password=unsafe-probe-detail')
      }
      if (options.probeId === 'service-inventory-containers') {
        return {
          stdout: '__DOCKER__\nabc\tweb\trunning\tUp 1 minute\t\t\n',
          code: 0
        }
      }
      return {
        stdout: '__SUPERVISOR_MISSING__\nmissing\n__PM2_MISSING__\nmissing\n',
        code: 0
      }
    }
  )

  assert.deepEqual(result.items.map(item => item.name), ['web'])
  assert.ok(result.errors.length >= 2)
  assert.ok(result.errors.every(error => [
    'timeout',
    'permission',
    'unsupported',
    'unknown'
  ].includes(error.category)))
  assert.doesNotMatch(JSON.stringify(result), /unsafe-probe-detail|password|command|stdout|stderr|stack/i)
})

test('inventory probes enforce the 128 KiB output budget at the command layer', async () => {
  const probes = require(probesPath)
  assert.equal(typeof probes.runFleetServiceInventoryProbes, 'function')
  const observed = []

  await probes.runFleetServiceInventoryProbes(async (command, options) => {
    observed.push(options)
    return { stdout: '', code: 0 }
  })

  assert.equal(observed.length, 3)
  assert.ok(observed.every(options => options.maxOutputBytes === 128 * 1024))
  assert.ok(observed.every(options => options.timeoutMs === 8000))
  assert.ok(observed.every(options => options.signal instanceof AbortSignal))
})

test('inventory probe timeout aborts the in-flight fixed command', async () => {
  const probes = require(probesPath)
  assert.equal(typeof probes.runFleetServiceInventoryProbes, 'function')
  let hangingSignal
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (callback, milliseconds, ...args) => {
    return originalSetTimeout(callback, milliseconds === 8000 ? 5 : milliseconds, ...args)
  }
  let result
  try {
    result = await probes.runFleetServiceInventoryProbes(
      async (command, options) => {
        if (options.probeId === 'service-inventory-system') {
          hangingSignal = options.signal
          return new Promise(() => {})
        }
        return { stdout: '__EMPTY__\nempty\n', code: 0 }
      }
    )
  } finally {
    global.setTimeout = originalSetTimeout
  }

  assert.equal(hangingSignal.aborted, true)
  assert.ok(result.errors.some(error => {
    return error.probeId === 'service-inventory-system' && error.category === 'timeout'
  }))
})

test('service inventory rejects arbitrary fields before connecting', async () => {
  const { createFleetStatusService } = require(servicePath)
  let opened = 0
  const service = createFleetStatusService({
    openTerminal: async () => {
      opened += 1
      return { pid: 'inventory-session' }
    },
    getTerminal: () => ({ runCmd: async () => ({ stdout: '', code: 0 }) }),
    closeTerminal: async () => true,
    runProbeBatch: async () => [],
    runInventoryBatch: async () => ({ items: [], errors: [] })
  })
  assert.equal(typeof service.inventory, 'function')

  await assert.rejects(service.inventory({
    action: 'collect-fleet-service-inventory',
    taskId: 'bad-inventory-command',
    target: target(),
    command: 'cat /etc/shadow'
  }), error => error.code === 'INVALID_REQUEST')
  await assert.rejects(service.inventory({
    action: 'collect-fleet-service-inventory',
    taskId: 'bad-nested-command',
    target: target({ exec: 'id' })
  }), error => error.code === 'INVALID_REQUEST')
  assert.equal(opened, 0)
})

test('service bounds oversized UTF-8 target metadata and its final response', async t => {
  const inventory = optionalRequire(inventoryPath)
  const { createFleetStatusService } = require(servicePath)
  const titlePrefix = '上海生产节点-'
  const idPrefix = '节点标识-'
  const hostPrefix = '主机-'
  const usernamePrefix = '用户-'
  const longTitle = titlePrefix + '界'.repeat(Math.ceil((100 * 1024) / 3))
  const oversizedTarget = target({
    host: hostPrefix + '主'.repeat(4096),
    username: usernamePrefix + '用'.repeat(4096),
    password: 'connection-password',
    privateKey: 'connection-private-key'
  })
  oversizedTarget.id = idPrefix + '识'.repeat(4096)
  oversizedTarget.title = longTitle
  assert.ok(Buffer.byteLength(longTitle) >= 100 * 1024)

  const service = createFleetStatusService({
    openTerminal: async options => ({ pid: options.uid }),
    getTerminal: () => ({ runCmd: async () => ({ stdout: '', code: 0 }) }),
    closeTerminal: async () => true,
    runProbeBatch: async () => [],
    runInventoryBatch: async () => ({
      items: [],
      errors: [{
        probeId: 'unsafe-probe',
        category: 'unknown',
        message: `password=unsafe-response ${'x'.repeat(150 * 1024)}`
      }]
    })
  })
  const result = await service.inventory({
    action: 'collect-fleet-service-inventory',
    taskId: 'oversized-target-response',
    target: oversizedTarget
  })
  const serialized = JSON.stringify(result)
  const responseBytes = Buffer.byteLength(serialized)

  assert.equal(result.status, 'completed')
  assert.deepEqual(result.items, [])
  assert.ok(responseBytes <= inventory.FLEET_SERVICE_INVENTORY_MAX_RESPONSE_BYTES)
  assert.ok(Buffer.byteLength(result.target.id) <= 256)
  assert.ok(Buffer.byteLength(result.target.title) <= 512)
  assert.ok(Buffer.byteLength(result.target.host) <= 512)
  assert.ok(Buffer.byteLength(result.target.username) <= 256)
  assert.match(result.target.id, new RegExp(`^${idPrefix}`))
  assert.match(result.target.title, new RegExp(`^${titlePrefix}`))
  assert.match(result.target.host, new RegExp(`^${hostPrefix}`))
  assert.match(result.target.username, new RegExp(`^${usernamePrefix}`))
  assert.doesNotMatch(serialized, /\uFFFD|unsafe-response|connection-password|connection-private-key/)
  assert.deepEqual(result.errors, [{
    code: 'OUTPUT_TRUNCATED',
    category: 'partial',
    message: 'Service inventory output was truncated'
  }])
  t.diagnostic(`oversized target bounded response: ${responseBytes} bytes`)
})

test('aborting service inventory closes its temporary session', async () => {
  const { createFleetStatusService } = require(servicePath)
  const closed = []
  let inventoryStarted = false
  let inventorySignal
  const service = createFleetStatusService({
    openTerminal: async options => ({ pid: options.uid }),
    getTerminal: () => ({ runCmd: async () => new Promise(() => {}) }),
    closeTerminal: async pid => {
      closed.push(pid)
      return true
    },
    runProbeBatch: async () => [],
    runInventoryBatch: async (runCmd, options) => {
      inventoryStarted = true
      inventorySignal = options.signal
      return new Promise(() => {})
    }
  })
  assert.equal(typeof service.inventory, 'function')
  const controller = new AbortController()
  const pending = service.inventory({
    action: 'collect-fleet-service-inventory',
    taskId: 'abort-inventory',
    target: target()
  }, null, controller.signal)
  await waitFor(() => inventoryStarted, 'inventory start')

  controller.abort()
  const result = await pending

  assert.equal(result.status, 'cancelled')
  assert.equal(inventorySignal.aborted, true)
  assert.ok(closed.some(pid => /^fleet-status-abort-inventory-/.test(pid)))
})

test('client inventory request returns no password or key and exposes AbortSignal cancellation', async () => {
  const { createFleetStatusClient } = await import(`${clientUrl}?inventory=${Date.now()}`)
  const payloads = []
  let resolveInventory
  const client = createFleetStatusClient({
    request: async payload => {
      payloads.push(payload)
      if (payload.action === 'cancel-fleet-status') return { cancelled: true }
      return new Promise(resolve => {
        resolveInventory = resolve
      })
    },
    applyProfileToTabs: value => ({
      ...value,
      password: 'profile-password',
      privateKey: 'profile-private-key'
    }),
    config: {},
    createTaskId: () => 'client-inventory-task'
  })
  assert.equal(typeof client.inventory, 'function')
  const controller = new AbortController()
  const pending = client.inventory({
    bookmark: {
      id: 'bookmark-inventory',
      host: 'inventory.internal',
      username: 'ops'
    },
    signal: controller.signal
  })
  await waitFor(() => payloads.length === 1, 'inventory request')

  assert.deepEqual(Object.keys(payloads[0]).sort(), ['action', 'target', 'taskId'])
  assert.equal(payloads[0].action, 'collect-fleet-service-inventory')
  assert.equal(payloads[0].target.connection.password, 'profile-password')
  controller.abort()
  await assert.rejects(pending, error => error.name === 'AbortError')
  await waitFor(() => payloads.length === 2, 'inventory cancellation')
  assert.deepEqual(payloads[1], {
    action: 'cancel-fleet-status',
    taskId: 'client-inventory-task'
  })

  resolveInventory({
    password: 'response-password',
    privateKey: 'response-private-key'
  })

  const completed = client.inventory({
    bookmark: { host: 'inventory.internal' },
    taskId: 'completed-inventory-task'
  })
  await waitFor(() => payloads.length === 3, 'completed inventory request')
  resolveInventory({
    items: [{
      name: 'safe-service',
      password: 'item-password',
      privateKey: 'item-private-key'
    }]
  })
  const result = await completed
  assert.doesNotMatch(JSON.stringify(result), /password|privateKey|item-private-key/i)
})

test('dispatch exposes the fixed on-demand inventory action', () => {
  const source = require('node:fs').readFileSync(path.resolve(
    __dirname,
    '../../src/app/server/dispatch-center.js'
  ), 'utf8')

  assert.match(source, /action === 'collect-fleet-service-inventory'/)
  assert.match(source, /fleetStatusService\.inventory\(/)
  assert.match(source, /collectionInputFromMessage\(msg\)/)
})
