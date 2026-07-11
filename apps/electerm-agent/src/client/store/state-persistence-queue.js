function cloneSnapshot (snapshot) {
  if (snapshot === undefined || snapshot === null) {
    return snapshot
  }
  return JSON.parse(JSON.stringify(snapshot))
}

function wait (delay) {
  return new Promise(resolve => setTimeout(resolve, delay))
}

export async function persistStateSnapshot ({
  oldState,
  snapshot,
  getChanges,
  removeItem,
  upsertItem,
  writeOrder
}) {
  const { updated, added, removed } = getChanges(oldState, snapshot)
  for (const item of removed) {
    await removeItem(item)
  }
  for (const item of [...updated, ...added]) {
    await upsertItem(item)
  }
  await writeOrder((snapshot || []).map(item => item.id))
}
export function createStatePersistenceQueue ({
  persist,
  getCommittedState,
  commitState,
  onError = () => {},
  retryDelays = [250, 1000, 4000],
  waitForRetry = wait,
  clone = cloneSnapshot
}) {
  const entries = new Map()

  function getEntry (dbName) {
    let entry = entries.get(dbName)
    if (!entry) {
      entry = {
        latest: undefined,
        pending: false,
        running: false,
        retryIndex: 0,
        errorReported: false,
        idlePromise: Promise.resolve()
      }
      entries.set(dbName, entry)
    }
    return entry
  }

  function start (dbName, entry) {
    if (entry.running) {
      return entry.idlePromise
    }
    entry.running = true
    entry.idlePromise = (async () => {
      while (entry.pending) {
        const snapshot = entry.latest
        entry.pending = false
        try {
          await persist(dbName, getCommittedState(dbName), snapshot)
          commitState(dbName, snapshot)
          entry.retryIndex = 0
          entry.errorReported = false
        } catch (error) {
          entry.pending = true
          if (!entry.errorReported) {
            entry.errorReported = true
            onError(error)
          }
          if (entry.retryIndex >= retryDelays.length) {
            break
          }
          const delay = retryDelays[entry.retryIndex]
          entry.retryIndex++
          await waitForRetry(delay)
        }
      }
    })().finally(() => {
      entry.running = false
    })
    return entry.idlePromise
  }

  function enqueue (dbName, snapshot) {
    const entry = getEntry(dbName)
    if (!entry.running) {
      entry.retryIndex = 0
    }
    entry.latest = clone(snapshot)
    entry.pending = true
    return start(dbName, entry)
  }

  function whenIdle (dbName) {
    return getEntry(dbName).idlePromise
  }

  return {
    enqueue,
    whenIdle
  }
}
