const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const registryUrl = pathToFileURL(path.join(aiRoot, 'agent-task-registry.js')).href
const controllerUrl = pathToFileURL(path.join(aiRoot, 'agent-task-controller.js')).href

function clone (value) {
  return value === undefined ? undefined : structuredClone(value)
}

function createTaskStore (initial = []) {
  const records = new Map(initial.map(item => [item.id, clone(item)]))
  const transitions = []
  let sequence = 0
  return {
    records,
    transitions,
    async saveTask (value) {
      const saved = clone({ ...value, id: value.id || `diagnostic-${++sequence}` })
      records.set(saved.id, saved)
      transitions.push(saved.status)
      return clone(saved)
    },
    async getTask (id) {
      return clone(records.get(String(id)))
    },
    async listTasks () {
      return [...records.values()].map(clone)
    },
    async patchTask (id, patch) {
      const current = records.get(String(id))
      if (!current) throw new Error(`missing task: ${id}`)
      const next = { ...current, ...clone(patch) }
      records.set(String(id), next)
      transitions.push(next.status)
      return clone(next)
    }
  }
}

function endpoint (overrides = {}) {
  return {
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    tabId: 'tab-1',
    pid: 1001,
    ...overrides
  }
}

function diagnosticPlan (overrides = {}) {
  return {
    summary: 'Nginx 异常只读诊断',
    source: 'server-status',
    endpoint: endpoint(),
    endpointKey: 'root@prod.example.com:22',
    steps: [
      {
        id: 'status',
        title: '服务状态',
        purpose: '确认失败状态',
        command: '/usr/bin/systemctl status nginx.service --no-pager',
        timeoutMs: 15000,
        risk: 'readonly',
        readOnly: true
      },
      {
        id: 'logs',
        title: '近期日志',
        purpose: '读取失败证据',
        command: '/usr/bin/journalctl -u nginx.service -n 50 --no-pager',
        timeoutMs: 15000,
        risk: 'readonly',
        readOnly: true
      }
    ],
    expectedSignals: ['服务退出码和错误日志'],
    stopConditions: ['端点变化、超时或命令失败'],
    target: { type: 'service', name: 'nginx.service', status: 'failed' },
    ...overrides
  }
}

async function waitFor (predicate) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const value = predicate()
    if (value) return value
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('timed out waiting for test condition')
}

test('diagnostic controller creates confirms and runs only after explicit confirmation', async () => {
  const { createAgentTaskRegistry } = await import(registryUrl)
  const { createAgentTaskController } = await import(controllerUrl)
  const store = createTaskStore()
  const registry = createAgentTaskRegistry()
  const remoteCalls = []
  const taskChanges = []
  const registryVisibility = []
  let endpointChecks = 0
  const controller = createAgentTaskController({
    store,
    registry,
    pid: 1001,
    endpoint: endpoint(),
    getCurrentEndpoint: async () => {
      endpointChecks += 1
      return endpoint()
    },
    runCmd: async (pid, command, options) => {
      remoteCalls.push({ pid, command, options })
      return { stdout: `evidence for ${command}`, code: 0 }
    },
    cancelRunCmd: async () => true,
    onTaskChange: task => {
      taskChanges.push(task.status)
      registryVisibility.push(registry.has(task.id))
    }
  })

  assert.equal(store.records.size, 0)
  assert.equal(remoteCalls.length, 0)

  const completed = await controller.confirmAndRun(diagnosticPlan())

  assert.equal(completed.status, 'completed')
  assert.deepEqual(remoteCalls.map(call => call.command), [
    '/usr/bin/systemctl status nginx.service --no-pager',
    '/usr/bin/journalctl -u nginx.service -n 50 --no-pager'
  ])
  assert.equal(remoteCalls.every(call => call.pid === 1001), true)
  assert.equal(remoteCalls.every(call => call.options.executionId), true)
  assert.equal(endpointChecks, 3)
  assert.deepEqual(taskChanges, [
    'awaiting-plan-confirmation',
    'awaiting-plan-confirmation',
    'awaiting-plan-confirmation',
    'completed'
  ])
  assert.deepEqual(registryVisibility, [false, false, true, true])
  assert.deepEqual(store.transitions.slice(0, 4), [
    'draft',
    'awaiting-plan-confirmation',
    'awaiting-plan-confirmation',
    'running-readonly'
  ])
  assert.equal(registry.size, 0)
})

