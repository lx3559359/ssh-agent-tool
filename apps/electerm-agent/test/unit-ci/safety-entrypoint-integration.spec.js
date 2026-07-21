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
const submissionHooksModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/command-submission-hooks.js'
)).href
const agentRiskDelegationUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-risk-delegation.js'
)).href
const recoveryProvidersUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/recovery-providers.js'
)).href
const recoveryBindingUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/recovery-binding.js'
)).href
const maintenanceRecoveryUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/maintenance-recovery-delegation.js'
)).href
const safetyCenterModelUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/main/safety-operation-center-model.js'
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
  const readinessChecks = []
  const confirmationBuilds = []
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
    readinessChecks,
    confirmationBuilds,
    runner,
    tracker,
    options: {
      runner,
      tracker,
      ensureTrackerReady: async context => {
        readinessChecks.push(context)
        if (overrides.ensureTrackerReady) {
          return overrides.ensureTrackerReady(context)
        }
        return true
      },
      createId: () => `operation-${++idSequence}`,
      getEndpoint: () => overrides.getEndpoint?.() || ({
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
      buildConfirmation: (command, classification) => {
        confirmationBuilds.push({ command, classification })
        return {
          command,
          classification,
          kind: classification.reversible ? 'reversible' : 'nonreversible',
          executeAllowed: true,
          automaticRollback: classification.reversible
        }
      },
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
  const { buildRecoveryPlan: realRecoveryPlan } = await import(recoveryProvidersUrl)
  const base = createHarness(overrides)
  const store = createMemoryStore()
  const endpoint = base.options.getEndpoint()
  const remoteCalls = []
  let recoveryOperationId
  const runnerOptions = {
    store,
    runRemote: async (command, options) => {
      remoteCalls.push({ command, options })
      const operationId = recoveryOperationId ||
        command.match(/__SHELLPILOT_[A-Z]+_RC_([A-Za-z0-9_-]+)/)?.[1]
      if (overrides.runRemote) {
        return overrides.runRemote(command, options, operationId)
      }
      return {
        stdout: `ok\n${marker(options.phase, operationId)}`,
        code: 0
      }
    },
    cancelRemote: async () => true,
    getCurrentEndpoint: async () => overrides.currentEndpoint || endpoint
  }
  if (overrides.useRealRecoveryPlan) {
    runnerOptions.buildRecoveryPlan = realRecoveryPlan
  }
  if (!overrides.useRealRecoveryPlan) {
    runnerOptions.buildRecoveryPlan = async request => {
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
  }
  const runner = createTransactionRunner(runnerOptions)
  const entrypoint = createSafetyCommandEntrypoint({
    ...base.options,
    runner
  })
  entrypoint.beginSession()
  return { ...base, entrypoint, runner, store, remoteCalls, endpoint }
}

const task6RecoveryCases = [
  ['builtin-server-hostname-change', '修改服务器主机名', '/etc/hostname'],
  ['builtin-server-hosts-manage', '管理 Hosts 映射', '/etc/hosts'],
  ['builtin-server-timezone-change', '修改服务器时区', 'timedatectl']
]

function task6RecoveryDetails (harness, [quickCommandId, title, backupTarget], index = 0) {
  const rollbackPath = `/tmp/shellpilot-rollback/${quickCommandId}-${1700000000000 + index}.sh`
  return {
    quickCommandId,
    command: `ROLLBACK_SCRIPT='${rollbackPath}'\ntask6-${quickCommandId}-${index}\nprintf 'mutate'`,
    title,
    rollbackPath,
    endpoint: {
      tabId: harness.endpoint.tabId,
      host: harness.endpoint.host,
      port: harness.endpoint.port,
      username: harness.endpoint.username
    },
    backupTargets: [backupTarget],
    verification: [`verify-${quickCommandId}`]
  }
}

async function createReloadedTask6Runner (harness, remoteCalls = []) {
  const { createTransactionRunner } = await import(runnerModuleUrl)
  const { buildRecoveryPlan } = await import(recoveryProvidersUrl)
  return createTransactionRunner({
    store: harness.store,
    buildRecoveryPlan,
    cancelRemote: async () => true,
    getCurrentEndpoint: async () => harness.endpoint,
    runRemote: async (command, options) => {
      remoteCalls.push({ command, options })
      const operationId = command.match(
        /__SHELLPILOT_[A-Z]+_RC_([A-Za-z0-9_-]+)/
      )?.[1]
      return {
        stdout: marker(options.phase, operationId),
        code: 0
      }
    }
  })
}

async function completeTask6SafetyOperation (harness, details, capability) {
  const running = harness.entrypoint.runSafetyCommand(details.command, {
    source: 'quick-command',
    title: details.title,
    maintenanceRecovery: capability
  })
  await waitFor(() => harness.entrypoint.hasPendingConfirmation())
  assert.equal(harness.entrypoint.confirmPending(), true)
  const result = await running
  const completion = result.waitForCompletion({ timeoutMs: 1000 })
  await harness.entrypoint.handleCommandFinished({
    token: result.token,
    command: result.execution.submittedCommand,
    exitCode: 0
  })
  await completion
  return {
    result,
    operation: await harness.store.get(result.operationId)
  }
}

test('all Task 6 operations create clickable authenticated recovery records', async () => {
  const {
    createInternalMaintenanceRecoveryDelegation
  } = await import(maintenanceRecoveryUrl)
  const { isSafetyOperationRollbackable } = await import(safetyCenterModelUrl)

  for (let index = 0; index < task6RecoveryCases.length; index += 1) {
    const harness = await createRealRunnerHarness({ useRealRecoveryPlan: true })
    const details = task6RecoveryDetails(harness, task6RecoveryCases[index], index)
    const capability = createInternalMaintenanceRecoveryDelegation(details)
    const { result, operation } = await completeTask6SafetyOperation(
      harness,
      details,
      capability
    )

    assert.equal(operation.state, 'rollback-available')
    assert.equal(operation.risk, 'change')
    assert.equal(operation.reversible, true)
    assert.equal(operation.recoveryProvider, 'quick-command')
    assert.equal(operation.metadata.maintenanceRecovery.quickCommandId, details.quickCommandId)
    assert.equal(operation.metadata.maintenanceRecovery.rollbackPath, details.rollbackPath)
    assert.deepEqual(
      operation.metadata.maintenanceRecovery.backupTargets,
      details.backupTargets
    )
    assert.deepEqual(
      operation.metadata.maintenanceRecovery.verification,
      details.verification
    )
    assert.match(operation.plan.rollbackCommand, new RegExp(details.rollbackPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.equal(isSafetyOperationRollbackable(operation), true)

    const restored = await harness.runner.rollback(result.operationId)
    assert.equal(restored.state, 'restored')
    assert.equal(isSafetyOperationRollbackable(restored), false)
    assert.equal((await harness.store.get(result.operationId)).state, 'restored')
  }
})

test('Task 6 recovery rejects the wrong tab and forged rollback paths', async () => {
  const {
    createInternalMaintenanceRecoveryDelegation
  } = await import(maintenanceRecoveryUrl)
  const options = { useRealRecoveryPlan: true }
  const harness = await createRealRunnerHarness(options)
  const details = task6RecoveryDetails(harness, task6RecoveryCases[0])
  const completed = await completeTask6SafetyOperation(
    harness,
    details,
    createInternalMaintenanceRecoveryDelegation(details)
  )
  const callsBeforeMismatch = harness.remoteCalls.length

  options.currentEndpoint = {
    ...harness.endpoint,
    tabId: 'tab-forged'
  }
  await assert.rejects(
    harness.runner.rollback(completed.result.operationId),
    /端点|会话|服务器|endpoint/i
  )
  assert.equal(harness.remoteCalls.length, callsBeforeMismatch)

  assert.throws(
    () => createInternalMaintenanceRecoveryDelegation({
      ...details,
      rollbackPath: '/tmp/shellpilot-rollback/../forged.sh'
    }),
    /回滚|路径|rollback/i
  )
  const forgedHarness = await createRealRunnerHarness({ useRealRecoveryPlan: true })
  await assert.rejects(
    forgedHarness.entrypoint.runSafetyCommand(details.command, {
      source: 'quick-command',
      maintenanceRecovery: {
        ...details,
        rollbackPath: '/tmp/forged.sh'
      }
    }),
    /恢复|capability|回滚|授权/i
  )
  assert.deepEqual(forgedHarness.submissions, [])
  assert.deepEqual(forgedHarness.remoteCalls, [])
})

test('Task 6 recovery binding rejects persisted path tampering and records rollback failure', async () => {
  const {
    createInternalMaintenanceRecoveryDelegation
  } = await import(maintenanceRecoveryUrl)
  const tamperHarness = await createRealRunnerHarness({ useRealRecoveryPlan: true })
  const tamperDetails = task6RecoveryDetails(tamperHarness, task6RecoveryCases[1])
  const tampered = await completeTask6SafetyOperation(
    tamperHarness,
    tamperDetails,
    createInternalMaintenanceRecoveryDelegation(tamperDetails)
  )
  const raw = tamperHarness.store.records.get(tampered.result.operationId)
  raw.plan.rollbackCommand = '/tmp/shellpilot-rollback/forged.sh'
  raw.plan.artifacts.rollbackScript = '/tmp/shellpilot-rollback/forged.sh'
  const callsBeforeTamper = tamperHarness.remoteCalls.length
  await assert.rejects(
    tamperHarness.runner.rollback(tampered.result.operationId),
    /完整性|绑定|篡改|恢复/i
  )
  assert.equal(tamperHarness.remoteCalls.length, callsBeforeTamper)

  const failureHarness = await createRealRunnerHarness({
    useRealRecoveryPlan: true,
    runRemote: (command, options, operationId) => {
      const code = options.phase === 'rollback' ? 7 : 0
      return {
        stdout: marker(options.phase, operationId, code),
        code
      }
    }
  })
  const failureDetails = task6RecoveryDetails(failureHarness, task6RecoveryCases[2])
  const failed = await completeTask6SafetyOperation(
    failureHarness,
    failureDetails,
    createInternalMaintenanceRecoveryDelegation(failureDetails)
  )
  await assert.rejects(
    failureHarness.runner.rollback(failed.result.operationId),
    /退出码 7|失败/
  )
  assert.equal(
    (await failureHarness.store.get(failed.result.operationId)).state,
    'failed'
  )
})

test('persisted Task 6 terminal records cannot be reactivated after runner reload', async () => {
  for (const [index, terminalState] of ['kept', 'restored', 'cancelled'].entries()) {
    const harness = await createRealRunnerHarness({ useRealRecoveryPlan: true })
    const details = task6RecoveryDetails(
      harness,
      task6RecoveryCases[index],
      20 + index
    )
    const { createInternalMaintenanceRecoveryDelegation } = await import(maintenanceRecoveryUrl)
    const completed = await completeTask6SafetyOperation(
      harness,
      details,
      createInternalMaintenanceRecoveryDelegation(details)
    )
    await harness.store.patch(completed.result.operationId, { state: terminalState })
    await harness.store.patch(completed.result.operationId, { state: 'failed' })

    const reloadCalls = []
    const reloadedRunner = await createReloadedTask6Runner(harness, reloadCalls)
    await assert.rejects(
      reloadedRunner.rollback(completed.result.operationId),
      error => error instanceof Error,
      terminalState
    )
    assert.deepEqual(reloadCalls, [], terminalState)
  }
})

test('persisted Task 6 command or path tampering stays denied after recomputing the public digest', async () => {
  const { createRecoveryBinding, verifyRecoveryBinding } = await import(recoveryBindingUrl)
  const { createInternalMaintenanceRecoveryDelegation } = await import(maintenanceRecoveryUrl)

  for (const [index, tamperKind] of ['command', 'path'].entries()) {
    const harness = await createRealRunnerHarness({ useRealRecoveryPlan: true })
    const details = task6RecoveryDetails(
      harness,
      task6RecoveryCases[index],
      30 + index
    )
    const completed = await completeTask6SafetyOperation(
      harness,
      details,
      createInternalMaintenanceRecoveryDelegation(details)
    )
    const operation = await harness.store.get(completed.result.operationId)
    operation.state = 'failed'
    if (tamperKind === 'command') {
      operation.command = operation.command.replace("printf 'mutate'", "printf 'forged'")
      operation.plan.executeCommand = operation.command
    } else {
      const forgedPath = `/tmp/shellpilot-rollback/forged-reload-${index}.sh`
      operation.metadata.maintenanceRecovery.rollbackPath = forgedPath
      operation.plan.rollbackCommand = operation.plan.rollbackCommand.replaceAll(
        details.rollbackPath,
        forgedPath
      )
      operation.plan.verifyCommand = operation.plan.verifyCommand.replaceAll(
        details.rollbackPath,
        forgedPath
      )
      operation.artifacts.rollbackScript = forgedPath
      operation.plan.artifacts = clone(operation.artifacts)
    }
    operation.recoveryBinding = await createRecoveryBinding(
      operation,
      operation.plan,
      operation.artifacts
    )
    assert.deepEqual(
      await verifyRecoveryBinding(operation),
      { valid: true, error: '' },
      tamperKind
    )
    await harness.store.patch(operation.id, operation)

    const reloadCalls = []
    const reloadedRunner = await createReloadedTask6Runner(harness, reloadCalls)
    await assert.rejects(
      reloadedRunner.rollback(operation.id),
      error => error instanceof Error,
      tamperKind
    )
    assert.deepEqual(reloadCalls, [], tamperKind)
  }
})

test('Task 6 retry rotates recovery identity and retires the failed record', async () => {
  const submitted = []
  let submitAttempts = 0
  const harness = await createRealRunnerHarness({
    useRealRecoveryPlan: true,
    submitCommand: (command, token) => {
      submitAttempts += 1
      if (submitAttempts === 1) return false
      submitted.push({ command, token })
      return true
    }
  })
  const { createInternalMaintenanceRecoveryDelegation } = await import(maintenanceRecoveryUrl)
  const details = task6RecoveryDetails(harness, task6RecoveryCases[1], 40)
  const firstRun = harness.entrypoint.runSafetyCommand(details.command, {
    source: 'quick-command',
    title: details.title,
    maintenanceRecovery: createInternalMaintenanceRecoveryDelegation(details)
  })
  await waitFor(() => harness.entrypoint.hasPendingConfirmation())
  assert.equal(harness.entrypoint.confirmPending(), true)
  const firstResult = await firstRun
  assert.equal(firstResult.retryable, true)
  const viewCountBeforeRetry = harness.views.length

  assert.equal(harness.entrypoint.confirmPending(), true)
  await waitFor(() => harness.views.slice(viewCountBeforeRetry).some(view => {
    return view.confirmation?.kind === 'reversible'
  }))
  assert.equal(harness.entrypoint.confirmPending(), true)
  await waitFor(() => submitted.length === 1)

  const secondOperationId = 'operation-2'
  await harness.entrypoint.handleCommandFinished({
    token: submitted[0].token,
    command: submitted[0].command,
    exitCode: 0
  })
  await harness.runner.keep(secondOperationId)

  const oldOperation = await harness.store.get(firstResult.operationId)
  const newOperation = await harness.store.get(secondOperationId)
  assert.equal(oldOperation.state, 'failed')
  assert.ok(oldOperation.recoveryRevokedAt)
  assert.equal(newOperation.state, 'kept')
  assert.notEqual(
    oldOperation.metadata.maintenanceRecovery.rollbackPath,
    newOperation.metadata.maintenanceRecovery.rollbackPath
  )
  assert.ok(newOperation.command.includes(newOperation.metadata.maintenanceRecovery.rollbackPath))
  assert.equal(newOperation.command.includes(details.rollbackPath), false)

  const callsBeforeOldRollback = harness.remoteCalls.length
  await assert.rejects(
    harness.runner.rollback(firstResult.operationId),
    error => error instanceof Error
  )
  assert.equal(harness.remoteCalls.length, callsBeforeOldRollback)
})

test('Task 6 rollback invokes the mutating script once and verifies read-only state', async () => {
  const harness = await createRealRunnerHarness({ useRealRecoveryPlan: true })
  const { createInternalMaintenanceRecoveryDelegation } = await import(maintenanceRecoveryUrl)
  const details = task6RecoveryDetails(harness, task6RecoveryCases[2], 50)
  const completed = await completeTask6SafetyOperation(
    harness,
    details,
    createInternalMaintenanceRecoveryDelegation(details)
  )

  const restored = await harness.runner.rollback(completed.result.operationId)
  const recoveryCalls = harness.remoteCalls.filter(call => {
    return call.options.phase === 'rollback' || call.options.phase === 'verify'
  })
  const scriptInvocation = `/bin/sh -- '${details.rollbackPath}'`
  assert.equal(restored.state, 'restored')
  assert.deepEqual(recoveryCalls.map(call => call.options.phase), ['rollback', 'verify'])
  assert.equal(
    recoveryCalls.filter(call => call.command.includes(scriptInvocation)).length,
    1
  )
  assert.equal(recoveryCalls[1].command.includes(scriptInvocation), false)
})

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

test('compound SSH quick commands finish through one trackable submission and release the next command', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness({
    getEndpoint: () => ({
      tabId: 'tab-1',
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      pid: 1001,
      sessionType: 'ssh'
    })
  })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const command = 'systemctl status nginx --no-pager && journalctl -u nginx -n 20 --no-pager'

  const first = await entrypoint.runSafetyCommand(command, {
    source: 'quick-command',
    title: '服务状态查询'
  })

  assert.equal(harness.requests[0].command, command)
  assert.notEqual(first.execution.submittedCommand, command)
  assert.match(first.execution.submittedCommand, /^sh -c /)
  assert.doesNotMatch(first.execution.submittedCommand, /[\r\n]/)
  assert.equal(first.execution.metadata.trackedEnvelope, true)

  const waiting = first.waitForCompletion({ timeoutMs: 1000 })
  assert.equal(await entrypoint.handleCommandFinished({
    token: first.token,
    command: first.execution.submittedCommand,
    exitCode: 0
  }), true)
  assert.equal((await waiting).exitCode, 0)

  const second = await entrypoint.runSafetyCommand('uptime', {
    source: 'quick-command'
  })
  assert.equal(second.sent, true)
  assert.equal(second.execution.submittedCommand, 'uptime')
})

test('delegated Agent resource risks receive exactly one lower confirmation and one dispatch', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const { createDelegatedAgentSafetyPreparation } = await import(agentRiskDelegationUrl)
  const endpoint = {
    tabId: 'tab-1',
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    pid: 1001,
    terminalPid: 'terminal-1',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:abc'
  }
  const riskContext = {
    purpose: 'collect a bounded operational signal',
    impactTargets: ['ssh-session:tab-1'],
    verification: [{
      name: 'read_service_status',
      args: { service: 'nginx' },
      expected: { exitCode: 0 }
    }]
  }

  for (const [toolName, command, executionMode] of [
    ['run_background_command', 'uptime', 'background'],
    ['send_terminal_command', 'journalctl -f', 'foreground'],
    ['send_terminal_command', 'tail -f /var/log/nginx/error.log', 'foreground']
  ]) {
    const harness = createHarness({ getEndpoint: () => endpoint })
    const entrypoint = createSafetyCommandEntrypoint(harness.options)
    entrypoint.beginSession()
    const preparation = createDelegatedAgentSafetyPreparation(toolName, {
      command,
      tabId: 'tab-1',
      riskContext
    }, {
      endpoint,
      classification: {
        outcome: 'risky',
        reasonCode: toolName === 'run_background_command'
          ? 'BACKGROUND_PROCESS'
          : 'RESOURCE_SENSITIVE_READ'
      }
    })

    const running = entrypoint.runSafetyCommand(command, {
      source: 'agent',
      executionMode,
      riskDelegation: preparation.safetyDelegationCapability
    })
    await waitFor(() => harness.confirmationBuilds.length === 1)

    assert.equal(harness.confirmationBuilds.length, 1, command)
    assert.deepEqual(
      harness.confirmationBuilds[0].classification.riskContext,
      riskContext,
      command
    )
    assert.equal(harness.submissions.length, 0, command)
    assert.equal(entrypoint.confirmPending(), true, command)

    const result = await running
    assert.equal(result.sent, true, command)
    assert.equal(harness.confirmationBuilds.length, 1, command)
    assert.equal(harness.submissions.length, 1, command)
  }
})

test('cancelling a delegated Agent resource risk confirms once and dispatches zero times', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const { createDelegatedAgentSafetyPreparation } = await import(agentRiskDelegationUrl)
  const endpoint = {
    tabId: 'tab-1',
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    pid: 1001,
    terminalPid: 'terminal-1',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:abc'
  }
  const riskContext = {
    purpose: 'run one bounded background diagnostic',
    impactTargets: ['ssh-session:tab-1'],
    verification: [{ name: 'verify_listening_port', args: { port: 22 } }]
  }
  const preparation = createDelegatedAgentSafetyPreparation(
    'run_background_command',
    { command: 'uptime', tabId: 'tab-1', riskContext },
    {
      endpoint,
      classification: { outcome: 'risky', reasonCode: 'BACKGROUND_PROCESS' }
    }
  )
  const harness = createHarness({ getEndpoint: () => endpoint })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const running = entrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    executionMode: 'background',
    riskDelegation: preparation.safetyDelegationCapability
  })
  await waitFor(() => harness.confirmationBuilds.length === 1)

  assert.equal(await entrypoint.cancelPending(), true)
  const result = await running
  assert.equal(result.cancelled, true)
  assert.equal(harness.confirmationBuilds.length, 1)
  assert.equal(harness.submissions.length, 0)
})

