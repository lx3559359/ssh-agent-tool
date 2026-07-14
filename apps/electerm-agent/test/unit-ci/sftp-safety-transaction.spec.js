const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const transactionRoot = path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions'
)

function importTransactionModule (name) {
  return import(pathToFileURL(path.join(transactionRoot, name)).href)
}

function clone (value) {
  return structuredClone(value)
}

function createMemoryStore () {
  const records = new Map()
  const transitions = []
  const store = {
    transitions,
    async save (value) {
      records.set(value.id, clone(value))
      transitions.push(value.state)
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
      transitions.push(next.state)
      return clone(next)
    },
    async guardedPatch (id, predicate, value) {
      const current = clone(records.get(id))
      if (!current) throw new Error(`missing record: ${id}`)
      if (await predicate(current) !== true) {
        const error = new Error('integrity atomic update rejected')
        error.code = 'SAFETY_OPERATION_INTEGRITY'
        throw error
      }
      const resolved = typeof value === 'function'
        ? await value(clone(current))
        : value
      return store.patch(id, resolved)
    }
  }
  return store
}

async function createSideEffectOperation (overrides = {}) {
  const { buildSideEffectSafetyRequest } = await importTransactionModule(
    'side-effect-model.js'
  )
  return buildSideEffectSafetyRequest({
    id: 'sftp-editor-save-1',
    source: 'sftp',
    title: 'SFTP editor save',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      pid: 1001,
      sessionType: 'sftp'
    },
    effect: {
      adapter: 'sftp',
      action: 'editor-save',
      resources: [{ path: '/srv/app/config.json', type: 'file' }],
      paths: { target: '/srv/app/config.json' },
      type: 'file',
      requestedMode: 0o640,
      expected: {
        size: 18,
        digest: 'a'.repeat(64),
        digestAlgorithm: 'SHA-256'
      },
      risk: 'readonly',
      reversible: false
    },
    risk: 'readonly',
    reversible: false,
    recoveryProvider: null,
    metadata: {
      editor: true,
      password: 'must-not-persist'
    },
    ...overrides
  }, { now: new Date('2026-07-14T08:00:00.000Z') })
}

test('side-effect requests use an authoritative SFTP action model without a fake command', async () => {
  const operation = await createSideEffectOperation()

  assert.equal(operation.operationKind, 'side-effect')
  assert.equal(operation.command, undefined)
  assert.equal(operation.source, 'sftp')
  assert.equal(operation.risk, 'change')
  assert.equal(operation.reversible, true)
  assert.equal(operation.recoveryProvider, 'sftp')
  assert.equal(operation.requiresConfirmation, true)
  assert.equal(operation.effect.adapter, 'sftp')
  assert.equal(operation.effect.action, 'editor-save')
  assert.deepEqual(operation.effect.paths, { target: '/srv/app/config.json' })
  assert.deepEqual(operation.effect.resources, [
    { path: '/srv/app/config.json', type: 'file' }
  ])
  assert.equal(operation.effect.requestedMode, 0o640)
  assert.match(operation.effectKey, /^sftp:editor-save:/)
  assert.equal(operation.metadata.password, '[REDACTED]')
  assert.equal(operation.effect.risk, undefined)
  assert.equal(operation.effect.reversible, undefined)
})

test('side-effect requests reject unsupported actions and non-absolute resources', async () => {
  await assert.rejects(
    createSideEffectOperation({
      effect: {
        adapter: 'sftp',
        action: 'download',
        resources: [{ path: '/srv/app/archive.tgz', type: 'file' }],
        paths: { target: '/srv/app/archive.tgz' },
        type: 'file',
        expected: { size: 1, digest: 'b'.repeat(64) }
      }
    }),
    /not supported|unsupported/i
  )
  await assert.rejects(
    createSideEffectOperation({
      effect: {
        adapter: 'sftp',
        action: 'delete',
        resources: [{ path: '../escape', type: 'file' }],
        paths: { source: '../escape' },
        type: 'file',
        expected: { absent: true }
      }
    }),
    /absolute path/i
  )
  await assert.rejects(
    createSideEffectOperation({
      effect: {
        adapter: 'sftp',
        action: 'editor-save',
        resources: [{ path: '/srv/app/config.json', type: 'file' }],
        paths: { target: '/srv/app/config.json' },
        type: 'file',
        expected: {}
      }
    }),
    /expected|digest|size/i
  )
  for (const protectedPath of [
    '/.shellpilot-transactions',
    '/.shellpilot-transactions/op/source',
    '/srv/.shellpilot-transactions',
    '/srv/.shellpilot-transactions/op/source',
    '\\srv\\.shellpilot-transactions\\op\\source'
  ]) {
    await assert.rejects(
      createSideEffectOperation({
        effect: {
          adapter: 'sftp',
          action: 'delete',
          resources: [{ path: protectedPath, type: 'file' }],
          paths: { source: protectedPath },
          type: 'file',
          expected: { absent: true }
        }
      }),
      /transaction storage|事务目录|事务存储/i,
      protectedPath
    )
  }

  for (const id of [
    '.',
    '..',
    'sftp/escape',
    'sftp\\escape',
    ' sftp-safe',
    'sftp-safe ',
    'sftp.safe',
    'sftp/../safe',
    'ｓftp-safe'
  ]) {
    await assert.rejects(
      createSideEffectOperation({ id }),
      /operation id|identifier|事务标识|操作标识/i,
      id
    )
  }
})

test('side-effect recovery binding v2 binds identity effect plan and artifacts without rollback commands', async () => {
  const {
    createRecoveryBinding,
    verifyRecoveryBinding
  } = await importTransactionModule('recovery-binding.js')
  const { validateRecoveryStructure } = await importTransactionModule('models.js')
  const operation = await createSideEffectOperation()
  operation.state = 'rollback-available'
  operation.plan = {
    adapter: 'sftp',
    operationDir: '/srv/app/.shellpilot-transactions/sftp-editor-save-1',
    manifestPath: '/srv/app/.shellpilot-transactions/sftp-editor-save-1/manifest.json',
    resources: [{
      slot: 'target',
      path: '/srv/app/config.json',
      snapshotPath: '/srv/app/.shellpilot-transactions/sftp-editor-save-1/target',
      restoreTempPath: '/srv/app/.shellpilot-transactions/sftp-editor-save-1/target.restore-temp',
      displacedPath: '/srv/app/.shellpilot-transactions/sftp-editor-save-1/target.displaced'
    }]
  }
  operation.artifacts = {
    manifest: operation.plan.manifestPath,
    target: operation.plan.resources[0].snapshotPath
  }
  operation.recoveryReadyAt = '2026-07-14T08:01:00.000Z'
  operation.recoveryBinding = await createRecoveryBinding(
    operation,
    operation.plan,
    operation.artifacts
  )

  assert.equal(operation.recoveryBinding.schemaVersion, 2)
  assert.equal(operation.recoveryBinding.algorithm, 'SHA-256')
  assert.match(operation.recoveryBinding.fingerprint, /^[a-f0-9]{64}$/)
  assert.deepEqual(validateRecoveryStructure(operation), { valid: true, error: '' })
  assert.deepEqual(await verifyRecoveryBinding(operation), { valid: true, error: '' })
  assert.equal(operation.plan.rollbackCommand, undefined)

  const cases = [
    ['id', value => { value.id = 'forged-id' }],
    ['endpoint', value => { value.endpoint.host = 'forged.example.com' }],
    ['effect-action', value => { value.effect.action = 'delete' }],
    ['effect-path', value => { value.effect.paths.target = '/tmp/forged' }],
    ['effect-key', value => { value.effectKey += ':forged' }],
    ['plan', value => { value.plan.resources[0].path = '/tmp/forged' }],
    ['artifact', value => { value.artifacts.target = '/tmp/forged' }]
  ]
  for (const [label, tamper] of cases) {
    const forged = clone(operation)
    tamper(forged)
    const result = await verifyRecoveryBinding(forged)
    assert.equal(result.valid, false, label)
  }
})

function sideEffectPrepareResult (operation) {
  const operationDir = `/srv/app/.shellpilot-transactions/${operation.id}`
  return {
    manifestComplete: true,
    plan: {
      adapter: 'sftp',
      operationDir,
      manifestPath: `${operationDir}/manifest.json`,
      resources: [{
        slot: 'target',
        path: operation.effect.paths.target,
        snapshotPath: `${operationDir}/target`,
        restoreTempPath: `${operationDir}/target.restore-temp`,
        displacedPath: `${operationDir}/target.displaced`
      }]
    },
    artifacts: {
      manifest: `${operationDir}/manifest.json`,
      target: `${operationDir}/target`
    }
  }
}

async function createSideEffectRunner (overrides = {}) {
  const { createTransactionRunner } = await importTransactionModule(
    'transaction-runner.js'
  )
  const operation = overrides.operation || await createSideEffectOperation()
  const store = overrides.store || createMemoryStore()
  const calls = []
  const adapter = {
    supports: value => value.effect?.adapter === 'sftp',
    prepare: async value => {
      calls.push('prepare')
      return sideEffectPrepareResult(value)
    },
    beforeExecute: async (value, context) => {
      calls.push('beforeExecute')
      assert.deepEqual(context.input, { text: '{"enabled":true}' })
      return { summary: 'saved' }
    },
    verifyExecute: async () => {
      calls.push('verifyExecute')
      return { verified: true, summary: 'verified save' }
    },
    rollback: async () => {
      calls.push('rollback')
      return { summary: 'restored snapshot' }
    },
    verifyRollback: async () => {
      calls.push('verifyRollback')
      return { verified: true, summary: 'verified rollback' }
    },
    ...overrides.adapter
  }
  let endpointChecks = 0
  const runner = createTransactionRunner({
    runRemote: async () => { throw new Error('side-effect must not run a command') },
    cancelRemote: async () => {},
    buildRecoveryPlan: async () => { throw new Error('side-effect must not build a command plan') },
    getCurrentEndpoint: async value => {
      endpointChecks += 1
      return overrides.getCurrentEndpoint
        ? overrides.getCurrentEndpoint(value, endpointChecks)
        : operation.endpoint
    },
    sideEffectAdapter: adapter,
    store
  })
  return {
    operation,
    store,
    adapter,
    calls,
    runner,
    get endpointChecks () { return endpointChecks }
  }
}

