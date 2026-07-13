const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const domainRoot = path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions'
)

function importDomainModule (name) {
  return import(pathToFileURL(path.join(domainRoot, name)).href)
}

function clone (value) {
  return value === undefined ? undefined : structuredClone(value)
}

function createMemoryStore () {
  const records = new Map()
  const transitions = []
  return {
    transitions,
    async save (value) {
      const saved = clone(value)
      records.set(saved.id, saved)
      transitions.push(saved.state || saved.status)
      return clone(saved)
    },
    async get (id) {
      return clone(records.get(id))
    },
    async patch (id, patch) {
      const current = records.get(id)
      if (!current) throw new Error(`missing record: ${id}`)
      const next = { ...current, ...clone(patch) }
      records.set(id, next)
      transitions.push(next.state || next.status)
      return clone(next)
    }
  }
}

function marker (phase, id, code = 0) {
  return `__SHELLPILOT_${phase.toUpperCase()}_RC_${id}=${code}`
}

function createClock () {
  let tick = 0
  return () => new Date(Date.UTC(2026, 6, 13, 10, 0, tick++))
}

async function waitFor (predicate) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('timed out waiting for test condition')
}

async function createRequest (overrides = {}) {
  const { buildSafetyRequest } = await importDomainModule('models.js')
  return buildSafetyRequest({
    id: 'op-1',
    source: 'agent',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      pid: 1001
    },
    command: 'systemctl restart nginx',
    ...overrides
  }, { now: new Date('2026-07-13T09:00:00.000Z') })
}

function createPlan (request) {
  const id = request.id
  return {
    provider: request.recoveryProvider,
    prepareCommand: `capture-state-for-${id}`,
    executeCommand: request.command,
    rollbackCommand: `( restore-${id} ); printf '\n${marker('rollback', id).replace('=0', '=%s')}\n' 0`,
    verifyCommand: `( verify-${id} ); printf '\n${marker('verify', id).replace('=0', '=%s')}\n' 0`,
    allowUnsafeExecute: request.recoveryProvider !== 'network',
    summary: `recovery for ${id}`,
    artifacts: {
      manifest: `~/.shellpilot/operations/${id}/manifest.json`,
      backupDir: `~/.shellpilot/operations/${id}/backup/`
    }
  }
}

async function createPreparedRunner (overrides = {}) {
  const { createTransactionRunner } = await importDomainModule('transaction-runner.js')
  const request = overrides.request || await createRequest()
  const store = overrides.store || createMemoryStore()
  const remoteCalls = []
  const runRemote = overrides.runRemote || (async (command, options) => {
    remoteCalls.push({ command, options })
    return { stdout: `ok\n${marker(options.phase, request.id)}`, code: 0 }
  })
  const runner = createTransactionRunner({
    runRemote,
    cancelRemote: overrides.cancelRemote || (async () => {}),
    store,
    getCurrentEndpoint: overrides.getCurrentEndpoint || (async () => request.endpoint),
    buildRecoveryPlan: overrides.buildRecoveryPlan || createPlan,
    now: overrides.now || createClock(),
    onEvent: overrides.onEvent
  })
  const prepared = await runner.prepare(request)
  return { runner, request, store, remoteCalls, prepared }
}

test('remote action markers support prepare and execute and use the last independent line', async () => {
  const {
    buildVerifiedRemoteAction,
    parseRemoteActionMarker
  } = await importDomainModule('remote-recovery.js')

  for (const action of ['prepare', 'execute', 'rollback', 'verify']) {
    const command = buildVerifiedRemoteAction('true', action, 'op-marker')
    assert.match(command, new RegExp(`__SHELLPILOT_${action.toUpperCase()}_RC_op-marker=%s`))
    assert.equal(parseRemoteActionMarker([
      marker(action, 'op-marker', 9),
      `prefix${marker(action, 'op-marker')}`,
      marker(action, 'op-marker')
    ].join('\n'), action, 'op-marker'), 0)
    assert.throws(
      () => parseRemoteActionMarker(marker(action, 'op-marker', 7), action, 'op-marker'),
      /退出码 7/
    )
  }
})