test('plain readonly commands keep zero confirmations and forged risk delegation is rejected', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const { createDelegatedAgentSafetyPreparation } = await import(agentRiskDelegationUrl)
  const readonlyHarness = createHarness()
  const readonlyEntrypoint = createSafetyCommandEntrypoint(readonlyHarness.options)
  readonlyEntrypoint.beginSession()

  const result = await readonlyEntrypoint.runSafetyCommand('uptime', {
    source: 'agent'
  })
  assert.equal(result.sent, true)
  assert.equal(readonlyHarness.confirmationBuilds.length, 0)
  assert.equal(readonlyHarness.submissions.length, 1)

  const forgedHarness = createHarness()
  const forgedEntrypoint = createSafetyCommandEntrypoint(forgedHarness.options)
  forgedEntrypoint.beginSession()
  await assert.rejects(forgedEntrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    riskDelegation: Object.freeze({})
  }), /delegation|capability|risk/i)
  assert.equal(forgedHarness.confirmationBuilds.length, 0)
  assert.equal(forgedHarness.submissions.length, 0)

  const endpoint = {
    tabId: 'tab-1',
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    pid: 1001,
    terminalPid: 'terminal-1',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:abc'
  }
  const preparation = createDelegatedAgentSafetyPreparation(
    'run_background_command',
    {
      command: 'uptime',
      tabId: 'tab-1',
      riskContext: {
        purpose: 'bounded background diagnostic',
        impactTargets: ['ssh-session:tab-1'],
        verification: [{
          name: 'verify_listening_port',
          args: { port: 22 }
        }]
      }
    },
    {
      endpoint,
      classification: { outcome: 'risky', reasonCode: 'BACKGROUND_PROCESS' }
    }
  )
  const changedHarness = createHarness({
    getEndpoint: () => ({ ...endpoint, pid: 1002 })
  })
  const changedEntrypoint = createSafetyCommandEntrypoint(changedHarness.options)
  changedEntrypoint.beginSession()
  await assert.rejects(changedEntrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    executionMode: 'background',
    riskDelegation: preparation.safetyDelegationCapability
  }), /不一致|session|endpoint/i)
  assert.equal(changedHarness.confirmationBuilds.length, 0)
  assert.equal(changedHarness.submissions.length, 0)

  const changedCommandHarness = createHarness({ getEndpoint: () => endpoint })
  const changedCommandEntrypoint = createSafetyCommandEntrypoint(
    changedCommandHarness.options
  )
  changedCommandEntrypoint.beginSession()
  await assert.rejects(changedCommandEntrypoint.runSafetyCommand('whoami', {
    source: 'agent',
    riskDelegation: preparation.safetyDelegationCapability
  }), /delegation|capability|risk/i)
  assert.equal(changedCommandHarness.confirmationBuilds.length, 0)
  assert.equal(changedCommandHarness.submissions.length, 0)
})

