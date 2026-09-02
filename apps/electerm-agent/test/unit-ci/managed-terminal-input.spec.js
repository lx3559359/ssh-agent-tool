const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createManagedTerminalInputWriter
} = require('../../src/app/server/managed-terminal-input')

function deferred () {
  let resolveDeferred
  const promise = new Promise(resolve => {
    resolveDeferred = resolve
  })
  return { promise, resolve: resolveDeferred }
}

test('managed terminal input writes bounded chunks and waits for SSH drain', async () => {
  const drain = deferred()
  const writes = []
  let drainWaits = 0
  const term = {
    write (value) {
      writes.push(value)
      return writes.length !== 1
    },
    waitForWriteDrain () {
      drainWaits += 1
      return drain.promise
    }
  }
  const writer = createManagedTerminalInputWriter(term, {
    chunkBytes: 512,
    pause: () => Promise.resolve()
  })
  const command = `${'a'.repeat(1300)}中文结尾`
  const submission = writer.submit({
    requestId: 'a'.repeat(32),
    command
  })

  assert.equal(submission.requestId, 'a'.repeat(32))
  assert.equal(typeof submission.completion.then, 'function')
  await Promise.resolve()
  assert.equal(writes.length, 1)
  assert.equal(Buffer.byteLength(writes[0]), 512)
  assert.equal(drainWaits, 1)

  drain.resolve()
  assert.deepEqual(await submission.completion, {
    requestId: 'a'.repeat(32),
    status: 'written'
  })
  assert.equal(writes.at(-1), '\r')
  assert.equal(writes.slice(0, -1).join(''), command)
  assert.equal(
    writes.slice(0, -1).every(value => Buffer.byteLength(value) <= 512),
    true
  )
})

test('managed terminal input yields without adding a default timer delay', async () => {
  const pacing = []
  const writes = []
  const writer = createManagedTerminalInputWriter({
    write: value => {
      writes.push(value)
      return true
    }
  }, {
    chunkBytes: 4,
    pause: milliseconds => {
      pacing.push(milliseconds)
      return Promise.resolve()
    }
  })

  await writer.submit({
    requestId: 'e'.repeat(32),
    command: 'eight123'
  }).completion

  assert.deepEqual(pacing, [0, 0])
  assert.deepEqual(writes, ['eigh', 't123', '\r'])
})

test('managed terminal interrupt drops the unsent tail and never appends Enter', async () => {
  const pacing = deferred()
  const writes = []
  const term = {
    write (value) {
      writes.push(value)
      return true
    }
  }
  let pauseCalls = 0
  const writer = createManagedTerminalInputWriter(term, {
    chunkBytes: 8,
    pause: () => {
      pauseCalls += 1
      return pacing.promise
    }
  })
  const command = 'first-command-tail-must-not-run'
  const submission = writer.submit({
    requestId: 'b'.repeat(32),
    command
  })

  await Promise.resolve()
  assert.equal(pauseCalls, 1)
  assert.equal(writes.length, 1)
  assert.equal(writer.interrupt(), true)
  assert.equal(writes.at(-1), '\x03')
  pacing.resolve()

  assert.deepEqual(await submission.completion, {
    requestId: 'b'.repeat(32),
    status: 'interrupted'
  })
  assert.equal(writes.includes('\r'), false)
  assert.equal(writes.filter(value => value === '\x03').length, 1)
  assert.notEqual(writes.filter(value => value !== '\x03').join(''), command)
})

test('managed terminal input rejects a second request while one is active', async () => {
  const pacing = deferred()
  const writer = createManagedTerminalInputWriter({ write: () => true }, {
    chunkBytes: 1,
    pause: () => pacing.promise
  })
  const first = writer.submit({
    requestId: 'c'.repeat(32),
    command: 'first'
  })

  assert.equal(writer.submit({
    requestId: 'd'.repeat(32),
    command: 'second'
  }), null)
  writer.dispose()
  pacing.resolve()
  assert.deepEqual(await first.completion, {
    requestId: 'c'.repeat(32),
    status: 'interrupted'
  })
})
