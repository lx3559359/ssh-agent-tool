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
  const queues = new Map()

  function enqueue (id, work) {
    const previous = queues.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    queues.set(id, current)
    return current.finally(() => {
      if (queues.get(id) === current) queues.delete(id)
    })
  }

  async function patch (id, value) {
    return enqueue(id, async () => {
      const current = records.get(id)
      if (!current) throw new Error(`missing record: ${id}`)
      const next = { ...current, ...clone(value) }
      records.set(id, next)
      transitions.push(next.state || next.status)
      return clone(next)
    })
  }

  async function guardedPatch (id, predicate, value) {
    return enqueue(id, async () => {
      const current = records.get(id)
      if (!current) throw new Error(`missing record: ${id}`)
      if (await predicate(clone(current)) !== true) {
        throw new Error('安全事务完整性校验失败，已拒绝原子更新。')
      }
      const resolved = typeof value === 'function'
        ? await value(clone(current))
        : value
      const next = { ...current, ...clone(resolved) }
      records.set(id, next)
      transitions.push(next.state || next.status)
      return clone(next)
    })
  }

  const store = {
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
    patch,
    guardedPatch,
    guardedPatchOperation: guardedPatch
  }
  return store
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
    command: '/usr/bin/systemctl start nginx',
    ...overrides
  }, { now: new Date('2026-07-13T09:00:00.000Z') })
}

function createPlan (request) {
  const id = request.id
  return {
    provider: request.recoveryProvider,
    operationDir: `~/.shellpilot/operations/${id}/`,
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
  assert.doesNotMatch(remoteCalls[0].command, /systemctl start nginx/)
  assert.equal(prepared.plan.summary, 'recovery for op-1')
  assert.equal(prepared.artifacts.manifest, '~/.shellpilot/operations/op-1/manifest.json')

  await assert.rejects(
    runner.execute('op-1', { confirmed: false }),
    /确认/
  )
  const result = await runner.execute('op-1', { confirmed: true })

  assert.equal(result.state, 'rollback-available')
  assert.deepEqual(remoteCalls.map(call => call.options.phase), ['prepare', 'execute'])
  assert.match(remoteCalls[1].command, /systemctl start nginx/)
  assert.deepEqual(store.transitions.slice(-3), [
    'executing',
    'verification-passed',
    'rollback-available'
  ])
})

test('external PTY execution begins after prepare without running the user command remotely', async () => {
  const { runner, request, store, remoteCalls } = await createPreparedRunner()

  const begun = await runner.beginExternalExecution(request.id, {
    confirmed: true
  })

  assert.equal(begun.state, 'executing')
  assert.match(begun.executionId, /^op-1-external-/)
  assert.deepEqual(remoteCalls.map(call => call.options.phase), ['prepare'])
  assert.equal(remoteCalls.some(call => call.command.includes(request.command)), false)
  assert.equal((await store.get(request.id)).executionId, begun.executionId)
})

test('external PTY exit zero makes verified recovery rollback available', async () => {
  const { runner, request, store, remoteCalls } = await createPreparedRunner()
  const begun = await runner.beginExternalExecution(request.id, {
    confirmed: true
  })

  const completed = await runner.completeExternalExecution(request.id, {
    executionId: begun.executionId,
    command: request.command,
    exitCode: 0
  })

  assert.equal(completed.state, 'rollback-available')
  assert.equal(completed.executionId, undefined)
  assert.equal(completed.plan.executeCommand, request.command)
  assert.deepEqual(remoteCalls.map(call => call.options.phase), ['prepare'])
  assert.equal((await store.get(request.id)).state, 'rollback-available')
})

test('rollback recovers a verification-passed transaction left by a crash', async () => {
  const context = await createPreparedRunner()
  await context.runner.execute(context.request.id, { confirmed: true })
  await context.store.patch(context.request.id, {
    state: 'verification-passed',
    completedAt: undefined
  })
  const callsBeforeRollback = context.remoteCalls.length

  const restored = await context.runner.rollback(context.request.id)

  assert.equal(restored.state, 'restored')
  assert.deepEqual(
    context.remoteCalls.slice(callsBeforeRollback).map(call => call.options.phase),
    ['rollback', 'verify']
  )
  assert.equal((await context.store.get(context.request.id)).state, 'restored')
})

test('external PTY nonzero and interrupted exits fail while preserving rollback', async t => {
  for (const exitCode of [7, null]) {
    await t.test(String(exitCode), async () => {
      const request = await createRequest({ id: `op-external-${exitCode}` })
      const { runner, store } = await createPreparedRunner({ request })
      const begun = await runner.beginExternalExecution(request.id, {
        confirmed: true
      })

      const completed = await runner.completeExternalExecution(request.id, {
        executionId: begun.executionId,
        command: request.command,
        exitCode
      })

      assert.equal(completed.state, 'failed')
      assert.equal(completed.plan.rollbackCommand.length > 0, true)
      assert.equal(completed.recoveryReadyAt.length > 0, true)
      assert.equal((await store.get(request.id)).state, 'failed')
    })
  }
})

test('external PTY completion rejects unrelated events and idempotently accepts the same identity', async () => {
  const { runner, request, store } = await createPreparedRunner()
  const begun = await runner.beginExternalExecution(request.id, {
    confirmed: true
  })

  await assert.rejects(
    runner.completeExternalExecution(request.id, {
      executionId: 'op-1-external-stale',
      command: request.command,
      exitCode: 0
    }),
    /执行标识/
  )
  await assert.rejects(
    runner.completeExternalExecution(request.id, {
      executionId: begun.executionId,
      command: '/usr/bin/uptime',
      exitCode: 0
    }),
    /命令不匹配/
  )
  assert.equal((await store.get(request.id)).state, 'executing')

  const completed = await runner.completeExternalExecution(request.id, {
    executionId: begun.executionId,
    command: request.command,
    exitCode: 0
  })
  const repeated = await runner.completeExternalExecution(request.id, {
    executionId: begun.executionId,
    command: request.command,
    exitCode: 0
  })
  assert.equal(repeated.state, completed.state)
  assert.equal(repeated.audit.length, completed.audit.length)
  await assert.rejects(runner.completeExternalExecution(request.id, {
    executionId: begun.executionId,
    command: request.command,
    exitCode: 7
  }), /完成记录|执行标识|匹配/)
})