test('Agent risk delegation capability is consumed by its first validation attempt', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const { createDelegatedAgentSafetyPreparation } = await import(agentRiskDelegationUrl)
  const endpoint = {
    tabId: 'tab-1',
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    pid: 1001,
    terminalPid: 'terminal-1',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:abc'
  }
  const makePreparation = () => createDelegatedAgentSafetyPreparation(
    'send_terminal_command',
    {
      command: 'journalctl -f',
      tabId: 'tab-1',
      riskContext: {
        purpose: 'observe one bounded stream',
        impactTargets: ['ssh-session:tab-1'],
        verification: [{
          name: 'read_recent_logs',
          args: { unit: 'nginx', limit: 10 },
          expected: { contains: 'nginx' }
        }]
      }
    },
    {
      endpoint,
      classification: {
        outcome: 'risky',
        reasonCode: 'RESOURCE_SENSITIVE_READ'
      }
    }
  )
  const start = async (capability, overrides = {}) => {
    const harness = createHarness({ getEndpoint: () => endpoint, ...overrides })
    const entrypoint = createSafetyCommandEntrypoint(harness.options)
    entrypoint.beginSession()
    return {
      harness,
      entrypoint,
      running: entrypoint.runSafetyCommand(
        'journalctl -f',
        { source: 'agent', riskDelegation: capability }
      )
    }
  }
  const assertCapabilityRejected = async (running) => {
    const outcome = await Promise.race([
      Promise.resolve(running).then(
        value => ({ value }),
        error => ({ error })
      ),
      new Promise(resolve => setImmediate(() => resolve({ pending: true })))
    ])
    assert.equal(outcome.error?.code, 'AGENT_RISK_DELEGATION_INVALID')
  }

  const successful = makePreparation()
  const first = await start(successful.safetyDelegationCapability)
  await waitFor(() => first.harness.confirmationBuilds.length === 1)
  first.entrypoint.confirmPending()
  const dispatched = await first.running
  assert.equal(dispatched.sent, true)
  await first.entrypoint.handleCommandFinished({
    token: dispatched.token,
    command: dispatched.execution.submittedCommand,
    exitCode: 0
  })
  await assertCapabilityRejected(
    (await start(successful.safetyDelegationCapability)).running
  )

  const cancelled = makePreparation()
  const cancelledRun = await start(cancelled.safetyDelegationCapability)
  await waitFor(() => cancelledRun.harness.confirmationBuilds.length === 1)
  await cancelledRun.entrypoint.cancelPending()
  assert.equal((await cancelledRun.running).cancelled, true)
  await assertCapabilityRejected(
    (await start(cancelled.safetyDelegationCapability)).running
  )

  const failed = makePreparation()
  const failedRun = await start(failed.safetyDelegationCapability, {
    prepare: () => { throw new Error('prepare failed') }
  })
  await assert.rejects(failedRun.running, /prepare failed/)
  await assertCapabilityRejected(
    (await start(failed.safetyDelegationCapability)).running
  )

  const mismatched = makePreparation()
  const wrongCommandHarness = createHarness({ getEndpoint: () => endpoint })
  const wrongCommandEntrypoint = createSafetyCommandEntrypoint(
    wrongCommandHarness.options
  )
  wrongCommandEntrypoint.beginSession()
  await assert.rejects(wrongCommandEntrypoint.runSafetyCommand('whoami', {
    source: 'agent',
    riskDelegation: mismatched.safetyDelegationCapability
  }), error => error.code === 'AGENT_RISK_DELEGATION_INVALID')
  await assertCapabilityRejected(
    (await start(mismatched.safetyDelegationCapability)).running
  )

  const wrongEndpoint = makePreparation()
  const changed = createHarness({
    getEndpoint: () => ({ ...endpoint, pid: 2002 })
  })
  const changedEntrypoint = createSafetyCommandEntrypoint(changed.options)
  changedEntrypoint.beginSession()
  await assert.rejects(changedEntrypoint.runSafetyCommand('journalctl -f', {
    source: 'agent',
    riskDelegation: wrongEndpoint.safetyDelegationCapability
  }), /session|endpoint|不一致/i)
  await assertCapabilityRejected(
    (await start(wrongEndpoint.safetyDelegationCapability)).running
  )
})

