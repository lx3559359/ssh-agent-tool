const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const actionsModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/main/safety-operation-center-actions.js'
)).href

function clone (value) {
  return value === undefined ? undefined : structuredClone(value)
}

function legacyOperation (overrides = {}) {
  return {
    id: 'legacy-sftp-1',
    schemaVersion: 1,
    source: 'sftp',
    state: 'rollback-available',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      pid: 1001,
      sessionType: 'ssh'
    },
    metadata: {
      legacy: true,
      legacyRecord: {
        id: 'sftp-record-1',
        source: 'sftp',
        status: 'available',
        host: 'prod.example.com',
        port: 22,
        username: 'root',
        tabId: 'tab-1'
      }
    },
    createdAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T10:00:00.000Z',
    ...overrides
  }
}

function modernOperation (overrides = {}) {
  return {
    id: 'modern-1',
    schemaVersion: 1,
    source: 'terminal',
    state: 'rollback-available',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      pid: 1001,
      sessionType: 'ssh'
    },
    recoveryBinding: {
      schemaVersion: 1,
      algorithm: 'SHA-256',
      fingerprint: 'a'.repeat(64)
    },
    plan: {
      operationDir: '~/.shellpilot/operations/modern-1/',
      rollbackCommand: 'rollback',
      verifyCommand: 'verify'
    },
    artifacts: { manifest: '~/.shellpilot/operations/modern-1/manifest.json' },
    recoveryReadyAt: '2026-07-13T10:01:00.000Z',
    createdAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T10:00:00.000Z',
    ...overrides
  }
}

function createActionStore (initial) {
  let current = clone(initial)
  let queue = Promise.resolve()
  const transitions = []

  return {
    transitions,
    async getOperation () {
      return clone(current)
    },
    guardedPatchOperation (id, predicate, patch) {
      const work = queue.then(async () => {
        if (current?.id !== id) throw new Error(`missing record: ${id}`)
        if (await predicate(clone(current)) !== true) {
          throw new Error('安全事务完整性校验失败，已拒绝原子更新。')
        }
        const resolved = typeof patch === 'function'
          ? await patch(clone(current))
          : patch
        current = {
          ...current,
          ...clone(resolved),
          metadata: resolved?.metadata
            ? { ...current.metadata, ...clone(resolved.metadata) }
            : current.metadata
        }
        transitions.push(current.state)
        return clone(current)
      })
      queue = work.catch(() => {})
      return work
    }
  }
}

function deferred () {
  let resolveDeferred
  const promise = new Promise(resolve => { resolveDeferred = resolve })
  return { promise, resolve: resolveDeferred }
}

async function waitFor (predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('timed out waiting for condition')
}

function actionOptions (store, overrides = {}) {
  return {
    getOperation: store.getOperation,
    guardedPatchOperation: store.guardedPatchOperation,
    now: () => new Date('2026-07-13T12:00:00.000Z'),
    createClaimToken: () => 'claim-1',
    resolveLegacyTarget: async () => ({ kind: 'sftp' }),
    runLegacyAction: async () => true,
    ...overrides
  }
}

test('legacy SFTP false result is failed atomically and remains retryable', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const record = legacyOperation()
  const store = createActionStore(record)
  let attempts = 0
  const options = actionOptions(store, {
    runLegacyAction: async () => {
      attempts += 1
      return attempts > 1
    }
  })

  await assert.rejects(
    executeSafetyCenterAction({ record, action: 'rollback', ...options }),
    /恢复失败|未成功/
  )
  const failed = await store.getOperation(record.id)
  assert.equal(failed.state, 'failed')
  assert.match(failed.error, /恢复失败|未成功/)
  assert.equal(typeof failed.failedAt, 'string')
  assert.equal(failed.completedAt, undefined)

  const restored = await executeSafetyCenterAction({
    record: failed,
    action: 'rollback',
    ...options,
    createClaimToken: () => 'claim-2'
  })
  assert.equal(restored.state, 'restored')
  assert.equal(attempts, 2)
  assert.deepEqual(store.transitions, [
    'rolling-back',
    'failed',
    'rolling-back',
    'restored'
  ])
})