test('external PTY completion retries idempotently after the terminal state was persisted before an error', async () => {
  const baseStore = createMemoryStore()
  let failResponse = true
  const store = {
    ...baseStore,
    async guardedPatch (id, predicate, value) {
      const updated = await baseStore.guardedPatch(id, predicate, value)
      if (updated.state === 'rollback-available' && failResponse) {
        failResponse = false
        throw new Error('终态已写入但响应丢失')
      }
      return updated
    }
  }
  const { runner, request } = await createPreparedRunner({ store })
  const begun = await runner.beginExternalExecution(request.id, {
    confirmed: true
  })
  const completion = {
    executionId: begun.executionId,
    command: request.command,
    exitCode: 0
  }

  await assert.rejects(
    runner.completeExternalExecution(request.id, completion),
    /终态已写入但响应丢失/
  )
  const persisted = await baseStore.get(request.id)
  assert.equal(persisted.state, 'rollback-available')
  const auditLength = persisted.audit.length

  const retried = await runner.completeExternalExecution(request.id, completion)
  assert.equal(retried.state, 'rollback-available')
  assert.equal(retried.audit.length, auditLength)
})

test('external nonreversible PTY execution requires unsafe confirmation without rollback', async () => {
  const request = await createRequest({
    id: 'op-external-unknown',
    source: 'terminal',
    command: 'custom-admin-tool --rotate'
  })
  const { runner, remoteCalls } = await createPreparedRunner({ request })

  await assert.rejects(
    runner.beginExternalExecution(request.id, { confirmed: true }),
    /unsafe/
  )
  const begun = await runner.beginExternalExecution(request.id, {
    confirmed: true,
    allowUnsafe: true
  })
  const completed = await runner.completeExternalExecution(request.id, {
    executionId: begun.executionId,
    command: request.command,
    exitCode: 0
  })

  assert.equal(completed.state, 'kept')
  assert.equal(completed.reversible, false)
  assert.equal(completed.plan, undefined)
  assert.deepEqual(remoteCalls, [])
})

test('prepare persists a recovery binding and execute rejects same-provider command tampering', async () => {
  const context = await createPreparedRunner({
    request: await createRequest({ id: 'op-binding-command' })
  })
  const prepared = await context.store.get(context.request.id)
  assert.equal(prepared.recoveryBinding.schemaVersion, 1)
  assert.equal(prepared.recoveryBinding.algorithm, 'SHA-256')
  assert.match(prepared.recoveryBinding.fingerprint, /^[a-f0-9]{64}$/)

  await context.store.patch(context.request.id, {
    command: '/usr/bin/systemctl start sshd'
  })
  const callsBeforeExecute = context.remoteCalls.length
  await assert.rejects(
    context.runner.execute(context.request.id, { confirmed: true }),
    /恢复绑定|指纹|不一致/
  )
  assert.equal(context.remoteCalls.length, callsBeforeExecute)
})

test('prepare persists the complete immutable recovery plan with a prepare command hash', async () => {
  const context = await createPreparedRunner({
    request: await createRequest({ id: 'op-binding-plan' })
  })
  const prepared = await context.store.get(context.request.id)

  assert.match(prepared.plan.prepareCommandHash, /^[a-f0-9]{64}$/)
  assert.equal(prepared.plan.executeCommand, context.request.command)
  assert.equal(prepared.plan.rollbackCommand, createPlan(context.request).rollbackCommand)
  assert.equal(prepared.plan.verifyCommand, createPlan(context.request).verifyCommand)
  assert.equal(prepared.plan.allowUnsafeExecute, true)
  assert.deepEqual(prepared.plan.artifacts, prepared.artifacts)
})

test('execute rejects persisted execute command or artifact tampering without a remote call', async () => {
  const cases = [
    {
      id: 'op-binding-execute-command',
      patch: operation => ({
        plan: {
          ...operation.plan,
          executeCommand: '/usr/bin/systemctl start sshd'
        }
      })
    },
    {
      id: 'op-binding-artifact',
      patch: operation => ({
        artifacts: {
          ...operation.artifacts,
          manifest: '~/.shellpilot/operations/forged/manifest.json'
        }
      })
    }
  ]

  for (const item of cases) {
    const context = await createPreparedRunner({
      request: await createRequest({ id: item.id })
    })
    const prepared = await context.store.get(item.id)
    await context.store.patch(item.id, item.patch(prepared))
    const callsBeforeExecute = context.remoteCalls.length

    await assert.rejects(
      context.runner.execute(item.id, { confirmed: true }),
      /恢复绑定|指纹|不一致/
    )
    assert.equal(context.remoteCalls.length, callsBeforeExecute, item.id)
  }
})

test('execute rejects endpoint tampering even when the live endpoint follows the forged record', async () => {
  const context = await createPreparedRunner({
    request: await createRequest({ id: 'op-binding-endpoint' }),
    getCurrentEndpoint: async operation => operation.endpoint
  })
  const prepared = await context.store.get(context.request.id)
  await context.store.patch(context.request.id, {
    endpoint: { ...prepared.endpoint, host: 'forged.example.com' }
  })

  const callsBeforeExecute = context.remoteCalls.length
  await assert.rejects(
    context.runner.execute(context.request.id, { confirmed: true }),
    /恢复绑定|指纹|不一致/
  )
  assert.equal(context.remoteCalls.length, callsBeforeExecute)
})

test('rollback rejects a recovery operationDir changed after execute', async () => {
  const context = await createPreparedRunner({
    request: await createRequest({ id: 'op-binding-rollback' })
  })
  await context.runner.execute(context.request.id, { confirmed: true })
  const executed = await context.store.get(context.request.id)
  await context.store.patch(context.request.id, {
    plan: {
      ...executed.plan,
      operationDir: '~/.shellpilot/operations/forged/'
    }
  })

  const callsBeforeRollback = context.remoteCalls.length
  await assert.rejects(
    context.runner.rollback(context.request.id),
    /恢复绑定|指纹|不一致/
  )
  assert.equal(context.remoteCalls.length, callsBeforeRollback)
})

test('rollback rejects persisted rollback or verify command tampering without a remote call', async () => {
  for (const field of ['rollbackCommand', 'verifyCommand']) {
    const id = `op-binding-${field}`
    const context = await createPreparedRunner({
      request: await createRequest({ id })
    })
    await context.runner.execute(id, { confirmed: true })
    const executed = await context.store.get(id)
    await context.store.patch(id, {
      plan: {
        ...executed.plan,
        [field]: `${field}-was-forged`
      }
    })
    const callsBeforeRollback = context.remoteCalls.length

    await assert.rejects(
      context.runner.rollback(id),
      /恢复绑定|指纹|不一致/
    )
    assert.equal(context.remoteCalls.length, callsBeforeRollback, field)
  }
})