test('entrypoint retry retains validated delegation without replaying its capability', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const { createDelegatedAgentSafetyPreparation } = await import(agentRiskDelegationUrl)
  const endpoint = {
    tabId: 'tab-1',
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    pid: 1001,
    terminalPid: 'terminal-1',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:abc'
  }
  const preparation = createDelegatedAgentSafetyPreparation(
    'send_terminal_command',
    {
      command: 'journalctl -f',
      tabId: 'tab-1',
      riskContext: {
        purpose: 'retry one validated stream submission',
        impactTargets: ['ssh-session:tab-1'],
        verification: [{
          name: 'read_recent_logs',
          args: { unit: 'nginx', limit: 10 },
          expected: { contains: 'nginx' }
        }]
      }
    },
    {
      endpoint,
      classification: {
        outcome: 'risky',
        reasonCode: 'RESOURCE_SENSITIVE_READ'
      }
    }
  )
  let beginAttempts = 0
  const harness = createHarness({
    getEndpoint: () => endpoint,
    beginExternalExecution: (id) => {
      beginAttempts += 1
      if (beginAttempts === 1) throw new Error('transient begin failure')
      return { id, state: 'executing', executionId: `${id}-external` }
    }
  })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const running = entrypoint.runSafetyCommand('journalctl -f', {
    source: 'agent',
    riskDelegation: preparation.safetyDelegationCapability
  })
  await waitFor(() => harness.confirmationBuilds.length === 1)
  entrypoint.confirmPending()
  assert.equal((await running).retryable, true)

  assert.equal(entrypoint.confirmPending(), true)
  await waitFor(() => harness.confirmationBuilds.length === 2)
  assert.equal(entrypoint.confirmPending(), true)
  await waitFor(() => harness.submissions.length === 1)
  assert.equal(beginAttempts, 2)

  const replayHarness = createHarness({ getEndpoint: () => endpoint })
  const replayEntrypoint = createSafetyCommandEntrypoint(replayHarness.options)
  replayEntrypoint.beginSession()
  const replayOutcome = await Promise.race([
    replayEntrypoint.runSafetyCommand('journalctl -f', {
      source: 'agent',
      riskDelegation: preparation.safetyDelegationCapability
    }).then(value => ({ value }), error => ({ error })),
    new Promise(resolve => setImmediate(() => resolve({ pending: true })))
  ])
  assert.equal(replayOutcome.error?.code, 'AGENT_RISK_DELEGATION_INVALID')
})

