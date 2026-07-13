const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/command-entrypoint.js'
)).href
const runnerModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/transaction-runner.js'
)).href

function createHarness (overrides = {}) {
  const requests = []
  const submissions = []
  const completions = []
  const cancellations = []
  const views = []
  const inputs = []
  const errors = []
  const trackedCommands = []
  let idSequence = 0
  let tokenSequence = 0
  const runner = {
    async prepare (request) {
      requests.push(request)
      if (overrides.prepare) return overrides.prepare(request)
      return { ...request, state: 'awaiting-confirmation' }
    },
    async beginExternalExecution (id, executeOptions) {
      if (overrides.beginExternalExecution) {
        return overrides.beginExternalExecution(id, executeOptions)
      }
      return { id, state: 'executing', executionId: `${id}-external` }
    },
    async completeExternalExecution (id, completion) {
      completions.push({ id, completion })
      if (overrides.completeExternalExecution) {
        return overrides.completeExternalExecution(id, completion)
      }
      return { id, state: 'kept' }
    },
    async cancel (id) {
      cancellations.push(id)
      if (overrides.cancel) return overrides.cancel(id)
    }
  }
  const tracker = {
    expectExternalSubmission (command) {
      trackedCommands.push(command)
      return `submission-${++tokenSequence}-${command}`
    },
    markExpectedSubmissionReleased () {
      return true
    },
    cancelExpectedSubmission () {
      return true
    }
  }
  return {
    requests,
    submissions,
    completions,
    cancellations,
    views,
    inputs,
    errors,
    trackedCommands,
    runner,
    tracker,
    options: {
      runner,
      tracker,
      createId: () => `operation-${++idSequence}`,
      getEndpoint: () => ({
        tabId: 'tab-1',
        host: 'prod.example.com',
        port: 22,
        username: 'root',
        pid: 1001
      }),
      submitCommand: (command, token) => {
        if (overrides.submitCommand) {
          return overrides.submitCommand(command, token)
        }
        submissions.push({ command, token })
      },
      inputCommand: command => inputs.push(command),
      buildConfirmation: (command, classification) => ({
        command,
        classification,
        kind: classification.reversible ? 'reversible' : 'nonreversible',
        executeAllowed: true,
        automaticRollback: classification.reversible
      }),
      onStateChange: state => views.push(state),
      onError: error => errors.push(error)
    }
  }
}

async function waitFor (predicate) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('timed out waiting for test condition')
}

function deferred () {
  let resolveDeferred
  let rejectDeferred
  const promise = new Promise((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })
  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred
  }
}

function clone (value) {
  return value === undefined ? undefined : structuredClone(value)
}

function createMemoryStore () {
  const records = new Map()
  async function guardedPatch (id, predicate, value) {
    const current = records.get(id)
    if (!current) throw new Error(`missing record: ${id}`)
    if (await predicate(clone(current)) !== true) {
      throw new Error('guarded patch rejected')
    }
    const patch = typeof value === 'function'
      ? await value(clone(current))
      : value
    const next = { ...current, ...clone(patch) }
    records.set(id, next)
    return clone(next)
  }
  return {
    records,
    async save (value) {
      records.set(value.id, clone(value))
      return clone(value)
    },
    async get (id) {
      return clone(records.get(id))
    },
    async patch (id, value) {
      const current = records.get(id)
      if (!current) throw new Error(`missing record: ${id}`)
      const next = { ...current, ...clone(value) }
      records.set(id, next)
      return clone(next)
    },
    guardedPatch,
    guardedPatchOperation: guardedPatch
  }
}

function marker (phase, id, code = 0) {
  return `__SHELLPILOT_${phase.toUpperCase()}_RC_${id}=${code}`
}

