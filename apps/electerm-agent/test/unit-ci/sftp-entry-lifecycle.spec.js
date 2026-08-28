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
