const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const executionUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/command-execution.js'
)).href
const registryUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/background-task-registry.js'
)).href
const commandEntrypointUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/command-entrypoint.js'
)).href
const transactionRunnerUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/transaction-runner.js'
)).href
const orphanRecoveryUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/command-orphan-recovery.js'
)).href

function clone (value) {
  return value === undefined ? undefined : structuredClone(value)
}

function installQualityRecorder () {
  const calls = []
  const previousWindow = globalThis.window
  globalThis.window = {
    pre: {
      runGlobalAsync: async (...args) => {
        if (args[0] === 'recordQualityEvent') calls.push(args)
        return true
      }
    }
  }
  return {
    calls,
    restore () {
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
    }
  }
}

function createProductionStore () {
  const records = new Map()
  const queues = new Map()

  function enqueue (id, work) {
    const previous = queues.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    queues.set(id, current)
    return current.finally(() => {
      if (queues.get(id) === current) queues.delete(id)
    })
  }

  function merge (current, patch) {
    return {
      ...current,
      ...clone(patch),
      ...(patch?.metadata
        ? { metadata: { ...current.metadata, ...clone(patch.metadata) } }
        : {})
    }
  }

  return {
    async save (value) {
      records.set(value.id, clone(value))
      return clone(value)
    },
    async get (id) {
      return clone(records.get(id))
    },
    async patch (id, patch) {
      return enqueue(id, async () => {
        const updated = merge(records.get(id), patch)
        records.set(id, updated)
        return clone(updated)
      })
    },
    async guardedPatch (id, predicate, patch) {
      return enqueue(id, async () => {
        const current = records.get(id)
        if (await predicate(clone(current)) !== true) {
          throw new Error('安全事务完整性校验失败，已拒绝原子更新。')
        }
        const resolved = typeof patch === 'function'
          ? await patch(clone(current))
          : patch
        const updated = merge(current, resolved)
        records.set(id, updated)
        return clone(updated)
      })
    },
    async guardedPatchOperation (id, predicate, patch) {
      return this.guardedPatch(id, predicate, patch)
    }
  }
}

async function createProductionBackgroundHarness (failureMode, cancelMode = 'success') {
  const { createSafetyCommandEntrypoint } = await import(commandEntrypointUrl)
  const { createTransactionRunner } = await import(transactionRunnerUrl)
  const endpoint = {
    tabId: 'tab-production',
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    pid: 4001
  }
  const store = createProductionStore()
  let clockTick = 0
  const productionRunner = createTransactionRunner({
    store,
    runRemote: async () => assert.fail('readonly background payload must use PTY once'),
    cancelRemote: async () => true,
    getCurrentEndpoint: async () => endpoint,
    buildRecoveryPlan: async () => assert.fail('readonly command needs no recovery'),
    now: () => new Date(Date.UTC(2026, 6, 14, 12, 0, clockTick++))
  })
  let completeCalls = 0
  let cancelCalls = 0
  const runner = {
    ...productionRunner,
    async completeExternalExecution (id, completion) {
      completeCalls += 1
      if (failureMode === 'false-before-commit' && completeCalls === 1) {
        return false
      }
      if (failureMode === 'always-throw') {
        throw new Error('事务存储暂时不可用')
      }
      const completed = await productionRunner.completeExternalExecution(id, completion)
      if (failureMode === 'throw-after-commit' && completeCalls === 1) {
        throw new Error('事务已写入但响应丢失')
      }
      return completed
    },
    async cancel (id) {
      cancelCalls += 1
      if (cancelMode === 'false') return false
      if (cancelMode === 'throw') throw new Error('事务取消写入失败')
      return productionRunner.cancel(id)
    }
  }
  const submissions = []
  let tokenSequence = 0
  const tracker = {
    expectExternalSubmission: command => `production-${++tokenSequence}-${command}`,
    markExpectedSubmissionReleased: () => true,
    cancelExpectedSubmission: () => true
  }
  const entrypoint = createSafetyCommandEntrypoint({
    runner,
    tracker,
    ensureTrackerReady: async () => true,
    createId: () => 'production-background-operation',
    getEndpoint: () => endpoint,
    submitCommand: (command, token) => {
      submissions.push({ command, token })
      return true
    },
    inputCommand: () => {},
    buildConfirmation: () => assert.fail('readonly command needs no confirmation'),
    onStateChange: () => {},
    onError: () => {}
  })
  entrypoint.beginSession()
  const submission = await entrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    executionMode: 'background'
  })
  assert.equal(await entrypoint.handleCommandFinished({
    token: submission.token,
    command: submission.execution.submittedCommand,
    exitCode: 0
  }), true)
  return {
    entrypoint,
    submission,
    submissions,
    store,
    get completeCalls () { return completeCalls },
    get cancelCalls () { return cancelCalls }
  }
}