async function createRealRunnerHarness (overrides = {}) {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const { createTransactionRunner } = await import(runnerModuleUrl)
  const base = createHarness(overrides)
  const store = createMemoryStore()
  const endpoint = base.options.getEndpoint()
  const remoteCalls = []
  let recoveryOperationId
  const runner = createTransactionRunner({
    store,
    runRemote: async (command, options) => {
      remoteCalls.push({ command, options })
      return {
        stdout: `ok\n${marker(options.phase, recoveryOperationId)}`,
        code: 0
      }
    },
    cancelRemote: async () => true,
    getCurrentEndpoint: async () => overrides.currentEndpoint || endpoint,
    buildRecoveryPlan: async request => {
      recoveryOperationId = request.id
      if (overrides.buildRecoveryPlan) {
        return overrides.buildRecoveryPlan(request)
      }
      return {
        provider: request.recoveryProvider,
        operationDir: `~/.shellpilot/operations/${request.id}/`,
        prepareCommand: `prepare-${request.id}`,
        executeCommand: request.command,
        rollbackCommand: `rollback-${request.id}`,
        verifyCommand: `verify-${request.id}`,
        allowUnsafeExecute: request.recoveryProvider !== 'network',
        artifacts: {
          manifest: `~/.shellpilot/operations/${request.id}/manifest.json`
        }
      }
    }
  })
  const entrypoint = createSafetyCommandEntrypoint({
    ...base.options,
    runner
  })
  entrypoint.beginSession()
  return { ...base, entrypoint, runner, store, remoteCalls, endpoint }
}

test('quick, AI and Agent commands use one classified safety request shape', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness()
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()

  const quick = await entrypoint.runSafetyCommand('uptime', {
    source: 'quick-command',
    title: '查看运行时间'
  })
  await entrypoint.handleCommandFinished({
    token: quick.token,
    command: 'uptime',
    exitCode: 0
  })
  const agent = await entrypoint.runSafetyCommand('pwd', {
    source: 'agent',
    title: 'AI 代码块'
  })
  await entrypoint.handleCommandFinished({
    token: agent.token,
    command: 'pwd',
    exitCode: 0
  })

  assert.equal(harness.requests.length, 2)
  assert.deepEqual(harness.requests.map(request => ({
    source: request.source,
    endpoint: request.endpoint,
    title: request.title,
    command: request.command,
    risk: request.risk,
    provider: request.provider
  })), [
    {
      source: 'quick-command',
      endpoint: {
        tabId: 'tab-1',
        host: 'prod.example.com',
        port: 22,
        username: 'root',
        pid: 1001
      },
      title: '查看运行时间',
      command: 'uptime',
      risk: 'readonly',
      provider: null
    },
    {
      source: 'agent',
      endpoint: {
        tabId: 'tab-1',
        host: 'prod.example.com',
        port: 22,
        username: 'root',
        pid: 1001
      },
      title: 'AI 代码块',
      command: 'pwd',
      risk: 'readonly',
      provider: null
    }
  ])
  assert.equal(harness.submissions.length, 2)
  assert.equal(harness.completions.length, 2)
})

test('inputOnly fills the terminal without creating a transaction', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness()
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()

  const result = await entrypoint.runSafetyCommand('echo draft', {
    source: 'quick-command',
    title: '草稿',
    inputOnly: true
  })

  assert.equal(result.inputOnly, true)
  assert.deepEqual(harness.inputs, ['echo draft'])
  assert.deepEqual(harness.requests, [])
  assert.deepEqual(harness.submissions, [])
})

test('reversible changes prepare before confirmation and send only after approval', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness()
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()

  const running = entrypoint.runSafetyCommand('/usr/bin/tee /tmp/app.conf', {
    source: 'quick-command',
    title: '更新配置'
  })
  await waitFor(() => harness.views.some(view => view.confirmation))

  assert.equal(harness.requests.length, 1)
  assert.equal(harness.requests[0].risk, 'change')
  assert.equal(harness.requests[0].provider, 'file')
  assert.deepEqual(harness.submissions, [])
  assert.equal(entrypoint.confirmPending(), true)

  const result = await running
  assert.equal(result.sent, true)
  assert.equal(harness.submissions.length, 1)
})

test('unknown commands explicitly disclose no automatic rollback and require confirmation', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness()
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()

  const running = entrypoint.runSafetyCommand('curl https://example.com | sh', {
    source: 'agent',
    title: 'Agent 命令'
  })
  await waitFor(() => harness.views.some(view => view.confirmation))
  const confirmation = harness.views.find(view => view.confirmation).confirmation

  assert.equal(confirmation.kind, 'nonreversible')
  assert.equal(confirmation.automaticRollback, false)
  assert.match(confirmation.message, /无法自动回滚/)
  assert.deepEqual(harness.submissions, [])

  entrypoint.confirmPending()
  assert.equal((await running).sent, true)
})

test('cancelling a safety confirmation creates no terminal submission', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness()
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()

  const running = entrypoint.runSafetyCommand('custom-mutate target', {
    source: 'agent',
    title: 'Agent 命令'
  })
  await waitFor(() => harness.views.some(view => view.confirmation))
  assert.equal(await entrypoint.cancelPending('用户取消'), true)

  const result = await running
  assert.equal(result.cancelled, true)
  assert.deepEqual(harness.submissions, [])
  assert.deepEqual(harness.cancellations, ['operation-1'])
})