test('transaction runner executes the complete side-effect adapter lifecycle without remote commands', async () => {
  const context = await createSideEffectRunner()
  const prepared = await context.runner.prepare(context.operation)

  assert.equal(prepared.state, 'awaiting-confirmation')
  assert.equal(prepared.recoveryBinding.schemaVersion, 2)
  assert.equal(prepared.plan.rollbackCommand, undefined)
  assert.deepEqual(context.calls, ['prepare'])
  await assert.rejects(
    context.runner.execute(context.operation.id, { confirmed: false }),
    /confirm|确认/i
  )
  assert.deepEqual(context.calls, ['prepare'])

  const executed = await context.runner.execute(context.operation.id, {
    confirmed: true,
    sideEffectInput: { text: '{"enabled":true}' }
  })
  assert.equal(executed.state, 'rollback-available')
  assert.deepEqual(context.calls, ['prepare', 'beforeExecute', 'verifyExecute'])

  const restored = await context.runner.rollback(context.operation.id)
  assert.equal(restored.state, 'restored')
  assert.deepEqual(context.calls, [
    'prepare',
    'beforeExecute',
    'verifyExecute',
    'rollback',
    'verifyRollback'
  ])
  assert.ok(context.endpointChecks >= 10)
})

test('side-effect runner checks binding after the mutation hook and keeps recovery on failure', async () => {
  const store = createMemoryStore()
  const context = await createSideEffectRunner({
    store,
    adapter: {
      beforeExecute: async operation => {
        context.calls.push('beforeExecute')
        const current = await store.get(operation.id)
        await store.patch(operation.id, {
          effect: {
            ...current.effect,
            paths: { target: '/srv/app/forged.json' }
          }
        })
        return { summary: 'mutated before tamper was noticed' }
      }
    }
  })
  await context.runner.prepare(context.operation)

  await assert.rejects(
    context.runner.execute(context.operation.id, {
      confirmed: true,
      sideEffectInput: { text: '{"enabled":true}' }
    }),
    /integrity|binding|完整|绑定/i
  )
  const failed = await store.get(context.operation.id)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.effect.paths.target, '/srv/app/config.json')
  assert.equal(failed.recoveryBinding.schemaVersion, 2)
  assert.deepEqual(context.calls, ['prepare', 'beforeExecute'])
})

test('side-effect execute verification failure preserves snapshots and permits rollback', async () => {
  const context = await createSideEffectRunner({
    adapter: {
      verifyExecute: async () => {
        context.calls.push('verifyExecute')
        throw new Error('写入后验证失败')
      }
    }
  })
  await context.runner.prepare(context.operation)

  await assert.rejects(context.runner.execute(context.operation.id, {
    confirmed: true,
    sideEffectInput: { text: '{"enabled":true}' }
  }), /验证失败/)
  const failed = await context.store.get(context.operation.id)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.artifacts.manifest.endsWith('/manifest.json'), true)

  const restored = await context.runner.rollback(context.operation.id)
  assert.equal(restored.state, 'restored')
  assert.deepEqual(context.calls.slice(-2), ['rollback', 'verifyRollback'])
})

test('side-effect rollback and rollback verification failures remain retryable', async t => {
  for (const failedHook of ['rollback', 'verifyRollback']) {
    await t.test(failedHook, async () => {
      let attempts = 0
      const context = await createSideEffectRunner({
        adapter: {
          [failedHook]: async () => {
            context.calls.push(failedHook)
            attempts += 1
            if (attempts === 1) throw new Error(`${failedHook} failed`)
            return { verified: true }
          }
        }
      })
      await context.runner.prepare(context.operation)
      await context.runner.execute(context.operation.id, {
        confirmed: true,
        sideEffectInput: { text: '{"enabled":true}' }
      })

      await assert.rejects(context.runner.rollback(context.operation.id), /failed/)
      const failed = await context.store.get(context.operation.id)
      assert.equal(failed.state, 'failed')
      assert.equal(failed.artifacts.manifest.endsWith('/manifest.json'), true)

      const restored = await context.runner.rollback(context.operation.id)
      assert.equal(restored.state, 'restored')
      assert.equal(attempts, 2)
    })
  }
})

test('side-effect completion is idempotent and cancellation or endpoint change never executes', async () => {
  const repeated = await createSideEffectRunner()
  await repeated.runner.prepare(repeated.operation)
  const first = await repeated.runner.execute(repeated.operation.id, {
    confirmed: true,
    sideEffectInput: { text: '{"enabled":true}' }
  })
  const second = await repeated.runner.execute(repeated.operation.id, {
    confirmed: true,
    sideEffectInput: { text: '{"enabled":true}' }
  })
  assert.equal(first.state, 'rollback-available')
  assert.equal(second.state, 'rollback-available')
  assert.equal(repeated.calls.filter(value => value === 'beforeExecute').length, 1)
  const restored = await repeated.runner.rollback(repeated.operation.id)
  const restoredAgain = await repeated.runner.rollback(repeated.operation.id)
  assert.equal(restoredAgain.state, restored.state)
  assert.equal(repeated.calls.filter(value => value === 'rollback').length, 1)

  const cancelled = await createSideEffectRunner()
  await cancelled.runner.prepare(cancelled.operation)
  const cancelledRecord = await cancelled.runner.cancel(cancelled.operation.id)
  assert.equal(cancelledRecord.state, 'cancelled')
  assert.deepEqual(cancelled.calls, ['prepare'])

  let endpointChanged = false
  const changed = await createSideEffectRunner({
    getCurrentEndpoint: (operation) => endpointChanged
      ? { ...operation.endpoint, host: 'other.example.com' }
      : operation.endpoint
  })
  await changed.runner.prepare(changed.operation)
  endpointChanged = true
  await assert.rejects(changed.runner.execute(changed.operation.id, {
    confirmed: true,
    sideEffectInput: { text: '{"enabled":true}' }
  }), /端点|endpoint/i)
  assert.deepEqual(changed.calls, ['prepare'])
})