test('verify rechecks the full persisted plan after rollback completes', async () => {
  const request = await createRequest({ id: 'op-binding-verify' })
  const store = createMemoryStore()
  const phases = []
  const context = await createPreparedRunner({
    request,
    store,
    runRemote: async (command, options) => {
      phases.push(options.phase)
      if (options.phase === 'rollback') {
        const rollingBack = await store.get(request.id)
        await store.patch(request.id, {
          plan: {
            ...rollingBack.plan,
            verifyCommand: 'verify-command-was-forged-during-rollback'
          }
        })
      }
      return { stdout: marker(options.phase, request.id), code: 0 }
    }
  })
  await context.runner.execute(request.id, { confirmed: true })

  await assert.rejects(
    context.runner.rollback(request.id),
    /恢复绑定|指纹|不一致/
  )
  assert.deepEqual(phases, ['prepare', 'execute', 'rollback'])
})

test('execute post-check restores the bound plan when persistence changes while remote is pending', async () => {
  const request = await createRequest({ id: 'op-binding-execute-pending' })
  let resolveExecute
  const phases = []
  const context = await createPreparedRunner({
    request,
    runRemote: async (command, options) => {
      phases.push(options.phase)
      if (options.phase === 'execute') {
        return new Promise(resolve => { resolveExecute = resolve })
      }
      return { stdout: marker(options.phase, request.id), code: 0 }
    }
  })
  const prepared = await context.store.get(request.id)
  const bound = {
    plan: clone(prepared.plan),
    artifacts: clone(prepared.artifacts),
    recoveryBinding: clone(prepared.recoveryBinding)
  }
  const execution = context.runner.execute(request.id, { confirmed: true })
  await waitFor(() => Boolean(resolveExecute))
  const executing = await context.store.get(request.id)
  await context.store.patch(request.id, {
    plan: {
      ...executing.plan,
      executeCommand: '/usr/bin/systemctl start sshd'
    },
    artifacts: {
      ...executing.artifacts,
      manifest: '~/.shellpilot/operations/forged/manifest.json'
    }
  })
  resolveExecute({ stdout: marker('execute', request.id), code: 0 })

  await assert.rejects(execution, /完整性|恢复绑定|指纹|不一致/)
  const failed = await context.store.get(request.id)
  assert.equal(failed.state, 'failed')
  assert.match(failed.integrityError, /完整性|恢复绑定|指纹|不一致/)
  assert.deepEqual(failed.plan, bound.plan)
  assert.deepEqual(failed.artifacts, bound.artifacts)
  assert.deepEqual(failed.recoveryBinding, bound.recoveryBinding)
  assert.deepEqual(phases, ['prepare', 'execute'])
  assert.equal((await context.runner.rollback(request.id)).state, 'restored')
})

test('verify post-check refuses restored and repairs rollback fields after pending-plan tampering', async () => {
  const request = await createRequest({ id: 'op-binding-verify-pending' })
  let resolveVerify
  let verifyAttempts = 0
  const phases = []
  const context = await createPreparedRunner({
    request,
    runRemote: async (command, options) => {
      phases.push(options.phase)
      if (options.phase === 'verify' && verifyAttempts++ === 0) {
        return new Promise(resolve => { resolveVerify = resolve })
      }
      return { stdout: marker(options.phase, request.id), code: 0 }
    }
  })
  await context.runner.execute(request.id, { confirmed: true })
  const rollbackAvailable = await context.store.get(request.id)
  const bound = {
    plan: clone(rollbackAvailable.plan),
    artifacts: clone(rollbackAvailable.artifacts),
    recoveryBinding: clone(rollbackAvailable.recoveryBinding)
  }
  const rollback = context.runner.rollback(request.id)
  await waitFor(() => Boolean(resolveVerify))
  const verifying = await context.store.get(request.id)
  await context.store.patch(request.id, {
    plan: {
      ...verifying.plan,
      verifyCommand: 'verify-command-was-forged-while-pending'
    }
  })
  resolveVerify({ stdout: marker('verify', request.id), code: 0 })

  await assert.rejects(rollback, /完整性|恢复绑定|指纹|不一致/)
  const failed = await context.store.get(request.id)
  assert.equal(failed.state, 'failed')
  assert.match(failed.integrityError, /完整性|恢复绑定|指纹|不一致/)
  assert.deepEqual(failed.plan, bound.plan)
  assert.deepEqual(failed.artifacts, bound.artifacts)
  assert.deepEqual(failed.recoveryBinding, bound.recoveryBinding)
  assert.notEqual(failed.state, 'restored')
  assert.deepEqual(phases, ['prepare', 'execute', 'rollback', 'verify'])
  assert.equal((await context.runner.rollback(request.id)).state, 'restored')
})

test('execute success guard detects a store patch in the exact post-remote window', async () => {
  const request = await createRequest({ id: 'op-atomic-execute-window' })
  const baseStore = createMemoryStore()
  let injectTamper = false
  let injected = false
  const guardedPatch = async (id, predicate, value) => {
    if (injectTamper && !injected) {
      injected = true
      const current = await baseStore.get(id)
      await baseStore.patch(id, {
        plan: {
          ...current.plan,
          executeCommand: '/usr/bin/systemctl start sshd'
        }
      })
    }
    return baseStore.guardedPatch(id, predicate, value)
  }
  const store = {
    ...baseStore,
    guardedPatch,
    guardedPatchOperation: guardedPatch
  }
  const context = await createPreparedRunner({
    request,
    store,
    runRemote: async (command, options) => {
      if (options.phase === 'execute') injectTamper = true
      return { stdout: marker(options.phase, request.id), code: 0 }
    }
  })
  const prepared = await store.get(request.id)

  await assert.rejects(
    context.runner.execute(request.id, { confirmed: true }),
    /完整性|恢复绑定|原子更新/
  )
  const failed = await store.get(request.id)
  assert.equal(injected, true)
  assert.equal(failed.state, 'failed')
  assert.deepEqual(failed.plan, prepared.plan)
  assert.notEqual(failed.state, 'rollback-available')
})