test('prepare creates and verifies recovery before execute can run a modifying command', async () => {
  const { runner, store, remoteCalls, prepared } = await createPreparedRunner()

  assert.equal(prepared.state, 'awaiting-confirmation')
  assert.deepEqual(store.transitions.slice(0, 3), [
    'preparing',
    'recovery-ready',
    'awaiting-confirmation'
  ])
  assert.deepEqual(remoteCalls.map(call => call.options.phase), ['prepare'])
  assert.doesNotMatch(remoteCalls[0].command, /systemctl restart nginx/)
  assert.equal(prepared.plan.summary, 'recovery for op-1')
  assert.equal(prepared.artifacts.manifest, '~/.shellpilot/operations/op-1/manifest.json')

  await assert.rejects(
    runner.execute('op-1', { confirmed: false }),
    /确认/
  )
  const result = await runner.execute('op-1', { confirmed: true })

  assert.equal(result.state, 'rollback-available')
  assert.deepEqual(remoteCalls.map(call => call.options.phase), ['prepare', 'execute'])
  assert.match(remoteCalls[1].command, /systemctl restart nginx/)
  assert.deepEqual(store.transitions.slice(-3), [
    'executing',
    'verification-passed',
    'rollback-available'
  ])
})

test('prepare and execute require real zero markers instead of transport code alone', async () => {
  const { createTransactionRunner } = await importDomainModule('transaction-runner.js')
  const request = await createRequest({ id: 'op-real-marker' })
  const store = createMemoryStore()
  const runner = createTransactionRunner({
    runRemote: async () => ({ stdout: 'transport said ok', code: 0 }),
    cancelRemote: async () => {},
    store,
    getCurrentEndpoint: async () => request.endpoint,
    buildRecoveryPlan: createPlan,
    now: createClock()
  })

  await assert.rejects(runner.prepare(request), /标记|状态/)
  assert.equal((await store.get(request.id)).state, 'failed')

  const executeRequest = await createRequest({ id: 'op-real-execute' })
  const executeStore = createMemoryStore()
  let phase = 'prepare'
  const executeRunner = createTransactionRunner({
    runRemote: async (command, options) => {
      if (options.phase === 'prepare') {
        return { stdout: marker('prepare', executeRequest.id), code: 0 }
      }
      phase = options.phase
      return { stdout: 'no execute marker', code: 0 }
    },
    cancelRemote: async () => {},
    store: executeStore,
    getCurrentEndpoint: async () => executeRequest.endpoint,
    buildRecoveryPlan: createPlan,
    now: createClock()
  })
  await executeRunner.prepare(executeRequest)
  await assert.rejects(
    executeRunner.execute(executeRequest.id, { confirmed: true }),
    /标记|状态/
  )
  assert.equal(phase, 'execute')
  assert.equal((await executeStore.get(executeRequest.id)).state, 'failed')
})

test('object remote results trust only stdout markers and reject nonzero transport codes', async () => {
  const { createTransactionRunner } = await importDomainModule('transaction-runner.js')
  const cases = [
    {
      id: 'op-stderr-marker',
      result: {
        stdout: 'ordinary stdout',
        stderr: marker('prepare', 'op-stderr-marker'),
        code: 0
      },
      expected: /标记|状态/
    },
    {
      id: 'op-transport-code',
      result: {
        stdout: marker('prepare', 'op-transport-code'),
        stderr: 'ignored warning',
        code: 23
      },
      expected: /23|传输|退出码/
    }
  ]

  for (const item of cases) {
    const request = await createRequest({ id: item.id })
    const store = createMemoryStore()
    const runner = createTransactionRunner({
      runRemote: async () => item.result,
      cancelRemote: async () => {},
      store,
      getCurrentEndpoint: async () => request.endpoint,
      buildRecoveryPlan: createPlan,
      now: createClock()
    })
    await assert.rejects(runner.prepare(request), item.expected)
    assert.equal((await store.get(item.id)).state, 'failed')
  }

  const stringRequest = await createRequest({ id: 'op-string-marker' })
  const stringStore = createMemoryStore()
  const stringRunner = createTransactionRunner({
    runRemote: async () => marker('prepare', stringRequest.id),
    cancelRemote: async () => {},
    store: stringStore,
    getCurrentEndpoint: async () => stringRequest.endpoint,
    buildRecoveryPlan: createPlan,
    now: createClock()
  })
  assert.equal((await stringRunner.prepare(stringRequest)).state, 'awaiting-confirmation')
})