test('side-effect cancel waits for an active atomic hook and preserves rollback state', async () => {
  let markStarted
  let releaseAtomic
  const started = new Promise(resolve => { markStarted = resolve })
  const atomic = new Promise(resolve => { releaseAtomic = resolve })
  let mutationCompleted = false
  const context = await createSideEffectRunner({
    adapter: {
      beforeExecute: async (operation, lifecycle) => {
        return lifecycle.runMutation(async () => {
          markStarted()
          await atomic
          mutationCompleted = true
          return { summary: `mutated ${operation.id}` }
        })
      }
    }
  })
  await context.runner.prepare(context.operation)
  const executing = context.runner.execute(context.operation.id, {
    confirmed: true,
    sideEffectInput: { text: '{"enabled":true}' }
  })
  await started

  let cancelSettled = false
  const cancelling = context.runner.cancel(context.operation.id).then(value => {
    cancelSettled = true
    return value
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(cancelSettled, false)
  assert.equal((await context.store.get(context.operation.id)).state, 'executing')

  releaseAtomic()
  const [executeResult, cancelResult] = await Promise.allSettled([
    executing,
    cancelling
  ])
  assert.equal(mutationCompleted, true)
  assert.equal(executeResult.status, 'rejected')
  assert.match(executeResult.reason.message, /cancel|取消|中止/i)
  assert.equal(cancelResult.status, 'fulfilled')
  assert.equal(cancelResult.value.state, 'failed')
  assert.equal(cancelResult.value.mutationStarted, true)
  assert.equal(cancelResult.value.commitPoint, true)
  assert.equal(cancelResult.value.artifacts.manifest.endsWith('/manifest.json'), true)
  assert.equal((await context.runner.rollback(context.operation.id)).state, 'restored')
})

test('side-effect mutation work waits for one atomic persisted commit marker', async () => {
  const store = createMemoryStore()
  const originalPatch = store.patch.bind(store)
  let markMarkerPatchStarted
  let releaseMarkerPatch
  let markWorkStarted
  let releaseWork
  let workStarted = false
  let markerPatch
  const markerPatchStarted = new Promise(resolve => { markMarkerPatchStarted = resolve })
  const markerPatchGate = new Promise(resolve => { releaseMarkerPatch = resolve })
  const workStartedSignal = new Promise(resolve => { markWorkStarted = resolve })
  const workGate = new Promise(resolve => { releaseWork = resolve })
  store.patch = async (id, value) => {
    if (!markerPatch && value.mutationStarted === true) {
      markerPatch = clone(value)
      markMarkerPatchStarted()
      await markerPatchGate
    }
    return originalPatch(id, value)
  }
  const context = await createSideEffectRunner({
    store,
    adapter: {
      beforeExecute: async (operation, lifecycle) => lifecycle.runMutation(async () => {
        workStarted = true
        markWorkStarted()
        await workGate
        return { summary: `mutated ${operation.id}` }
      })
    }
  })
  await context.runner.prepare(context.operation)
  const executing = context.runner.execute(context.operation.id, {
    confirmed: true,
    sideEffectInput: { text: '{"enabled":true}' }
  })

  try {
    await markerPatchStarted
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(workStarted, false)
    assert.equal(markerPatch.mutationStarted, true)
    assert.equal(markerPatch.commitPoint, true)
    const beforeCommit = await store.get(context.operation.id)
    assert.equal(beforeCommit.mutationStarted, undefined)
    assert.equal(beforeCommit.commitPoint, undefined)

    releaseMarkerPatch()
    await workStartedSignal
    const committed = await store.get(context.operation.id)
    assert.equal(committed.mutationStarted, true)
    assert.equal(committed.commitPoint, true)
    releaseWork()
    assert.equal((await executing).state, 'rollback-available')
  } finally {
    releaseMarkerPatch()
    releaseWork()
    await executing.catch(() => {})
  }
})

test('side-effect mutation marker persistence failure performs zero remote work', async () => {
  const store = createMemoryStore()
  const originalPatch = store.patch.bind(store)
  let workStarted = false
  store.patch = async (id, value) => {
    if (value.mutationStarted === true) {
      throw new Error('mutation marker persistence failed')
    }
    return originalPatch(id, value)
  }
  const context = await createSideEffectRunner({
    store,
    adapter: {
      beforeExecute: async (operation, lifecycle) => lifecycle.runMutation(() => {
        workStarted = true
        return { summary: `mutated ${operation.id}` }
      })
    }
  })
  await context.runner.prepare(context.operation)

  await assert.rejects(context.runner.execute(context.operation.id, {
    confirmed: true,
    sideEffectInput: { text: '{"enabled":true}' }
  }), /marker persistence failed/)
  const failed = await store.get(context.operation.id)
  assert.equal(workStarted, false)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.mutationStarted, undefined)
  assert.equal(failed.commitPoint, undefined)
})

test('side-effect mutation marker guard blocks binding and endpoint changes before work', async t => {
  await t.test('recovery binding change', async () => {
    const store = createMemoryStore()
    let workStarted = false
    const context = await createSideEffectRunner({
      store,
      adapter: {
        beforeExecute: async (operation, lifecycle) => {
          const current = await store.get(operation.id)
          await store.patch(operation.id, {
            effect: {
              ...current.effect,
              paths: { target: '/srv/app/forged-before-marker.json' }
            }
          })
          return lifecycle.runMutation(() => {
            workStarted = true
            return { summary: `mutated ${operation.id}` }
          })
        }
      }
    })
    await context.runner.prepare(context.operation)

    await assert.rejects(context.runner.execute(context.operation.id, {
      confirmed: true,
      sideEffectInput: { text: '{"enabled":true}' }
    }), /integrity|binding|完整|绑定/i)
    assert.equal(workStarted, false)
    assert.equal((await store.get(context.operation.id)).state, 'failed')
  })

  await t.test('live endpoint change', async () => {
    let endpointChanged = false
    let workStarted = false
    const context = await createSideEffectRunner({
      getCurrentEndpoint: operation => endpointChanged
        ? { ...operation.endpoint, host: 'other.example.com' }
        : operation.endpoint,
      adapter: {
        beforeExecute: async (operation, lifecycle) => {
          endpointChanged = true
          return lifecycle.runMutation(() => {
            workStarted = true
            return { summary: `mutated ${operation.id}` }
          })
        }
      }
    })
    await context.runner.prepare(context.operation)

    await assert.rejects(context.runner.execute(context.operation.id, {
      confirmed: true,
      sideEffectInput: { text: '{"enabled":true}' }
    }), /端点|endpoint/i)
    assert.equal(workStarted, false)
    assert.equal((await context.store.get(context.operation.id)).state, 'failed')
  })
})

test('side-effect persisted mutation marker prevents false cancellation after runner restart', async () => {
  const store = createMemoryStore()
  let markWorkStarted
  let releaseWork
  let recordSeenByWork
  const workStarted = new Promise(resolve => { markWorkStarted = resolve })
  const workGate = new Promise(resolve => { releaseWork = resolve })
  const context = await createSideEffectRunner({
    store,
    adapter: {
      beforeExecute: async (operation, lifecycle) => lifecycle.runMutation(async () => {
        recordSeenByWork = await store.get(operation.id)
        markWorkStarted()
        await workGate
        return { summary: `mutated ${operation.id}` }
      })
    }
  })
  await context.runner.prepare(context.operation)
  const executing = context.runner.execute(context.operation.id, {
    confirmed: true,
    sideEffectInput: { text: '{"enabled":true}' }
  })

  try {
    await workStarted
    assert.equal(recordSeenByWork.mutationStarted, true)
    assert.equal(recordSeenByWork.commitPoint, true)
    const restarted = await createSideEffectRunner({
      operation: context.operation,
      store
    })
    const cancelledAfterRestart = await restarted.runner.cancel(context.operation.id)
    assert.equal(cancelledAfterRestart.state, 'failed')
    assert.equal(cancelledAfterRestart.mutationStarted, true)
    assert.equal(cancelledAfterRestart.commitPoint, true)
  } finally {
    releaseWork()
    await executing.catch(() => {})
  }
})

test('side-effect cancel before mutation starts is cancelled with zero modification', async () => {
  let markStarted
  const started = new Promise(resolve => { markStarted = resolve })
  let modified = false
  const context = await createSideEffectRunner({
    adapter: {
      beforeExecute: async (operation, lifecycle) => {
        markStarted()
        await new Promise(resolve => {
          if (lifecycle.signal.aborted) return resolve()
          lifecycle.signal.addEventListener('abort', resolve, { once: true })
        })
        if (!lifecycle.signal.aborted) modified = true
        const error = new Error(`cancelled before ${operation.id} mutation`)
        error.name = 'AbortError'
        throw error
      }
    }
  })
  await context.runner.prepare(context.operation)
  const executing = context.runner.execute(context.operation.id, {
    confirmed: true,
    sideEffectInput: { text: '{"enabled":true}' }
  })
  await started
  const cancelled = await context.runner.cancel(context.operation.id)

  await assert.rejects(executing, /cancel|取消|中止/i)
  assert.equal(cancelled.state, 'cancelled')
  assert.equal(cancelled.mutationStarted, undefined)
  assert.equal(cancelled.commitPoint, undefined)
  assert.equal(modified, false)
})

test('side-effect external AbortSignal persists an honest pre or post mutation state', async t => {
  await t.test('before mutation', async () => {
    let markStarted
    const started = new Promise(resolve => { markStarted = resolve })
    const controller = new AbortController()
    const context = await createSideEffectRunner({
      adapter: {
        beforeExecute: async (operation, lifecycle) => {
          markStarted()
          await new Promise(resolve => {
            if (lifecycle.signal.aborted) return resolve()
            lifecycle.signal.addEventListener('abort', resolve, { once: true })
          })
          const error = new Error(`aborted before ${operation.id} mutation`)
          error.name = 'AbortError'
          throw error
        }
      }
    })
    await context.runner.prepare(context.operation)
    const executing = context.runner.execute(context.operation.id, {
      confirmed: true,
      signal: controller.signal,
      sideEffectInput: { text: '{"enabled":true}' }
    })
    const rejected = assert.rejects(executing, /cancel|取消|中止/i)
    await started
    controller.abort()
    await rejected
    assert.equal((await context.store.get(context.operation.id)).state, 'cancelled')
  })

  await t.test('after mutation', async () => {
    let markStarted
    let releaseAtomic
    const started = new Promise(resolve => { markStarted = resolve })
    const atomic = new Promise(resolve => { releaseAtomic = resolve })
    const controller = new AbortController()
    const context = await createSideEffectRunner({
      adapter: {
        beforeExecute: async (operation, lifecycle) => lifecycle.runMutation(async () => {
          markStarted()
          await atomic
          return { summary: `mutated ${operation.id}` }
        })
      }
    })
    await context.runner.prepare(context.operation)
    const executing = context.runner.execute(context.operation.id, {
      confirmed: true,
      signal: controller.signal,
      sideEffectInput: { text: '{"enabled":true}' }
    })
    const rejected = assert.rejects(executing, /cancel|取消|中止/i)
    await started
    controller.abort()
    releaseAtomic()
    await rejected
    const failed = await context.store.get(context.operation.id)
    assert.equal(failed.state, 'failed')
    assert.equal(failed.mutationStarted, true)
    assert.equal(failed.commitPoint, true)
    assert.equal((await context.runner.rollback(context.operation.id)).state, 'restored')
  })
})

test('SFTP endpoint identity survives transport refresh but rejects another security context', async () => {
  const { buildSftpSafetyEndpoint } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-safety-endpoint.js'
  )).href)
  const { findMatchingSafetySftp } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/main/safety-operation-center-model.js'
  )).href)
  const tab = {
    id: 'tab-stable',
    host: 'prod.example.com',
    port: 2222,
    username: 'deploy',
    title: 'production'
  }
  const endpoint = buildSftpSafetyEndpoint({
    tab,
    terminalId: 'terminal-session-stable'
  })
  const operation = await createSideEffectOperation({ endpoint })
  const refreshedEndpoint = buildSftpSafetyEndpoint({
    tab: { ...tab },
    terminalId: 'terminal-session-stable'
  })
  const context = await createSideEffectRunner({
    operation,
    getCurrentEndpoint: () => refreshedEndpoint
  })
  await context.runner.prepare(operation)
  await context.runner.execute(operation.id, {
    confirmed: true,
    sideEffectInput: { text: '{"enabled":true}' }
  })

  const refreshedCapability = {
    sftp: { id: 'new-random-sftp-transport-id' },
    getSftpSafetyEndpoint: () => refreshedEndpoint,
    rollbackSafetyOperation: id => context.runner.rollback(id)
  }
  const matched = findMatchingSafetySftp(
    operation,
    [tab.id],
    () => refreshedCapability
  )
  assert.equal(matched, refreshedCapability)
  assert.equal((await matched.rollbackSafetyOperation(operation.id)).state, 'restored')

  for (const changedEndpoint of [
    { ...refreshedEndpoint, host: 'other.example.com' },
    { ...refreshedEndpoint, port: 22 },
    { ...refreshedEndpoint, username: 'root' },
    { ...refreshedEndpoint, tabId: 'tab-other' },
    { ...refreshedEndpoint, terminalPid: 'terminal-session-other' }
  ]) {
    assert.equal(findMatchingSafetySftp(
      operation,
      [tab.id],
      () => ({
        ...refreshedCapability,
        getSftpSafetyEndpoint: () => changedEndpoint
      })
    ), undefined)
  }
})