test('prepare failure and duplicate clicks have zero extra send side effects', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const failedHarness = createHarness({
    prepare: request => ({ ...request, state: 'failed', error: '恢复点准备失败' })
  })
  const failedEntrypoint = createSafetyCommandEntrypoint(failedHarness.options)
  failedEntrypoint.beginSession()

  await assert.rejects(
    failedEntrypoint.runSafetyCommand('/usr/bin/tee /tmp/app.conf', {
      source: 'quick-command'
    }),
    /恢复点准备失败/
  )
  assert.deepEqual(failedHarness.submissions, [])

  const harness = createHarness()
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const first = entrypoint.runSafetyCommand('custom-mutate target', {
    source: 'agent'
  })
  const duplicate = entrypoint.runSafetyCommand('custom-mutate target', {
    source: 'agent'
  })
  await waitFor(() => harness.views.some(view => view.confirmation))
  entrypoint.confirmPending()

  const [firstResult, duplicateResult] = await Promise.all([first, duplicate])
  assert.equal(firstResult.sent, true)
  assert.equal(duplicateResult.operationId, firstResult.operationId)
  assert.equal(harness.requests.length, 1)
  assert.equal(harness.submissions.length, 1)
})

test('real runner audits readonly execution without unsafe confirmation', async () => {
  const harness = await createRealRunnerHarness()

  const result = await harness.entrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    title: '只读诊断'
  })

  assert.equal(result.sent, true)
  assert.equal(harness.submissions.length, 1)
  assert.deepEqual(harness.remoteCalls, [])
  const executing = await harness.store.get(result.operationId)
  assert.equal(executing.state, 'executing')

  await harness.entrypoint.handleCommandFinished({
    token: result.token,
    command: 'uptime',
    exitCode: 0
  })
  assert.equal((await harness.store.get(result.operationId)).state, 'kept')
})

test('background mode classifies the original command and binds tracker completion to its trusted wrapper', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness()
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()

  const originalCommand = '/usr/bin/systemctl start nginx'
  const running = entrypoint.runSafetyCommand(originalCommand, {
    source: 'agent',
    title: '后台重启服务',
    executionMode: 'background'
  })
  await waitFor(() => harness.views.some(view => view.confirmation))

  assert.equal(harness.requests[0].command, originalCommand)
  assert.equal(harness.requests[0].provider, 'systemd')
  assert.equal(harness.requests[0].metadata.execution.mode, 'background')
  assert.match(harness.requests[0].metadata.execution.submittedCommand, /^nohup bash -c /)
  entrypoint.confirmPending()

  const result = await running
  const submittedCommand = result.execution.submittedCommand
  assert.notEqual(submittedCommand, harness.requests[0].command)
  assert.deepEqual(harness.trackedCommands, [submittedCommand])
  assert.equal(harness.submissions[0].command, submittedCommand)

  const waiting = result.waitForCompletion({ timeoutMs: 1000 })
  await entrypoint.handleCommandFinished({
    token: result.token,
    command: submittedCommand,
    exitCode: 0
  })
  const completion = await waiting
  assert.equal(completion.exitCode, 0)
  assert.equal(harness.completions[0].completion.command, originalCommand)
})

test('callers cannot forge a submitted command for a benign original command', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness()
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()

  await assert.rejects(entrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    submittedCommand: 'rm -rf /'
  }), /实际提交命令|不允许/)
  assert.deepEqual(harness.requests, [])
  assert.deepEqual(harness.submissions, [])
})

test('background network changes still fail closed from the original command', async () => {
  const harness = await createRealRunnerHarness({
    buildRecoveryPlan: () => {
      throw new Error('网络恢复点不可用')
    }
  })

  await assert.rejects(harness.entrypoint.runSafetyCommand(
    '/usr/sbin/ip addr add 10.0.0.2/24 dev eth0',
    {
      source: 'agent',
      title: '后台调整网络',
      executionMode: 'background'
    }
  ), /网络恢复点不可用/)
  assert.equal((await harness.store.get('operation-1')).command,
    '/usr/sbin/ip addr add 10.0.0.2/24 dev eth0')
  assert.deepEqual(harness.submissions, [])
})