test('prepare and execute reclassify persisted commands and reject forged readonly reboot', async () => {
  const { createTransactionRunner } = await importDomainModule('transaction-runner.js')
  const classified = await createRequest({ id: 'op-forged-prepare', command: 'reboot' })
  const forged = {
    ...classified,
    risk: 'readonly',
    reversible: false,
    recoveryProvider: null,
    requiresConfirmation: false,
    reason: 'forged readonly claim'
  }
  const store = createMemoryStore()
  const calls = []
  const runner = createTransactionRunner({
    runRemote: async command => {
      calls.push(command)
      return marker('execute', forged.id)
    },
    cancelRemote: async () => {},
    store,
    getCurrentEndpoint: async () => forged.endpoint,
    buildRecoveryPlan: createPlan,
    now: createClock()
  })

  await assert.rejects(runner.prepare(forged), /禁止|blocked|伪造|分类/)
  assert.equal((await store.get(forged.id)).state, 'failed')
  assert.equal(calls.length, 0)

  const executeRecord = {
    ...forged,
    id: 'op-forged-execute',
    state: 'awaiting-confirmation'
  }
  await store.save(executeRecord)
  await assert.rejects(
    runner.execute(executeRecord.id, { confirmed: true, allowUnsafe: true }),
    /禁止|blocked|伪造|分类/
  )
  assert.equal(calls.length, 0)
})

test('endpoint changes and unsafe network changes never execute', async () => {
  const endpointRequest = await createRequest({ id: 'op-endpoint' })
  let currentEndpoint = endpointRequest.endpoint
  const endpointContext = await createPreparedRunner({
    request: endpointRequest,
    getCurrentEndpoint: async () => currentEndpoint
  })
  currentEndpoint = { ...currentEndpoint, tabId: 'tab-2', pid: 2002 }
  await assert.rejects(
    endpointContext.runner.execute(endpointRequest.id, { confirmed: true }),
    /端点不一致/
  )
  assert.deepEqual(endpointContext.remoteCalls.map(call => call.options.phase), ['prepare'])

  const network = {
    ...await createRequest({ id: 'op-network-unsafe' }),
    command: 'ip link set dev eth0 down',
    risk: 'change',
    reversible: false,
    recoveryProvider: 'network'
  }
  const networkContext = await createPreparedRunner({ request: network })
  await assert.rejects(
    networkContext.runner.execute(network.id, { confirmed: true, allowUnsafe: true }),
    /网络|禁止|拒绝/
  )
  assert.equal(networkContext.remoteCalls.length, 0)
})

test('unknown and nonreversible changes require an explicit unsafe confirmation', async () => {
  for (const [id, command] of [
    ['op-unknown', 'custom-diagnostic --check'],
    ['op-nonreversible', 'systemctl restart nginx && chmod 600 /etc/app.conf']
  ]) {
    const request = await createRequest({ id, command })
    const context = await createPreparedRunner({ request })
    await assert.rejects(
      context.runner.execute(id, { confirmed: true }),
      /unsafe|不安全|允许/
    )
    const result = await context.runner.execute(id, {
      confirmed: true,
      allowUnsafe: true
    })
    assert.equal(result.state, 'kept')
    assert.deepEqual(context.remoteCalls.map(call => call.options.phase), ['execute'])
  }
})

