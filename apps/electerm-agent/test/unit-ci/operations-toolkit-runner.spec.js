const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const endpoint = {
  tabId: 'tab-1',
  pid: 88,
  terminalPid: 88,
  sessionType: 'ssh',
  host: 'example.com',
  port: 22,
  username: 'hik',
  connectionUsername: 'hik',
  hostKeyFingerprint: 'SHA256:fixture'
}
const rootIdentity = Object.freeze({ uid: '0', username: 'root' })

function createLeaseChannel (execute, options = {}) {
  return {
    acquire: async () => {
      options.events?.push('acquire')
      return {
        execute,
        release: async () => {
          options.events?.push('release')
          return options.releaseResult ?? true
        }
      }
    }
  }
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
    endpointKey: 'hik@example.com:22',
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
    channel: createLeaseChannel(
      async ({ onChunk }) => {
        onChunk('up 10 days')
        return { exitCode: 0, identity: rootIdentity }
      }
    ),
    discover: async () => ({ tools: ['uptime'] }),
    onTaskChange: task => statuses.push(task.status)
  })
  const running = runner.run({ tool, endpoint, params: {} })
  const completed = await running.completion
  assert.equal(completed.status, 'completed')
  assert.equal(completed.steps[0].output, 'up 10 days')
  assert.equal(runner.getActiveCount('hik@example.com:22'), 0)
  assert.deepEqual(statuses.slice(0, 3), ['created', 'discovering', 'running'])
  assert.ok(statuses.filter(status => status === 'running').length >= 2)
  assert.equal(statuses.at(-1), 'completed')
})

test('runner releases endpoint slot after cancellation', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const events = []
  const runner = createOperationsTaskRunner({
    channel: createLeaseChannel(
      ({ signal }) => {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('cancelled')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        })
      },
      { events }
    ),
    discover: async () => ({ tools: [] }),
    maxReadonlyPerEndpoint: 1
  })
  const first = runner.run({ tool, endpoint, params: {} })
  const firstCancelled = await runner.cancel(first.taskId)
  assert.equal(firstCancelled.status, 'cancelled')
  assert.equal(runner.get(first.taskId).status, 'cancelled')
  const next = runner.run({ tool, endpoint, params: {} })
  await runner.cancel(next.taskId)
  assert.equal((await next.completion).status, 'cancelled')
  assert.equal(runner.getActiveCount('hik@example.com:22'), 0)
  assert.deepEqual(events, ['acquire', 'release', 'acquire', 'release'])
})

test('runner rejects invalid endpoint and non-readonly tool', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const runner = createOperationsTaskRunner({
    channel: createLeaseChannel(async () => ({
      exitCode: 0,
      identity: rootIdentity
    })),
    discover: async () => ({})
  })
  assert.throws(
    () => createOperationsTaskRunner({
      channel: { execute: async () => ({ exitCode: 0 }) }
    }),
    /执行通道不可用/
  )
  assert.throws(
    () => runner.run({ tool, endpoint: { ...endpoint, pid: '' } }),
    /端点信息不完整/
  )
  assert.throws(
    () => runner.run({ tool, endpoint: { ...endpoint, port: 'invalid' } }),
    /端口无效/
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
    channel: createLeaseChannel(async () => ({
      exitCode: 0,
      identity: rootIdentity
    })),
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
    channel: createLeaseChannel(
      ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    ),
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
  assert.equal(runner.getSensitiveActiveCount('hik@example.com:22'), 0)
})

test('runner releases sensitive slot when synchronous task setup fails', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const runner = createOperationsTaskRunner({
    channel: createLeaseChannel(async () => ({
      exitCode: 0,
      identity: rootIdentity
    })),
    discover: async () => ({}),
    createTaskId: () => { throw new Error('task setup failed') }
  })
  const confirmation = await confirmationFor({}, 'capture-setup-failure')

  assert.throws(() => runner.run({
    tool: sensitiveTool,
    endpoint,
    confirmation
  }), /task setup failed/)
  assert.equal(runner.getSensitiveActiveCount('hik@example.com:22'), 0)
})