test('foreground cancellation is bound to the exact active operation identity', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness()
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()

  const first = await entrypoint.runSafetyCommand('uptime', {
    source: 'agent'
  })
  assert.equal(first.sent, true)
  await entrypoint.handleCommandFinished({
    token: first.token,
    command: first.execution.submittedCommand,
    exitCode: 0
  })

  const second = await entrypoint.runSafetyCommand('whoami', {
    source: 'agent'
  })
  assert.equal(second.sent, true)
  let interrupts = 0
  const interrupt = () => { interrupts += 1 }

  assert.equal(await entrypoint.cancelForegroundExecutionById(
    first.operationId,
    interrupt,
    'stale Agent cancellation'
  ), false)
  assert.equal(interrupts, 0)
  assert.equal(await entrypoint.cancelForegroundExecutionById(
    'not-dispatched',
    interrupt,
    'pre-dispatch Agent cancellation'
  ), false)
  assert.equal(interrupts, 0)

  assert.equal(await entrypoint.cancelForegroundExecutionById(
    second.operationId,
    interrupt,
    'exact Agent cancellation'
  ), true)
  assert.equal(interrupts, 1)
  assert.equal(await entrypoint.cancelForegroundExecutionById(
    second.operationId,
    interrupt,
    'duplicate Agent cancellation'
  ), false)
  assert.equal(interrupts, 1)
})

