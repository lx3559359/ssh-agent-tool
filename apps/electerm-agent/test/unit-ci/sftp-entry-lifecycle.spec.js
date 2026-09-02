const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modulePath = path.resolve(
  __dirname,
  '../../src/client/components/sftp/sftp-entry-lifecycle.js'
)

async function loadModule () {
  assert.equal(
    fs.existsSync(modulePath),
    true,
    'SFTP entry lifecycle policy must be implemented as a testable module'
  )
  const url = pathToFileURL(modulePath)
  url.search = `test=${Date.now()}-${Math.random()}`
  return import(url)
}

function deferred () {
  let settle
  let rejectDeferred
  const promise = new Promise((resolve, reject) => {
    settle = resolve
    rejectDeferred = reject
  })
  return { promise, resolve: settle, reject: rejectDeferred }
}

test('generation drain releases active capabilities before transport destroy', async () => {
  const {
    activateRemoteFileGeneration,
    drainRemoteFileGeneration
  } = await loadModule()
  const releaseGate = deferred()
  const calls = []
  const entry = {
    sftp: { destroy: async () => calls.push('destroy') },
    sftpLifecycleEpoch: 7,
    remoteFileOperations: new Set([{
      async release () {
        calls.push('release')
        await releaseGate.promise
        calls.push('released')
      }
    }]),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    remoteFileOperationTail: Promise.resolve()
  }

  const drain = drainRemoteFileGeneration(entry)
  assert.equal(entry.sftp, null)
  assert.equal(entry.sftpLifecycleEpoch, 8)
  assert.equal(drain.generation.accepting, false)
  assert.deepEqual(calls, ['release'])
  releaseGate.resolve()
  await drain.promise
  assert.deepEqual(calls, ['release', 'released', 'destroy'])
  assert.equal(activateRemoteFileGeneration(entry, drain.generation), true)
  assert.equal(drain.generation.accepting, true)
})

test('generation drain invalidates displayed identity before cleanup can settle', async () => {
  const { drainRemoteFileGeneration } = await loadModule()
  const releaseGate = deferred()
  const calls = []
  const entry = {
    sftp: { destroy: async () => calls.push('destroy') },
    invalidateRemoteFileIdentity: () => calls.push('invalidate-identity'),
    remoteFileOperations: new Set([{
      async release () {
        calls.push('release')
        await releaseGate.promise
      }
    }]),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    remoteFileOperationTail: Promise.resolve()
  }

  const drain = drainRemoteFileGeneration(entry)
  assert.deepEqual(calls, ['invalidate-identity', 'release'])
  releaseGate.resolve()
  await drain.promise
  assert.deepEqual(calls, ['invalidate-identity', 'release', 'destroy'])
})

test('generation drain settles every release then destroys once and rejects observably', async () => {
  const {
    activateRemoteFileGeneration,
    drainRemoteFileGeneration
  } = await loadModule()
  const rejectedRelease = deferred()
  const pendingRelease = deferred()
  const rejectedSettlement = deferred()
  const releaseError = new Error('root cleanup failed')
  const settlementError = new Error('prepared cleanup failed')
  const calls = []
  let destroyCount = 0
  const entry = {
    sftp: {
      destroy: async () => {
        destroyCount += 1
        calls.push('destroy')
      }
    },
    remoteFileOperations: new Set([{
      release: () => {
        calls.push('release-rejected')
        return rejectedRelease.promise
      }
    }, {
      release: () => {
        calls.push('release-pending')
        return pendingRelease.promise
      }
    }]),
    remoteFileOperationSettlements: new Set([rejectedSettlement.promise]),
    remoteFileOperationBackends: new Map(),
    remoteFileOperationTail: Promise.resolve()
  }

  const oldDrain = drainRemoteFileGeneration(entry)
  const latestDrain = drainRemoteFileGeneration(entry)
  assert.deepEqual(calls, ['release-rejected', 'release-pending'])
  rejectedRelease.reject(releaseError)
  rejectedSettlement.reject(settlementError)
  await Promise.resolve()
  assert.equal(destroyCount, 0)
  pendingRelease.resolve(true)
  await assert.rejects(oldDrain.promise, error => {
    assert.equal(error instanceof AggregateError, true)
    assert.deepEqual(error.errors, [releaseError, settlementError])
    return true
  })
  await latestDrain.promise

  assert.equal(destroyCount, 1)
  assert.deepEqual(calls, ['release-rejected', 'release-pending', 'destroy'])
  assert.equal(activateRemoteFileGeneration(entry, oldDrain.generation), false)
  assert.equal(activateRemoteFileGeneration(entry, latestDrain.generation), true)
})

