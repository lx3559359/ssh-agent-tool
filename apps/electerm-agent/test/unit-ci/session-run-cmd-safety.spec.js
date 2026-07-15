const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const sessionCommonPath = path.resolve(
  __dirname,
  '../../src/app/server/session-common.js'
)
const sessionApiPath = path.resolve(
  __dirname,
  '../../src/app/server/session-api.js'
)
const remoteCommonPath = path.resolve(
  __dirname,
  '../../src/app/server/remote-common.js'
)
const globalStatePath = path.resolve(
  __dirname,
  '../../src/app/server/global-state.js'
)

function createStream () {
  const stream = new EventEmitter()
  stream.stderr = new EventEmitter()
  stream.signals = []
  stream.closeCalls = 0
  stream.destroyCalls = 0
  stream.signal = signal => { stream.signals.push(signal) }
  stream.close = () => { stream.closeCalls += 1 }
  stream.destroy = () => { stream.destroyCalls += 1 }
  return stream
}

function createSessionHarness () {
  const { commonExtends } = require(sessionCommonPath)
  const streams = []
  class FakeSession {
    kill () {
      this.killed = true
    }
  }
  commonExtends(FakeSession)
  const session = new FakeSession()
  session.initOptions = {}
  session.client = {
    exec: (command, options, callback) => {
      const stream = createStream()
      streams.push({ command, options, stream })
      callback(null, stream)
    }
  }
  return { session, streams }
}

test('bounded run-cmd collection keeps strict memory and the transaction marker tail', async () => {
  const { createBoundedOutputCollector } = require(sessionCommonPath)
  const maxOutputBytes = 1024
  const collector = createBoundedOutputCollector(maxOutputBytes)
  const unicode = Buffer.from('前🙂后'.repeat(600), 'utf8')

  for (let offset = 0; offset < unicode.length; offset += 317) {
    collector.append(unicode.subarray(offset, offset + 317))
    assert.ok(collector.retainedBytes <= maxOutputBytes)
  }

  const marker = '\n__SHELLPILOT_PREPARE_RC_op-bounded=0\n'
  collector.append(Buffer.from(marker))
  const output = collector.toString()

  assert.ok(Buffer.byteLength(output, 'utf8') <= maxOutputBytes)
  assert.match(output, /__SHELLPILOT_PREPARE_RC_op-bounded=0/)
  assert.doesNotMatch(output, /\uFFFD/)
})

test('bounded head and tail use a separator that cannot synthesize a marker', () => {
  const { createBoundedOutputCollector } = require(sessionCommonPath)
  const maxOutputBytes = 256
  const collector = createBoundedOutputCollector(maxOutputBytes)
  const markerPrefix = '\n__SHELLPILOT_PREPARE_RC_op-join-attack'
  const head = 'h'.repeat(128 - markerPrefix.length) + markerPrefix
  const tail = '=0\n' + 't'.repeat(125)
  const original = head + 'middle-data'.repeat(80) + tail

  assert.doesNotMatch(original, /^__SHELLPILOT_PREPARE_RC_op-join-attack=0$/m)
  collector.append(Buffer.from(original))
  const output = collector.toString()

  assert.ok(Buffer.byteLength(output, 'utf8') <= maxOutputBytes)
  assert.match(output, /ShellPilot output truncated/)
  assert.doesNotMatch(output, /^__SHELLPILOT_PREPARE_RC_op-join-attack=0$/m)
})

test('capped SSH stdout and stderr are collected during streaming without losing marker verification', async () => {
  const { session, streams } = createSessionHarness()
  const maxOutputBytes = 2048
  const running = session.runCmd('prepare', undefined, {
    executionId: 'op-prepare-1',
    maxOutputBytes
  })
  const stream = streams[0].stream
  const marker = '\n__SHELLPILOT_PREPARE_RC_op-stream=0\n'

  stream.emit('data', Buffer.alloc(128 * 1024, 'a'))
  stream.stderr.emit('data', Buffer.alloc(128 * 1024, 'b'))
  const splitUtf8 = Buffer.from('🙂'.repeat(1000), 'utf8')
  stream.emit('data', splitUtf8.subarray(0, 3999))
  stream.emit('data', splitUtf8.subarray(3999))
  stream.emit('data', Buffer.from(marker))
  stream.emit('close', 0, null)

  const result = await running
  assert.equal(typeof result, 'object')
  assert.ok(
    Buffer.byteLength(result.stdout, 'utf8') +
    Buffer.byteLength(result.stderr, 'utf8') <= maxOutputBytes
  )
  assert.match(result.stdout, /__SHELLPILOT_PREPARE_RC_op-stream=0/)
  assert.doesNotMatch(result.stdout + result.stderr, /\uFFFD/)
  assert.equal(result.code, 0)
  assert.equal(result.signal, null)
})