async function createBackgroundTaskRegistryForHarness (harness, overrides = {}) {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  const registry = createBackgroundTaskRegistry({
    readFile: async (_tabId, file) => file.endsWith('.exit') ? '0\n' : '4321\n',
    isAlive: async () => false,
    kill: async () => true,
    ...overrides
  })
  registry.register({
    id: 'production-background-task',
    operationId: harness.submission.operationId,
    tabId: 'tab-production',
    command: 'uptime',
    startTime: 100,
    pidFile: '/tmp/production.pid',
    exitFile: '/tmp/production.exit',
    logFile: '/tmp/production.log',
    finalize: harness.submission.finalizeBackground,
    cancel: harness.submission.cancelBackground,
    completion: harness.submission.completion
  })
  return registry
}

function createFakeScheduler () {
  let nextId = 1
  const scheduled = new Map()
  const delays = []
  return {
    scheduler: {
      setTimeout (callback, delay) {
        const id = nextId++
        scheduled.set(id, callback)
        delays.push(delay)
        return id
      },
      clearTimeout (id) {
        scheduled.delete(id)
      }
    },
    delays,
    get size () {
      return scheduled.size
    },
    async runNext () {
      const next = scheduled.entries().next().value
      assert.ok(next, 'expected one scheduled task monitor')
      const [id, callback] = next
      scheduled.delete(id)
      await callback()
      await Promise.resolve()
    }
  }
}

function backgroundTask (overrides = {}) {
  return {
    id: 'bg-operation',
    operationId: 'operation',
    tabId: 'tab-1',
    command: 'sleep 30',
    startTime: 100,
    pidFile: '/tmp/task.pid',
    exitFile: '/tmp/task.exit',
    logFile: '/tmp/task.log',
    finalize: async () => true,
    cancel: async () => true,
    ...overrides
  }
}

test('background wrapper writes only the captured PID with valid shell separators', async () => {
  const { buildCommandExecution } = await import(executionUrl)
  const execution = buildCommandExecution({
    command: 'printf ok',
    operationId: 'operation-1',
    mode: 'background'
  })

  assert.match(execution.submittedCommand, /^bash -c /)
  assert.match(execution.metadata.launcherScript, /bg_pid=\$!;/)
  assert.match(execution.metadata.launcherScript, /printf '%s\\n' "\$bg_pid"/)
  assert.match(execution.metadata.launcherScript, /; disown "\$bg_pid"/)
  assert.doesNotMatch(execution.metadata.launcherScript, /> [^;]+ disown/)
})

test('status finalizes the original operation from the real payload exit code once', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  const finalizations = []
  const registry = createBackgroundTaskRegistry({
    readFile: async (_tabId, path) => path.endsWith('.exit') ? '7\n' : '4321\n',
    isAlive: async () => false,
    kill: async () => false,
    now: () => 200
  })
  registry.register({
    id: 'bg-operation-1',
    operationId: 'operation-1',
    tabId: 'tab-1',
    command: 'exit 7',
    startTime: 100,
    pidFile: '/tmp/task.pid',
    exitFile: '/tmp/task.exit',
    logFile: '/tmp/task.log',
    finalize: async exitCode => finalizations.push(exitCode),
    cancel: async () => true
  })

  const first = await registry.status('bg-operation-1')
  const second = await registry.status('bg-operation-1')

  assert.equal(first.status, 'failed')
  assert.equal(first.exitCode, 7)
  assert.equal(first.operationId, 'operation-1')
  assert.equal(second.exitCode, 7)
  assert.deepEqual(finalizations, [7])
})