test('transfer quiescence joins the owner and prepared safety terminal before generation drain', async () => {
  const { quiesceSftpEntryTransfers } = await loadModule()
  const cancelGate = deferred()
  const calls = []
  const session = Object.freeze({ backend: { name: 'root' } })
  const entry = {
    props: { tab: { id: 'tab-root' } },
    sftp: { name: 'native-still-attached' },
    remoteFileGeneration: { accepting: true },
    transferSafetySessionAliases: new Map([
      ['prepared-operation', ['prepared-operation', 'sftp-transfer-prepared']]
    ]),
    transferSafetySessionPins: new Map([
      ['prepared-operation', session],
      ['sftp-transfer-prepared', session]
    ]),
    preparedTransferFileSessions: new Map([
      ['prepared', { session }]
    ]),
    async cancelTransferSafetyOperation (id, pinned) {
      assert.equal(entry.sftp?.name, 'native-still-attached')
      assert.equal(pinned, session)
      calls.push(`cancel-safety:${id}`)
      entry.transferSafetySessionAliases.delete(id)
      entry.transferSafetySessionPins.delete(id)
      return { state: 'cancelled' }
    },
    async releasePreparedTransferFileSession (id) {
      calls.push(`release-prepared:${id}`)
      entry.preparedTransferFileSessions.delete(id)
    }
  }
  let ownerReleased = false
  const owner = {
    tabId: 'tab-root',
    async cancelAndWait () {
      calls.push('cancel-owner')
      await cancelGate.promise
    },
    transferSafety: {
      async dispose () { calls.push('join-owner-safety') }
    },
    async releaseRemoteFileSession () {
      if (!ownerReleased) calls.push('release-owner-session')
      ownerReleased = true
    }
  }

  const settlement = quiesceSftpEntryTransfers(entry, { owners: [owner] })
  assert.equal(entry.remoteFileGeneration.accepting, false)
  assert.equal(entry.sftp.name, 'native-still-attached')
  assert.deepEqual(calls, ['cancel-owner'])

  cancelGate.resolve()
  await settlement
  assert.deepEqual(calls, [
    'cancel-owner',
    'join-owner-safety',
    'release-owner-session',
    'cancel-safety:prepared-operation',
    'release-prepared:prepared'
  ])
})

test('unexpected SFTP packets retry once per connection attempt', async () => {
  const { shouldRetryUnexpectedSftpPacket } = await loadModule()
  const error = new Error('Unexpected packet before SFTP handshake')

  assert.equal(shouldRetryUnexpectedSftpPacket(error, {
    expectedMessage: 'Unexpected packet',
    retryCount: 0
  }), true)
  assert.equal(shouldRetryUnexpectedSftpPacket(error, {
    expectedMessage: 'Unexpected packet',
    retryCount: 1
  }), false)
  assert.equal(shouldRetryUnexpectedSftpPacket(new Error('Permission denied'), {
    expectedMessage: 'Unexpected packet',
    retryCount: 0
  }), false)
})

test('SFTP entry disposal clears every timer and pending debounce', async () => {
  const { disposeSftpEntryScheduling } = await loadModule()
  const cleared = []
  const cancelled = []
  const entry = {
    timer: 0,
    timer4: 4,
    timer5: 5,
    retryHandler: 9,
    remoteListDebounce: { cancel: () => cancelled.push('remote') },
    localListDebounce: { cancel: () => cancelled.push('local') }
  }

  disposeSftpEntryScheduling(entry, {
    clearTimer: timer => cleared.push(timer)
  })

  assert.deepEqual(cleared, [0, 4, 5, 9])
  assert.deepEqual(cancelled, ['remote', 'local'])
  assert.equal(entry.timer, null)
  assert.equal(entry.timer4, null)
  assert.equal(entry.timer5, null)
  assert.equal(entry.retryHandler, null)
})

test('replacing an SFTP entry timer cancels the previous callback', async () => {
  const { replaceSftpEntryTimer } = await loadModule()
  const cleared = []
  const scheduled = []
  const entry = { timer5: 5 }
  const callback = () => {}

  const timer = replaceSftpEntryTimer(entry, 'timer5', callback, 1000, {
    clearTimer: value => cleared.push(value),
    setTimer: (fn, delay) => {
      scheduled.push([fn, delay])
      return 6
    }
  })

  assert.equal(timer, 6)
  assert.equal(entry.timer5, 6)
  assert.deepEqual(cleared, [5])
  assert.deepEqual(scheduled, [[callback, 1000]])
})