test('capped run-cmd returns SSH close failure metadata', async () => {
  const { session, streams } = createSessionHarness()
  const running = session.runCmd('prepare', undefined, {
    executionId: 'op-close-metadata',
    maxOutputBytes: 1024
  })
  const stream = streams[0].stream

  stream.emit('data', Buffer.from('bounded stdout'))
  stream.stderr.emit('data', Buffer.from('bounded stderr'))
  stream.emit('close', 23, 'TERM')

  assert.deepEqual(await running, {
    stdout: 'bounded stdout',
    stderr: 'bounded stderr',
    code: 23,
    signal: 'TERM'
  })
})

test('uncapped legacy run-cmd calls preserve their stdout-only return value', async () => {
  const { session, streams } = createSessionHarness()
  const running = session.runCmd('legacy')
  const stream = streams[0].stream

  stream.emit('data', Buffer.from('legacy stdout'))
  stream.stderr.emit('data', Buffer.from('legacy stderr'))
  stream.emit('close', 0, null)

  assert.equal(await running, 'legacy stdout')
})

test('cancelRunCmd closes the exact SSH stream and ignores late success', async () => {
  const { session, streams } = createSessionHarness()
  const executionId = 'op-cancel-1'
  let resolved = false
  const running = session.runCmd('sleep 60', undefined, { executionId })
    .then(value => {
      resolved = true
      return value
    })
  const stream = streams[0].stream

  assert.equal(await session.cancelRunCmd('other-execution'), false)
  assert.equal(stream.closeCalls, 0)
  assert.equal(await session.cancelRunCmd(executionId), true)
  await assert.rejects(running, error => error.name === 'RunCmdCancelledError')
  assert.deepEqual(stream.signals, ['TERM'])
  assert.equal(stream.closeCalls + stream.destroyCalls, 1)

  stream.emit('data', Buffer.from('late success'))
  stream.emit('close', 0, null)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(resolved, false)
})

test('same executionId in two sessions cannot cancel the other SSH stream', async () => {
  const first = createSessionHarness()
  const second = createSessionHarness()
  const executionId = 'shared-execution-id'
  const firstRun = first.session.runCmd('first', undefined, { executionId })
  const secondRun = second.session.runCmd('second', undefined, { executionId })

  assert.equal(await first.session.cancelRunCmd(executionId), true)
  await assert.rejects(firstRun, error => error.name === 'RunCmdCancelledError')
  assert.equal(second.streams[0].stream.closeCalls, 0)
  second.streams[0].stream.emit('data', Buffer.from('second complete'))
  second.streams[0].stream.emit('close', 0, null)
  assert.equal(await secondRun, 'second complete')
})

test('session kill clears active run-cmd streams and execution ids', async () => {
  const { session, streams } = createSessionHarness()
  const running = session.runCmd('sleep 60', undefined, {
    executionId: 'disconnect-execution'
  })

  session.kill()

  await assert.rejects(running, error => error.name === 'RunCmdCancelledError')
  assert.equal(streams[0].stream.closeCalls + streams[0].stream.destroyCalls, 1)
  assert.equal(session.killed, true)
})

test('session-api forwards execution identity and output limits and cancels by pid plus id', async t => {
  const sessionApi = require(sessionApiPath)
  const { terminals } = require(remoteCommonPath)
  const globalState = require(globalStatePath)
  const calls = []
  const pid = 'session-api-run-cmd'
  terminals(pid, {
    runCmd: async (command, conn, options) => {
      calls.push({ type: 'run', command, conn, options })
      return 'bounded output'
    },
    cancelRunCmd: async executionId => {
      calls.push({ type: 'cancel', executionId })
      return true
    }
  })
  t.after(() => globalState.removeSession(pid))

  assert.equal(await sessionApi.runCmd({
    pid,
    cmd: 'prepare',
    timeoutMs: 123,
    maxOutputBytes: 456,
    executionId: 'op-api-1'
  }), 'bounded output')
  assert.equal(await sessionApi.cancelRunCmd({
    pid,
    executionId: 'op-api-1'
  }), true)
  assert.deepEqual(calls, [
    {
      type: 'run',
      command: 'prepare',
      conn: undefined,
      options: {
        timeoutMs: 123,
        maxOutputBytes: 456,
        executionId: 'op-api-1'
      }
    },
    { type: 'cancel', executionId: 'op-api-1' }
  ])
})