test('change transactions with different ids serialize by endpointKey', async () => {
  const { createTransactionRunner } = await importDomainModule('transaction-runner.js')
  const store = createMemoryStore()
  const releases = new Map()
  const executeOrder = []
  let activeCount = 0
  let maxActiveCount = 0
  const runner = createTransactionRunner({
    runRemote: async (command, options) => {
      const id = options.executionId.replace(new RegExp(`-${options.phase}-\\d+$`), '')
      if (options.phase !== 'execute') {
        return { stdout: marker(options.phase, id), code: 0 }
      }
      executeOrder.push(id)
      activeCount += 1
      maxActiveCount = Math.max(maxActiveCount, activeCount)
      return new Promise(resolve => {
        releases.set(id, () => {
          activeCount -= 1
          resolve({ stdout: marker('execute', id), code: 0 })
        })
      })
    },
    cancelRemote: async () => {},
    store,
    getCurrentEndpoint: async operation => operation.endpoint,
    buildRecoveryPlan: createPlan,
    now: createClock()
  })
  const firstRequest = await createRequest({ id: 'op-lock-1' })
  const secondRequest = {
    ...await createRequest({ id: 'op-lock-2' }),
    endpointKey: 'forged@different.example.com:22'
  }
  await runner.prepare(firstRequest)
  await runner.prepare(secondRequest)

  const first = runner.execute(firstRequest.id, { confirmed: true })
  await waitFor(() => releases.has(firstRequest.id))
  const second = runner.execute(secondRequest.id, { confirmed: true })
  await new Promise(resolve => setTimeout(resolve, 20))
  const startsBeforeFirstRelease = executeOrder.length
  releases.get(firstRequest.id)()
  await waitFor(() => releases.has(secondRequest.id))
  releases.get(secondRequest.id)()
  const results = await Promise.all([first, second])

  assert.equal(startsBeforeFirstRelease, 1)
  assert.equal(maxActiveCount, 1)
  assert.deepEqual(executeOrder, [firstRequest.id, secondRequest.id])
  assert.equal(results.every(result => result.state === 'rollback-available'), true)
})

test('failed execute keeps recovery artifacts and can be rolled back and verified', async () => {
  let failExecute = true
  const context = await createPreparedRunner({
    runRemote: async (command, options) => {
      const code = options.phase === 'execute' && failExecute ? 23 : 0
      return { stdout: marker(options.phase, 'op-1', code), code }
    }
  })

  await assert.rejects(
    context.runner.execute('op-1', { confirmed: true }),
    /退出码 23/
  )
  const failed = await context.store.get('op-1')
  assert.equal(failed.state, 'failed')
  assert.equal(failed.artifacts.manifest, '~/.shellpilot/operations/op-1/manifest.json')
  assert.ok(failed.plan.rollbackCommand)

  failExecute = false
  const restored = await context.runner.rollback('op-1')
  assert.equal(restored.state, 'restored')
  assert.deepEqual(
    restored.audit.slice(-2).map(entry => entry.phase),
    ['rollback', 'verify']
  )
})

test('failed rollback remains retryable and keep only accepts rollback-available', async () => {
  let rollbackAttempts = 0
  const rollbackContext = await createPreparedRunner({
    runRemote: async (command, options) => {
      const code = options.phase === 'rollback' && rollbackAttempts++ === 0 ? 31 : 0
      return { stdout: marker(options.phase, 'op-1', code), code }
    }
  })
  await rollbackContext.runner.execute('op-1', { confirmed: true })
  await assert.rejects(rollbackContext.runner.rollback('op-1'), /退出码 31/)
  assert.equal((await rollbackContext.store.get('op-1')).state, 'failed')
  assert.equal((await rollbackContext.runner.rollback('op-1')).state, 'restored')

  const keepContext = await createPreparedRunner()
  await assert.rejects(keepContext.runner.keep('op-1'), /状态|保留/)
  await keepContext.runner.execute('op-1', { confirmed: true })
  assert.equal((await keepContext.runner.keep('op-1')).state, 'kept')
  await assert.rejects(keepContext.runner.rollback('op-1'), /状态|回滚/)
})