test('background SFTP observer absorbs expected aborts and reports other failures once', async () => {
  const { runSftpBackgroundTask } = await loadModule()
  const reports = []
  const abort = new Error('generation drained')
  abort.name = 'AbortError'
  abort.code = 'ABORT_ERR'

  assert.equal(await runSftpBackgroundTask(
    () => Promise.reject(abort),
    { reportError: error => reports.push(error) }
  ), undefined)
  const failure = new Error('transport failed')
  assert.equal(await runSftpBackgroundTask(
    () => Promise.reject(failure),
    { reportError: error => reports.push(error) }
  ), undefined)
  assert.deepEqual(reports, [failure])

  assert.equal(await runSftpBackgroundTask(
    () => { throw abort },
    { reportError: error => reports.push(error) }
  ), undefined)
  assert.deepEqual(reports, [failure])
})

test('explicit SFTP initialization is reserved synchronously and shared', async () => {
  const { startSftpEntryExplicitInitialization } = await loadModule()
  const gate = deferred()
  const calls = []
  const entry = {}

  const first = startSftpEntryExplicitInitialization(entry, async () => {
    calls.push('first')
    await gate.promise
    return 'ready'
  })
  const second = startSftpEntryExplicitInitialization(entry, async () => {
    calls.push('duplicate')
    return 'duplicate'
  })

  assert.equal(first, second)
  assert.equal(entry.sftpExplicitInitialization, first)
  assert.deepEqual(calls, ['first'])
  gate.resolve()
  assert.equal(await first, 'ready')
  assert.equal(entry.sftpExplicitInitialization, null)

  assert.equal(await startSftpEntryExplicitInitialization(
    entry,
    async () => {
      calls.push('warm')
      return 'warm-ready'
    }
  ), 'warm-ready')
  assert.deepEqual(calls, ['first', 'warm'])
})

test('failed explicit SFTP initialization clears the reservation for retry', async () => {
  const { startSftpEntryExplicitInitialization } = await loadModule()
  const failure = new Error('first open failed')
  const reports = []
  const calls = []
  const entry = {}

  assert.equal(await startSftpEntryExplicitInitialization(
    entry,
    async () => {
      calls.push('failed')
      throw failure
    },
    { reportError: error => reports.push(error) }
  ), undefined)
  assert.equal(entry.sftpExplicitInitialization, null)
  assert.deepEqual(reports, [failure])

  assert.equal(await startSftpEntryExplicitInitialization(
    entry,
    async () => {
      calls.push('retry')
      return 'ready'
    },
    { reportError: error => reports.push(error) }
  ), 'ready')
  assert.deepEqual(calls, ['failed', 'retry'])
  assert.deepEqual(reports, [failure])
})

test('unmount settles every pending SFTP render commit', async () => {
  const {
    beginSftpEntryRenderCommit,
    disposeSftpEntryReadiness,
    getSftpEntryReadinessSnapshot
  } = await loadModule()
  const entry = {
    state: {
      remoteLoading: false,
      remoteRefreshState: 'idle'
    }
  }
  const first = beginSftpEntryRenderCommit(entry)
  const second = beginSftpEntryRenderCommit(entry)

  assert.equal(
    getSftpEntryReadinessSnapshot(entry).renderCommitCount,
    2
  )
  entry.remoteFileUnmounted = true
  disposeSftpEntryReadiness(entry)

  assert.deepEqual(await Promise.all([first.promise, second.promise]), [
    false,
    false
  ])
  const snapshot = getSftpEntryReadinessSnapshot(entry)
  assert.equal(snapshot.renderCommitCount, 0)
  assert.equal(snapshot.fullySettled, false)
})

test('remote reconnect destroys the stale SFTP transport before recreating it', async () => {
  const { reconnectSftpEntryRemote } = await loadModule()
  const calls = []
  const client = {
    async destroy () {
      calls.push('destroy')
    }
  }
  const entry = {
    sftp: client,
    terminalId: 'terminal-42',
    port: 2200,
    initRemoteAll: () => {
      calls.push(['init', entry.sftp, entry.terminalId, entry.port])
      return 'reconnecting'
    }
  }

  assert.equal(await reconnectSftpEntryRemote(entry), 'reconnecting')
  assert.equal(entry.terminalId, 'terminal-42')
  assert.equal(entry.port, 2200)
  assert.deepEqual(calls, [
    'destroy',
    ['init', null, 'terminal-42', 2200]
  ])
})