function normalizeFakePath (value) {
  const parts = []
  for (const part of String(value || '/').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

function parentFakePath (value) {
  const normalized = normalizeFakePath(value)
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? '/' : normalized.slice(0, index)
}

function createFakeSftp (initial = {}, options = {}) {
  const nodes = new Map([['/', {
    type: 'directory',
    mode: 0o755,
    dev: 1,
    uid: 1000,
    gid: 1000
  }]])
  const calls = []
  let fullReads = 0
  let chunkReads = 0
  let failCopy = Boolean(options.failCopy)
  let failManifest = Boolean(options.failManifest)
  let failEditorSwap = Boolean(options.failEditorSwap)
  let failRemove = Boolean(options.failRemove)
  let failChown = Boolean(options.failChown)

  function missing (path) {
    const error = new Error(`No such file: ${path}`)
    error.code = 'SFTP_NO_SUCH_FILE'
    return error
  }

  function exists (path) {
    return nodes.has(normalizeFakePath(path))
  }

  function ensureParents (path, dev = 1) {
    const parent = parentFakePath(path)
    if (parent === path || nodes.has(parent)) return
    ensureParents(parent, dev)
    nodes.set(parent, { type: 'directory', mode: 0o755, dev })
  }

  function put (path, value) {
    const normalized = normalizeFakePath(path)
    ensureParents(normalized, value.dev || 1)
    nodes.set(normalized, value.type === 'file'
      ? {
          type: 'file',
          content: Buffer.from(value.content || ''),
          mode: value.mode ?? 0o644,
          dev: value.dev || 1,
          uid: value.uid ?? 1000,
          gid: value.gid ?? 1000
        }
      : {
          type: value.type || 'directory',
          mode: value.mode ?? 0o755,
          dev: value.dev || 1,
          uid: value.uid ?? 1000,
          gid: value.gid ?? 1000
        })
  }

  for (const [path, value] of Object.entries(initial)) put(path, value)

  function node (path) {
    const normalized = normalizeFakePath(path)
    const value = nodes.get(normalized)
    if (!value) throw missing(normalized)
    return value
  }

  function statValue (value) {
    const typeMode = {
      file: 0o100000,
      directory: 0o040000,
      symlink: 0o120000,
      special: 0o010000
    }[value.type]
    return {
      mode: typeMode | value.mode,
      size: value.type === 'file' ? value.content.length : 0,
      uid: value.uid,
      gid: value.gid,
      ...(options.omitDev ? {} : { dev: value.dev }),
      isDirectory: value.type === 'directory'
    }
  }

  function descendants (path) {
    const normalized = normalizeFakePath(path)
    const prefix = normalized === '/' ? '/' : `${normalized}/`
    return [...nodes.keys()].filter(key => key === normalized || key.startsWith(prefix))
  }

  function removeTree (path) {
    for (const key of descendants(path).sort((a, b) => b.length - a.length)) {
      if (key !== '/') nodes.delete(key)
    }
  }

  function cloneTree (from, to) {
    const source = normalizeFakePath(from)
    const target = normalizeFakePath(to)
    const keys = descendants(source).sort((a, b) => a.length - b.length)
    for (const key of keys) {
      const suffix = key.slice(source.length)
      const value = node(key)
      put(`${target}${suffix}`, value.type === 'file'
        ? { ...value, content: Buffer.from(value.content) }
        : { ...value })
    }
  }

  const sftp = {
    calls,
    nodes,
    exists,
    text: path => node(path).content.toString('utf8'),
    type: path => node(path).type,
    get fullReads () { return fullReads },
    get chunkReads () { return chunkReads },
    async lstat (path) {
      calls.push(['lstat', normalizeFakePath(path)])
      return statValue(node(path))
    },
    async stat (path) {
      calls.push(['stat', normalizeFakePath(path)])
      return statValue(node(path))
    },
    async list (path) {
      const normalized = normalizeFakePath(path)
      calls.push(['list', normalized])
      if (node(normalized).type !== 'directory') throw new Error('Not a directory')
      const prefix = normalized === '/' ? '/' : `${normalized}/`
      const entries = []
      for (const key of nodes.keys()) {
        if (!key.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        if (!rest || rest.includes('/')) continue
        const value = node(key)
        entries.push({
          name: rest,
          type: value.type === 'directory' ? 'd' : value.type === 'symlink' ? 'l' : '-',
          mode: statValue(value).mode,
          size: value.type === 'file' ? value.content.length : 0
        })
      }
      return entries
    },
    async mkdir (path) {
      const normalized = normalizeFakePath(path)
      calls.push(['mkdir', normalized])
      if (exists(normalized)) {
        const error = new Error('Already exists')
        error.code = 'EEXIST'
        throw error
      }
      if (!exists(parentFakePath(normalized))) throw missing(parentFakePath(normalized))
      put(normalized, { type: 'directory', mode: 0o700 })
      return 1
    },
    async cp (from, to) {
      calls.push(['cp', normalizeFakePath(from), normalizeFakePath(to)])
      if (failCopy) {
        failCopy = false
        throw new Error('No space left on device')
      }
      if (exists(to)) throw new Error('Target already exists')
      cloneTree(from, to)
      return 1
    },
    async copyEntry (from, to, callOptions) {
      calls.push(['copyEntry', normalizeFakePath(from), normalizeFakePath(to), callOptions])
      if (failCopy) {
        failCopy = false
        throw new Error('No space left on device')
      }
      if (exists(to)) throw new Error('Target already exists')
      cloneTree(from, to)
      if (failChown) {
        failChown = false
        throw new Error('SFTP chown unsupported')
      }
      if (options.dropOwnershipOnCopy) {
        for (const key of descendants(to)) {
          node(key).uid = 1000
          node(key).gid = 1000
        }
      }
      return 1
    },
    async rename (from, to) {
      const source = normalizeFakePath(from)
      const target = normalizeFakePath(to)
      calls.push(['rename', source, target])
      node(source)
      if (failEditorSwap && source.endsWith('.execute')) {
        failEditorSwap = false
        throw new Error('Editor swap failed')
      }
      if (exists(target)) removeTree(target)
      cloneTree(source, target)
      removeTree(source)
      return 1
    },
    async rm (path) {
      const normalized = normalizeFakePath(path)
      calls.push(['rm', normalized])
      if (node(normalized).type === 'directory') throw new Error('Is a directory')
      nodes.delete(normalized)
      return 1
    },
    async rmdir (path) {
      const normalized = normalizeFakePath(path)
      calls.push(['rmdir', normalized])
      if (node(normalized).type !== 'directory') throw new Error('Not a directory')
      removeTree(normalized)
      return 1
    },
    async removeEntry (path, callOptions) {
      const normalized = normalizeFakePath(path)
      calls.push(['removeEntry', normalized, callOptions])
      node(normalized)
      if (failRemove) {
        failRemove = false
        const keys = descendants(normalized).sort((a, b) => b.length - a.length)
        if (keys.length) nodes.delete(keys[0])
        throw new Error('Recursive remove failed')
      }
      removeTree(normalized)
      return 1
    },
    async chmod (path, mode) {
      const normalized = normalizeFakePath(path)
      calls.push(['chmod', normalized, mode])
      node(normalized).mode = mode
      return 1
    },
    async chown (path, uid, gid) {
      const normalized = normalizeFakePath(path)
      calls.push(['chown', normalized, uid, gid])
      if (failChown) {
        failChown = false
        throw new Error('SFTP chown unsupported')
      }
      node(normalized).uid = uid
      node(normalized).gid = gid
      return 1
    },
    async writeFile (path, text, mode) {
      const normalized = normalizeFakePath(path)
      calls.push(['writeFile', normalized, mode])
      if (failManifest && normalized.endsWith('/manifest.json.preparing')) {
        failManifest = false
        throw new Error('Manifest write failed')
      }
      put(normalized, {
        type: 'file',
        content: Buffer.from(String(text)),
        mode: mode ?? (exists(normalized) ? node(normalized).mode : 0o644),
        dev: exists(parentFakePath(normalized)) ? node(parentFakePath(normalized)).dev : 1
      })
      return 'ok'
    },
    async readFile () {
      fullReads += 1
      throw new Error('unbounded readFile is forbidden')
    },
    async readFileChunk (path, readOptions = {}) {
      const normalized = normalizeFakePath(path)
      const offset = readOptions.offset || 0
      const maxBytes = readOptions.maxBytes || 64 * 1024
      calls.push(['readFileChunk', normalized, offset, maxBytes])
      chunkReads += 1
      const content = node(normalized).content
      const chunk = content.subarray(offset, Math.min(content.length, offset + maxBytes))
      return {
        base64: chunk.toString('base64'),
        offset,
        nextOffset: offset + chunk.length,
        bytesRead: chunk.length,
        totalBytes: content.length,
        hasMore: offset + chunk.length < content.length
      }
    }
  }
  return sftp
}

async function buildSftpOperation ({
  id,
  action,
  paths,
  type,
  requestedMode,
  expected,
  transfer
}) {
  const { buildSideEffectSafetyRequest } = await importTransactionModule(
    'side-effect-model.js'
  )
  return buildSideEffectSafetyRequest({
    id,
    source: 'sftp',
    title: `SFTP ${action}`,
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      pid: 1001,
      sessionType: 'sftp'
    },
    effect: {
      adapter: 'sftp',
      action,
      paths,
      resources: Object.values(paths).map(path => ({ path, type })),
      type,
      requestedMode,
      expected: expected || {},
      ...(transfer ? { transfer } : {})
    }
  })
}

async function createRealSftpTransactionRunner (operation, sftp) {
  const { createTransactionRunner } = await importTransactionModule(
    'transaction-runner.js'
  )
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const store = createMemoryStore()
  const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
  const runner = createTransactionRunner({
    runRemote: async () => { throw new Error('SFTP side-effect must not run commands') },
    cancelRemote: async () => {},
    buildRecoveryPlan: async () => { throw new Error('SFTP side-effect uses adapter recovery') },
    getCurrentEndpoint: async () => operation.endpoint,
    sideEffectAdapter: adapter,
    store
  })
  return { runner, store }
}

test('SFTP adapter rejects forged ids before constructing a transaction directory', async () => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const operation = await buildSftpOperation({
    id: 'adapter-safe-id',
    action: 'delete',
    paths: { source: '/srv/app/data.txt' },
    type: 'file',
    expected: { absent: true }
  })

  for (const id of ['.', '..', 'nested/escape', 'nested\\escape']) {
    const sftp = createFakeSftp({
      '/srv/app/data.txt': { type: 'file', content: 'data' }
    })
    const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
    await assert.rejects(
      adapter.prepare({ ...operation, id }),
      /operation id|identifier|事务标识|事务目录/i,
      id
    )
    assert.equal(sftp.calls.some(call => (
      call[0] === 'copyEntry' || call[0] === 'writeFile'
    )), false, id)
  }
})

async function runExternalSftpTransfer ({ operation, sftp, mutate }) {
  const context = await createRealSftpTransactionRunner(operation, sftp)
  await context.runner.prepare(operation)
  const begun = await context.runner.beginExternalExecution(operation.id, {
    confirmed: true,
    transferIdentity: operation.effect.transfer.identity,
    cancelExternal: async () => {}
  })
  await mutate()
  const completed = await context.runner.completeExternalExecution(operation.id, {
    executionId: begun.executionId,
    effectKey: operation.effectKey,
    transferIdentity: operation.effect.transfer.identity,
    exitCode: 0
  })
  return { ...context, completed }
}

test('SFTP external upload protects new and overwritten targets with rollback', async () => {
  for (const existing of [false, true]) {
    const sftp = createFakeSftp(existing
      ? { '/srv/app/release.txt': { type: 'file', content: 'old', mode: 0o640 } }
      : { '/srv/app': { type: 'directory' } })
    const operation = await buildSftpOperation({
      id: `adapter-upload-${existing ? 'overwrite' : 'new'}`,
      action: 'upload',
      paths: { target: '/srv/app/release.txt' },
      type: 'file',
      expected: { type: 'file', size: 3 },
      transfer: {
        identity: `upload-${existing ? 'overwrite' : 'new'}`,
        sourceIdentity: `source-${existing ? 'overwrite' : 'new'}`,
        batchId: 'batch-upload',
        direction: 'local-to-remote'
      }
    })
    const context = await runExternalSftpTransfer({
      operation,
      sftp,
      mutate: () => sftp.writeFile('/srv/app/release.txt', 'new', 0o640)
    })

    assert.equal(context.completed.state, 'rollback-available')
    assert.equal(sftp.text('/srv/app/release.txt'), 'new')
    const restored = await context.runner.rollback(operation.id)
    assert.equal(restored.state, 'restored')
    if (existing) assert.equal(sftp.text('/srv/app/release.txt'), 'old')
    else assert.equal(sftp.exists('/srv/app/release.txt'), false)
  }
})

test('SFTP rollback refuses same-size external file changes after a verified upload', async () => {
  for (const existing of [false, true]) {
    const sftp = createFakeSftp(existing
      ? { '/srv/app/release.txt': { type: 'file', content: 'old', mode: 0o640 } }
      : { '/srv/app': { type: 'directory' } })
    const operation = await buildSftpOperation({
      id: `adapter-upload-post-file-${existing ? 'overwrite' : 'new'}`,
      action: 'upload',
      paths: { target: '/srv/app/release.txt' },
      type: 'file',
      expected: { type: 'file', size: 3 },
      transfer: {
        identity: `upload-post-file-${existing ? 'overwrite' : 'new'}`,
        sourceIdentity: 'source-post-file',
        batchId: 'batch-post-file',
        direction: 'local-to-remote'
      }
    })
    const context = await runExternalSftpTransfer({
      operation,
      sftp,
      mutate: () => sftp.writeFile('/srv/app/release.txt', 'new', 0o640)
    })

    assert.equal(context.completed.state, 'rollback-available')
    assert.equal(
      context.completed.artifacts.postMutation.resources[0].descriptor.digestAlgorithm,
      'SHELLPILOT-SHA-256-CHAIN-V1'
    )
    await sftp.writeFile('/srv/app/release.txt', 'bad', 0o640)
    const mutationCalls = sftp.calls.length

    await assert.rejects(
      context.runner.rollback(operation.id),
      /外部变化|拒绝回滚/
    )
    assert.equal(sftp.text('/srv/app/release.txt'), 'bad')
    assert.equal(sftp.calls.slice(mutationCalls).some(call => (
      ['rename', 'removeEntry', 'rm', 'rmdir'].includes(call[0])
    )), false)
  }
})

test('SFTP rollback refuses external directory tree changes after a verified upload', async () => {
  const sftp = createFakeSftp({
    '/srv/app': { type: 'directory' },
    '/srv/app/release': { type: 'directory', mode: 0o750 },
    '/srv/app/release/config.txt': { type: 'file', content: 'old', mode: 0o640 }
  })
  const operation = await buildSftpOperation({
    id: 'adapter-upload-post-directory',
    action: 'upload',
    paths: { target: '/srv/app/release' },
    type: 'directory',
    expected: { type: 'directory' },
    transfer: {
      identity: 'upload-post-directory',
      sourceIdentity: 'source-post-directory',
      batchId: 'batch-post-directory',
      direction: 'local-to-remote'
    }
  })
  const context = await runExternalSftpTransfer({
    operation,
    sftp,
    mutate: async () => {
      await sftp.removeEntry('/srv/app/release')
      await sftp.mkdir('/srv/app/release')
      await sftp.writeFile('/srv/app/release/config.txt', 'new', 0o640)
    }
  })

  assert.equal(context.completed.state, 'rollback-available')
  assert.equal(
    context.completed.artifacts.postMutation.resources[0].descriptor.entries[0].name,
    'config.txt'
  )
  await sftp.writeFile('/srv/app/release/extra.txt', 'outside', 0o600)
  const mutationCalls = sftp.calls.length

  await assert.rejects(
    context.runner.rollback(operation.id),
    /外部变化|拒绝回滚/
  )
  assert.equal(sftp.text('/srv/app/release/extra.txt'), 'outside')
  assert.equal(sftp.calls.slice(mutationCalls).some(call => (
    ['rename', 'removeEntry', 'rm', 'rmdir'].includes(call[0])
  )), false)
})

test('SFTP directory upload partial failure remains rollbackable', async () => {
  const sftp = createFakeSftp({
    '/srv/app': { type: 'directory' }
  })
  const operation = await buildSftpOperation({
    id: 'adapter-upload-directory-partial',
    action: 'upload',
    paths: { target: '/srv/app/release' },
    type: 'directory',
    expected: { type: 'directory' },
    transfer: {
      identity: 'upload-directory-partial',
      sourceIdentity: 'source-directory-partial',
      batchId: 'batch-directory',
      direction: 'local-to-remote'
    }
  })
  const context = await createRealSftpTransactionRunner(operation, sftp)
  await context.runner.prepare(operation)
  const begun = await context.runner.beginExternalExecution(operation.id, {
    confirmed: true,
    transferIdentity: operation.effect.transfer.identity,
    cancelExternal: async () => {}
  })
  await sftp.mkdir('/srv/app/release')
  await sftp.writeFile('/srv/app/release/partial.txt', 'partial')

  const failed = await context.runner.completeExternalExecution(operation.id, {
    executionId: begun.executionId,
    effectKey: operation.effectKey,
    transferIdentity: operation.effect.transfer.identity,
    exitCode: 1
  })
  assert.equal(failed.state, 'failed')
  assert.equal(sftp.exists('/srv/app/release/partial.txt'), true)

  const restored = await context.runner.rollback(operation.id)
  assert.equal(restored.state, 'restored')
  assert.equal(sftp.exists('/srv/app/release'), false)
})

test('SFTP same-endpoint copy and move bind both paths and restore both sides', async () => {
  const cases = [
    {
      action: 'copy',
      mutate: sftp => sftp.cp('/srv/app/source.txt', '/srv/app/target.txt'),
      initialTarget: false
    },
    {
      action: 'move',
      mutate: sftp => sftp.rename('/srv/app/source.txt', '/srv/app/target.txt'),
      initialTarget: true
    }
  ]
  for (const item of cases) {
    const sftp = createFakeSftp({
      '/srv/app/source.txt': { type: 'file', content: 'source', mode: 0o640 },
      ...(item.initialTarget
        ? { '/srv/app/target.txt': { type: 'file', content: 'target', mode: 0o600 } }
        : {})
    })
    const operation = await buildSftpOperation({
      id: `adapter-${item.action}-external`,
      action: item.action,
      paths: {
        source: '/srv/app/source.txt',
        target: '/srv/app/target.txt'
      },
      type: 'file',
      expected: { type: 'file', size: 6 },
      transfer: {
        identity: `${item.action}-item`,
        batchId: 'batch-same-endpoint',
        direction: 'same-endpoint'
      }
    })
    const context = await runExternalSftpTransfer({
      operation,
      sftp,
      mutate: () => item.mutate(sftp)
    })

    assert.equal(context.completed.state, 'rollback-available')
    assert.equal(sftp.text('/srv/app/target.txt'), 'source')
    await context.runner.rollback(operation.id)
    assert.equal(sftp.text('/srv/app/source.txt'), 'source')
    if (item.initialTarget) assert.equal(sftp.text('/srv/app/target.txt'), 'target')
    else assert.equal(sftp.exists('/srv/app/target.txt'), false)
  }
})

test('SFTP same-endpoint copy rejects a same-size target with different content', async () => {
  const sftp = createFakeSftp({
    '/srv/app/source.txt': { type: 'file', content: 'source', mode: 0o640 }
  })
  const operation = await buildSftpOperation({
    id: 'adapter-copy-wrong-digest',
    action: 'copy',
    paths: {
      source: '/srv/app/source.txt',
      target: '/srv/app/target.txt'
    },
    type: 'file',
    expected: { type: 'file', size: 6 },
    transfer: {
      identity: 'copy-wrong-digest',
      batchId: 'batch-copy-digest',
      direction: 'same-endpoint'
    }
  })
  const context = await runExternalSftpTransfer({
    operation,
    sftp,
    mutate: () => sftp.writeFile('/srv/app/target.txt', 'xxxxxx', 0o640)
  })

  assert.equal(context.completed.state, 'failed')
  assert.match(context.completed.error, /复制后的源或目标校验失败/)
  const restored = await context.runner.rollback(operation.id)
  assert.equal(restored.state, 'restored')
  assert.equal(sftp.exists('/srv/app/target.txt'), false)
})

test('SFTP upload verification rejects same-size corruption and missing directory entries', async () => {
  const cases = [
    {
      id: 'file',
      type: 'file',
      sourceDescriptor: {
        type: 'file',
        mode: 0o640,
        uid: 501,
        gid: 20,
        size: 3,
        digest: await (await import(pathToFileURL(path.resolve(
          __dirname,
          '../../src/client/components/sftp/sftp-transaction-adapter.js'
        )).href)).digestSftpText('abc').then(result => result.digest),
        digestAlgorithm: 'SHELLPILOT-SHA-256-CHAIN-V1'
      },
      mutate: sftp => sftp.writeFile('/srv/app/target', 'xyz', 0o640)
    },
    {
      id: 'directory',
      type: 'directory',
      sourceDescriptor: {
        type: 'directory',
        mode: 0o750,
        uid: 501,
        gid: 20,
        entries: [{
          name: 'required.txt',
          entry: {
            type: 'file',
            mode: 0o640,
            uid: 501,
            gid: 20,
            size: 3,
            digest: '0'.repeat(64),
            digestAlgorithm: 'SHELLPILOT-SHA-256-CHAIN-V1'
          }
        }]
      },
      mutate: sftp => sftp.mkdir('/srv/app/target')
    }
  ]

  for (const item of cases) {
    const sftp = createFakeSftp({ '/srv/app': { type: 'directory' } })
    const operation = await buildSftpOperation({
      id: `adapter-upload-integrity-${item.id}`,
      action: 'upload',
      paths: { target: '/srv/app/target' },
      type: item.type,
      expected: { sourceDescriptor: item.sourceDescriptor },
      transfer: {
        identity: `upload-integrity-${item.id}`,
        sourceIdentity: `source-integrity-${item.id}`,
        direction: 'local-to-remote'
      }
    })
    const context = await runExternalSftpTransfer({
      operation,
      sftp,
      mutate: () => item.mutate(sftp)
    })

    assert.equal(context.completed.state, 'failed')
    assert.match(context.completed.error, /上传后的远程目标校验失败/)
    assert.equal((await context.runner.rollback(operation.id)).state, 'restored')
  }
})

test('SFTP adapter snapshots and verifies editor saves with bounded chunk reads', async () => {
  const {
    createSftpTransactionAdapter,
    digestSftpText
  } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const oldText = 'old-config\n'.repeat(90000)
  const newText = '{"enabled":true}\n'
  const sftp = createFakeSftp({
    '/srv/app/config.json': {
      type: 'file',
      content: oldText,
      mode: 0o640
    }
  })
  const expected = await digestSftpText(newText)
  const operation = await buildSftpOperation({
    id: 'adapter-editor-save',
    action: 'editor-save',
    paths: { target: '/srv/app/config.json' },
    type: 'file',
    requestedMode: 0o640,
    expected
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })

  const prepared = await adapter.prepare(operation)
  operation.plan = prepared.plan
  operation.artifacts = prepared.artifacts
  assert.equal(prepared.manifestComplete, true)
  assert.equal(sftp.text('/srv/app/config.json'), oldText)
  assert.equal(sftp.text(prepared.artifacts.target), oldText)
  assert.equal(sftp.fullReads, 0)
  assert.ok(sftp.chunkReads > 10)
  assert.ok(sftp.calls.filter(call => call[0] === 'readFileChunk')
    .every(call => call[3] <= 64 * 1024))

  await adapter.beforeExecute(operation, { input: { text: newText } })
  await adapter.verifyExecute(operation)
  assert.equal(sftp.text('/srv/app/config.json'), newText)

  await sftp.writeFile('/srv/app/config.json', 'external-change', 0o640)
  await assert.rejects(adapter.rollback(operation), /外部|变化|拒绝/)
  await sftp.writeFile('/srv/app/config.json', newText, 0o640)
  await adapter.rollback(operation)
  await adapter.verifyRollback(operation)
  assert.equal(sftp.text('/srv/app/config.json'), oldText)
  assert.equal(sftp.text(prepared.artifacts.target), oldText)
})

test('SFTP adapter forwards lifecycle AbortSignal to snapshot copy and recursive delete', async () => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const sftp = createFakeSftp({
    '/srv/app/tree': { type: 'directory', mode: 0o750 },
    '/srv/app/tree/file.txt': { type: 'file', content: 'data', mode: 0o640 }
  })
  const operation = await buildSftpOperation({
    id: 'adapter-delete-abort-signal',
    action: 'delete',
    paths: { source: '/srv/app/tree' },
    type: 'directory',
    expected: { absent: true }
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
  const controller = new AbortController()
  Object.assign(operation, await adapter.prepare(operation, {
    signal: controller.signal
  }))
  const copyCall = sftp.calls.find(call => call[0] === 'copyEntry')
  assert.equal(copyCall[3].signal, controller.signal)

  await adapter.beforeExecute(operation, { signal: controller.signal })
  const removeCall = sftp.calls.find(call => call[0] === 'removeEntry')
  assert.equal(removeCall[2].signal, controller.signal)
})

test('SFTP transport replaces transaction AbortSignal with a bounded server cancel token', async () => {
  const { prepareSftpCancelableCall } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/common/sftp-operation-cancellation.js'
  )).href)
  const controller = new AbortController()
  const input = ['/source', '/target', {
    signal: controller.signal,
    maxTotalBytes: 1024
  }]
  const prepared = prepareSftpCancelableCall('copyEntry', input, 'cancel_token-1')
  assert.equal(prepared.signal, controller.signal)
  assert.equal(prepared.cancelToken, 'cancel_token-1')
  assert.equal(prepared.args[2].signal, undefined)
  assert.equal(prepared.args[2].cancelToken, 'cancel_token-1')
  assert.equal(prepared.args[2].maxTotalBytes, 1024)
  assert.equal(input[2].cancelToken, undefined)

  const ordinary = prepareSftpCancelableCall('cp', input, 'cancel_token-2')
  assert.equal(ordinary.signal, undefined)
  assert.equal(ordinary.cancelToken, undefined)
  assert.equal(ordinary.args, input)

  assert.throws(
    () => prepareSftpCancelableCall('removeEntry', [
      '/tree',
      { signal: controller.signal }
    ], '../escape'),
    /token|令牌|无效/i
  )

  const fs = require('node:fs')
  const clientSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/common/sftp.js'
  ), 'utf8')
  const serverSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/app/server/session-server.js'
  ), 'utf8')
  assert.match(clientSource, /action:\s*'sftp-cancel'/)
  assert.match(serverSource, /action === 'sftp-cancel'[\s\S]{0,300}cancelOperation/)
})

