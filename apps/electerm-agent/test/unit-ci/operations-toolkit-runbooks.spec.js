const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const expectedIds = [
  'runbook.health.baseline',
  'runbook.cpu.incident',
  'runbook.memory.oom',
  'runbook.storage.capacity-io',
  'runbook.web.gateway',
  'runbook.container.runtime',
  'runbook.network.intermittent',
  'runbook.security.ssh-audit',
  'runbook.service.incident',
  'runbook.compatibility.domestic-linux'
]

test('runbook catalog exposes ten multi-step read-only workflows', async () => {
  const { operationsToolTypes } = await importModule(
    'src/client/components/operations-toolkit/shared/definition.js'
  )
  const { getOperationsRunbooks } = await importModule(
    'src/client/components/operations-toolkit/catalog/scripts/index.js'
  )
  const runbooks = getOperationsRunbooks()

  assert.equal(operationsToolTypes.script, 'script')
  assert.deepEqual(
    runbooks.map(item => item.id).sort(),
    [...expectedIds].sort()
  )
  assert.equal(new Set(runbooks.map(item => item.id)).size, runbooks.length)
  for (const runbook of runbooks) {
    assert.equal(runbook.type, 'script', `${runbook.id} should use script type`)
    assert.equal(runbook.risk, 'read-only', `${runbook.id} should stay read-only`)
    assert.ok(runbook.steps.length >= 3, `${runbook.id} should be multi-step`)
    assert.ok(runbook.description.length >= 8)
  }
})

test('runbooks reject unsafe parameters and only build read-only commands', async () => {
  const { getOperationsRunbooks } = await importModule(
    'src/client/components/operations-toolkit/catalog/scripts/index.js'
  )
  const runbooks = getOperationsRunbooks()
  const capabilities = {
    services: [
      { name: 'nginx.service' },
      { name: 'docker.service' }
    ],
    interfaces: [
      { name: 'eth0', state: 'UP', cidr: '192.0.2.10/24' }
    ]
  }
  const dangerous = /\b(?:rm|mv|cp|install|remove|erase|reboot|shutdown|poweroff|halt|chmod|chown)\b|systemctl\s+(?:start|stop|restart|reload|enable|disable)|docker\s+(?:start|stop|restart|rm)|sed\s+-i|(?:^|[;&|])\s*>\s*/

  for (const runbook of runbooks) {
    for (const step of runbook.steps) {
      const command = typeof step.buildCommand === 'function'
        ? step.buildCommand({}, capabilities)
        : step.command
      assert.doesNotMatch(command, dangerous, `${runbook.id}/${step.id} mutates state`)
    }
  }

  const network = runbooks.find(item => item.id === 'runbook.network.intermittent')
  const networkStep = network.steps.find(item => item.buildCommand)
  assert.throws(
    () => networkStep.buildCommand({ host: 'example.com; touch /tmp/pwned' }, capabilities),
    /格式无效/
  )

  const service = runbooks.find(item => item.id === 'runbook.service.incident')
  const serviceStep = service.steps.find(item => item.buildCommand)
  assert.throws(
    () => serviceStep.buildCommand({ services: ['unknown.service'] }, capabilities),
    /只能选择/
  )

  const containers = runbooks.find(item => item.id === 'runbook.container.runtime')
  const eventStep = containers.steps.find(item => item.id === 'events')
  assert.match(eventStep.command, /podman events --since 2h --until 0s/)
})

test('runbooks remain separate from diagnostics and safe maintenance', async () => {
  const { getOperationsCatalog } = await importModule(
    'src/client/components/operations-toolkit/catalog/index.js'
  )
  const { getSafeMaintenanceCommands } = await importModule(
    'src/client/components/operations-toolkit/catalog/maintenance.js'
  )
  const catalog = getOperationsCatalog()
  const scripts = catalog.filter(item => item.type === 'script')
  const diagnostics = catalog.filter(item => item.type === 'diagnostic')

  assert.equal(scripts.length, 10)
  assert.ok(diagnostics.length > 0)
  assert.deepEqual(getSafeMaintenanceCommands(scripts), [])
})

test('runbook executes every step, persists history, and produces AI context', async () => {
  const { getOperationsRunbooks } = await importModule(
    'src/client/components/operations-toolkit/catalog/scripts/index.js'
  )
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const { buildOperationsAIContext } = await importModule(
    'src/client/components/operations-toolkit/shared/ai-context.js'
  )
  const saved = []
  const scripts = []
  const tool = getOperationsRunbooks().find(item => (
    item.id === 'runbook.health.baseline'
  ))
  const runner = createOperationsTaskRunner({
    channel: {
      execute: async ({ script, onChunk }) => {
        scripts.push(script)
        onChunk(`result:${scripts.length}`)
        return { exitCode: 0 }
      }
    },
    discover: async () => ({
      services: [],
      interfaces: [{ name: 'eth0', state: 'UP' }]
    }),
    taskStore: {
      save: task => saved.push(task)
    }
  })
  const active = runner.run({
    tool,
    params: {},
    endpoint: {
      tabId: 'tab-runbook',
      pid: 42,
      host: 'server.example',
      port: 22,
      username: 'root'
    }
  })
  const completed = await active.completion
  const context = buildOperationsAIContext({
    tool,
    task: completed,
    maxCharacters: 4000
  })

  assert.equal(completed.status, 'completed')
  assert.equal(completed.steps.length, tool.steps.length)
  assert.ok(completed.steps.every(step => step.status === 'completed'))
  assert.equal(scripts.length, tool.steps.length)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].id, completed.id)
  assert.match(context, /服务器综合健康巡检/)
  assert.match(context, /result:1/)
  assert.match(context, /不要假设已执行任何修复/)
})