test('uncertain transport teardown blocks reconnect and new generation startup', async () => {
  const { reconnectSftpEntryRemote } = await loadModule()
  const calls = []
  const timeout = new Error('SFTP teardown timed out')
  timeout.code = 'TEARDOWN_TIMEOUT'
  timeout.uncertain = true
  const entry = {
    sftp: {
      async destroy () {
        calls.push('destroy')
        throw timeout
      }
    },
    initRemoteAll: () => { calls.push('init') }
  }

  await assert.rejects(reconnectSftpEntryRemote(entry), error => error === timeout)
  await assert.rejects(reconnectSftpEntryRemote(entry), error => error === timeout)
  assert.deepEqual(calls, ['destroy'])
  assert.equal(entry.remoteFileGeneration.accepting, false)
})

test('nested uncertain release failures keep later reconnects blocked', async () => {
  const { reconnectSftpEntryRemote } = await loadModule()
  const failures = [
    Object.assign(new Error('release teardown timed out'), {
      code: 'TEARDOWN_TIMEOUT'
    }),
    Object.assign(new Error('release transport state is unknown'), {
      uncertain: true
    })
  ]

  for (const failure of failures) {
    const nestedFailure = new AggregateError([
      new AggregateError([failure], 'nested capability cleanup failed')
    ], 'capability cleanup failed')
    const calls = []
    const entry = {
      sftp: {
        async destroy () {
          calls.push('destroy')
        }
      },
      remoteFileOperations: new Set([{
        async release () {
          calls.push('release')
          throw nestedFailure
        }
      }]),
      remoteFileOperationSettlements: new Set(),
      remoteFileOperationBackends: new Map(),
      initRemoteAll: () => {
        calls.push('init')
        return 'ready'
      }
    }

    let firstError
    await assert.rejects(reconnectSftpEntryRemote(entry), error => {
      firstError = error
      assert.equal(error instanceof AggregateError, true)
      assert.deepEqual(error.errors, [nestedFailure])
      return true
    })
    await assert.rejects(
      reconnectSftpEntryRemote(entry),
      error => error === firstError
    )
    assert.deepEqual(calls, ['release', 'destroy'])
    assert.equal(entry.remoteFileGeneration.accepting, false)
  }
})

test('cleanup release and cause error shapes keep reconnects blocked', async () => {
  const { reconnectSftpEntryRemote } = await loadModule()
  const uncertainError = Object.assign(new Error('transport state unknown'), {
    uncertain: true
  })
  const causedError = new Error('cleanup cause failed')
  causedError.cause = uncertainError
  const releaseError = new Error('prepared release failed')
  releaseError.releaseError = causedError
  const primaryError = new Error('native connection failed')
  primaryError.cleanupErrors = [releaseError]
  const calls = []
  const entry = {
    sftp: {
      async destroy () { calls.push('destroy') }
    },
    remoteFileOperations: new Set([{
      async release () {
        calls.push('release')
        throw primaryError
      }
    }]),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    initRemoteAll: () => {
      calls.push('init')
      return 'ready'
    }
  }

  let firstError
  await assert.rejects(reconnectSftpEntryRemote(entry), error => {
    firstError = error
    assert.equal(error instanceof AggregateError, true)
    assert.deepEqual(error.errors, [primaryError])
    return true
  })
  await assert.rejects(
    reconnectSftpEntryRemote(entry),
    error => error === firstError
  )
  assert.deepEqual(calls, ['release', 'destroy'])
  assert.equal(entry.remoteFileGeneration.accepting, false)
})

test('remote reconnect drains active root cleanup before destroy and init', async () => {
  const { reconnectSftpEntryRemote } = await loadModule()
  const releaseGate = deferred()
  const calls = []
  const entry = {
    sftp: { destroy: async () => calls.push('destroy') },
    invalidateRemoteFileIdentity: () => calls.push('invalidate-identity'),
    remoteFileOperations: new Set([{
      async release () {
        calls.push('release')
        await releaseGate.promise
        calls.push('released')
      }
    }]),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    initRemoteAll: () => {
      calls.push('init')
      return 'ready'
    }
  }

  const reconnecting = reconnectSftpEntryRemote(entry)
  await Promise.resolve()
  assert.deepEqual(calls, ['invalidate-identity', 'release'])
  releaseGate.resolve()
  assert.equal(await reconnecting, 'ready')
  assert.deepEqual(calls, [
    'invalidate-identity',
    'release',
    'released',
    'destroy',
    'init'
  ])
})

test('binding a new SSH generation destroys the old SFTP transport first', async () => {
  const { bindSftpEntryRemoteSession } = await loadModule()
  const calls = []
  const entry = {
    terminalId: 'tab-1',
    port: 41001,
    sshSessionGeneration: 'generation-old',
    sftp: {
      async destroy () { calls.push('destroy') }
    },
    shouldRenderRemote: () => true,
    initRemoteAll: () => {
      calls.push(['init', entry.sftp, entry.sshSessionGeneration])
      return 'ready'
    },
    initLocalAll: () => calls.push('local')
  }

  assert.equal(await bindSftpEntryRemoteSession(entry, {
    terminalId: 'tab-1',
    port: 41002,
    sshSessionGeneration: 'generation-new'
  }), 'ready')
  assert.deepEqual(calls, [
    'destroy',
    ['init', null, 'generation-new'],
    'local'
  ])
})