test('registry cancellation reaches cancelRunCmd with the active execution id after UI unmount', async () => {
  const { createAgentTaskRegistry } = await import(registryUrl)
  const { createAgentTaskController } = await import(controllerUrl)
  const store = createTaskStore()
  const registry = createAgentTaskRegistry()
  const cancelCalls = []
  let remoteStarted = false
  const controller = createAgentTaskController({
    store,
    registry,
    pid: 1001,
    endpoint: endpoint(),
    getCurrentEndpoint: async () => endpoint(),
    runCmd: async () => {
      remoteStarted = true
      return new Promise(() => {})
    },
    cancelRunCmd: async (pid, executionId) => {
      cancelCalls.push({ pid, executionId })
      return true
    }
  })
  const running = controller.confirmAndRun(diagnosticPlan({
    steps: [diagnosticPlan().steps[0]]
  }))
  const entry = await waitFor(() => registry.list()[0])
  await waitFor(() => remoteStarted && entry.taskId && registry.canCancel({
    id: entry.taskId,
    recordType: 'task',
    status: 'running-readonly',
    endpoint: endpoint()
  }))

  const cancelled = await registry.cancel(entry.taskId)
  const finalTask = await running

  assert.equal(cancelled.status, 'cancelled')
  assert.equal(finalTask.status, 'cancelled')
  assert.equal(cancelCalls.length, 1)
  assert.equal(cancelCalls[0].pid, 1001)
  assert.match(cancelCalls[0].executionId, new RegExp(`^${entry.taskId}-readonly-`))
  assert.equal(registry.size, 0)
})

test('task registry isolates concurrent tasks and only allows the same running endpoint', async () => {
  const { createAgentTaskRegistry } = await import(registryUrl)
  const registry = createAgentTaskRegistry()
  const calls = []
  const firstAbort = new AbortController()
  const secondAbort = new AbortController()
  registry.register({
    taskId: 'task-a',
    runner: {
      cancel: async id => {
        calls.push(['a', id])
        return { id, status: 'cancelled' }
      }
    },
    controller: firstAbort,
    pid: 1001,
    endpoint: endpoint()
  })
  registry.register({
    taskId: 'task-b',
    runner: {
      cancel: async id => {
        calls.push(['b', id])
        return { id, status: 'cancelled' }
      }
    },
    controller: secondAbort,
    pid: 2002,
    endpoint: endpoint({ tabId: 'tab-2', pid: 2002 })
  })

  assert.equal(registry.canCancel({
    id: 'task-a',
    status: 'running-readonly',
    endpoint: endpoint()
  }), true)
  assert.equal(registry.canCancel({
    id: 'task-a',
    status: 'running-change',
    endpoint: endpoint()
  }), true)
  assert.equal(registry.canCancel({
    id: 'task-a',
    status: 'running-readonly',
    endpoint: endpoint({ host: 'other.example.com' })
  }), false)
  assert.equal(registry.canCancel({
    id: 'task-a',
    status: 'completed',
    endpoint: endpoint()
  }), false)

  await registry.cancel('task-a')

  assert.deepEqual(calls, [['a', 'task-a']])
  assert.equal(firstAbort.signal.aborted, true)
  assert.equal(secondAbort.signal.aborted, false)
  assert.equal(registry.has('task-a'), false)
  assert.equal(registry.has('task-b'), true)
})

test('safety center capability is backed by the task registry', async () => {
  const {
    createAgentTaskRegistry,
    installSafetyTaskCapability
  } = await import(registryUrl)
  const registry = createAgentTaskRegistry()
  const store = {}
  const calls = []
  registry.register({
    taskId: 'task-capability',
    runner: {
      cancel: async id => {
        calls.push(id)
        return { id, status: 'cancelled' }
      }
    },
    controller: new AbortController(),
    pid: 1001,
    endpoint: endpoint()
  })
  const capability = installSafetyTaskCapability(store, registry)
  const task = {
    id: 'task-capability',
    recordType: 'task',
    status: 'running-readonly',
    endpoint: endpoint()
  }

  assert.equal(store.safetyTaskCapability, capability)
  assert.equal(capability.canCancel(task), true)
  assert.equal((await capability.cancel(task.id)).status, 'cancelled')
  assert.deepEqual(calls, ['task-capability'])
  assert.equal(capability.canCancel(task), false)
})