test('concurrent execute cancellation stops the active execution without late state overwrite', async () => {
  let rejectExecute
  const cancelled = await createPreparedRunner({
    runRemote: (command, options) => {
      if (options.phase === 'prepare') {
        return Promise.resolve({ stdout: marker('prepare', 'op-1'), code: 0 })
      }
      return new Promise((resolve, reject) => { rejectExecute = reject })
    },
    cancelRemote: async () => {
      rejectExecute(new Error('remote cancelled'))
    }
  })
  const executing = cancelled.runner.execute('op-1', { confirmed: true })
  await waitFor(() => Boolean(rejectExecute))
  const cancelling = cancelled.runner.cancel('op-1')
  await assert.rejects(executing, /取消/)
  assert.equal((await cancelling).state, 'cancelled')
  assert.equal((await cancelled.store.get('op-1')).state, 'cancelled')
  assert.equal(
    cancelled.store.transitions.filter(state => state === 'cancelled').length,
    1
  )

  const queued = await createPreparedRunner()
  const queuedExecution = queued.runner.execute('op-1', { confirmed: true })
  const queuedCancellation = queued.runner.cancel('op-1')
  await assert.rejects(queuedExecution, /取消/)
  assert.equal((await queuedCancellation).state, 'cancelled')
  assert.equal(
    queued.store.transitions.filter(state => state === 'cancelled').length,
    1
  )
  assert.deepEqual(queued.remoteCalls.map(call => call.options.phase), ['prepare'])

  let resolveExecute
  let resolveCancel
  const completed = await createPreparedRunner({
    runRemote: (command, options) => {
      if (options.phase === 'prepare') {
        return Promise.resolve({ stdout: marker('prepare', 'op-1'), code: 0 })
      }
      return new Promise(resolve => { resolveExecute = resolve })
    },
    cancelRemote: () => new Promise(resolve => { resolveCancel = resolve })
  })
  const completion = completed.runner.execute('op-1', { confirmed: true })
  await waitFor(() => Boolean(resolveExecute))
  const lateCancellation = completed.runner.cancel('op-1')
  resolveExecute({ stdout: marker('execute', 'op-1'), code: 0 })
  await assert.rejects(completion, /取消/)
  resolveCancel()
  assert.equal((await lateCancellation).state, 'cancelled')
  assert.equal((await completed.store.get('op-1')).state, 'cancelled')
})

test('cancel returns after cancelRemote even when runRemote never settles', async () => {
  let resolveNeverSettled
  const cancelledExecutions = []
  const context = await createPreparedRunner({
    runRemote: (command, options) => {
      const id = options.executionId.replace(new RegExp(`-${options.phase}-\\d+$`), '')
      if (options.phase === 'prepare') {
        return Promise.resolve({ stdout: marker('prepare', id), code: 0 })
      }
      return new Promise(resolve => { resolveNeverSettled = resolve })
    },
    cancelRemote: async executionId => { cancelledExecutions.push(executionId) }
  })
  const execution = context.runner.execute('op-1', { confirmed: true })
  await waitFor(() => Boolean(resolveNeverSettled))
  const cancellation = context.runner.cancel('op-1')
  const outcome = await Promise.race([
    cancellation,
    new Promise(resolve => setTimeout(() => resolve('timed-out'), 50))
  ])
  if (outcome === 'timed-out') {
    resolveNeverSettled({ stdout: marker('execute', 'op-1'), code: 0 })
    await Promise.allSettled([execution, cancellation])
  }

  assert.notEqual(outcome, 'timed-out')
  assert.equal(outcome.state, 'cancelled')
  await assert.rejects(execution, /取消/)
  assert.equal(cancelledExecutions.length, 1)
  assert.equal((await context.store.get('op-1')).state, 'cancelled')

  const nextRequest = await createRequest({ id: 'op-after-cancel' })
  const nextOutcome = await Promise.race([
    context.runner.prepare(nextRequest),
    new Promise(resolve => setTimeout(() => resolve('timed-out'), 50))
  ])
  assert.notEqual(nextOutcome, 'timed-out')
  assert.equal(nextOutcome.state, 'awaiting-confirmation')
})