test('explicit open racing session bind shares one initialization on the bound generation', async () => {
  const {
    bindSftpEntryRemoteSession,
    startSftpEntryExplicitInitialization
  } = await loadModule()
  const oldDestroyed = deferred()
  const calls = []
  const entry = {
    terminalId: 'tab-old',
    port: 41001,
    sshSessionGeneration: 'generation-old',
    sftp: {
      async destroy () {
        calls.push('destroy-old')
        await oldDestroyed.promise
      }
    },
    shouldRenderRemote: () => true,
    shouldInitializeRemoteOnBind: () => true,
    initRemoteAll: options => {
      calls.push(['init', entry.sshSessionGeneration, options])
      return 'ready'
    },
    initLocalAll: () => calls.push(['local', entry.sshSessionGeneration])
  }
  const binding = bindSftpEntryRemoteSession(entry, {
    terminalId: 'tab-new',
    port: 41002,
    sshSessionGeneration: 'generation-new',
    sshTerminalPid: '1002'
  })
  const explicit = startSftpEntryExplicitInitialization(
    entry,
    () => entry.initRemoteAll({ explicitOpen: true })
  )

  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(calls, ['destroy-old'])
  oldDestroyed.resolve()
  assert.equal(await explicit, 'ready')
  assert.equal(await binding, 'ready')
  assert.deepEqual(calls, [
    'destroy-old',
    ['init', 'generation-new', { explicitOpen: true }],
    ['local', 'generation-new']
  ])
})

test('session bind never reuses an explicit initialization from the old generation', async () => {
  const {
    bindSftpEntryRemoteSession,
    startSftpEntryExplicitInitialization
  } = await loadModule()
  const oldInitialization = deferred()
  const calls = []
  const entry = {
    terminalId: 'tab-old',
    port: 41001,
    sshSessionGeneration: 'generation-old',
    sshTerminalPid: '1001',
    shouldRenderRemote: () => true,
    shouldInitializeRemoteOnBind: () => true,
    initRemoteAll: options => {
      const generation = entry.sshSessionGeneration
      calls.push(['init', generation, options])
      return generation === 'generation-old'
        ? oldInitialization.promise
        : 'ready-new'
    },
    initLocalAll: () => calls.push(['local', entry.sshSessionGeneration])
  }
  const explicit = startSftpEntryExplicitInitialization(
    entry,
    () => entry.initRemoteAll({ explicitOpen: true })
  )
  const binding = bindSftpEntryRemoteSession(entry, {
    terminalId: 'tab-new',
    port: 41002,
    sshSessionGeneration: 'generation-new',
    sshTerminalPid: '1002'
  })

  await Promise.resolve()
  await Promise.resolve()
  oldInitialization.resolve('ready-old')
  assert.equal(await explicit, 'ready-old')
  assert.equal(await binding, 'ready-new')
  assert.deepEqual(calls, [
    ['init', 'generation-old', { explicitOpen: true }],
    ['init', 'generation-new', undefined],
    ['local', 'generation-new']
  ])
})

test('pending session binding keeps old committed readiness unsettled', async () => {
  const {
    beginSftpEntryRenderCommit,
    bindSftpEntryRemoteSession,
    getSftpEntryReadinessSnapshot
  } = await loadModule()
  const oldDestroyed = deferred()
  const entry = {
    state: { remoteLoading: false, remoteRefreshState: 'idle' },
    sshSessionGeneration: 'generation-old',
    sshTerminalPid: '1001',
    sftp: { destroy: () => oldDestroyed.promise },
    shouldRenderRemote: () => true,
    shouldInitializeRemoteOnBind: () => false,
    initLocalAll: () => {}
  }
  beginSftpEntryRenderCommit(entry).settle({
    committed: true,
    visibleRemoteCommitted: true,
    firstReadyCommitted: true
  })
  assert.equal(getSftpEntryReadinessSnapshot(entry).fullySettled, true)
  const lateOldCommit = beginSftpEntryRenderCommit(entry)

  const binding = bindSftpEntryRemoteSession(entry, {
    terminalId: 'tab-new',
    port: 41002,
    sshSessionGeneration: 'generation-new',
    sshTerminalPid: '1002'
  })
  const pending = getSftpEntryReadinessSnapshot(entry)
  assert.equal(pending.sessionBindingPending, true)
  assert.equal(pending.visibleRemoteCommitted, false)
  assert.equal(pending.firstReadyCommitted, false)
  assert.equal(pending.fullySettled, false)

  oldDestroyed.resolve()
  await binding
  assert.equal(await lateOldCommit.promise, false)
  assert.equal(lateOldCommit.settle({
    committed: true,
    visibleRemoteCommitted: true,
    firstReadyCommitted: true
  }), false)
  const rebound = getSftpEntryReadinessSnapshot(entry)
  assert.equal(rebound.sessionBindingPending, false)
  assert.equal(rebound.visibleRemoteCommitted, false)
  assert.equal(rebound.firstReadyCommitted, false)
  assert.equal(rebound.fullySettled, false)

  beginSftpEntryRenderCommit(entry).settle({
    committed: true,
    visibleRemoteCommitted: true
  })
  const visible = getSftpEntryReadinessSnapshot(entry)
  assert.equal(visible.visibleRemoteCommitted, true)
  assert.equal(visible.firstReadyCommitted, false)
  assert.equal(visible.fullySettled, false)

  beginSftpEntryRenderCommit(entry).settle({
    committed: true,
    firstReadyCommitted: true
  })
  assert.equal(getSftpEntryReadinessSnapshot(entry).fullySettled, true)
})