test('SFTP action cancellation after mutation start remains immediately rollbackable', async t => {
  const { digestSftpText } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const cases = [
    {
      action: 'editor-save',
      initial: {
        '/srv/app/config.txt': { type: 'file', content: 'original', mode: 0o640 }
      },
      operation: {
        paths: { target: '/srv/app/config.txt' },
        type: 'file',
        requestedMode: 0o640,
        expected: await digestSftpText('replacement')
      },
      input: { text: 'replacement' },
      installAtomicHook (sftp, started, atomic) {
        const writeFile = sftp.writeFile.bind(sftp)
        sftp.writeFile = async (remotePath, ...args) => {
          if (!remotePath.endsWith('.execute')) return writeFile(remotePath, ...args)
          started()
          await atomic
          return writeFile(remotePath, ...args)
        }
      },
      verifyRestored (sftp) {
        assert.equal(sftp.text('/srv/app/config.txt'), 'original')
      }
    },
    {
      action: 'chmod',
      initial: {
        '/srv/app/mode.txt': { type: 'file', content: 'mode', mode: 0o640 }
      },
      operation: {
        paths: { source: '/srv/app/mode.txt' },
        type: 'file',
        requestedMode: 0o750,
        expected: { mode: 0o750, type: 'file' }
      },
      installAtomicHook (sftp, started, atomic) {
        const chmod = sftp.chmod.bind(sftp)
        sftp.chmod = async (remotePath, mode) => {
          if (remotePath !== '/srv/app/mode.txt' || mode !== 0o750) {
            return chmod(remotePath, mode)
          }
          started()
          await atomic
          return chmod(remotePath, mode)
        }
      },
      verifyRestored (sftp) {
        assert.equal(sftp.nodes.get('/srv/app/mode.txt').mode, 0o640)
      }
    },
    {
      action: 'rename',
      initial: {
        '/srv/app/source.txt': { type: 'file', content: 'source', mode: 0o640 }
      },
      operation: {
        paths: {
          source: '/srv/app/source.txt',
          target: '/srv/app/renamed.txt'
        },
        type: 'file'
      },
      installAtomicHook (sftp, started, atomic) {
        const rename = sftp.rename.bind(sftp)
        sftp.rename = async (from, to) => {
          if (from !== '/srv/app/source.txt' || to !== '/srv/app/renamed.txt') {
            return rename(from, to)
          }
          started()
          await atomic
          return rename(from, to)
        }
      },
      verifyRestored (sftp) {
        assert.equal(sftp.text('/srv/app/source.txt'), 'source')
        assert.equal(sftp.exists('/srv/app/renamed.txt'), false)
      }
    },
    {
      action: 'delete',
      initial: {
        '/srv/app/tree': { type: 'directory', mode: 0o750 },
        '/srv/app/tree/a.txt': { type: 'file', content: 'A', mode: 0o640 },
        '/srv/app/tree/b.txt': { type: 'file', content: 'B', mode: 0o640 }
      },
      operation: {
        paths: { source: '/srv/app/tree' },
        type: 'directory',
        expected: { absent: true }
      },
      installAtomicHook (sftp, started) {
        const removeEntry = sftp.removeEntry.bind(sftp)
        sftp.removeEntry = async (remotePath, options = {}) => {
          if (!remotePath.endsWith('.execute')) {
            return removeEntry(remotePath, options)
          }
          started()
          await new Promise(resolve => {
            if (options.signal?.aborted) return resolve()
            options.signal?.addEventListener('abort', resolve, { once: true })
          })
          const partial = [...sftp.nodes.keys()].find(path => (
            path.startsWith(`${remotePath}/`) && sftp.nodes.get(path).type === 'file'
          ))
          if (partial) sftp.nodes.delete(partial)
          const error = new Error('recursive delete aborted after partial removal')
          error.name = 'AbortError'
          throw error
        }
      },
      verifyRestored (sftp) {
        assert.equal(sftp.text('/srv/app/tree/a.txt'), 'A')
        assert.equal(sftp.text('/srv/app/tree/b.txt'), 'B')
      }
    }
  ]

  for (const definition of cases) {
    await t.test(definition.action, async () => {
      let markStarted
      let releaseAtomic
      const started = new Promise(resolve => { markStarted = resolve })
      const atomic = new Promise(resolve => { releaseAtomic = resolve })
      const sftp = createFakeSftp(definition.initial)
      definition.installAtomicHook(sftp, markStarted, atomic)
      const operation = await buildSftpOperation({
        id: `adapter-cancel-${definition.action}`,
        action: definition.action,
        ...definition.operation
      })
      const { runner } = await createRealSftpTransactionRunner(operation, sftp)
      await runner.prepare(operation)
      const executing = runner.execute(operation.id, {
        confirmed: true,
        sideEffectInput: definition.input
      })
      const executionResult = executing.then(
        value => ({ status: 'fulfilled', value }),
        reason => ({ status: 'rejected', reason })
      )
      await started
      let cancelSettled = false
      const cancelling = runner.cancel(operation.id).then(value => {
        cancelSettled = true
        return value
      })
      const cancellationResult = cancelling.then(
        value => ({ status: 'fulfilled', value }),
        reason => ({ status: 'rejected', reason })
      )
      await new Promise(resolve => setImmediate(resolve))
      if (definition.action !== 'delete') assert.equal(cancelSettled, false)
      releaseAtomic()
      const [executeResult, cancelResult] = await Promise.all([
        executionResult,
        cancellationResult
      ])

      assert.equal(executeResult.status, 'rejected')
      assert.equal(cancelResult.status, 'fulfilled')
      assert.equal(cancelResult.value.state, 'failed')
      assert.equal(cancelResult.value.mutationStarted, true)
      assert.equal(cancelResult.value.commitPoint, true)
      assert.equal((await runner.rollback(operation.id)).state, 'restored')
      definition.verifyRestored(sftp)
    })
  }
})

