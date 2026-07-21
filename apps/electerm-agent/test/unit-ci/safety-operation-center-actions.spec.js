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

function legacyTerminalOperation (record, state) {
  const legacyStatus = state === 'restored' ? 'restored' : 'kept'
  return {
    ...clone(record),
    state,
    metadata: {
      ...clone(record.metadata),
      safetyCenterLegacyClaim: null,
      legacyRecord: {
        ...clone(record.metadata.legacyRecord),
        status: legacyStatus,
        rollbackStatus: legacyStatus === 'restored' ? 'completed' : 'kept'
      }
    }
  }
}

function legacyQuickOperation (overrides = {}) {
  const record = legacyOperation()
  return {
    ...record,
    source: 'quick-command',
    metadata: {
      ...record.metadata,
      legacyRecord: {
        ...record.metadata.legacyRecord,
        source: 'quick-command',
        rollbackPath: '/tmp/shellpilot-rollback/network.sh'
      }
    },
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
    replaceOperation (operation) {
      current = clone(operation)
    },
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
    if (await predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('timed out waiting for condition')
}

function actionOptions (store, overrides = {}) {
  return {
    getOperation: store.getOperation,
    guardedPatchOperation: store.guardedPatchOperation,
    syncLegacyOperation: store.getOperation,
    now: () => new Date('2026-07-13T12:00:00.000Z'),
    createClaimId: () => 'claim-1',
    claimLeaseMs: 60_000,
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
    createClaimId: () => 'claim-2'
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

test('legacy action treats the same migrated terminal state as idempotent and rejects conflicts', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const staleView = legacyOperation()
  const restoredStore = createActionStore(legacyTerminalOperation(staleView, 'restored'))
  let executions = 0

  const restored = await executeSafetyCenterAction({
    record: staleView,
    action: 'rollback',
    ...actionOptions(restoredStore, {
      runLegacyAction: async () => { executions += 1 }
    })
  })
  assert.equal(restored.state, 'restored')
  assert.equal(executions, 0)

  const keptStore = createActionStore(legacyTerminalOperation(staleView, 'kept'))
  await assert.rejects(
    executeSafetyCenterAction({
      record: staleView,
      action: 'rollback',
      ...actionOptions(keptStore, {
        runLegacyAction: async () => { executions += 1 }
      })
    }),
    /状态已变化|冲突|不允许/
  )
  assert.equal(executions, 0)
  assert.equal((await keptStore.getOperation(staleView.id)).state, 'kept')
})

test('legacy success accepts a matching migration terminal write during claim commit', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const record = legacyOperation()
  const store = createActionStore(record)

  const result = await executeSafetyCenterAction({
    record,
    action: 'rollback',
    ...actionOptions(store, {
      runLegacyAction: async claimed => {
        store.replaceOperation(legacyTerminalOperation(claimed, 'restored'))
        return true
      }
    })
  })

  assert.equal(result.state, 'restored')
  assert.equal(result.metadata.safetyCenterLegacyClaim, null)
  assert.equal(result.stateWriteError, undefined)
  assert.equal((await store.getOperation(record.id)).state, 'restored')
  assert.deepEqual(store.transitions, ['rolling-back'])
})

test('legacy quick keep accepts a matching kept migration write during claim commit', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const record = legacyQuickOperation()
  const store = createActionStore(record)
  let executions = 0

  const result = await executeSafetyCenterAction({
    record,
    action: 'keep',
    ...actionOptions(store, {
      runLegacyAction: async claimed => {
        executions += 1
        store.replaceOperation(legacyTerminalOperation(claimed, 'kept'))
        return true
      }
    })
  })

  assert.equal(result.state, 'kept')
  assert.equal(executions, 1)
  assert.equal((await store.getOperation(record.id)).state, 'kept')
  assert.deepEqual(store.transitions, ['rolling-back'])
})

test('legacy claims persist an injected-clock lease and block an unexpired owner', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const record = legacyOperation()
  const store = createActionStore(record)
  const pending = deferred()
  const first = executeSafetyCenterAction({
    record,
    action: 'rollback',
    ...actionOptions(store, {
      runLegacyAction: async () => pending.promise
    })
  })
  await waitFor(() => store.transitions.includes('rolling-back'))

  const claimed = await store.getOperation(record.id)
  assert.deepEqual(claimed.metadata.safetyCenterLegacyClaim, {
    claimId: 'claim-1',
    action: 'rollback',
    claimedAt: '2026-07-13T12:00:00.000Z',
    expiresAt: '2026-07-13T12:01:00.000Z'
  })
  await assert.rejects(
    executeSafetyCenterAction({
      record,
      action: 'rollback',
      ...actionOptions(store, {
        createClaimId: () => 'claim-2',
        runLegacyAction: async () => true
      })
    }),
    /仍在执行|状态已变化/
  )

  pending.resolve(true)
  assert.equal((await first).state, 'restored')
})