test('failed new generation initialization cannot reuse old readiness', async () => {
  const {
    beginSftpEntryRenderCommit,
    bindSftpEntryRemoteSession,
    getSftpEntryReadinessSnapshot
  } = await loadModule()
  const failure = new Error('new generation unavailable')
  const calls = []
  const entry = {
    state: { remoteLoading: false, remoteRefreshState: 'idle' },
    sshSessionGeneration: 'generation-old',
    sshTerminalPid: '1001',
    shouldRenderRemote: () => true,
    shouldInitializeRemoteOnBind: () => true,
    initRemoteAll: async () => {
      calls.push(['init', entry.sshSessionGeneration])
      throw failure
    },
    initLocalAll: () => calls.push(['local', entry.sshSessionGeneration])
  }
  beginSftpEntryRenderCommit(entry).settle({
    committed: true,
    visibleRemoteCommitted: true,
    firstReadyCommitted: true
  })
  assert.equal(getSftpEntryReadinessSnapshot(entry).fullySettled, true)

  await bindSftpEntryRemoteSession(entry, {
    terminalId: 'tab-new',
    port: 41002,
    sshSessionGeneration: 'generation-new',
    sshTerminalPid: '1002'
  })

  const snapshot = getSftpEntryReadinessSnapshot(entry)
  assert.deepEqual(calls, [
    ['init', 'generation-new'],
    ['local', 'generation-new']
  ])
  assert.equal(snapshot.sessionBindingPending, false)
  assert.equal(snapshot.visibleRemoteCommitted, false)
  assert.equal(snapshot.firstReadyCommitted, false)
  assert.equal(snapshot.fullySettled, false)
})

test('hidden SSH SFTP binding defers remote loading until explicit open', async () => {
  const { bindSftpEntryRemoteSession } = await loadModule()
  const calls = []
  const entry = {
    terminalId: 'tab-1',
    port: 41001,
    sshSessionGeneration: 'generation-old',
    shouldRenderRemote: () => true,
    shouldInitializeRemoteOnBind: () => false,
    initRemoteAll: () => {
      calls.push('init')
      return 'ready'
    },
    initLocalAll: () => calls.push('local')
  }

  assert.equal(await bindSftpEntryRemoteSession(entry, {
    terminalId: 'tab-1',
    port: 41002,
    sshSessionGeneration: 'generation-new',
    sshTerminalPid: '1002'
  }), undefined)
  assert.deepEqual(calls, ['local'])
})

test('session rebind reports rejected cleanup after destroying the stale transport', async () => {
  const { bindSftpEntryRemoteSession } = await loadModule()
  const releaseGate = deferred()
  const cleanupError = new Error('staging cleanup failed')
  const calls = []
  const entry = {
    sftp: { destroy: async () => calls.push('destroy') },
    invalidateRemoteFileIdentity: () => calls.push('invalidate-identity'),
    remoteFileOperations: new Set([{
      async release () {
        calls.push('release')
        await releaseGate.promise
        throw cleanupError
      }
    }]),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    shouldRenderRemote: () => true,
    initRemoteAll: () => {
      calls.push(['init', entry.sshSessionGeneration])
      return 'ready'
    },
    initLocalAll: () => calls.push('local')
  }

  const binding = bindSftpEntryRemoteSession(entry, {
    terminalId: 'tab-new',
    port: 41003,
    sshSessionGeneration: 'generation-new',
    sshTerminalPid: '1003'
  })
  await Promise.resolve()
  assert.deepEqual(calls, ['invalidate-identity', 'release'])
  releaseGate.resolve()
  await assert.rejects(binding, error => {
    assert.equal(error instanceof AggregateError, true)
    assert.deepEqual(error.errors, [cleanupError])
    return true
  })
  assert.deepEqual(calls, [
    'invalidate-identity',
    'release',
    'destroy'
  ])
})