test('verify success guard detects a store patch before the atomic restored write', async () => {
  const request = await createRequest({ id: 'op-atomic-verify-window' })
  const baseStore = createMemoryStore()
  let injectTamper = false
  let injected = false
  const guardedPatch = async (id, predicate, value) => {
    if (injectTamper && !injected) {
      injected = true
      const current = await baseStore.get(id)
      await baseStore.patch(id, {
        plan: {
          ...current.plan,
          verifyCommand: 'verify-command-was-forged-after-remote'
        }
      })
    }
    return baseStore.guardedPatch(id, predicate, value)
  }
  const store = {
    ...baseStore,
    guardedPatch,
    guardedPatchOperation: guardedPatch
  }
  const context = await createPreparedRunner({
    request,
    store,
    runRemote: async (command, options) => {
      if (options.phase === 'verify') injectTamper = true
      return { stdout: marker(options.phase, request.id), code: 0 }
    }
  })
  await context.runner.execute(request.id, { confirmed: true })
  const bound = await store.get(request.id)

  await assert.rejects(
    context.runner.rollback(request.id),
    /完整性|恢复绑定|原子更新/
  )
  const failed = await store.get(request.id)
  assert.equal(injected, true)
  assert.equal(failed.state, 'failed')
  assert.deepEqual(failed.plan, bound.plan)
  assert.notEqual(failed.state, 'restored')
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

test('truncated transport head and tail cannot fabricate a valid prepare marker', async () => {
  const { createBoundedOutputCollector } = require(path.resolve(
    __dirname,
    '../../src/app/server/session-common.js'
  ))
  const { createTransactionRunner } = await importDomainModule('transaction-runner.js')
  const request = await createRequest({ id: 'op-join-attack' })
  const store = createMemoryStore()
  const collector = createBoundedOutputCollector(256)
  const markerPrefix = '\n__SHELLPILOT_PREPARE_RC_op-join-attack'
  const head = 'h'.repeat(128 - markerPrefix.length) + markerPrefix
  const tail = '=0\n' + 't'.repeat(125)
  const original = head + 'middle-data'.repeat(80) + tail
  collector.append(Buffer.from(original))
  const runner = createTransactionRunner({
    runRemote: async () => ({ stdout: collector.toString(), code: 0 }),
    cancelRemote: async () => {},
    store,
    getCurrentEndpoint: async () => request.endpoint,
    buildRecoveryPlan: createPlan,
    now: createClock()
  })

  assert.doesNotMatch(original, /^__SHELLPILOT_PREPARE_RC_op-join-attack=0$/m)
  await assert.rejects(runner.prepare(request), /标记|状态/)
  assert.equal((await store.get(request.id)).state, 'failed')
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
    },
    {
      id: 'op-transport-signal',
      result: {
        stdout: marker('prepare', 'op-transport-signal'),
        code: null,
        signal: 'TERM'
      },
      expected: /TERM|信号|中断/
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

test('prepare restores authoritative recovery for a forged nonreversible claim', async () => {
  const { createTransactionRunner } = await importDomainModule('transaction-runner.js')
  const classified = await createRequest({ id: 'op-forged-recovery-prepare' })
  const forged = {
    ...classified,
    reversible: false,
    recoveryProvider: null
  }
  const store = createMemoryStore()
  const phases = []
  let planInput
  const runner = createTransactionRunner({
    runRemote: async (command, options) => {
      phases.push(options.phase)
      return { stdout: marker(options.phase, forged.id), code: 0 }
    },
    cancelRemote: async () => {},
    store,
    getCurrentEndpoint: async () => forged.endpoint,
    buildRecoveryPlan: operation => {
      planInput = clone(operation)
      return createPlan(operation)
    },
    now: createClock()
  })

  const prepared = await runner.prepare(forged)

  assert.equal(prepared.state, 'awaiting-confirmation')
  assert.equal(prepared.reversible, true)
  assert.equal(prepared.recoveryProvider, 'systemd')
  assert.equal(planInput.recoveryProvider, 'systemd')
  assert.ok(prepared.plan?.rollbackCommand)
  assert.deepEqual(phases, ['prepare'])
})

test('execute cannot use unsafe mode after persisted recovery classification tampering', async () => {
  const { createTransactionRunner } = await importDomainModule('transaction-runner.js')
  const request = await createRequest({ id: 'op-tampered-recovery-execute' })
  const store = createMemoryStore()
  await store.save({
    ...request,
    state: 'awaiting-confirmation',
    reversible: false,
    recoveryProvider: null
  })
  const calls = []
  const runner = createTransactionRunner({
    runRemote: async (command, options) => {
      calls.push({ command, options })
      return { stdout: marker(options.phase, request.id), code: 0 }
    },
    cancelRemote: async () => {},
    store,
    getCurrentEndpoint: async () => request.endpoint,
    buildRecoveryPlan: createPlan,
    now: createClock()
  })

  await assert.rejects(
    runner.execute(request.id, { confirmed: true, allowUnsafe: true }),
    /recovery-ready/
  )
  const failed = await store.get(request.id)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.reversible, true)
  assert.equal(failed.recoveryProvider, 'systemd')
  assert.equal(calls.length, 0)
})

test('persisted stricter risk cannot bypass authoritative recovery requirements', async t => {
  const { createTransactionRunner } = await importDomainModule('transaction-runner.js')
  for (const risk of ['unknown', 'blocked']) {
    await t.test(risk, async () => {
      const prepareRequest = {
        ...await createRequest({ id: `op-risk-${risk}-prepare` }),
        risk,
        reversible: false,
        recoveryProvider: null
      }
      const prepareStore = createMemoryStore()
      const prepareCalls = []
      const prepareRunner = createTransactionRunner({
        runRemote: async (command, options) => {
          prepareCalls.push({ command, options })
          return { stdout: marker(options.phase, prepareRequest.id), code: 0 }
        },
        cancelRemote: async () => {},
        store: prepareStore,
        getCurrentEndpoint: async () => prepareRequest.endpoint,
        buildRecoveryPlan: createPlan,
        now: createClock()
      })

      await assert.rejects(
        prepareRunner.prepare(prepareRequest),
        /分类|伪造|blocked|恢复|recovery/
      )
      assert.equal(prepareCalls.length, 0)
      const rejectedPrepare = await prepareStore.get(prepareRequest.id)
      assert.equal(rejectedPrepare.reversible, true)
      assert.equal(rejectedPrepare.recoveryProvider, 'systemd')

      const executeRequest = {
        ...await createRequest({ id: `op-risk-${risk}-execute` }),
        state: 'awaiting-confirmation',
        risk,
        reversible: false,
        recoveryProvider: null
      }
      const executeStore = createMemoryStore()
      await executeStore.save(executeRequest)
      const executeCalls = []
      const executeRunner = createTransactionRunner({
        runRemote: async (command, options) => {
          executeCalls.push({ command, options })
          return { stdout: marker(options.phase, executeRequest.id), code: 0 }
        },
        cancelRemote: async () => {},
        store: executeStore,
        getCurrentEndpoint: async () => executeRequest.endpoint,
        buildRecoveryPlan: createPlan,
        now: createClock()
      })

      await assert.rejects(
        executeRunner.execute(executeRequest.id, {
          confirmed: true,
          allowUnsafe: true
        }),
        /分类|伪造|blocked|恢复|recovery/
      )
      assert.equal(executeCalls.length, 0)
      const rejectedExecute = await executeStore.get(executeRequest.id)
      assert.equal(rejectedExecute.reversible, true)
      assert.equal(rejectedExecute.recoveryProvider, 'systemd')
    })
  }
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
    ...await createRequest({
      id: 'op-network-unsafe',
      command: 'ip link set dev eth0 down && whoami'
    }),
    state: 'awaiting-confirmation',
    risk: 'change',
    reversible: false,
    recoveryProvider: 'network'
  }
  const networkStore = createMemoryStore()
  await networkStore.save(network)
  const networkCalls = []
  const { createTransactionRunner } = await importDomainModule('transaction-runner.js')
  const networkRunner = createTransactionRunner({
    runRemote: async (command, options) => {
      networkCalls.push({ command, options })
      return { stdout: marker(options.phase, network.id), code: 0 }
    },
    cancelRemote: async () => {},
    store: networkStore,
    getCurrentEndpoint: async () => network.endpoint,
    buildRecoveryPlan: createPlan,
    now: createClock()
  })
  await assert.rejects(
    networkRunner.execute(network.id, { confirmed: true, allowUnsafe: true }),
    /网络|禁止|拒绝/
  )
  assert.equal(networkCalls.length, 0)
})

test('unknown and nonreversible changes require an explicit unsafe confirmation', async () => {
  for (const [id, command] of [
    ['op-unknown', 'custom-diagnostic --check'],
    ['op-nonreversible', '/usr/bin/systemctl start nginx && /usr/bin/chmod 600 /etc/app.conf']
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
  assert.equal((await cancelling).state, 'failed')
  assert.equal((await cancelled.store.get('op-1')).state, 'failed')
  assert.equal(
    cancelled.store.transitions.filter(state => state === 'failed').length,
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
  assert.equal((await lateCancellation).state, 'failed')
  assert.equal((await completed.store.get('op-1')).state, 'failed')
})

test('cancelRemote failure rejects with a sanitized error and never claims cancellation', async () => {
  const secret = 'cancel-transport-secret'
  let executeStarted = false
  const context = await createPreparedRunner({
    runRemote: (command, options) => {
      if (options.phase === 'prepare') {
        return Promise.resolve({ stdout: marker('prepare', 'op-1'), code: 0 })
      }
      executeStarted = true
      return new Promise(() => {})
    },
    cancelRemote: async () => {
      throw new Error(`password=${secret}`)
    }
  })
  const execution = context.runner.execute('op-1', { confirmed: true })
  await waitFor(() => executeStarted)

  const [cancelOutcome, executionOutcome] = await Promise.allSettled([
    context.runner.cancel('op-1'),
    execution
  ])

  assert.equal(cancelOutcome.status, 'rejected')
  assert.match(cancelOutcome.reason.message, /\[REDACTED\]/)
  assert.doesNotMatch(cancelOutcome.reason.message, new RegExp(secret))
  assert.equal(executionOutcome.status, 'rejected')
  assert.match(executionOutcome.reason.message, /取消/)
  const failed = await context.store.get('op-1')
  assert.equal(failed.state, 'failed')
  assert.notEqual(failed.state, 'cancelled')
  assert.match(failed.error, /\[REDACTED\]/)
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(secret))
})

test('cancelling an active reversible execute preserves recovery and permits rollback', async () => {
  let executeStarted = false
  const context = await createPreparedRunner({
    runRemote: (command, options) => {
      if (options.phase === 'execute') {
        executeStarted = true
        return new Promise(() => {})
      }
      return Promise.resolve({ stdout: marker(options.phase, 'op-1'), code: 0 })
    },
    cancelRemote: async () => {}
  })
  const bound = await context.store.get('op-1')
  const execution = context.runner.execute('op-1', { confirmed: true })
  await waitFor(() => executeStarted)

  const [cancelOutcome, executionOutcome] = await Promise.allSettled([
    context.runner.cancel('op-1'),
    execution
  ])

  assert.equal(cancelOutcome.status, 'fulfilled')
  assert.equal(cancelOutcome.value.state, 'failed')
  assert.equal(executionOutcome.status, 'rejected')
  const failed = await context.store.get('op-1')
  assert.equal(failed.state, 'failed')
  assert.deepEqual(failed.plan, bound.plan)
  assert.deepEqual(failed.artifacts, bound.artifacts)
  assert.deepEqual(failed.recoveryBinding, bound.recoveryBinding)
  assert.equal((await context.runner.rollback('op-1')).state, 'restored')
})

test('cancelling an active rollback preserves recovery and permits a retry', async () => {
  let firstRollbackStarted = false
  let rollbackAttempts = 0
  const context = await createPreparedRunner({
    runRemote: (command, options) => {
      if (options.phase === 'rollback' && rollbackAttempts++ === 0) {
        firstRollbackStarted = true
        return new Promise(() => {})
      }
      return Promise.resolve({ stdout: marker(options.phase, 'op-1'), code: 0 })
    },
    cancelRemote: async () => {}
  })
  await context.runner.execute('op-1', { confirmed: true })
  const bound = await context.store.get('op-1')
  const rollback = context.runner.rollback('op-1')
  await waitFor(() => firstRollbackStarted)

  const [cancelOutcome, rollbackOutcome] = await Promise.allSettled([
    context.runner.cancel('op-1'),
    rollback
  ])

  assert.equal(cancelOutcome.status, 'fulfilled')
  assert.equal(cancelOutcome.value.state, 'failed')
  assert.equal(rollbackOutcome.status, 'rejected')
  const failed = await context.store.get('op-1')
  assert.equal(failed.state, 'failed')
  assert.deepEqual(failed.plan, bound.plan)
  assert.deepEqual(failed.artifacts, bound.artifacts)
  assert.deepEqual(failed.recoveryBinding, bound.recoveryBinding)
  assert.equal((await context.runner.rollback('op-1')).state, 'restored')
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
  assert.equal(outcome.state, 'failed')
  await assert.rejects(execution, /取消/)
  assert.equal(cancelledExecutions.length, 1)
  assert.equal((await context.store.get('op-1')).state, 'failed')

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

test('transaction remote contracts cap output and stop consuming oversized chunks', async () => {
  const maxBytes = 64 * 1024
  const totalChunks = 100
  let chunksRead = 0
  let stderrRead = false
  let executeStarted = false
  let cancelOptions
  const remoteOptions = []
  async function * stdoutChunks (phase, id) {
    const markerLine = `${marker(phase, id)}\n`
    yield markerLine
    yield new Uint8Array(
      maxBytes - new TextEncoder().encode(markerLine).byteLength - 1
    ).fill(120)
    for (let index = 0; index < totalChunks; index += 1) {
      chunksRead += 1
      yield new Uint8Array([0xe8])
    }
  }
  async function * unreadStderr () {
    stderrRead = true
    yield 'must not be consumed'
  }
  const context = await createPreparedRunner({
    runRemote: (command, options) => {
      remoteOptions.push(options)
      if (options.phase === 'execute') {
        executeStarted = true
        return new Promise(() => {})
      }
      return Promise.resolve({
        stdout: stdoutChunks(options.phase, 'op-1'),
        stderr: unreadStderr(),
        code: 0
      })
    },
    cancelRemote: async (executionId, options) => {
      cancelOptions = options
    }
  })

  assert.equal(remoteOptions[0].maxOutputBytes, maxBytes)
  assert.ok(chunksRead > 0 && chunksRead < totalChunks)
  assert.equal(stderrRead, false)
  assert.ok(Buffer.byteLength(context.prepared.audit[0].preview, 'utf8') <= maxBytes)

  const execution = context.runner.execute('op-1', { confirmed: true })
  await waitFor(() => executeStarted)
  const [cancelOutcome, executionOutcome] = await Promise.allSettled([
    context.runner.cancel('op-1'),
    execution
  ])
  assert.equal(cancelOutcome.status, 'fulfilled')
  assert.equal(executionOutcome.status, 'rejected')
  assert.equal(remoteOptions[1].maxOutputBytes, maxBytes)
  assert.equal(cancelOptions.maxOutputBytes, maxBytes)
})

function createTaskStore () {
  return createMemoryStore()
}

function readonlyPlan (overrides = {}) {
  return {
    id: 'task-1',
    title: '检查生产服务器',
    steps: [
      { id: 'uptime', title: '运行时间', command: '/usr/bin/uptime', timeoutMs: 100 },
      { id: 'identity', title: '当前用户', command: '/usr/bin/whoami', timeoutMs: 100 }
    ],
    ...overrides
  }
}

test('task runner rejects executable commands that audit redaction would rewrite', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const calls = []
  const runner = createTaskRunner({
    runRemote: async command => {
      calls.push(command)
      return { output: 'ok', code: 0 }
    },
    cancelRemote: async () => {},
    store: createTaskStore(),
    now: createClock()
  })

  await assert.rejects(
    runner.create(readonlyPlan({
      id: 'task-command-redaction-rejected',
      steps: [{
        id: 'inspect',
        command: 'cat /srv/password=actual-value/config',
        timeoutMs: 100
      }]
    })),
    /命令|敏感|凭据|拒绝/
  )
  assert.deepEqual(calls, [])
})

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
  assert.deepEqual(calls.map(call => call.command), ['/usr/bin/uptime', '/usr/bin/whoami'])
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

test('task runner rejects a persisted executable plan swap after confirmation', async () => {
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
    id: 'task-confirmed-plan-tamper',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      pid: 1001
    },
    steps: [
      {
        id: 'first',
        title: 'First check',
        command: '/usr/bin/uptime',
        purpose: 'check availability',
        timeoutMs: 100
      },
      {
        id: 'second',
        title: 'Second check',
        command: '/usr/bin/whoami',
        purpose: 'check identity',
        timeoutMs: 200
      }
    ]
  }))
  const confirmed = await runner.confirmPlan(task.id)
  assert.equal(confirmed.planGrant.algorithm, 'SHA-256')
  assert.match(confirmed.planGrant.digest, /^[a-f0-9]{64}$/)
  await store.patch(task.id, {
    steps: [confirmed.steps[1], confirmed.steps[0]]
  })

  await assert.rejects(runner.run(task.id), /计划|绑定|篡改/)
  assert.deepEqual(calls, [])
  const rejected = await store.get(task.id)
  assert.equal(rejected.status, 'awaiting-change-confirmation')
  assert.equal(rejected.completedAt, undefined)
  assert.equal(rejected.reasonCode, 'PLAN_BINDING_CHANGED')
  assert.match(rejected.error, /计划|绑定|篡改/)
})

test('task remote output is capped before consuming all chunks', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const maxBytes = 64 * 1024
  const totalChunks = 100
  let chunksRead = 0
  let stderrRead = false
  let runOptions
  async function * outputChunks () {
    for (let index = 0; index < totalChunks; index += 1) {
      chunksRead += 1
      yield 'x'.repeat(16 * 1024)
    }
  }
  async function * unreadStderr () {
    stderrRead = true
    yield 'must not be consumed'
  }
  const runner = createTaskRunner({
    runRemote: async (command, options) => {
      runOptions = options
      return { output: outputChunks(), stderr: unreadStderr(), code: 0 }
    },
    cancelRemote: async () => {},
    store: createTaskStore(),
    now: createClock()
  })
  const task = await runner.create(readonlyPlan({
    steps: [{ id: 'bounded', command: '/usr/bin/uptime', timeoutMs: 100 }]
  }))
  await runner.confirmPlan(task.id)

  const completed = await runner.run(task.id)

  assert.equal(runOptions.maxOutputBytes, maxBytes)
  assert.ok(chunksRead > 0 && chunksRead < totalChunks)
  assert.equal(stderrRead, false)
  assert.ok(Buffer.byteLength(completed.steps[0].output, 'utf8') <= maxBytes)
})

