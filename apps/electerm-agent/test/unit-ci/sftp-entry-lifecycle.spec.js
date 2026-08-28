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

test('generation drain rejection still destroys once and latest drain wins', async () => {
  const {
    activateRemoteFileGeneration,
    drainRemoteFileGeneration
  } = await loadModule()
  const releaseGate = deferred()
  let destroyCount = 0
  const entry = {
    sftp: { destroy: async () => { destroyCount += 1 } },
    remoteFileOperations: new Set([{
      release: () => releaseGate.promise
    }]),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    remoteFileOperationTail: Promise.resolve()
  }

  const oldDrain = drainRemoteFileGeneration(entry)
  const latestDrain = drainRemoteFileGeneration(entry)
  releaseGate.reject(new Error('root cleanup failed'))
  await Promise.all([oldDrain.promise, latestDrain.promise])

  assert.equal(destroyCount, 1)
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

test('session rebind survives rejected root cleanup and initializes after destroy', async () => {
  const { bindSftpEntryRemoteSession } = await loadModule()
  const releaseGate = deferred()
  const calls = []
  const entry = {
    sftp: { destroy: async () => calls.push('destroy') },
    invalidateRemoteFileIdentity: () => calls.push('invalidate-identity'),
    remoteFileOperations: new Set([{
      async release () {
        calls.push('release')
        await releaseGate.promise
        throw new Error('staging cleanup failed')
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
  assert.equal(await binding, 'ready')
  assert.deepEqual(calls, [
    'invalidate-identity',
    'release',
    'destroy',
    ['init', 'generation-new'],
    'local'
  ])
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
  const start = source.indexOf('remoteList = async')
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