test('PID-only session rebind clears the visible snapshot before drain settles', async () => {
  const { bindSftpEntryRemoteSession } = await loadModule()
  const releaseGate = deferred()
  const staleFile = { id: 'root-app-conf', name: 'app.conf' }
  const entry = {
    sshSessionGeneration: 'generation-1',
    sshTerminalPid: '100',
    visibleRemoteDirectoryCacheKey: 'root-cache-key',
    remoteDirectoryCachePaintEpoch: 7,
    state: {
      remote: [staleFile],
      remoteFileTree: new Map([[staleFile.id, staleFile]]),
      selectedFiles: new Set([staleFile.id]),
      lastClickedFile: staleFile.id
    },
    remoteDirectoryCache: { clear: () => {} },
    setState (update) {
      Object.assign(this.state, update)
    },
    remoteFileOperations: new Set([{
      async release () { await releaseGate.promise }
    }]),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    shouldRenderRemote: () => true,
    shouldInitializeRemoteOnBind: () => false,
    initLocalAll: () => {}
  }

  const binding = bindSftpEntryRemoteSession(entry, {
    terminalId: 'tab-1',
    port: 41001,
    sshSessionGeneration: 'generation-1',
    sshTerminalPid: '200'
  })
  await Promise.resolve()

  assert.deepEqual(entry.state.remote, [])
  assert.deepEqual(Array.from(entry.state.remoteFileTree), [])
  assert.deepEqual(Array.from(entry.state.selectedFiles), [])
  assert.equal(entry.state.lastClickedFile, null)
  assert.equal(entry.visibleRemoteDirectoryCacheKey, '')
  assert.equal(entry.remoteDirectoryCachePaintEpoch, 8)

  releaseGate.resolve()
  await binding
})

test('stale remote initialization cannot write back after dispose and new init', async () => {
  const {
    beginSftpEntryRemoteTask,
    commitSftpEntryRemoteClient,
    disposeSftpEntryClient
  } = await loadModule()
  const oldResult = deferred()
  const calls = []
  const oldClient = {
    async destroy () { calls.push('destroy-old') }
  }
  const newClient = {
    async destroy () { calls.push('destroy-new') }
  }
  const entry = {
    sftp: null,
    sshSessionGeneration: 'generation-old'
  }
  const oldTask = beginSftpEntryRemoteTask(entry, 'generation-old')
  const oldWriteback = oldResult.promise.then(client =>
    commitSftpEntryRemoteClient(entry, oldTask, client)
  )

  await disposeSftpEntryClient(entry)
  entry.sshSessionGeneration = 'generation-new'
  const newTask = beginSftpEntryRemoteTask(entry, 'generation-new')
  assert.equal(
    await commitSftpEntryRemoteClient(entry, newTask, newClient),
    true
  )
  oldResult.resolve(oldClient)

  assert.equal(await oldWriteback, false)
  assert.equal(entry.sftp, newClient)
  assert.deepEqual(calls, ['destroy-old'])
})

test('new session binding wins while the old transport destroy is pending', async () => {
  const { bindSftpEntryRemoteSession } = await loadModule()
  const oldDestroyed = deferred()
  const calls = []
  const entry = {
    terminalId: 'tab-old',
    port: 41001,
    sshSessionGeneration: 'generation-old',
    sshTerminalPid: '1001',
    sftp: {
      async destroy () {
        calls.push('destroy-old')
        await oldDestroyed.promise
      }
    },
    shouldRenderRemote: () => true,
    initRemoteAll: () => {
      calls.push([
        'init',
        entry.terminalId,
        entry.sshSessionGeneration,
        entry.sshTerminalPid
      ])
      return entry.sshSessionGeneration
    },
    initLocalAll: () => calls.push(['local', entry.sshSessionGeneration])
  }

  const oldBinding = bindSftpEntryRemoteSession(entry, {
    terminalId: 'tab-first',
    port: 41002,
    sshSessionGeneration: 'generation-first',
    sshTerminalPid: '1002'
  })
  const newBinding = bindSftpEntryRemoteSession(entry, {
    terminalId: 'tab-new',
    port: 41003,
    sshSessionGeneration: 'generation-new',
    sshTerminalPid: '1003'
  })

  await Promise.resolve()
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'init'), false)
  oldDestroyed.resolve()
  assert.equal(await newBinding, 'generation-new')
  assert.equal(await oldBinding, undefined)
  assert.equal(entry.terminalId, 'tab-new')
  assert.equal(entry.port, 41003)
  assert.equal(entry.sshSessionGeneration, 'generation-new')
  assert.equal(entry.sshTerminalPid, '1003')
  assert.deepEqual(calls, [
    'destroy-old',
    ['init', 'tab-new', 'generation-new', '1003'],
    ['local', 'generation-new']
  ])
})

