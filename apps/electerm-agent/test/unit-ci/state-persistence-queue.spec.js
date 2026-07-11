const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const queueModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/store/state-persistence-queue.js')
)

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

async function loadQueueFactory () {
  const { createStatePersistenceQueue } = await import(queueModuleUrl)
  return createStatePersistenceQueue
}

test('serializes writes per dbName and coalesces rapid changes to the latest snapshot', async () => {
  const createStatePersistenceQueue = await loadQueueFactory()
  const firstWrite = deferred()
  const writes = []
  let activeWrites = 0
  let maxActiveWrites = 0
  let committedState = []
  const queue = createStatePersistenceQueue({
    persist: async (dbName, oldState, snapshot) => {
      activeWrites++
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites)
      writes.push({ dbName, oldState, snapshot })
      if (writes.length === 1) {
        await firstWrite.promise
      }
      activeWrites--
    },
    getCommittedState: () => committedState,
    commitState: (dbName, snapshot) => {
      committedState = snapshot
    }
  })

  queue.enqueue('bookmarks', [{ id: 'one' }])
  await Promise.resolve()
  queue.enqueue('bookmarks', [{ id: 'one' }, { id: 'two' }])
  queue.enqueue('bookmarks', [{ id: 'latest' }])

  assert.equal(writes.length, 1)
  firstWrite.resolve()
  await queue.whenIdle('bookmarks')

  assert.equal(maxActiveWrites, 1)
  assert.deepEqual(writes.map(write => write.snapshot), [
    [{ id: 'one' }],
    [{ id: 'latest' }]
  ])
  assert.deepEqual(writes[1].oldState, [{ id: 'one' }])
})

test('allows different dbNames to persist in parallel', async () => {
  const createStatePersistenceQueue = await loadQueueFactory()
  const gates = {
    bookmarks: deferred(),
    history: deferred()
  }
  const started = []
  const queue = createStatePersistenceQueue({
    persist: async dbName => {
      started.push(dbName)
      await gates[dbName].promise
    },
    getCommittedState: () => [],
    commitState: () => {}
  })

  queue.enqueue('bookmarks', [{ id: 'bookmark' }])
  queue.enqueue('history', [{ id: 'history' }])
  await Promise.resolve()

  assert.deepEqual(new Set(started), new Set(['bookmarks', 'history']))
  gates.bookmarks.resolve()
  gates.history.resolve()
  await Promise.all([
    queue.whenIdle('bookmarks'),
    queue.whenIdle('history')
  ])
})

test('advances committed state only after the complete snapshot write succeeds', async () => {
  const createStatePersistenceQueue = await loadQueueFactory()
  const write = deferred()
  const commits = []
  const queue = createStatePersistenceQueue({
    persist: () => write.promise,
    getCommittedState: () => [{ id: 'old' }],
    commitState: (dbName, snapshot) => commits.push({ dbName, snapshot })
  })

  queue.enqueue('bookmarks', [{ id: 'new' }])
  await Promise.resolve()
  assert.deepEqual(commits, [])

  write.resolve()
  await queue.whenIdle('bookmarks')
  assert.deepEqual(commits, [{
    dbName: 'bookmarks',
    snapshot: [{ id: 'new' }]
  }])
})

test('keeps the committed state after a failed complete snapshot write', async () => {
  const createStatePersistenceQueue = await loadQueueFactory()
  const oldState = [{ id: 'old' }]
  const commits = []
  const errors = []
  const queue = createStatePersistenceQueue({
    persist: async () => {
      throw new Error('order write failed')
    },
    getCommittedState: () => oldState,
    commitState: (dbName, snapshot) => commits.push({ dbName, snapshot }),
    onError: error => errors.push(error.message),
    retryDelays: []
  })

  queue.enqueue('bookmarks', [{ id: 'new' }])
  await queue.whenIdle('bookmarks')

  assert.deepEqual(commits, [])
  assert.deepEqual(errors, ['order write failed'])
})

test('uses bounded retry delays and reports only once for one failure episode', async () => {
  const createStatePersistenceQueue = await loadQueueFactory()
  const retryWaits = []
  const errors = []
  let attempts = 0
  const queue = createStatePersistenceQueue({
    persist: async () => {
      attempts++
      throw new Error('database unavailable')
    },
    getCommittedState: () => [],
    commitState: () => {},
    onError: error => errors.push(error.message),
    retryDelays: [10, 20],
    waitForRetry: async delay => retryWaits.push(delay)
  })

  queue.enqueue('bookmarks', [{ id: 'pending' }])
  await queue.whenIdle('bookmarks')

  assert.equal(attempts, 3)
  assert.deepEqual(retryWaits, [10, 20])
  assert.deepEqual(errors, ['database unavailable'])
})

test('persists the latest pending snapshot when a later change wakes an exhausted queue', async () => {
  const createStatePersistenceQueue = await loadQueueFactory()
  const oldState = [{ id: 'old' }]
  const writes = []
  const commits = []
  const errors = []
  let failing = true
  const queue = createStatePersistenceQueue({
    persist: async (dbName, committed, snapshot) => {
      writes.push({ dbName, committed, snapshot })
      if (failing) {
        throw new Error('disk full')
      }
    },
    getCommittedState: () => oldState,
    commitState: (dbName, snapshot) => commits.push({ dbName, snapshot }),
    onError: error => errors.push(error.message),
    retryDelays: []
  })

  queue.enqueue('bookmarks', [{ id: 'failed' }])
  await queue.whenIdle('bookmarks')
  failing = false
  queue.enqueue('bookmarks', [{ id: 'latest' }])
  await queue.whenIdle('bookmarks')

  assert.deepEqual(writes, [
    {
      dbName: 'bookmarks',
      committed: oldState,
      snapshot: [{ id: 'failed' }]
    },
    {
      dbName: 'bookmarks',
      committed: oldState,
      snapshot: [{ id: 'latest' }]
    }
  ])
  assert.deepEqual(commits, [{
    dbName: 'bookmarks',
    snapshot: [{ id: 'latest' }]
  }])
  assert.deepEqual(errors, ['disk full'])
})
test('retries idempotent data writes when order fails after the data write', async () => {
  const {
    createStatePersistenceQueue,
    persistStateSnapshot
  } = await import(queueModuleUrl)
  const rows = new Map()
  const commits = []
  let dataWrites = 0
  let orderAttempts = 0
  const snapshot = [{ id: 'new-item', value: 'latest' }]
  const queue = createStatePersistenceQueue({
    persist: (dbName, oldState, pendingSnapshot) => persistStateSnapshot({
      oldState,
      snapshot: pendingSnapshot,
      getChanges: () => ({
        added: pendingSnapshot,
        updated: [],
        removed: []
      }),
      removeItem: () => {},
      upsertItem: item => {
        dataWrites++
        rows.set(item.id, item)
      },
      writeOrder: async order => {
        orderAttempts++
        if (orderAttempts === 1) {
          throw new Error('order write failed')
        }
        assert.deepEqual(order, ['new-item'])
      }
    }),
    getCommittedState: () => [],
    commitState: (dbName, committedSnapshot) => {
      commits.push(committedSnapshot)
    },
    retryDelays: [0],
    waitForRetry: async () => {}
  })

  queue.enqueue('bookmarks', snapshot)
  await queue.whenIdle('bookmarks')

  assert.equal(dataWrites, 2)
  assert.equal(orderAttempts, 2)
  assert.equal(rows.size, 1)
  assert.deepEqual(rows.get('new-item'), snapshot[0])
  assert.deepEqual(commits, [snapshot])
})