test('SFTP adapter restores absent editor targets and keeps displaced content', async () => {
  const {
    createSftpTransactionAdapter,
    digestSftpText
  } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const sftp = createFakeSftp({ '/srv/app': { type: 'directory' } })
  const text = 'created by editor'
  const operation = await buildSftpOperation({
    id: 'adapter-editor-absent',
    action: 'editor-save',
    paths: { target: '/srv/app/new.txt' },
    type: 'file',
    expected: await digestSftpText(text)
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
  const prepared = await adapter.prepare(operation)
  Object.assign(operation, prepared)

  await adapter.beforeExecute(operation, { input: { text } })
  await adapter.verifyExecute(operation)
  await adapter.rollback(operation)
  await adapter.verifyRollback(operation)

  assert.equal(sftp.exists('/srv/app/new.txt'), false)
  assert.equal(sftp.text(operation.plan.resources[0].displacedPath), text)
})

test('SFTP adapter restores an editor target after an interrupted atomic swap', async () => {
  const {
    createSftpTransactionAdapter,
    digestSftpText
  } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const sftp = createFakeSftp({
    '/srv/app/config.txt': { type: 'file', content: 'original', mode: 0o640 }
  }, { failEditorSwap: true })
  const operation = await buildSftpOperation({
    id: 'adapter-editor-interrupted',
    action: 'editor-save',
    paths: { target: '/srv/app/config.txt' },
    type: 'file',
    requestedMode: 0o640,
    expected: await digestSftpText('replacement')
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
  Object.assign(operation, await adapter.prepare(operation))

  await assert.rejects(
    adapter.beforeExecute(operation, { input: { text: 'replacement' } }),
    /swap failed/i
  )
  operation.failedAt = new Date().toISOString()
  await adapter.rollback(operation)
  await adapter.verifyRollback(operation)
  assert.equal(sftp.text('/srv/app/config.txt'), 'original')
  assert.equal(sftp.text(operation.artifacts.target), 'original')
})

test('SFTP adapter handles chmod for files and directories exactly', async t => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  for (const type of ['file', 'directory']) {
    await t.test(type, async () => {
      const target = `/srv/app/${type === 'file' ? 'run.sh' : 'private'}`
      const sftp = createFakeSftp({
        [target]: { type, content: type === 'file' ? '#!/bin/sh' : undefined, mode: 0o640 }
      })
      const operation = await buildSftpOperation({
        id: `adapter-chmod-${type}`,
        action: 'chmod',
        paths: { source: target },
        type,
        requestedMode: 0o750,
        expected: { mode: 0o750, type }
      })
      const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
      Object.assign(operation, await adapter.prepare(operation))
      assert.deepEqual(operation.plan.resources[0].original, {
        type,
        mode: 0o640,
        uid: 1000,
        gid: 1000
      })
      assert.equal(sftp.calls.some(call => (
        call[0] === 'readFileChunk' && call[1] === target
      )), false)
      await adapter.beforeExecute(operation)
      await adapter.verifyExecute(operation)
      assert.equal((await sftp.stat(target)).mode & 0o7777, 0o750)
      await sftp.chown(target, 9001, 9002)
      await assert.rejects(adapter.rollback(operation), /外部|ownership|uid|gid|拒绝/i)
      await sftp.chown(target, 1000, 1000)
      await adapter.rollback(operation)
      await adapter.verifyRollback(operation)
      assert.equal((await sftp.stat(target)).mode & 0o7777, 0o640)
    })
  }
})

test('SFTP adapter bounds recursive directory descriptions and fails closed', async () => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const initial = {
    '/srv/app/deep': { type: 'directory' }
  }
  let current = '/srv/app/deep'
  for (let index = 0; index < 140; index += 1) {
    current = `${current}/d${index}`
    initial[current] = { type: 'directory' }
  }
  const sftp = createFakeSftp(initial)
  const operation = await buildSftpOperation({
    id: 'adapter-bounded-tree',
    action: 'delete',
    paths: { source: '/srv/app/deep' },
    type: 'directory',
    expected: { absent: true }
  })

  await assert.rejects(
    createSftpTransactionAdapter({ getSftp: () => sftp }).prepare(operation),
    /limit|bounded|too (?:deep|large)|上限|过深|过大/i
  )
  assert.equal(sftp.exists('/srv/app/deep'), true)
  assert.equal(sftp.calls.some(call => call[0] === 'copyEntry'), false)
})

test('SFTP adapter rejects an oversized manifest before creating snapshot staging', async () => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const initial = {
    '/srv/app/wide': { type: 'directory', mode: 0o750 }
  }
  for (let index = 0; index < 1400; index += 1) {
    const suffix = String(index).padStart(4, '0')
    const name = `${suffix}-${'manifest-entry-'.repeat(13)}`
    initial[`/srv/app/wide/${name}`] = { type: 'directory', mode: 0o750 }
  }
  const sftp = createFakeSftp(initial)
  const operation = await buildSftpOperation({
    id: 'sftp-delete-oversized-manifest',
    action: 'delete',
    paths: { source: '/srv/app/wide' },
    type: 'directory',
    expected: { absent: true }
  })

  await assert.rejects(
    createSftpTransactionAdapter({ getSftp: () => sftp }).prepare(operation),
    /manifest|清单|size|limit|大小|上限/i
  )
  assert.equal(sftp.calls.some(call => call[0] === 'copyEntry'), false)
  assert.equal([...sftp.nodes.keys()].some(key => key.includes(operation.id)), false)
})

test('SFTP adapter snapshots both rename paths and blocks cross-filesystem or special sources', async () => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const sftp = createFakeSftp({
    '/srv/app/source.txt': { type: 'file', content: 'source', mode: 0o640, dev: 7 },
    '/srv/app/target.txt': { type: 'file', content: 'target', mode: 0o600, dev: 7 }
  })
  const operation = await buildSftpOperation({
    id: 'adapter-rename',
    action: 'rename',
    paths: { source: '/srv/app/source.txt', target: '/srv/app/target.txt' },
    type: 'file'
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
  Object.assign(operation, await adapter.prepare(operation))
  assert.equal(sftp.text(operation.artifacts.source), 'source')
  assert.equal(sftp.text(operation.artifacts.target), 'target')

  await adapter.beforeExecute(operation)
  await adapter.verifyExecute(operation)
  assert.equal(sftp.exists('/srv/app/source.txt'), false)
  assert.equal(sftp.text('/srv/app/target.txt'), 'source')
  await adapter.rollback(operation)
  await adapter.verifyRollback(operation)
  assert.equal(sftp.text('/srv/app/source.txt'), 'source')
  assert.equal(sftp.text('/srv/app/target.txt'), 'target')

  const crossFs = createFakeSftp({
    '/mnt/a/source.txt': { type: 'file', content: 'a', dev: 1 },
    '/mnt/b': { type: 'directory', dev: 2 }
  })
  const crossOperation = await buildSftpOperation({
    id: 'adapter-rename-cross-fs',
    action: 'rename',
    paths: { source: '/mnt/a/source.txt', target: '/mnt/b/target.txt' },
    type: 'file'
  })
  await assert.rejects(
    createSftpTransactionAdapter({ getSftp: () => crossFs }).prepare(crossOperation),
    /文件系统|跨|拒绝/
  )

  const special = createFakeSftp({
    '/srv/app/link': { type: 'symlink', mode: 0o777 }
  })
  const specialOperation = await buildSftpOperation({
    id: 'adapter-rename-special',
    action: 'rename',
    paths: { source: '/srv/app/link', target: '/srv/app/link-new' },
    type: 'file'
  })
  await assert.rejects(
    createSftpTransactionAdapter({ getSftp: () => special }).prepare(specialOperation),
    /符号链接|特殊|拒绝/
  )

  const noDeviceIds = createFakeSftp({
    '/srv/app/same-a.txt': { type: 'file', content: 'a' }
  }, { omitDev: true })
  const sameDirectoryOperation = await buildSftpOperation({
    id: 'adapter-rename-no-device-id',
    action: 'rename',
    paths: {
      source: '/srv/app/same-a.txt',
      target: '/srv/app/same-b.txt'
    },
    type: 'file'
  })
  const sameDirectoryAdapter = createSftpTransactionAdapter({
    getSftp: () => noDeviceIds
  })
  await sameDirectoryAdapter.prepare(sameDirectoryOperation)
})

test('SFTP adapter snapshots and restores complete delete trees', async () => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const sftp = createFakeSftp({
    '/srv/app/data': { type: 'directory', mode: 0o750 },
    '/srv/app/data/a.txt': { type: 'file', content: 'A', mode: 0o640 },
    '/srv/app/data/nested': { type: 'directory', mode: 0o700 },
    '/srv/app/data/nested/b.bin': { type: 'file', content: Buffer.alloc(180000, 7), mode: 0o600 }
  })
  const operation = await buildSftpOperation({
    id: 'adapter-delete-tree',
    action: 'delete',
    paths: { source: '/srv/app/data' },
    type: 'directory',
    expected: { absent: true }
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
  Object.assign(operation, await adapter.prepare(operation))

  await adapter.beforeExecute(operation)
  await adapter.verifyExecute(operation)
  assert.equal(sftp.exists('/srv/app/data'), false)
  await adapter.rollback(operation)
  await adapter.verifyRollback(operation)
  assert.equal(sftp.text('/srv/app/data/a.txt'), 'A')
  assert.equal(sftp.nodes.get('/srv/app/data/nested/b.bin').content.length, 180000)
  assert.equal(sftp.fullReads, 0)
  assert.equal(sftp.calls.some(call => (
    call[0] === 'copyEntry' && call[1] === '/srv/app/data'
  )), true)
  assert.equal(sftp.calls.some(call => (
    call[0] === 'removeEntry' && call[1] === operation.plan.resources[0].executionPath
  )), true)
})

test('SFTP adapter binds and restores ownership for every directory entry', async t => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const source = {
    '/srv/app/owned': {
      type: 'directory', mode: 0o750, uid: 2100, gid: 3100
    },
    '/srv/app/owned/a.txt': {
      type: 'file', content: 'A', mode: 0o640, uid: 2101, gid: 3101
    },
    '/srv/app/owned/nested': {
      type: 'directory', mode: 0o700, uid: 2102, gid: 3102
    },
    '/srv/app/owned/nested/b.txt': {
      type: 'file', content: 'B', mode: 0o600, uid: 2103, gid: 3103
    }
  }
  const operation = await buildSftpOperation({
    id: 'adapter-delete-ownership',
    action: 'delete',
    paths: { source: '/srv/app/owned' },
    type: 'directory',
    expected: { absent: true }
  })
  const sftp = createFakeSftp(source)
  const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
  Object.assign(operation, await adapter.prepare(operation))

  const original = operation.plan.resources[0].original
  assert.deepEqual(
    { uid: original.uid, gid: original.gid },
    { uid: 2100, gid: 3100 }
  )
  assert.deepEqual(
    original.entries.map(item => [item.name, item.entry.uid, item.entry.gid]),
    [['a.txt', 2101, 3101], ['nested', 2102, 3102]]
  )
  assert.deepEqual(
    original.entries[1].entry.entries.map(item => [
      item.name,
      item.entry.uid,
      item.entry.gid
    ]),
    [['b.txt', 2103, 3103]]
  )

  await adapter.beforeExecute(operation)
  await adapter.verifyExecute(operation)
  await adapter.rollback(operation)
  await adapter.verifyRollback(operation)
  for (const [remotePath, metadata] of Object.entries(source)) {
    const restored = sftp.nodes.get(remotePath)
    assert.equal(restored.uid, metadata.uid, remotePath)
    assert.equal(restored.gid, metadata.gid, remotePath)
  }

  await t.test('ownership mismatch fails prepare', async () => {
    const mismatched = createFakeSftp(source, { dropOwnershipOnCopy: true })
    const mismatchOperation = await buildSftpOperation({
      id: 'adapter-delete-ownership-mismatch',
      action: 'delete',
      paths: { source: '/srv/app/owned' },
      type: 'directory',
      expected: { absent: true }
    })
    await assert.rejects(
      createSftpTransactionAdapter({ getSftp: () => mismatched })
        .prepare(mismatchOperation),
      /ownership|uid|gid|快照|校验/i
    )
    assert.equal(mismatched.exists('/srv/app/owned'), true)
  })

  await t.test('chown failure fails prepare', async () => {
    const denied = createFakeSftp(source, { failChown: true })
    const deniedOperation = await buildSftpOperation({
      id: 'adapter-delete-ownership-denied',
      action: 'delete',
      paths: { source: '/srv/app/owned' },
      type: 'directory',
      expected: { absent: true }
    })
    await assert.rejects(
      createSftpTransactionAdapter({ getSftp: () => denied })
        .prepare(deniedOperation),
      /chown|ownership|权限|unsupported/i
    )
    assert.equal(denied.exists('/srv/app/owned'), true)
  })
})

test('SFTP adapter can roll back an interrupted recursive delete', async () => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  const sftp = createFakeSftp({
    '/srv/app/data': { type: 'directory', mode: 0o750 },
    '/srv/app/data/a.txt': { type: 'file', content: 'A', mode: 0o640 },
    '/srv/app/data/b.txt': { type: 'file', content: 'B', mode: 0o600 }
  }, { failRemove: true })
  const operation = await buildSftpOperation({
    id: 'adapter-delete-interrupted',
    action: 'delete',
    paths: { source: '/srv/app/data' },
    type: 'directory',
    expected: { absent: true }
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
  Object.assign(operation, await adapter.prepare(operation))

  await assert.rejects(adapter.beforeExecute(operation), /remove failed/i)
  await adapter.rollback(operation)
  await adapter.verifyRollback(operation)
  assert.equal(sftp.text('/srv/app/data/a.txt'), 'A')
  assert.equal(sftp.text('/srv/app/data/b.txt'), 'B')
})

test('SFTP adapter fails closed on copy or manifest failure and reuses a verified manifest', async t => {
  const { createSftpTransactionAdapter } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-transaction-adapter.js'
  )).href)
  for (const failure of ['copy', 'manifest']) {
    await t.test(failure, async () => {
      const sftp = createFakeSftp({
        '/srv/app/file.txt': { type: 'file', content: 'original' }
      }, {
        failCopy: failure === 'copy',
        failManifest: failure === 'manifest'
      })
      const operation = await buildSftpOperation({
        id: `adapter-fail-${failure}`,
        action: 'delete',
        paths: { source: '/srv/app/file.txt' },
        type: 'file',
        expected: { absent: true }
      })
      const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
      await assert.rejects(adapter.prepare(operation), /space|copy|manifest|清单|快照/i)
      assert.equal(sftp.text('/srv/app/file.txt'), 'original')
    })
  }

  const sftp = createFakeSftp({
    '/srv/app/file.txt': { type: 'file', content: 'original' }
  })
  const operation = await buildSftpOperation({
    id: 'adapter-reuse-manifest',
    action: 'delete',
    paths: { source: '/srv/app/file.txt' },
    type: 'file',
    expected: { absent: true }
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
  const first = await adapter.prepare(operation)
  const copyCount = sftp.calls.filter(call => call[0] === 'cp').length
  const second = await adapter.prepare(operation)
  assert.deepEqual(second.plan, first.plan)
  assert.equal(sftp.calls.filter(call => call[0] === 'cp').length, copyCount)
})

test('SFTP UI routes editor save chmod rename and delete through modern transactions', () => {
  const fs = require('node:fs')
  const itemSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/file-item.jsx'
  ), 'utf8')
  const entrySource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-entry.jsx'
  ), 'utf8')

  assert.match(itemSource, /changeRemoteFileMode/)
  assert.match(itemSource, /renameRemoteFile/)
  assert.match(itemSource, /saveRemoteEditorFile/)
  assert.match(itemSource, /Number\.parseInt\(String\(permission\), 8\)/)
  assert.match(
    itemSource,
    /changeFileMode[\s\S]{0,500}this\.props\.isFtp[\s\S]{0,180}sftp\.chmod\(p, permission\)/
  )
  assert.doesNotMatch(itemSource, /recordSftpMutationRecovery/)
  assert.match(entrySource, /createTransactionRunner/)
  assert.match(entrySource, /createSftpTransactionAdapter/)
  assert.match(entrySource, /buildSideEffectSafetyRequest/)
  assert.match(entrySource, /runSftpSafetyOperation/)
  assert.match(entrySource, /deleteRemoteFilesWithSafety/)
  assert.match(entrySource, /mode === undefined \? undefined : Number\(mode\) & 0o7777/)
  assert.match(entrySource, /renameRemoteFile[\s\S]{0,300}this\.props\.isFtp/)
  assert.match(entrySource, /saveRemoteEditorFile[\s\S]{0,300}this\.props\.isFtp/)
  assert.match(entrySource, /deleteRemoteFilesWithSafety[\s\S]{0,300}this\.props\.isFtp/)
  assert.match(
    entrySource,
    /renderDelConfirmTitle[\s\S]{0,500}this\.props\.isFtp[\s\S]{0,180}永久删除[\s\S]{0,80}无恢复快照/
  )
  assert.match(entrySource, /恢复快照已验证/)
  assert.match(
    entrySource,
    /deleteRemoteFilesWithSafety[\s\S]{0,220}this\.props\.isFtp[\s\S]{0,220}confirmDelete[\s\S]{0,220}remoteDel/
  )
  assert.doesNotMatch(entrySource, /softDeleteRemoteFiles\(/)
  assert.doesNotMatch(entrySource, /recordSftpMutationRecovery/)
  for (const method of [
    'getSftpSafetyEndpoint',
    'rollbackSafetyOperation',
    'keepSafetyOperation',
    'cancelSafetyOperation'
  ]) {
    assert.match(entrySource, new RegExp(method))
  }
})