test('SFTP entry validates the latest lifecycle before transport and list writes', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-entry.jsx'
  ), 'utf8')
  const start = source.indexOf('remoteListUncoalesced = async')
  const end = source.indexOf('\n  updateRemoteList = async', start)
  const method = source.slice(start, end)

  assert.match(method, /beginSftpEntryRemoteTask\(this\)/)
  assert.match(method, /const generation = initializeRemoteFileGeneration\(this\)/)
  assert.match(
    method,
    /sftp = await Client\([\s\S]{0,300}candidateSftp = sftp[\s\S]{0,200}assertCurrentGeneration\(\)[\s\S]{0,160}destroyCandidate\(\)/
  )
  assert.match(
    method,
    /await sftp\.connect\(opts\)[\s\S]{0,1300}!isCurrentSftpEntryRemoteTask\(this, task\)/
  )
  assert.match(
    method,
    /await this\.sftpList\(sftp, remotePath\)[\s\S]{0,300}commitSftpEntryRemoteClient\([\s\S]{0,100}generation/
  )
  assert.doesNotMatch(method, /this\.sftp\s*=\s*sftp/)
  assert.match(method, /updateRemoteList\(remote, remotePath, sftp, task\)/)
})

test('SFTP entry invalidates cache for full session rebind and reconnect', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-entry.jsx'
  ), 'utf8')
  const lifecycleSource = fs.readFileSync(modulePath, 'utf8')
  const unmountStart = source.indexOf('componentWillUnmount ()')
  const unmountEnd = source.indexOf('\n  initFtpData =', unmountStart)
  const initStart = source.indexOf('initData = (')
  const initEnd = source.indexOf('\n  shouldRenderRemote =', initStart)
  const reloadStart = source.indexOf('handleReloadRemoteSftp = async')
  const reloadEnd = source.indexOf('\n  handleUploadFromBrowser', reloadStart)
  const unmount = source.slice(unmountStart, unmountEnd)
  const init = source.slice(initStart, initEnd)
  const reload = source.slice(reloadStart, reloadEnd)

  assert.match(unmount, /remoteDirectoryCache\?\.clear\?\.\(\)/)
  assert.match(init, /sshSessionGeneration/)
  assert.match(init, /sshTerminalPid/)
  assert.doesNotMatch(init, /remoteDirectoryCache/)
  assert.match(
    lifecycleSource,
    /String\(entry\.sshSessionGeneration \|\| ''\)\.trim\(\) !== nextGeneration[\s\S]{0,120}String\(entry\.sshTerminalPid \|\| ''\)\.trim\(\) !== nextTerminalPid/
  )
  assert.match(
    lifecycleSource,
    /if \(terminalSessionChanged\) \{\s*invalidateSftpEntryRemoteSnapshot/
  )
  assert.match(
    reload,
    /invalidateSftpEntryRemoteSnapshot\(this, \{ remoteLoading: true \}\)/
  )
})

test('SFTP client disposal detaches first and absorbs destroy rejection', async () => {
  const { disposeSftpEntryClient } = await loadModule()
  const error = new Error('socket already closed')
  const client = {
    destroy: async () => { throw error }
  }
  const entry = { sftp: client }

  const disposal = disposeSftpEntryClient(entry)
  assert.equal(entry.sftp, null)
  assert.equal(await disposal, false)
})

test('safe delete removes matching absolute paths from a 1000 item remote list', async () => {
  const { removeDeletedRemoteEntries } = await loadModule()
  const remote = Array.from({ length: 1000 }, (_, index) => ({
    id: `remote-${index}`,
    type: 'remote',
    path: '/srv/app',
    name: `item-${index}.txt`
  }))
  const next = removeDeletedRemoteEntries(remote, [
    '/srv/app/item-10.txt',
    '/srv/app/./item-999.txt'
  ])
  assert.equal(next.length, 998)
  assert.equal(next.some(file => file.name === 'item-10.txt'), false)
  assert.equal(next.some(file => file.name === 'item-999.txt'), false)
  assert.equal(next[0], remote[0])
})