test('accepted foreground completion retires its interrupt identity before audit persistence', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const completing = deferred()
  const harness = createHarness({
    completeExternalExecution: () => completing.promise
  })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()

  const first = await entrypoint.runSafetyCommand('uptime', {
    source: 'agent'
  })
  const waiting = first.waitForCompletion().then(
    value => ({ value }),
    error => ({ error })
  )
  const completionCall = entrypoint.handleCommandFinished({
    token: first.token,
    command: first.execution.submittedCommand,
    exitCode: 0
  })
  await waitFor(() => harness.completions.length === 1)

  const manualInput = await entrypoint.runSafetyCommand('echo manual', {
    source: 'quick-command',
    inputOnly: true
  })
  assert.equal(manualInput.inputOnly, true)
  assert.deepEqual(harness.inputs, ['echo manual'])

  let interrupts = 0
  const interrupt = () => { interrupts += 1 }
  assert.equal(await entrypoint.cancelForegroundExecutionById(
    first.operationId,
    interrupt,
    'late Agent cancellation'
  ), false)
  assert.equal(interrupts, 0)
  assert.deepEqual(harness.cancellations, [])
  assert.equal(await entrypoint.handleCommandFinished({
    token: first.token,
    command: first.execution.submittedCommand,
    exitCode: 0
  }), false)

  completing.resolve({ id: first.operationId, state: 'kept' })
  assert.equal(await completionCall, true)
  const completionOutcome = await waiting
  assert.equal(completionOutcome.error, undefined)
  assert.equal(completionOutcome.value.exitCode, 0)
  assert.equal(await entrypoint.handleCommandFinished({
    token: first.token,
    command: first.execution.submittedCommand,
    exitCode: 0
  }), false)
  assert.equal(harness.completions.length, 1)
  assert.deepEqual(harness.cancellations, [])
  assert.deepEqual(harness.errors, [])
  assert.equal(entrypoint.hasPending(), false)
})