test('background terminal state notifies an Agent risk binding exactly once', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  const terminal = []
  const registry = createBackgroundTaskRegistry({
    readFile: async (_tabId, path) => path.endsWith('.exit') ? '0\n' : '4321\n',
    isAlive: async () => false,
    kill: async () => false,
    now: () => 200
  })
  registry.register(backgroundTask({
    id: 'agent-terminal-callback',
    finalize: async () => true,
    onTerminal: outcome => terminal.push(outcome)
  }))

  await registry.status('agent-terminal-callback')
  await Promise.resolve()
  await registry.status('agent-terminal-callback')
  assert.equal(terminal.length, 1)
  assert.equal(terminal[0].status, 'completed')
})

test('cancel uses a validated PID and cancels the transaction only after kill succeeds', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  const killed = []
  const cancellations = []
  const registry = createBackgroundTaskRegistry({
    readFile: async (_tabId, path) => path.endsWith('.exit') ? '' : '4321\n',
    isAlive: async () => true,
    kill: async (_tabId, pid) => {
      killed.push(pid)
      return true
    }
  })
  registry.register({
    id: 'bg-operation-2',
    operationId: 'operation-2',
    tabId: 'tab-1',
    command: 'sleep 30',
    pidFile: '/tmp/task.pid',
    exitFile: '/tmp/task.exit',
    logFile: '/tmp/task.log',
    finalize: async () => {},
    cancel: async reason => {
      cancellations.push(reason)
      return true
    }
  })

  const result = await registry.cancel('bg-operation-2')

  assert.equal(result.status, 'cancelled')
  assert.deepEqual(killed, ['4321'])
  assert.equal(cancellations.length, 1)
})

test('missing or malformed background identity is reported as interrupted, never completed', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  const registry = createBackgroundTaskRegistry({
    readFile: async () => '123; touch /tmp/pwned',
    isAlive: async () => true,
    kill: async () => true
  })

  const orphan = await registry.status('bg-after-restart')
  assert.equal(orphan.status, 'unknown')
  assert.equal(orphan.interrupted, true)

  registry.register({
    id: 'bg-malformed',
    operationId: 'operation-3',
    tabId: 'tab-1',
    command: 'sleep 30',
    pidFile: '/tmp/task.pid',
    exitFile: '/tmp/task.exit',
    logFile: '/tmp/task.log',
    finalize: async () => assert.fail('must not finalize'),
    cancel: async () => true
  })
  const malformed = await registry.status('bg-malformed')
  assert.equal(malformed.status, 'unknown')
  assert.equal(malformed.interrupted, true)
})

test('finalize false stays unknown and retries only transaction finalization', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  let attempts = 0
  const registry = createBackgroundTaskRegistry({
    readFile: async (_tabId, path) => path.endsWith('.exit') ? '0\n' : '4321\n',
    isAlive: async () => false,
    kill: async () => false
  })
  registry.register(backgroundTask({
    finalize: async () => {
      attempts += 1
      return attempts > 1
    }
  }))

  const first = await registry.status('bg-operation')
  assert.equal(first.status, 'unknown')
  assert.equal(first.finalizePending, true)
  assert.equal(first.exitCode, 0)
  assert.match(first.message, /事务.*未完成.*重试/)

  const second = await registry.status('bg-operation')
  assert.equal(second.status, 'completed')
  assert.equal(second.exitCode, 0)
  assert.equal(second.interrupted, undefined)
  assert.equal(attempts, 2)
})

