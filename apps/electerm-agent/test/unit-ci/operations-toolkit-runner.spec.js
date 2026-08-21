const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const endpoint = {
  tabId: 'tab-1',
  pid: 88,
  host: 'example.com',
  port: 22,
  username: 'root'
}
const tool = {
  id: 'system.overview',
  title: '系统运行概览',
  type: 'diagnostic',
  category: 'system',
  risk: 'read-only',
  steps: [
    { id: 'uptime', command: 'uptime', timeoutMs: 1000 }
  ]
}

const sensitiveTool = {
  ...tool,
  id: 'network.packet-capture',
  risk: 'resource-sensitive',
  requiresConfirmation: true
}

async function confirmationFor (params = {}, nonce = 'capture-confirmation') {
  const { createOperationsResourceConfirmation } = await importModule(
    'src/client/components/operations-toolkit/shared/resource-confirmation.js'
  )
  return createOperationsResourceConfirmation({
    toolId: sensitiveTool.id,
    endpointKey: 'root@example.com:22',
    params,
    createNonce: () => nonce
  })
}

test('runner completes readonly task and releases endpoint slot', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const statuses = []
  const runner = createOperationsTaskRunner({
    channel: {
      execute: async ({ onChunk }) => {
        onChunk('up 10 days')
        return { exitCode: 0 }
      }
    },
    discover: async () => ({ tools: ['uptime'] }),
    onTaskChange: task => statuses.push(task.status)
  })
  const running = runner.run({ tool, endpoint, params: {} })
  const completed = await running.completion
  assert.equal(completed.status, 'completed')
  assert.equal(completed.steps[0].output, 'up 10 days')
  assert.equal(runner.getActiveCount('root@example.com:22'), 0)
  assert.deepEqual(statuses.slice(0, 3), ['created', 'discovering', 'running'])
  assert.ok(statuses.filter(status => status === 'running').length >= 2)
  assert.equal(statuses.at(-1), 'completed')
})

test('runner releases endpoint slot after cancellation', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const runner = createOperationsTaskRunner({
    channel: {
      execute: ({ signal }) => {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('cancelled')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        })
      }
    },
    discover: async () => ({ tools: [] }),
    maxReadonlyPerEndpoint: 1
  })
  const first = runner.run({ tool, endpoint, params: {} })
  await runner.cancel(first.taskId)
  assert.equal(runner.get(first.taskId).status, 'cancelled')
  const next = runner.run({ tool, endpoint, params: {} })
  await runner.cancel(next.taskId)
  assert.equal((await next.completion).status, 'cancelled')
  assert.equal(runner.getActiveCount('root@example.com:22'), 0)
})

test('runner rejects invalid endpoint and non-readonly tool', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const runner = createOperationsTaskRunner({
    channel: { execute: async () => ({ exitCode: 0 }) },
    discover: async () => ({})
  })
  assert.throws(
    () => runner.run({ tool, endpoint: { ...endpoint, pid: '' } }),
    /端点信息不完整/
  )
  assert.throws(
    () => runner.run({
      tool: { ...tool, risk: 'reversible-change' },
      endpoint
    }),
    /只读或资源敏感/
  )
})

test('runner requires and consumes a matching sensitive confirmation', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const runner = createOperationsTaskRunner({
    channel: { execute: async () => ({ exitCode: 0 }) },
    discover: async () => ({})
  })
  assert.throws(
    () => runner.run({ tool: sensitiveTool, endpoint, params: {} }),
    /确认/
  )
  const confirmation = await confirmationFor()
  const completed = await runner.run({
    tool: sensitiveTool,
    endpoint,
    params: {},
    confirmation
  }).completion
  assert.equal(completed.status, 'completed')
  assert.throws(
    () => runner.run({
      tool: sensitiveTool,
      endpoint,
      params: {},
      confirmation
    }),
    /已经使用/
  )
})

test('runner permits only one sensitive task per endpoint', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const runner = createOperationsTaskRunner({
    channel: {
      execute: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    },
    discover: async () => ({})
  })
  const first = runner.run({
    tool: sensitiveTool,
    endpoint,
    confirmation: await confirmationFor({}, 'capture-1')
  })
  const secondConfirmation = await confirmationFor({}, 'capture-2')
  assert.throws(() => runner.run({
    tool: sensitiveTool,
    endpoint,
    confirmation: secondConfirmation
  }), /资源敏感任务/)
  await runner.cancel(first.taskId)
  assert.equal(runner.getSensitiveActiveCount('root@example.com:22'), 0)
})

test('runner releases sensitive slot when synchronous task setup fails', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const runner = createOperationsTaskRunner({
    channel: { execute: async () => ({ exitCode: 0 }) },
    discover: async () => ({}),
    createTaskId: () => { throw new Error('task setup failed') }
  })
  const confirmation = await confirmationFor({}, 'capture-setup-failure')

  assert.throws(() => runner.run({
    tool: sensitiveTool,
    endpoint,
    confirmation
  }), /task setup failed/)
  assert.equal(runner.getSensitiveActiveCount('root@example.com:22'), 0)
})