test('real background change prepares recovery for the original and completes from its wrapper identity', async () => {
  const harness = await createRealRunnerHarness()
  const originalCommand = '/usr/bin/systemctl start nginx'
  const running = harness.entrypoint.runSafetyCommand(originalCommand, {
    source: 'agent',
    title: '后台启动服务',
    executionMode: 'background'
  })
  await waitFor(() => harness.views.some(view => view.confirmation))
  harness.entrypoint.confirmPending()
  const result = await running

  assert.equal(harness.remoteCalls.length, 1)
  assert.equal(harness.remoteCalls[0].options.phase, 'prepare')
  assert.equal((await harness.store.get(result.operationId)).command, originalCommand)
  assert.equal((await harness.store.get(result.operationId)).recoveryProvider, 'systemd')
  assert.equal(harness.submissions[0].command, result.execution.submittedCommand)

  const waiting = result.waitForCompletion({ timeoutMs: 1000 })
  await harness.entrypoint.handleCommandFinished({
    token: result.token,
    command: result.execution.submittedCommand,
    exitCode: 0
  })
  await waiting
  assert.equal((await harness.store.get(result.operationId)).state, 'rollback-available')
})

test('completion API reports nonzero exit and endpoint cancellation without sending a next command', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const failedHarness = createHarness()
  const failedEntrypoint = createSafetyCommandEntrypoint(failedHarness.options)
  failedEntrypoint.beginSession()
  const failed = await failedEntrypoint.runSafetyCommand('uptime', {
    source: 'quick-command'
  })
  const failedCompletion = failed.waitForCompletion({ timeoutMs: 1000 })
  await failedEntrypoint.handleCommandFinished({
    token: failed.token,
    command: 'uptime',
    exitCode: 7
  })
  await assert.rejects(failedCompletion, /退出码 7/)

  const switchedHarness = createHarness()
  const switchedEntrypoint = createSafetyCommandEntrypoint(switchedHarness.options)
  switchedEntrypoint.beginSession()
  const switched = await switchedEntrypoint.runSafetyCommand('pwd', {
    source: 'quick-command'
  })
  const switchedCompletion = switched.waitForCompletion({ timeoutMs: 1000 })
  await switchedEntrypoint.cancelCurrentExecution('终端已切换')
  await assert.rejects(switchedCompletion, /终端已切换/)
  assert.deepEqual(switchedHarness.cancellations, [switched.operationId])
})

test('begin and submit failures clear busy state and expose a cancellable retry', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  for (const failure of ['begin', 'submit']) {
    const harness = createHarness({
      beginExternalExecution: failure === 'begin'
        ? async id => ({ id, state: 'failed', error: '外部执行启动失败' })
        : undefined,
      submitCommand: failure === 'submit'
        ? () => { throw new Error('socket 写入失败') }
        : undefined
    })
    const entrypoint = createSafetyCommandEntrypoint(harness.options)
    entrypoint.beginSession()
    const running = entrypoint.runSafetyCommand('custom-mutate target', {
      source: 'agent',
      title: '变更命令'
    })
    await waitFor(() => harness.views.some(view => view.confirmation))
    entrypoint.confirmPending()

    const result = await running
    const state = harness.views.at(-1)
    assert.equal(result.sent, false, failure)
    assert.equal(result.retryable, true, failure)
    assert.equal(state.busy, false, failure)
    assert.equal(state.confirmation.kind, 'retry', failure)
    assert.match(state.error, /失败|尚未发送/, failure)
    assert.equal(entrypoint.hasPendingConfirmation(), true, failure)
    assert.equal(await entrypoint.cancelPending(), false, failure)
    assert.equal(harness.views.at(-1).confirmation, null, failure)
  }
})

test('a retry re-prepares a new transaction before submitting once', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  let beginAttempts = 0
  const harness = createHarness({
    beginExternalExecution: async id => {
      beginAttempts += 1
      return beginAttempts === 1
        ? { id, state: 'failed', error: '第一次启动失败' }
        : { id, state: 'executing', executionId: `${id}-external` }
    }
  })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const first = entrypoint.runSafetyCommand('custom-mutate target', {
    source: 'agent',
    title: '变更命令'
  })
  await waitFor(() => harness.views.some(view => view.confirmation?.kind === 'nonreversible'))
  entrypoint.confirmPending()
  assert.equal((await first).retryable, true)

  assert.equal(entrypoint.confirmPending(), true)
  await waitFor(() => harness.requests.length === 2 &&
    harness.views.at(-1).confirmation?.kind === 'nonreversible')
  entrypoint.confirmPending()
  await waitFor(() => harness.submissions.length === 1)

  assert.equal(beginAttempts, 2)
  assert.equal(harness.requests.length, 2)
  assert.equal(harness.submissions.length, 1)
})