test('finalize throw is redacted unknown state and remains safely retryable', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  let attempts = 0
  const registry = createBackgroundTaskRegistry({
    readFile: async (_tabId, path) => path.endsWith('.exit') ? '7\n' : '4321\n',
    isAlive: async () => false,
    kill: async () => false
  })
  registry.register(backgroundTask({
    finalize: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('password=finalize-secret')
      return true
    }
  }))

  const first = await registry.status('bg-operation')
  assert.equal(first.status, 'unknown')
  assert.equal(first.finalizePending, true)
  assert.equal(first.exitCode, 7)
  assert.match(first.message, /后台任务事务收口失败/)
  assert.doesNotMatch(first.message, /finalize-secret/)

  const second = await registry.status('bg-operation')
  assert.equal(second.status, 'failed')
  assert.equal(second.exitCode, 7)
  assert.equal(attempts, 2)
})

test('production background finalization retries the same identity without resubmitting payload', async t => {
  for (const failureMode of ['false-before-commit', 'throw-after-commit']) {
    await t.test(failureMode, async () => {
      const harness = await createProductionBackgroundHarness(failureMode)
      const registry = await createBackgroundTaskRegistryForHarness(harness)
      let settled = 0
      harness.submission.completion.then(() => { settled += 1 })

      const first = await registry.status('production-background-task')
      assert.equal(first.status, 'unknown')
      assert.equal(first.finalizePending, true)
      assert.equal(harness.entrypoint.hasPending(), true)
      assert.equal(settled, 0)
      assert.equal(harness.completeCalls, 1)
      assert.equal(harness.cancelCalls, 0)
      assert.equal(harness.submissions.length, 1)

      const second = await registry.status('production-background-task')
      await Promise.resolve()
      assert.equal(second.status, 'completed')
      assert.equal(harness.completeCalls, 2)
      assert.equal(harness.cancelCalls, 0)
      assert.equal(harness.submissions.length, 1)
      assert.equal(settled, 1)
      assert.equal(harness.entrypoint.hasPending(), false)
      assert.equal((await harness.store.get(harness.submission.operationId)).state, 'kept')
    })
  }
})

test('false-before-commit keeps the SSH quality trace open until retry succeeds', async () => {
  const recorder = installQualityRecorder()
  try {
    const harness = await createProductionBackgroundHarness('false-before-commit')
    const registry = await createBackgroundTaskRegistryForHarness(harness)

    const first = await registry.status('production-background-task')
    assert.equal(first.status, 'unknown')
    assert.deepEqual(
      recorder.calls.map(([, , event]) => event.phase),
      ['started']
    )

    const second = await registry.status('production-background-task')
    assert.equal(second.status, 'completed')
    assert.deepEqual(
      recorder.calls.map(([, , event]) => event.phase),
      ['started', 'completed']
    )
  } finally {
    recorder.restore()
  }
})

test('permanent production finalization failure cancels once at monitor timeout', async () => {
  const harness = await createProductionBackgroundHarness('always-throw')
  const clock = { value: 100 }
  const fake = createFakeScheduler()
  const registry = await createBackgroundTaskRegistryForHarness(harness, {
    now: () => clock.value,
    scheduler: fake.scheduler,
    monitorInitialDelayMs: 250,
    monitorMaxDelayMs: 250,
    monitorTimeoutMs: 500
  })

  const first = await registry.status('production-background-task')
  assert.equal(first.status, 'unknown')
  assert.equal(first.finalizePending, true)
  assert.equal(harness.completeCalls, 1)
  assert.equal(harness.cancelCalls, 0)
  assert.equal(harness.submissions.length, 1)

  clock.value = 600
  await fake.runNext()

  const terminal = registry.get('production-background-task')
  assert.equal(terminal.status, 'unknown')
  assert.equal(terminal.interrupted, true)
  assert.match(terminal.message, /监控超时/)
  assert.equal(harness.cancelCalls, 1)
  assert.equal(harness.submissions.length, 1)
  assert.equal(fake.size, 0)
  assert.equal(harness.entrypoint.hasPending(), false)
})