test('task runner fails closed without an explicit finite numeric exit code', async t => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const invalidResults = [
    ['undefined', undefined],
    ['null', null],
    ['number', 0],
    ['string', 'ok'],
    ['missing-code', { output: 'ok' }],
    ['nan-code', { output: 'ok', code: Number.NaN }],
    ['infinite-code', { output: 'ok', code: Number.POSITIVE_INFINITY }],
    ['numeric-string-code', { output: 'ok', code: '0' }]
  ]

  for (const [label, result] of invalidResults) {
    await t.test(label, async () => {
      const store = createTaskStore()
      const runner = createTaskRunner({
        runRemote: async () => result,
        cancelRemote: async () => {},
        store,
        now: createClock()
      })
      const task = await runner.create(readonlyPlan({
        id: `task-invalid-result-${label}`,
        steps: [{ id: 'invalid', command: '/usr/bin/uptime', timeoutMs: 100 }]
      }))
      await runner.confirmPlan(task.id)

      await assert.rejects(runner.run(task.id), /退出码|远程结果/)
      const failed = await store.get(task.id)
      assert.equal(failed.status, 'failed')
      assert.equal(failed.steps[0].status, 'failed')
    })
  }
})

test('task runner records a terminal partial failure before a classifier-detected change step', async () => {
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
      { id: 'uptime', command: '/usr/bin/uptime', timeoutMs: 100 },
      {
        id: 'restart',
        command: '/usr/bin/systemctl start nginx',
        timeoutMs: 100,
        readOnly: true,
        risk: 'readonly'
      },
      { id: 'identity', command: '/usr/bin/whoami', timeoutMs: 100 }
    ]
  }))
  await runner.confirmPlan(task.id)
  await assert.rejects(runner.run(task.id), /只读|分类|风险|拒绝/)
  const stopped = await store.get(task.id)

  assert.equal(stopped.status, 'partially-completed')
  assert.deepEqual(calls, ['/usr/bin/uptime'])
  assert.equal(stopped.steps[0].status, 'completed')
  assert.equal(stopped.steps[1].status, 'failed')
  assert.equal(stopped.steps[2].status, 'pending')
  assert.equal(typeof stopped.completedAt, 'string')
  assert.equal(typeof stopped.error, 'string')
})