test('audit output and thrown errors are redacted before UTF-8 64 KiB truncation', async () => {
  const secret = 'runner-secret-value'
  const huge = `token=${secret};` + '诊'.repeat(70000)
  const context = await createPreparedRunner({
    runRemote: async (command, options) => ({
      stdout: `${huge}\n${marker(options.phase, 'op-1')}`,
      code: 0
    })
  })
  const audit = context.prepared.audit[0]
  assert.ok(Buffer.byteLength(audit.preview, 'utf8') <= 64 * 1024)
  assert.doesNotMatch(audit.preview, new RegExp(secret))
  assert.match(audit.preview, /\[REDACTED\]/)
  assert.equal(audit.phase, 'prepare')
  assert.equal(audit.code, 0)
  assert.ok(audit.timestamp)

  const request = await createRequest({ id: 'op-error-redaction' })
  const store = createMemoryStore()
  const { createTransactionRunner } = await importDomainModule('transaction-runner.js')
  const runner = createTransactionRunner({
    runRemote: async () => { throw new Error(`password=${secret}`) },
    cancelRemote: async () => {},
    store,
    getCurrentEndpoint: async () => request.endpoint,
    buildRecoveryPlan: createPlan,
    now: createClock()
  })
  await assert.rejects(
    runner.prepare(request),
    error => !error.message.includes(secret) && error.message.includes('[REDACTED]')
  )
  assert.doesNotMatch(JSON.stringify(await store.get(request.id)), new RegExp(secret))
})

function createTaskStore () {
  return createMemoryStore()
}

function readonlyPlan (overrides = {}) {
  return {
    id: 'task-1',
    title: '检查生产服务器',
    steps: [
      { id: 'uptime', title: '运行时间', command: 'uptime', timeoutMs: 100 },
      { id: 'identity', title: '当前用户', command: 'whoami', timeoutMs: 100 }
    ],
    ...overrides
  }
}

test('task runner requires plan confirmation and persists validated readonly progress', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  const calls = []
  const events = []
  const runner = createTaskRunner({
    runRemote: async (command, options) => {
      calls.push({ command, options })
      return {
        output: `password=task-secret; output for ${command};${'诊'.repeat(70000)}`,
        code: 0
      }
    },
    cancelRemote: async () => {},
    store,
    now: createClock(),
    onEvent: event => events.push(event)
  })
  const task = await runner.create(readonlyPlan({
    steps: readonlyPlan().steps.map(step => ({
      ...step,
      readOnly: false,
      risk: 'change'
    }))
  }))

  assert.equal(task.status, 'awaiting-plan-confirmation')
  assert.equal(task.steps.every(step => step.readOnly && step.risk === 'readonly'), true)
  await assert.rejects(runner.run(task.id), /确认计划/)

  await runner.confirmPlan(task.id)
  const completed = await runner.run(task.id)
  assert.equal(completed.status, 'completed')
  assert.deepEqual(calls.map(call => call.command), ['uptime', 'whoami'])
  assert.equal(completed.steps.every(step => step.status === 'completed'), true)
  assert.doesNotMatch(JSON.stringify(completed), /task-secret/)
  assert.equal(events.length > 0, true)
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), ['output', 'phase', 'status', 'stepId', 'taskId'])
    assert.equal(event.taskId, task.id)
    assert.equal(event.phase, 'readonly')
  }
  const completedEvents = events.filter(event => event.status === 'completed')
  assert.equal(completedEvents.length, 2)
  for (const event of completedEvents) {
    assert.equal(typeof event.output, 'string')
    assert.match(event.output, /\[REDACTED\]/)
    assert.doesNotMatch(event.output, /task-secret/)
    assert.ok(Buffer.byteLength(event.output, 'utf8') <= 64 * 1024)
  }
})