test('failed foreground completion stays retired and cannot replace the next active identity', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const completing = deferred()
  const harness = createHarness({
    completeExternalExecution: () => completing.promise
  })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()

  const first = await entrypoint.runSafetyCommand('uptime', {
    source: 'agent'
  })
  const waiting = first.waitForCompletion().then(
    value => ({ value }),
    error => ({ error })
  )
  const completionCall = entrypoint.handleCommandFinished({
    token: first.token,
    command: first.execution.submittedCommand,
    exitCode: 0
  })
  await waitFor(() => harness.completions.length === 1)

  let interrupts = 0
  const interrupt = () => { interrupts += 1 }
  assert.equal(await entrypoint.cancelForegroundExecutionById(
    first.operationId,
    interrupt,
    'late Agent cancellation'
  ), false)
  assert.equal(await entrypoint.handleCommandFinished({
    token: first.token,
    command: first.execution.submittedCommand,
    exitCode: 0
  }), false)
  assert.equal(interrupts, 0)

  completing.reject(new Error('audit persistence failed'))
  assert.equal(await completionCall, false)
  const completionOutcome = await waiting
  assert.equal(completionOutcome.value, undefined)
  assert.match(completionOutcome.error.message, /audit persistence failed/)
  assert.deepEqual(harness.cancellations, [first.operationId])
  assert.equal(harness.errors.length, 1)
  assert.match(harness.errors[0].message, /audit persistence failed/)

  const second = await entrypoint.runSafetyCommand('whoami', {
    source: 'agent'
  })
  assert.equal(await entrypoint.handleCommandFinished({
    token: first.token,
    command: first.execution.submittedCommand,
    exitCode: 0
  }), false)
  assert.equal(await entrypoint.cancelForegroundExecutionById(
    first.operationId,
    interrupt,
    'stale Agent cancellation'
  ), false)
  assert.equal(await entrypoint.cancelForegroundExecutionById(
    second.operationId,
    interrupt,
    'exact Agent cancellation'
  ), true)
  assert.equal(await entrypoint.cancelForegroundExecutionById(
    second.operationId,
    interrupt,
    'duplicate Agent cancellation'
  ), false)
  assert.equal(interrupts, 1)
  assert.deepEqual(harness.cancellations, [
    first.operationId,
    second.operationId
  ])
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

test('background launcher completion does not finalize the original payload transaction', async () => {
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
  assert.match(harness.requests[0].metadata.execution.submittedCommand, /^bash -c /)
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
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(harness.completions.length, 0)

  await result.finalizeBackground(7)
  await assert.rejects(waiting, /7/)
  assert.equal(harness.completions.length, 1)
  assert.equal(harness.completions[0].completion.command, originalCommand)
  assert.equal(harness.completions[0].completion.exitCode, 7)
})

test('background launcher failure finalizes without exposing a detached task', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness()
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const result = await entrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    executionMode: 'background'
  })
  const waiting = result.waitForCompletion({ timeoutMs: 1000 })

  await entrypoint.handleCommandFinished({
    token: result.token,
    command: result.execution.submittedCommand,
    exitCode: 9
  })

  await assert.rejects(waiting, /9/)
  await assert.rejects(result.finalizeBackground(0), /后台|启动|终态/)
  assert.equal(harness.completions[0].completion.exitCode, 9)
})

test('background execution exposes an idempotent cancel capability after launch', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const harness = createHarness()
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const result = await entrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    executionMode: 'background'
  })
  const waiting = result.waitForCompletion({ timeoutMs: 1000 })
  await entrypoint.handleCommandFinished({
    token: result.token,
    command: result.execution.submittedCommand,
    exitCode: 0
  })

  assert.equal(await result.cancelBackground('用户取消后台任务。'), true)
  assert.equal(await result.cancelBackground('重复取消。'), false)
  await assert.rejects(waiting, /取消/)
  assert.deepEqual(harness.cancellations, [result.operationId])
  assert.equal(entrypoint.hasPending(), false)
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

test('only authenticated internal submission hooks run atomically before submit and abort on invalidation', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const { createInternalSubmissionHooks } = await import(submissionHooksModuleUrl)
  let selection
  const hookEvents = []
  const harness = createHarness({
    submitCommand: (command, token) => {
      hookEvents.push(['submit', selection])
      harness.submissions.push({ command, token })
    }
  })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const submissionHooks = createInternalSubmissionHooks({
    beforeSubmit: () => {
      selection = ['C:\\tmp\\upload.txt']
      hookEvents.push(['before', selection])
    },
    onAbort: () => {
      selection = undefined
      hookEvents.push(['abort', selection])
    }
  })
  const running = entrypoint.runSafetyCommand('rz', {
    source: 'agent',
    submissionHooks
  })
  await waitFor(() => harness.views.some(view => view.confirmation))
  entrypoint.confirmPending()
  const result = await running

  assert.deepEqual(hookEvents.slice(0, 2), [
    ['before', ['C:\\tmp\\upload.txt']],
    ['submit', ['C:\\tmp\\upload.txt']]
  ])
  await entrypoint.invalidateSession()
  assert.equal(selection, undefined)
  assert.equal(hookEvents.at(-1)[0], 'abort')
  await assert.rejects(result.waitForCompletion({ timeoutMs: 1000 }), /断开|取消/)
})