test('legacy action re-reads latest record and rejects restored or kept state', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  for (const state of ['restored', 'kept']) {
    const staleView = legacyOperation()
    const store = createActionStore(legacyOperation({ state }))
    let executions = 0

    await assert.rejects(
      executeSafetyCenterAction({
        record: staleView,
        action: 'rollback',
        ...actionOptions(store, {
          runLegacyAction: async () => { executions += 1 }
        })
      }),
      /状态已变化|不允许/
    )
    assert.equal(executions, 0)
    assert.equal((await store.getOperation(staleView.id)).state, state)
  }
})

test('guarded legacy claim prevents duplicate execution across modal instances', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const record = legacyOperation()
  const store = createActionStore(record)
  const pending = deferred()
  let executions = 0
  const options = actionOptions(store, {
    runLegacyAction: async () => {
      executions += 1
      return pending.promise
    }
  })

  const first = executeSafetyCenterAction({ record, action: 'rollback', ...options })
  await waitFor(() => store.transitions.includes('rolling-back'))
  await assert.rejects(
    executeSafetyCenterAction({
      record,
      action: 'rollback',
      ...options,
      createClaimToken: () => 'claim-2'
    }),
    /状态已变化|不允许/
  )
  pending.resolve(true)
  assert.equal((await first).state, 'restored')
  assert.equal(executions, 1)
})

test('legacy endpoint mismatch records failure without invoking remote action', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const record = legacyOperation()
  const store = createActionStore(record)
  let executions = 0

  await assert.rejects(
    executeSafetyCenterAction({
      record,
      action: 'rollback',
      ...actionOptions(store, {
        resolveLegacyTarget: async () => undefined,
        runLegacyAction: async () => { executions += 1 }
      })
    }),
    /端点匹配|匹配的活动/
  )
  assert.equal(executions, 0)
  assert.equal((await store.getOperation(record.id)).state, 'failed')
})

test('modern action re-reads latest endpoint and invokes only terminal runner capability', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const staleView = modernOperation({ endpoint: { ...modernOperation().endpoint, tabId: 'stale-tab' } })
  const latest = modernOperation()
  const store = createActionStore(latest)
  const calls = []
  const terminal = {
    rollbackSafetyOperation: async id => {
      calls.push(['rollback', id])
      return { ...latest, state: 'restored' }
    }
  }

  const result = await executeSafetyCenterAction({
    record: staleView,
    action: 'rollback',
    getOperation: store.getOperation,
    guardedPatchOperation: store.guardedPatchOperation,
    findModernTerminal: record => {
      calls.push(['find', record.endpoint.tabId])
      return terminal
    }
  })

  assert.equal(result.state, 'restored')
  assert.deepEqual(calls, [['find', 'tab-1'], ['rollback', latest.id]])
  assert.deepEqual(store.transitions, [])
})

test('modern stale state and endpoint mismatch never invoke runner', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  let runnerCalls = 0
  const staleStore = createActionStore(modernOperation({ state: 'restored' }))
  await assert.rejects(
    executeSafetyCenterAction({
      record: modernOperation(),
      action: 'rollback',
      getOperation: staleStore.getOperation,
      guardedPatchOperation: staleStore.guardedPatchOperation,
      findModernTerminal: () => ({
        rollbackSafetyOperation: async () => { runnerCalls += 1 }
      })
    }),
    /状态已变化|不允许/
  )

  const readyStore = createActionStore(modernOperation())
  await assert.rejects(
    executeSafetyCenterAction({
      record: modernOperation(),
      action: 'rollback',
      getOperation: readyStore.getOperation,
      guardedPatchOperation: readyStore.guardedPatchOperation,
      findModernTerminal: () => undefined
    }),
    /端点完全匹配/
  )
  assert.equal(runnerCalls, 0)
})