test('an expired legacy claim can be taken over and retried with a new lease', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const record = legacyOperation({
    state: 'rolling-back',
    metadata: {
      ...legacyOperation().metadata,
      safetyCenterLegacyClaim: {
        claimId: 'crashed-owner',
        action: 'rollback',
        claimedAt: '2026-07-13T11:58:00.000Z',
        expiresAt: '2026-07-13T11:59:00.000Z'
      }
    }
  })
  const store = createActionStore(record)
  let executions = 0

  const result = await executeSafetyCenterAction({
    record,
    action: 'rollback',
    ...actionOptions(store, {
      createClaimId: () => 'takeover-owner',
      runLegacyAction: async claimed => {
        executions += 1
        assert.equal(claimed.metadata.safetyCenterLegacyClaim.claimId, 'takeover-owner')
        assert.equal(claimed.metadata.safetyCenterLegacyClaim.expiresAt, '2026-07-13T12:01:00.000Z')
        return true
      }
    })
  })

  assert.equal(result.state, 'restored')
  assert.equal(executions, 1)
  assert.deepEqual(store.transitions, ['rolling-back', 'restored'])
})

test('a late legacy owner cannot overwrite a takeover owner or its terminal result', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const record = legacyOperation()
  const store = createActionStore(record)
  const firstPending = deferred()
  const secondPending = deferred()
  let currentTime = new Date('2026-07-13T12:00:00.000Z')
  const now = () => currentTime

  const first = executeSafetyCenterAction({
    record,
    action: 'rollback',
    ...actionOptions(store, {
      now,
      createClaimId: () => 'owner-1',
      runLegacyAction: async () => firstPending.promise
    })
  })
  await waitFor(async () => (await store.getOperation(record.id)).metadata?.safetyCenterLegacyClaim?.claimId === 'owner-1')
  currentTime = new Date('2026-07-13T12:02:00.000Z')

  const second = executeSafetyCenterAction({
    record,
    action: 'rollback',
    ...actionOptions(store, {
      now,
      createClaimId: () => 'owner-2',
      runLegacyAction: async () => secondPending.promise
    })
  })
  const secondOutcome = second.then(
    value => ({ value }),
    error => ({ error })
  )
  await waitFor(async () => (await store.getOperation(record.id)).metadata?.safetyCenterLegacyClaim?.claimId === 'owner-2')

  firstPending.resolve(true)
  await assert.rejects(first, /状态已变化|其他执行|接管/)
  let current = await store.getOperation(record.id)
  assert.equal(current.state, 'rolling-back')
  assert.equal(current.metadata.safetyCenterLegacyClaim.claimId, 'owner-2')

  secondPending.resolve(true)
  const outcome = await secondOutcome
  if (outcome.error) throw outcome.error
  assert.equal(outcome.value.state, 'restored')
  current = await store.getOperation(record.id)
  assert.equal(current.state, 'restored')
  assert.equal(current.metadata.safetyCenterLegacyClaim, null)
})

test('expired takeover syncs legacy storage and skips remote work when migration already completed', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const displayed = legacyOperation({
    state: 'rolling-back',
    metadata: {
      ...legacyOperation().metadata,
      safetyCenterLegacyClaim: {
        claimId: 'crashed-owner',
        action: 'rollback',
        claimedAt: '2026-07-13T11:58:00.000Z',
        expiresAt: '2026-07-13T11:59:00.000Z'
      }
    }
  })
  const store = createActionStore(displayed)
  let syncCalls = 0
  let executions = 0

  const result = await executeSafetyCenterAction({
    record: displayed,
    action: 'rollback',
    ...actionOptions(store, {
      syncLegacyOperation: async () => {
        syncCalls += 1
        const migrated = legacyTerminalOperation(displayed, 'restored')
        store.replaceOperation(migrated)
        return migrated
      },
      runLegacyAction: async () => { executions += 1 }
    })
  })

  assert.equal(result.state, 'restored')
  assert.equal(syncCalls, 1)
  assert.equal(executions, 0)
  assert.deepEqual(store.transitions, [])
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
      createClaimId: () => 'claim-2'
    }),
    /状态已变化|不允许|仍在执行/
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

test('modern revoked recovery never invokes rollback runner', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const record = modernOperation({ state: 'failed', recoveryRevokedAt: '2026-07-13T11:00:00.000Z' })
  const store = createActionStore(record)
  let runnerCalls = 0

  await assert.rejects(
    executeSafetyCenterAction({
      record,
      action: 'rollback',
      getOperation: store.getOperation,
      guardedPatchOperation: store.guardedPatchOperation,
      findModernTerminal: () => ({ rollbackSafetyOperation: async () => { runnerCalls += 1; return { ...record, state: 'restored' } } })
    }),
    /状态已变化|已撤销/
  )
  assert.equal(runnerCalls, 0)
})