test('task cancellation during delayed running patch never starts or cancels a remote execution', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const baseStore = createTaskStore()
  let releaseRunningPatch
  let markRunningPatchStarted
  let delayed = false
  const runningPatchStarted = new Promise(resolve => { markRunningPatchStarted = resolve })
  const runningPatchRelease = new Promise(resolve => { releaseRunningPatch = resolve })
  const store = {
    ...baseStore,
    async patch (id, patch) {
      if (!delayed && patch.steps?.some(step => step.status === 'running')) {
        delayed = true
        markRunningPatchStarted()
        await runningPatchRelease
      }
      return baseStore.patch(id, patch)
    }
  }
  let runCalls = 0
  let cancelCalls = 0
  const runner = createTaskRunner({
    store,
    runRemote: async () => {
      runCalls += 1
      return { output: 'must not run', code: 0 }
    },
    cancelRemote: async () => { cancelCalls += 1 },
    now: createClock()
  })
  const task = await runner.create(readonlyPlan({
    id: 'task-cancel-delayed-running-patch',
    steps: [{ id: 'delayed', command: '/usr/bin/uptime', timeoutMs: 100 }]
  }))
  await runner.confirmPlan(task.id)
  const abort = new AbortController()
  const running = runner.run(task.id, { signal: abort.signal })
  await runningPatchStarted

  abort.abort()
  let cancelSettled = false
  const cancelling = runner.cancel(task.id).then(value => {
    cancelSettled = true
    return value
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(cancelSettled, false)
  releaseRunningPatch()

  const [runOutcome, cancelOutcome] = await Promise.allSettled([running, cancelling])
  const finalTask = await store.get(task.id)
  assert.equal(runOutcome.status, 'rejected')
  assert.equal(cancelOutcome.status, 'fulfilled')
  assert.equal(cancelOutcome.value.status, 'cancelled')
  assert.equal(finalTask.status, 'cancelled')
  assert.equal(finalTask.steps[0].status, 'cancelled')
  assert.equal(runCalls, 0)
  assert.equal(cancelCalls, 0)
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
      { id: 'slow', command: '/usr/bin/uptime', timeoutMs: 10 },
      { id: 'never', command: '/usr/bin/whoami', timeoutMs: 100 }
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

test('task signal abort fails honestly when remote cancellation fails', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  const controller = new AbortController()
  const secret = 'signal-cancel-secret'
  let activeStarted = false
  let cancelCalls = 0
  const runner = createTaskRunner({
    runRemote: async () => {
      activeStarted = true
      return new Promise(() => {})
    },
    cancelRemote: async () => {
      cancelCalls += 1
      throw new Error(`token=${secret} cancel-control-failed`)
    },
    store,
    now: createClock()
  })
  const task = await runner.create(readonlyPlan({
    id: 'task-signal-cancel-failure',
    steps: [{ id: 'active', command: '/usr/bin/uptime', timeoutMs: 1000 }]
  }))
  await runner.confirmPlan(task.id)
  const running = runner.run(task.id, { signal: controller.signal })
  await waitFor(() => activeStarted)

  controller.abort()

  await assert.rejects(running, error => {
    assert.match(error.message, /cancel-control-failed/)
    assert.match(error.message, /\[REDACTED\]/)
    assert.doesNotMatch(error.message, new RegExp(secret))
    return true
  })
  const failed = await store.get(task.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.steps[0].status, 'failed')
  assert.equal(cancelCalls, 1)
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(secret))
})

test('task signal abort cannot commit remote success while cancellation is pending', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  const controller = new AbortController()
  const secret = 'signal-race-cancel-secret'
  let resolveRemote
  let rejectCancellation
  let cancelCalls = 0
  let markCancellationStarted
  const cancellationStarted = new Promise(resolve => {
    markCancellationStarted = resolve
  })
  const runner = createTaskRunner({
    runRemote: async () => new Promise(resolve => { resolveRemote = resolve }),
    cancelRemote: async () => {
      cancelCalls += 1
      return new Promise((resolve, reject) => {
        rejectCancellation = reject
        markCancellationStarted()
      })
    },
    store,
    now: createClock()
  })
  const task = await runner.create(readonlyPlan({
    id: 'task-signal-success-cancel-race',
    steps: [{ id: 'active', command: '/usr/bin/uptime', timeoutMs: 1000 }]
  }))
  await runner.confirmPlan(task.id)
  const running = runner.run(task.id, { signal: controller.signal })
  await waitFor(() => Boolean(resolveRemote))

  controller.abort()
  await cancellationStarted
  resolveRemote({ output: 'late remote success', code: 0 })
  await new Promise(resolve => setImmediate(resolve))
  rejectCancellation(new Error(`token=${secret} signal-race-cancel-failed`))

  await assert.rejects(running, error => {
    assert.match(error.message, /signal-race-cancel-failed/)
    assert.match(error.message, /\[REDACTED\]/)
    assert.doesNotMatch(error.message, new RegExp(secret))
    return true
  })
  const failed = await store.get(task.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.steps[0].status, 'failed')
  assert.equal(cancelCalls, 1)
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(secret))
})

