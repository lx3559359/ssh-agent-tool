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
  assert.deepEqual(statuses, ['created', 'discovering', 'running', 'running', 'completed'])
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
    /仅允许只读工具/
  )
})