test('task runner stops before a classifier-detected change step', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  const calls = []
  const runner = createTaskRunner({
    runRemote: async command => {
      calls.push(command)
      return { output: 'ok', code: 0 }
    },
    cancelRemote: async () => {},
    store,
    now: createClock()
  })
  const task = await runner.create(readonlyPlan({
    steps: [
      { id: 'uptime', command: 'uptime', timeoutMs: 100 },
      {
        id: 'restart',
        command: 'systemctl restart nginx',
        timeoutMs: 100,
        readOnly: true,
        risk: 'readonly'
      },
      { id: 'identity', command: 'whoami', timeoutMs: 100 }
    ]
  }))
  await runner.confirmPlan(task.id)
  const stopped = await runner.run(task.id)

  assert.equal(stopped.status, 'awaiting-change-confirmation')
  assert.deepEqual(calls, ['uptime'])
  assert.equal(stopped.steps[0].status, 'completed')
  assert.equal(stopped.steps[1].status, 'awaiting-confirmation')
  assert.equal(stopped.steps[2].status, 'pending')
})

test('task runner enforces per-step timeout and cancels the active remote execution', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  const cancelledExecutions = []
  const events = []
  const runner = createTaskRunner({
    runRemote: async (command, options) => {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    },
    cancelRemote: async executionId => { cancelledExecutions.push(executionId) },
    store,
    now: createClock(),
    onEvent: event => events.push(event)
  })
  const task = await runner.create(readonlyPlan({
    steps: [
      { id: 'slow', command: 'uptime', timeoutMs: 10 },
      { id: 'never', command: 'whoami', timeoutMs: 100 }
    ]
  }))
  await runner.confirmPlan(task.id)
  await assert.rejects(runner.run(task.id), /超时/)

  const failed = await store.get(task.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.steps[0].status, 'failed')
  assert.equal(failed.steps[1].status, 'pending')
  assert.equal(cancelledExecutions.length, 1)
  const failedEvent = events.find(event => event.status === 'failed')
  assert.equal(typeof failedEvent.output, 'string')
  assert.match(failedEvent.output, /超时/)
  assert.ok(Buffer.byteLength(failedEvent.output, 'utf8') <= 64 * 1024)
})

test('task cancellation stops later steps and preserves completed progress', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  let rejectActive
  const cancelledExecutions = []
  const runner = createTaskRunner({
    runRemote: async command => {
      if (command === 'uptime') return { output: 'first complete', code: 0 }
      return new Promise((resolve, reject) => { rejectActive = reject })
    },
    cancelRemote: async executionId => {
      cancelledExecutions.push(executionId)
      rejectActive(new Error('remote cancelled'))
    },
    store,
    now: createClock()
  })
  const task = await runner.create(readonlyPlan({
    steps: [
      { id: 'first', command: 'uptime', timeoutMs: 100 },
      { id: 'active', command: 'whoami', timeoutMs: 1000 },
      { id: 'never', command: 'pwd', timeoutMs: 100 }
    ]
  }))
  await runner.confirmPlan(task.id)
  const running = runner.run(task.id)
  await waitFor(() => Boolean(rejectActive))
  const cancelling = runner.cancel(task.id)
  await assert.rejects(running, /取消/)
  const cancelled = await cancelling

  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.steps[0].status, 'completed')
  assert.equal(cancelled.steps[1].status, 'cancelled')
  assert.equal(cancelled.steps[2].status, 'pending')
  assert.equal(cancelledExecutions.length, 1)
})

test('an event callback failure cannot break task execution', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  const runner = createTaskRunner({
    runRemote: async () => ({ output: 'ok', code: 0 }),
    cancelRemote: async () => {},
    store,
    now: createClock(),
    onEvent: () => { throw new Error('observer failed') }
  })
  const task = await runner.create(readonlyPlan({
    steps: [{ id: 'uptime', command: 'uptime', timeoutMs: 100 }]
  }))
  await runner.confirmPlan(task.id)

  assert.equal((await runner.run(task.id)).status, 'completed')
})