test('task timeout fails honestly when remote cancellation fails', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  const secret = 'timeout-cancel-secret'
  let cancelCalls = 0
  const runner = createTaskRunner({
    runRemote: async () => new Promise(() => {}),
    cancelRemote: async () => {
      cancelCalls += 1
      throw new Error(`password=${secret} timeout-cancel-control-failed`)
    },
    store,
    now: createClock()
  })
  const task = await runner.create(readonlyPlan({
    id: 'task-timeout-cancel-failure',
    steps: [{ id: 'slow', command: '/usr/bin/uptime', timeoutMs: 10 }]
  }))
  await runner.confirmPlan(task.id)

  await assert.rejects(runner.run(task.id), error => {
    assert.match(error.message, /timeout-cancel-control-failed/)
    assert.match(error.message, /\[REDACTED\]/)
    assert.doesNotMatch(error.message, new RegExp(secret))
    return true
  })
  const failed = await store.get(task.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.steps[0].status, 'failed')
  assert.equal(cancelCalls, 1)
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(secret))
})

test('task timeout cannot commit remote success while cancellation is pending', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  const secret = 'timeout-race-cancel-secret'
  let resolveRemote
  let rejectCancellation
  let cancelCalls = 0
  let markCancellationStarted
  const cancellationStarted = new Promise(resolve => {
    markCancellationStarted = resolve
  })
  const runner = createTaskRunner({
    runRemote: async () => new Promise(resolve => { resolveRemote = resolve }),
    cancelRemote: async () => {
      cancelCalls += 1
      return new Promise((resolve, reject) => {
        rejectCancellation = reject
        markCancellationStarted()
      })
    },
    store,
    now: createClock()
  })
  const task = await runner.create(readonlyPlan({
    id: 'task-timeout-success-cancel-race',
    steps: [{ id: 'slow', command: '/usr/bin/uptime', timeoutMs: 10 }]
  }))
  await runner.confirmPlan(task.id)
  const running = runner.run(task.id)
  await waitFor(() => Boolean(resolveRemote))
  await cancellationStarted

  resolveRemote({ output: 'late remote success', code: 0 })
  await new Promise(resolve => setImmediate(resolve))
  rejectCancellation(new Error(`password=${secret} timeout-race-cancel-failed`))

  await assert.rejects(running, error => {
    assert.match(error.message, /timeout-race-cancel-failed/)
    assert.match(error.message, /\[REDACTED\]/)
    assert.doesNotMatch(error.message, new RegExp(secret))
    return true
  })
  const failed = await store.get(task.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.steps[0].status, 'failed')
  assert.equal(cancelCalls, 1)
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(secret))
})