test('runner keeps one PTY lease across discovery and every step and stores both identities', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const events = []
  const twoStepTool = {
    ...tool,
    steps: [
      { id: 'one', command: 'printf one' },
      { id: 'two', command: 'printf two' }
    ]
  }
  const lease = {
    execute: async ({ script, onChunk }) => {
      events.push(`execute:${script}`)
      onChunk?.(script.includes('discover') ? 'capabilities' : 'root output')
      return { exitCode: 0, identity: rootIdentity }
    },
    release: async () => {
      events.push('release')
      return true
    }
  }
  const runner = createOperationsTaskRunner({
    channel: {
      acquire: async ({ taskId }) => {
        events.push(`acquire:${taskId}`)
        return lease
      }
    },
    createTaskId: () => 'operations-1',
    discover: async (_endpoint, context) => {
      const result = await context.execute({
        script: 'discover capabilities',
        onChunk: () => {}
      })
      context.onIdentity(result.identity)
      return { tools: ['id'] }
    }
  })

  const completed = await runner.run({
    tool: twoStepTool,
    endpoint
  }).completion

  assert.deepEqual(events, [
    'acquire:operations-1',
    'execute:discover capabilities',
    'execute:printf one',
    'execute:printf two',
    'release'
  ])
  assert.equal(completed.endpoint.username, 'hik')
  assert.equal(completed.endpoint.connectionUsername, 'hik')
  assert.deepEqual(completed.runtimeIdentity, {
    channel: 'pty',
    effectiveUid: '0',
    effectiveUsername: 'root'
  })
})

test('runner releases its PTY lease once after discovery and step failures', async t => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const cases = [
    {
      name: 'discovery failure',
      discover: async () => { throw new Error('discover failed') },
      execute: async () => ({ exitCode: 0, identity: rootIdentity })
    },
    {
      name: 'step exception',
      discover: async () => ({}),
      execute: async () => { throw new Error('step failed') }
    },
    {
      name: 'step nonzero exit',
      discover: async () => ({}),
      execute: async () => ({ exitCode: 7, identity: rootIdentity })
    }
  ]

  for (const item of cases) {
    await t.test(item.name, async () => {
      const events = []
      const runner = createOperationsTaskRunner({
        channel: createLeaseChannel(item.execute, { events }),
        discover: item.discover
      })
      const completed = await runner.run({ tool, endpoint }).completion
      assert.equal(['failed', 'partially-completed'].includes(completed.status), true)
      assert.deepEqual(events, ['acquire', 'release'])
    })
  }
})

test('runner fails if a later PTY step reports a different effective identity', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  let execution = 0
  const runner = createOperationsTaskRunner({
    channel: createLeaseChannel(async () => {
      execution += 1
      return {
        exitCode: 0,
        identity: execution === 1
          ? rootIdentity
          : { uid: '1000', username: 'hik' }
      }
    }),
    discover: async () => ({}),
    onTaskChange: () => {}
  })
  const changed = await runner.run({
    tool: {
      ...tool,
      steps: [
        { id: 'one', command: 'id' },
        { id: 'two', command: 'id' }
      ]
    },
    endpoint
  }).completion

  assert.equal(changed.status, 'failed')
  assert.match(changed.error, /有效身份.*变化/)
  assert.equal(changed.runtimeIdentity.effectiveUsername, 'root')
})

test('cancellation unknown remains final and records an unreleased terminal lease', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  const events = []
  let signalExecutionStarted
  const executionStarted = new Promise(resolve => {
    signalExecutionStarted = resolve
  })
  const runner = createOperationsTaskRunner({
    channel: createLeaseChannel(({ signal }) => new Promise((resolve, reject) => {
      signalExecutionStarted()
      signal.addEventListener('abort', () => {
        const error = new Error('prompt recovery missing')
        error.name = 'CancellationUnknownError'
        reject(error)
      }, { once: true })
    }), {
      events,
      releaseResult: false
    }),
    discover: async () => ({})
  })
  const running = runner.run({ tool, endpoint })
  await executionStarted

  const cancelled = await runner.cancel(running.taskId)

  assert.equal(cancelled.status, 'cancellation-unknown')
  assert.equal(cancelled.terminalRecoveryRequired, true)
  assert.match(cancelled.error, /prompt recovery missing/)
  assert.deepEqual(events, ['acquire', 'release'])
  assert.equal(runner.get(running.taskId).status, 'cancellation-unknown')
})

test('runner records one lease release exception without losing the final task', async () => {
  const { createOperationsTaskRunner } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-runner.js'
  )
  let releases = 0
  const runner = createOperationsTaskRunner({
    channel: {
      acquire: async () => ({
        execute: async () => ({ exitCode: 0, identity: rootIdentity }),
        release: async () => {
          releases += 1
          throw new Error('release failed')
        }
      })
    },
    discover: async () => ({})
  })

  const completed = await runner.run({ tool, endpoint }).completion

  assert.equal(completed.status, 'completed')
  assert.equal(completed.terminalRecoveryRequired, true)
  assert.match(completed.releaseError, /release failed/)
  assert.equal(releases, 1)
})