test('monitor timeout records one failed cancel attempt and stops retrying', async () => {
  const harness = await createProductionBackgroundHarness('always-throw', 'false')
  const clock = { value: 100 }
  const fake = createFakeScheduler()
  const registry = await createBackgroundTaskRegistryForHarness(harness, {
    now: () => clock.value,
    scheduler: fake.scheduler,
    monitorInitialDelayMs: 250,
    monitorMaxDelayMs: 250,
    monitorTimeoutMs: 500
  })

  await registry.status('production-background-task')
  clock.value = 600
  await fake.runNext()

  const terminal = registry.get('production-background-task')
  assert.equal(terminal.status, 'unknown')
  assert.equal(terminal.interrupted, true)
  assert.match(terminal.message, /中断收口失败|取消失败/)
  assert.equal(harness.cancelCalls, 1)
  assert.equal(harness.submissions.length, 1)
  assert.equal(fake.size, 0)
  assert.equal(harness.entrypoint.hasPending(), false)
})

test('a registered task auto-finalizes from its real exit without a status query', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  const clock = { value: 100 }
  const fake = createFakeScheduler()
  let exit = ''
  const finalized = []
  const registry = createBackgroundTaskRegistry({
    readFile: async (_tabId, path) => path.endsWith('.exit') ? exit : '4321\n',
    isAlive: async () => true,
    kill: async () => false,
    now: () => clock.value,
    scheduler: fake.scheduler,
    monitorInitialDelayMs: 250,
    monitorMaxDelayMs: 1000,
    monitorTimeoutMs: 5000
  })
  registry.register(backgroundTask({
    finalize: async code => {
      finalized.push(code)
      return true
    }
  }))

  assert.equal(fake.size, 1)
  assert.equal(fake.delays[0] >= 250, true)
  await fake.runNext()
  assert.equal(registry.get('bg-operation').status, 'running')
  assert.equal(fake.size, 1)

  exit = '7\n'
  clock.value = 500
  await fake.runNext()
  assert.deepEqual(finalized, [7])
  assert.equal(registry.get('bg-operation').status, 'failed')
  assert.equal(fake.size, 0)
})

test('cancel session invalidation and monitor timeout stop their task timers', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  const clock = { value: 100 }
  const fake = createFakeScheduler()
  let resolveLifecycle
  const lifecycle = new Promise(resolve => { resolveLifecycle = resolve })
  const registry = createBackgroundTaskRegistry({
    readFile: async (_tabId, path) => path.endsWith('.exit') ? '' : '4321\n',
    isAlive: async () => true,
    kill: async () => true,
    now: () => clock.value,
    scheduler: fake.scheduler,
    monitorInitialDelayMs: 250,
    monitorMaxDelayMs: 1000,
    monitorTimeoutMs: 1000
  })

  registry.register(backgroundTask({ id: 'cancelled' }))
  assert.equal(fake.size, 1)
  await registry.cancel('cancelled')
  assert.equal(fake.size, 0)

  registry.register(backgroundTask({ id: 'invalidated', completion: lifecycle }))
  assert.equal(fake.size, 1)
  resolveLifecycle({ cancelled: true, error: '终端连接已断开。' })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(fake.size, 0)
  assert.equal(registry.get('invalidated').status, 'unknown')

  registry.register(backgroundTask({ id: 'timed-out' }))
  assert.equal(fake.size, 1)
  clock.value = 1200
  await fake.runNext()
  assert.equal(fake.size, 0)
  assert.equal(registry.get('timed-out').status, 'unknown')
  assert.match(registry.get('timed-out').message, /监控超时/)
})

test('late monitor results cannot overwrite session invalidation', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  let resolveAlive
  let resolveLifecycle
  const alive = new Promise(resolve => { resolveAlive = resolve })
  const lifecycle = new Promise(resolve => { resolveLifecycle = resolve })
  const registry = createBackgroundTaskRegistry({
    readFile: async (_tabId, path) => path.endsWith('.exit') ? '' : '4321\n',
    isAlive: async () => alive,
    kill: async () => true
  })
  registry.register(backgroundTask({ completion: lifecycle }))

  const checking = registry.status('bg-operation')
  await Promise.resolve()
  await Promise.resolve()
  resolveLifecycle({ cancelled: true, error: '终端连接已断开。' })
  await Promise.resolve()
  await Promise.resolve()
  resolveAlive(true)
  await checking

  assert.equal(registry.get('bg-operation').status, 'unknown')
  assert.equal(registry.get('bg-operation').interrupted, true)
})