test('task cancellation stops later steps and preserves completed progress', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  let rejectActive
  const cancelledExecutions = []
  const runner = createTaskRunner({
    runRemote: async command => {
      if (command === '/usr/bin/uptime') return { output: 'first complete', code: 0 }
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
      { id: 'first', command: '/usr/bin/uptime', timeoutMs: 100 },
      { id: 'active', command: '/usr/bin/whoami', timeoutMs: 1000 },
      { id: 'never', command: '/usr/bin/pwd', timeoutMs: 100 }
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

test('task cancelRemote failure surfaces a sanitized error and records failure', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const secret = 'task-cancel-secret'
  let activeStarted = false
  const store = createTaskStore()
  const runner = createTaskRunner({
    runRemote: async () => {
      activeStarted = true
      return new Promise(() => {})
    },
    cancelRemote: async () => {
      throw new Error(`token=${secret}`)
    },
    store,
    now: createClock()
  })
  const task = await runner.create(readonlyPlan({
    steps: [{ id: 'active', command: '/usr/bin/uptime', timeoutMs: 1000 }]
  }))
  await runner.confirmPlan(task.id)
  const running = runner.run(task.id)
  await waitFor(() => activeStarted)

  const [cancelOutcome, runOutcome] = await Promise.allSettled([
    runner.cancel(task.id),
    running
  ])

  assert.equal(cancelOutcome.status, 'rejected')
  assert.match(cancelOutcome.reason.message, /\[REDACTED\]/)
  assert.doesNotMatch(cancelOutcome.reason.message, new RegExp(secret))
  assert.equal(runOutcome.status, 'rejected')
  const failed = await store.get(task.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.steps[0].status, 'failed')
  assert.match(failed.error, /\[REDACTED\]/)
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(secret))
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
    steps: [{ id: 'uptime', command: '/usr/bin/uptime', timeoutMs: 100 }]
  }))
  await runner.confirmPlan(task.id)

  assert.equal((await runner.run(task.id)).status, 'completed')
})

test('task runner checks the exact SSH session before starting the first step', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  const calls = []
  const endpoint = {
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    tabId: 'tab-1',
    pid: 1001
  }
  const runner = createTaskRunner({
    runRemote: async command => {
      calls.push(command)
      return { output: 'must not run', code: 0 }
    },
    cancelRemote: async () => {},
    getCurrentEndpoint: async () => ({ ...endpoint, host: 'other.example.com' }),
    store,
    now: createClock()
  })
  const task = await runner.create(readonlyPlan({
    id: 'task-endpoint-before-first',
    endpoint,
    steps: [{ id: 'first', command: '/usr/bin/uptime', timeoutMs: 100 }]
  }))
  await runner.confirmPlan(task.id)

  await assert.rejects(runner.run(task.id), /端点不一致/)
  const failed = await store.get(task.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.steps[0].status, 'failed')
  assert.deepEqual(calls, [])
})

test('task runner fails closed when an endpoint-bound task has no live endpoint resolver', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  const calls = []
  const runner = createTaskRunner({
    runRemote: async command => {
      calls.push(command)
      return { output: 'must not run', code: 0 }
    },
    cancelRemote: async () => {},
    store,
    now: createClock()
  })
  const task = await runner.create(readonlyPlan({
    id: 'task-endpoint-resolver-required',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      pid: 1001
    },
    steps: [{ id: 'first', command: '/usr/bin/uptime', timeoutMs: 100 }]
  }))
  await runner.confirmPlan(task.id)

  await assert.rejects(runner.run(task.id), /端点|连接|复核/)
  assert.equal((await store.get(task.id)).status, 'failed')
  assert.deepEqual(calls, [])
})

test('task runner rechecks the SSH session before every later step', async () => {
  const { createTaskRunner } = await importDomainModule('task-runner.js')
  const store = createTaskStore()
  const calls = []
  let endpointChecks = 0
  const endpoint = {
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    tabId: 'tab-1',
    pid: 1001
  }
  const runner = createTaskRunner({
    runRemote: async command => {
      calls.push(command)
      return { output: `output for ${command}`, code: 0 }
    },
    cancelRemote: async () => {},
    getCurrentEndpoint: async () => {
      endpointChecks += 1
      return endpointChecks < 3 ? endpoint : { ...endpoint, pid: 2002 }
    },
    store,
    now: createClock()
  })
  const task = await runner.create(readonlyPlan({
    id: 'task-endpoint-between-steps',
    endpoint
  }))
  await runner.confirmPlan(task.id)

  await assert.rejects(runner.run(task.id), /会话端点不一致/)
  const failed = await store.get(task.id)
  assert.equal(endpointChecks, 3)
  assert.deepEqual(calls, ['/usr/bin/uptime'])
  assert.equal(failed.status, 'partially-completed')
  assert.equal(failed.steps[0].status, 'completed')
  assert.equal(failed.steps[1].status, 'failed')
})