test('submit failure leaves the real transaction cancelled and retryable', async () => {
  const harness = await createRealRunnerHarness({
    submitCommand: () => false
  })
  const result = await harness.entrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    title: '只读诊断'
  })

  assert.equal(result.retryable, true)
  assert.equal((await harness.store.get(result.operationId)).state, 'cancelled')
  assert.equal(harness.entrypoint.hasPendingConfirmation(), true)
  assert.deepEqual(harness.submissions, [])
})

test('submit failure cannot retry when the executing transaction cannot be cancelled', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness({
    submitCommand: () => { throw new Error('socket 写入失败') },
    cancel: async () => { throw new Error('事务取消失败') }
  })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const result = await entrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    title: '只读诊断'
  })

  assert.equal(result.sent, false)
  assert.equal(result.retryable, false)
  assert.equal(result.blocked, true)
  assert.equal(harness.views.at(-1).busy, false)
  assert.equal(harness.views.at(-1).confirmation.kind, 'blocked')
  assert.match(harness.views.at(-1).error, /取消失败.*禁止重试/)
  assert.equal(entrypoint.confirmPending(), false)
})

test('completion timeout cancels the active transaction and reports Chinese feedback', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness()
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const result = await entrypoint.runSafetyCommand('uptime', {
    source: 'quick-command'
  })

  await assert.rejects(
    result.waitForCompletion({ timeoutMs: 5 }),
    /等待命令完成超时.*停止后续命令/
  )
  assert.deepEqual(harness.cancellations, [result.operationId])
  assert.equal(entrypoint.hasPending(), false)
})

test('completion failure is cancelled and reported without an unhandled rejection', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness({
    completeExternalExecution: async () => {
      throw new Error('事务完成写入失败')
    }
  })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()

  const result = await entrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    title: '只读诊断'
  })

  assert.equal(await entrypoint.handleCommandFinished({
    token: result.token,
    command: 'uptime',
    exitCode: 0
  }), false)
  assert.deepEqual(harness.cancellations, [result.operationId])
  assert.equal(harness.errors.length, 1)
  assert.match(harness.errors[0].message, /事务完成写入失败/)
  assert.equal(entrypoint.hasPending(), false)
})

test('real runner fails closed on unavailable network recovery and endpoint mismatch', async () => {
  const network = await createRealRunnerHarness({
    buildRecoveryPlan: () => {
      throw new Error('网络恢复点不可用')
    }
  })

  await assert.rejects(
    network.entrypoint.runSafetyCommand(
      '/usr/sbin/ip addr add 10.0.0.2/24 dev eth0',
      { source: 'quick-command', title: '调整网络' }
    ),
    /网络恢复点不可用/
  )
  assert.deepEqual(network.submissions, [])

  const mismatch = await createRealRunnerHarness({
    currentEndpoint: {
      tabId: 'tab-2',
      host: 'other.example.com',
      port: 22,
      username: 'root',
      pid: 2002
    }
  })
  await assert.rejects(
    mismatch.entrypoint.runSafetyCommand('uptime', {
      source: 'agent',
      title: '只读诊断'
    }),
    /端点|会话|服务器/
  )
  assert.deepEqual(mismatch.submissions, [])
})

test('input changes and disconnects cancel stale preparation before any send', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  for (const cancel of ['inputChanged', 'invalidateSession']) {
    const preparation = deferred()
    const harness = createHarness({ prepare: () => preparation.promise })
    const entrypoint = createSafetyCommandEntrypoint(harness.options)
    entrypoint.beginSession()
    const running = entrypoint.runSafetyCommand('/usr/bin/tee /tmp/app.conf', {
      source: 'quick-command',
      title: '更新配置'
    })
    await waitFor(() => harness.requests.length === 1)

    await entrypoint[cancel]()
    preparation.resolve({
      ...harness.requests[0],
      state: 'awaiting-confirmation'
    })

    const result = await running
    assert.equal(result.cancelled, true, cancel)
    assert.deepEqual(harness.submissions, [], cancel)
    assert.deepEqual(harness.cancellations, ['operation-1'], cancel)
  }
})