test('restart recovery marks orphaned running tasks failed without touching live registry entries', async () => {
  const {
    createAgentTaskRegistry,
    recoverOrphanedAgentTasks
  } = await import(registryUrl)
  const runningBase = {
    source: 'server-status',
    status: 'running-readonly',
    endpoint: endpoint(),
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z'
  }
  const store = createTaskStore([
    {
      ...runningBase,
      id: 'orphan-empty',
      steps: [{ id: 'running', status: 'running' }]
    },
    {
      ...runningBase,
      id: 'orphan-partial',
      steps: [
        { id: 'done', status: 'completed' },
        { id: 'running', status: 'running' }
      ]
    },
    {
      ...runningBase,
      id: 'still-live',
      steps: [{ id: 'running', status: 'running' }]
    },
    {
      ...runningBase,
      id: 'foreign-running',
      source: 'agent',
      steps: [{ id: 'running', status: 'running' }]
    }
  ])
  const registry = createAgentTaskRegistry()
  registry.register({
    taskId: 'still-live',
    runner: { cancel: async () => ({ status: 'cancelled' }) },
    controller: new AbortController(),
    endpoint: endpoint(),
    pid: 1001
  })

  const recovered = await recoverOrphanedAgentTasks({ store, registry })
  const empty = await store.getTask('orphan-empty')
  const partial = await store.getTask('orphan-partial')
  const live = await store.getTask('still-live')
  const foreign = await store.getTask('foreign-running')

  assert.deepEqual(recovered.map(task => task.id).sort(), ['orphan-empty', 'orphan-partial'])
  assert.equal(empty.status, 'failed')
  assert.equal(empty.steps[0].status, 'failed')
  assert.match(empty.error, /任务已中断.*执行器不可用/)
  assert.equal(partial.status, 'partially-completed')
  assert.equal(partial.steps[0].status, 'completed')
  assert.equal(partial.steps[1].status, 'failed')
  assert.equal(live.status, 'running-readonly')
  assert.equal(foreign.status, 'running-readonly')
})

test('AI plan request uses the selected profile and truly stops an active stream', async () => {
  const { requestDiagnosticPlanText } = await import(controllerUrl)
  const calls = []
  let pollStarted = false
  const abort = new AbortController()
  const request = requestDiagnosticPlanText({
    prompt: 'target-only-prompt',
    config: {
      modelAI: 'selected-model',
      roleAI: 'SSH 运维专家',
      baseURLAI: 'https://relay.example.com',
      apiPathAI: '/v1/chat/completions',
      apiKeyAI: 'selected-key',
      proxyAI: '',
      authHeaderNameAI: 'X-API-Key'
    },
    signal: abort.signal,
    pollIntervalMs: 0,
    runGlobalAsync: async (...args) => {
      calls.push(args)
      if (args[0] === 'AIchat') {
        return { isStream: true, sessionId: 'diagnostic-stream', content: '' }
      }
      if (args[0] === 'getStreamContent') {
        pollStarted = true
        return new Promise(() => {})
      }
      if (args[0] === 'stopStream') return true
      throw new Error(`unexpected action: ${args[0]}`)
    }
  })
  await waitFor(() => pollStarted)

  abort.abort()

  await assert.rejects(request, /已取消/)
  assert.equal(calls[0][0], 'AIchat')
  assert.equal(calls[0][1], 'target-only-prompt')
  assert.equal(calls[0][2], 'selected-model')
  assert.equal(calls[0][6], 'selected-key')
  assert.equal(calls[0][8], true)
  assert.equal(calls[0][9], 'X-API-Key')
  assert.deepEqual(calls.at(-1), ['stopStream', 'diagnostic-stream'])
})

test('AI plan request fails closed with Chinese redacted configuration and response errors', async () => {
  const { requestDiagnosticPlanText } = await import(controllerUrl)
  let calls = 0
  await assert.rejects(
    requestDiagnosticPlanText({
      prompt: 'target-only-prompt',
      config: {},
      runGlobalAsync: async () => { calls += 1 }
    }),
    /请先配置|未配置/
  )
  assert.equal(calls, 0)

  const config = {
    baseURLAI: 'https://relay.example.com',
    apiKeyAI: 'selected-key'
  }
  await assert.rejects(
    requestDiagnosticPlanText({
      prompt: 'target-only-prompt',
      config,
      runGlobalAsync: async () => ({ error: '401 selected-key token=backend-secret' })
    }),
    error => /AI.*失败|请求失败/.test(error.message) &&
      /\[REDACTED\]/.test(error.message) &&
      !/backend-secret|selected-key/.test(error.message)
  )
  await assert.rejects(
    requestDiagnosticPlanText({
      prompt: 'target-only-prompt',
      config,
      runGlobalAsync: async () => ({})
    }),
    /未返回|为空/
  )
})