test('submission hook spoofing is rejected and submit failure clears hook state', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const { createInternalSubmissionHooks } = await import(submissionHooksModuleUrl)
  const spoofHarness = createHarness()
  const spoofEntrypoint = createSafetyCommandEntrypoint(spoofHarness.options)
  spoofEntrypoint.beginSession()
  await assert.rejects(spoofEntrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    beforeSubmit: () => {}
  }), /内部|hook|钩子/)
  assert.deepEqual(spoofHarness.requests, [])

  let selected = false
  const failedHarness = createHarness({
    submitCommand: () => { throw new Error('socket failed') }
  })
  const failedEntrypoint = createSafetyCommandEntrypoint(failedHarness.options)
  failedEntrypoint.beginSession()
  const result = await failedEntrypoint.runSafetyCommand('uptime', {
    source: 'agent',
    submissionHooks: createInternalSubmissionHooks({
      beforeSubmit: () => { selected = true },
      onAbort: () => { selected = false }
    })
  })

  assert.equal(result.sent, false)
  assert.equal(selected, false)
})

test('explicit safety commands wait for tracker readiness under default configuration', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const ready = deferred()
  const harness = createHarness({
    ensureTrackerReady: () => ready.promise
  })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const running = entrypoint.runSafetyCommand('uptime', { source: 'agent' })
  await waitFor(() => harness.readinessChecks.length === 1)

  assert.equal(harness.requests.length, 0)
  assert.equal(harness.submissions.length, 0)
  ready.resolve(true)
  const result = await running
  assert.equal(result.sent, true)

  const unavailable = createHarness({
    ensureTrackerReady: async () => {
      throw new Error('Shell Integration 尚未就绪')
    }
  })
  const unavailableEntrypoint = createSafetyCommandEntrypoint(unavailable.options)
  unavailableEntrypoint.beginSession()
  await assert.rejects(
    unavailableEntrypoint.runSafetyCommand('uptime', { source: 'agent' }),
    /Shell Integration|跟踪/
  )
  assert.deepEqual(unavailable.requests, [])
  assert.equal(unavailableEntrypoint.hasPendingConfirmation(), false)
})

test('single readonly quick commands can fall back when shell integration is unavailable', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const unavailable = createHarness({
    ensureTrackerReady: async () => {
      throw new Error('Shell Integration 尚未就绪')
    },
    submitCommand: (command, token) => {
      unavailable.submissions.push({ command, token })
      return true
    }
  })
  const entrypoint = createSafetyCommandEntrypoint(unavailable.options)
  entrypoint.beginSession()

  const result = await entrypoint.runSafetyCommand('uptime', {
    source: 'quick-command',
    allowUntrackedReadonlyFallback: true
  })
  const completion = await result.waitForCompletion()

  assert.equal(result.sent, true)
  assert.equal(result.untracked, true)
  assert.deepEqual(unavailable.requests, [])
  assert.deepEqual(unavailable.submissions, [{
    command: 'uptime',
    token: result.token
  }])
  assert.equal(completion.untracked, true)
  assert.equal(completion.exitCode, null)
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

test('real background change remains executing after launcher and finalizes from payload exit', async () => {
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
  assert.equal((await harness.store.get(result.operationId)).state, 'executing')
  await result.finalizeBackground(0)
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

test('disconnect during delayed completion cancels the retained identity and ignores late success', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const completing = deferred()
  const harness = createHarness({
    completeExternalExecution: () => completing.promise
  })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const result = await entrypoint.runSafetyCommand('uptime', { source: 'agent' })
  const waiting = result.waitForCompletion({ timeoutMs: 1000 })
  const completionCall = entrypoint.handleCommandFinished({
    token: result.token,
    command: 'uptime',
    exitCode: 0
  })
  await waitFor(() => harness.completions.length === 1)

  const invalidating = entrypoint.invalidateSession()
  completing.resolve({ id: result.operationId, state: 'kept' })
  await Promise.all([completionCall, invalidating])

  await assert.rejects(waiting, /断开|取消/)
  assert.deepEqual(harness.cancellations, [result.operationId])
  assert.equal(entrypoint.hasPending(), false)
})

test('late retry cancellation cannot re-arm confirmation after session invalidation', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const cancelling = deferred()
  const harness = createHarness({
    submitCommand: () => { throw new Error('socket failed') },
    cancel: () => cancelling.promise
  })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  entrypoint.beginSession()
  const running = entrypoint.runSafetyCommand('uptime', { source: 'agent' })
  await waitFor(() => harness.cancellations.length === 1)

  const invalidating = entrypoint.invalidateSession()
  cancelling.resolve({ state: 'cancelled' })
  const [result] = await Promise.all([running, invalidating])

  assert.equal(result.sent, false)
  assert.equal(result.cancelled, true)
  assert.equal(entrypoint.hasPendingConfirmation(), false)
  assert.equal(harness.views.at(-1).confirmation, null)
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

test('an AbortSignal cancels stale safety preparation before terminal send', async () => {
  const { createSafetyCommandEntrypoint } = await import(moduleUrl)
  const preparation = deferred()
  const harness = createHarness({ prepare: () => preparation.promise })
  const entrypoint = createSafetyCommandEntrypoint(harness.options)
  const controller = new AbortController()
  entrypoint.beginSession()
  const running = entrypoint.runSafetyCommand('/usr/bin/tee /tmp/app.conf', {
    source: 'agent',
    signal: controller.signal
  })
  await waitFor(() => harness.requests.length === 1)

  controller.abort()
  preparation.resolve({
    ...harness.requests[0],
    state: 'awaiting-confirmation'
  })

  const result = await running
  assert.equal(result.cancelled, true)
  assert.deepEqual(harness.submissions, [])
  assert.deepEqual(harness.cancellations, ['operation-1'])
})
