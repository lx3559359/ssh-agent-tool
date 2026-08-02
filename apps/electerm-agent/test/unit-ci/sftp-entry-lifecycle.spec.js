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