test('terminal records obey count and TTL while active records are never evicted', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  const clock = { value: 100 }
  const fake = createFakeScheduler()
  const exits = new Map()
  const registry = createBackgroundTaskRegistry({
    readFile: async (_tabId, file) => file.endsWith('.exit')
      ? (exits.get(file) || '')
      : '4321\n',
    isAlive: async () => true,
    kill: async () => true,
    now: () => clock.value,
    scheduler: fake.scheduler,
    terminalRecordLimit: 2,
    terminalRecordTtlMs: 1000
  })

  registry.register(backgroundTask({
    id: 'active',
    operationId: 'active-operation',
    startTime: 1,
    exitFile: '/tmp/active.exit'
  }))
  for (const [index, id] of ['done-1', 'done-2', 'done-3'].entries()) {
    const exitFile = `/tmp/${id}.exit`
    exits.set(exitFile, '0\n')
    clock.value = 200 + index * 100
    registry.register(backgroundTask({
      id,
      operationId: `${id}-operation`,
      exitFile,
      pidFile: `/tmp/${id}.pid`,
      logFile: `/tmp/${id}.log`
    }))
    await registry.status(id)
  }

  assert.equal(registry.get('done-1'), undefined)
  assert.deepEqual(
    registry.list().map(record => record.id).sort(),
    ['active', 'done-2', 'done-3']
  )
  assert.equal(fake.size, 1)

  clock.value = 2000
  assert.deepEqual(registry.list().map(record => record.id), ['active'])
  assert.equal(registry.get('active').status, 'started')
  assert.equal(fake.size, 1)
})

test('startup recovery fails only prior-session background command operations', async () => {
  const { recoverOrphanedCommandOperations } = await import(orphanRecoveryUrl)
  const operations = new Map([
    ['orphan-background', {
      id: 'orphan-background',
      state: 'executing',
      executionId: 'external-old',
      updatedAt: '2026-07-13T10:00:00.000Z',
      metadata: { commandEntrypoint: true, execution: { mode: 'background' } }
    }],
    ['current-background', {
      id: 'current-background',
      state: 'executing',
      executionId: 'external-current',
      updatedAt: '2026-07-14T10:01:00.000Z',
      metadata: { commandEntrypoint: true, execution: { mode: 'background' } }
    }],
    ['orphan-foreground', {
      id: 'orphan-foreground',
      state: 'executing',
      executionId: 'external-foreground',
      updatedAt: '2026-07-13T10:00:00.000Z',
      metadata: { commandEntrypoint: true, execution: { mode: 'foreground' } }
    }]
  ])
  const store = {
    async listOperations () {
      return [...operations.values()].map(operation => structuredClone(operation))
    },
    async guardedPatchOperation (id, predicate, patch) {
      const current = operations.get(id)
      assert.equal(await predicate(structuredClone(current)), true)
      const updated = {
        ...current,
        ...patch,
        metadata: { ...current.metadata, ...patch.metadata }
      }
      operations.set(id, updated)
      return structuredClone(updated)
    }
  }

  const recovered = await recoverOrphanedCommandOperations({
    store,
    startedAt: '2026-07-14T10:00:00.000Z',
    now: () => new Date('2026-07-14T10:02:00.000Z')
  })

  assert.deepEqual(recovered.map(operation => operation.id), ['orphan-background'])
  const orphan = operations.get('orphan-background')
  assert.equal(orphan.state, 'failed')
  assert.equal(orphan.executionId, undefined)
  assert.equal(orphan.metadata.interrupted, true)
  assert.match(orphan.error, /应用重启.*执行结果未知.*中断/)
  assert.equal(operations.get('current-background').state, 'executing')
  assert.equal(operations.get('orphan-foreground').state, 'executing')

  const topbar = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/main/aigshell-topbar.jsx'
  ), 'utf8')
  assert.match(topbar, /recoverOrphanedCommandOperations/)
})