test('safety center routes modern SFTP records to SFTP capability and summarizes effects', async () => {
  const centerRoot = path.resolve(__dirname, '../../src/client/components/main')
  const {
    buildSafetyRecordViewModel,
    findMatchingSafetySftp
  } = await import(pathToFileURL(path.join(
    centerRoot,
    'safety-operation-center-model.js'
  )).href)
  const { executeSafetyCenterAction } = await import(pathToFileURL(path.join(
    centerRoot,
    'safety-operation-center-actions.js'
  )).href)
  const operation = await createSideEffectOperation()
  operation.state = 'rollback-available'
  const prepared = sideEffectPrepareResult(operation)
  operation.plan = prepared.plan
  operation.artifacts = prepared.artifacts
  operation.recoveryReadyAt = '2026-07-14T08:01:00.000Z'
  operation.recoveryBinding = {
    schemaVersion: 2,
    algorithm: 'SHA-256',
    fingerprint: 'a'.repeat(64)
  }
  const calls = []
  const capability = {
    sftp: {},
    getSftpSafetyEndpoint: () => operation.endpoint,
    rollbackSafetyOperation: async id => {
      calls.push(id)
      return { state: 'restored' }
    }
  }

  assert.equal(findMatchingSafetySftp(
    operation,
    ['tab-1'],
    () => capability
  ), capability)
  const result = await executeSafetyCenterAction({
    record: operation,
    action: 'rollback',
    getOperation: async () => operation,
    findModernCapability: latest => findMatchingSafetySftp(
      latest,
      ['tab-1'],
      () => capability
    ),
    resolveLegacyTarget: async () => { throw new Error('must not use legacy') },
    runLegacyAction: async () => { throw new Error('must not use legacy') }
  })
  assert.equal(result.state, 'restored')
  assert.deepEqual(calls, [operation.id])

  const view = buildSafetyRecordViewModel(operation)
  assert.equal(view.effectAdapter, 'sftp')
  assert.equal(view.effectAction, 'editor-save')
  assert.deepEqual(view.resourcePaths, ['/srv/app/config.json'])
  assert.equal(view.artifactPaths.some(value => value.endsWith('/manifest.json')), true)
  assert.match(view.commandSummary, /editor-save/)
  assert.doesNotMatch(view.commandSummary, /undefined/)
})
