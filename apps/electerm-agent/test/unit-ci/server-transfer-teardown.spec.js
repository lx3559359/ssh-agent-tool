const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const teardownPath = path.resolve(
  __dirname,
  '../../src/app/server/session-transfer-teardown.js'
)
const { Sftp } = require('../../src/app/server/session-sftp')
const { Ftp } = require('../../src/app/server/session-ftp')
const remoteCommon = require('../../src/app/server/remote-common')
const globalState = require('../../src/app/server/global-state')

const clientSftpPath = path.resolve(
  __dirname,
  '../../src/client/common/sftp.js'
)

function dataModule (source) {
  return import('data:text/javascript;base64,' + Buffer.from(
    `${source}\n//# sourceURL=client-sftp-teardown-${Date.now()}-${Math.random()}.js`
  ).toString('base64'))
}

async function loadClientSftp (ws) {
  let source = fs.readFileSync(clientSftpPath, 'utf8')
  source = source
    .replace("import generate from './uid'", "let generated = 0; const generate = () => 'sftp-' + (++generated)")
    .replace("import Transfer from './transfer'", 'const Transfer = async () => ({})')
    .replace(
      "import { transferTypeMap, instSftpKeys as keys } from './constants'",
      'const transferTypeMap = {}; const keys = []'
    )
    .replace("import initWs from './ws'", 'const initWs = async () => globalThis.__clientSftpWs')
    .replace(
      'const sftpTeardownTimeoutMs = 1500',
      'const sftpTeardownTimeoutMs = 20'
    )
    .replace(
      /import \{[\s\S]*?\} from '\.\/sftp-operation-cancellation'/,
      'const createSftpAbortError = () => new Error(); const prepareSftpCancelableCall = () => ({ args: [] })'
    )
    .replace(
      "import { bindSftpTransportSession } from './sftp-session-generation.js'",
      'const bindSftpTransportSession = () => {}'
    )
    .replace(
      "import { reconstructSftpError } from './sftp-error.js'",
      "const reconstructSftpError = remote => new Error(remote?.message || 'SFTP teardown failed')"
    )
  globalThis.__clientSftpWs = ws
  return dataModule(source)
}

function deferred () {
  let resolve
  let reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}

function flush () {
  return new Promise(resolve => setImmediate(resolve))
}

test('session transfer teardown is bounded concurrent and deletes exact instances only', async () => {
  const { destroySessionTransfers } = require(teardownPath)
  const gate = deferred()
  const first = { destroy: () => gate.promise }
  const failure = new Error('second transfer cleanup failed')
  const second = { destroy: async () => { throw failure } }
  const replacement = { destroy: async () => true }
  const calls = []
  first.destroy = () => {
    calls.push('first')
    return gate.promise
  }
  second.destroy = async () => {
    calls.push('second')
    throw failure
  }
  const session = { transfers: { first, second } }

  const cleanup = destroySessionTransfers(session, { timeoutMs: 100 })
  await flush()
  assert.deepEqual(calls, ['first', 'second'])
  session.transfers.first = replacement
  gate.resolve(true)
  await assert.rejects(cleanup, error => error === failure)
  assert.equal(session.transfers.first, replacement)
  assert.equal(Object.hasOwn(session.transfers, 'second'), false)

  const never = { destroy: () => new Promise(() => {}) }
  const bounded = { transfers: { never } }
  await assert.rejects(
    destroySessionTransfers(bounded, { timeoutMs: 20 }),
    /timed out|timeout/i
  )
  assert.equal(Object.hasOwn(bounded.transfers, 'never'), false)
})

test('SFTP graceful teardown waits for transfer cleanup before channel close and preserves first error', async () => {
  const gate = deferred()
  const transferFailure = new Error('atomic cleanup failed')
  const order = []
  const session = Object.create(Sftp.prototype)
  session.transfers = {
    active: {
      async destroy () {
        assert.equal(session.closing, true)
        order.push('transfer-destroy')
        await gate.promise
        throw transferFailure
      }
    }
  }
  const channel = new EventEmitter()
  channel.end = () => {
    order.push('channel-end')
    queueMicrotask(() => channel.emit('close'))
  }
  session.sftp = channel
  session.initOptions = {}
  session.onEndConn = () => { order.push('session-end') }

  const cleanup = session.destroyGracefully()
  assert.equal(session.closing, true)
  await flush()
  assert.deepEqual(order, ['transfer-destroy'])
  gate.resolve()
  await assert.rejects(cleanup, error => error === transferFailure)
  assert.deepEqual(order, [
    'transfer-destroy', 'channel-end', 'session-end'
  ])
  assert.equal(session.sftp, undefined)
  assert.equal(session.transfers.active, undefined)
  await assert.rejects(
    session.destroyGracefully(),
    error => error === transferFailure
  )
})

test('FTP graceful teardown joins transfer destruction before ending session', async () => {
  const gate = deferred()
  const order = []
  const session = Object.create(Ftp.prototype)
  session.transfers = {
    active: {
      async destroy () {
        assert.equal(session.closing, true)
        order.push('transfer-destroy')
        await gate.promise
      }
    }
  }
  session.initOptions = {}
  session.onEndConn = () => { order.push('session-end') }

  const cleanup = session.destroyGracefully()
  assert.equal(session.closing, true)
  await flush()
  assert.deepEqual(order, ['transfer-destroy'])
  gate.resolve()
  assert.equal(await cleanup, true)
  assert.deepEqual(order, ['transfer-destroy', 'session-end'])
  assert.equal(session.transfers.active, undefined)
})

test('remote transfer close awaits destroy and cannot delete a replacement instance', async () => {
  const sftpId = 'remote-common-teardown-session'
  const gate = deferred()
  const old = { destroy: () => gate.promise }
  const replacement = { destroy: async () => true }
  const session = { transfers: { transfer: old } }
  globalState.setSession(sftpId, session)
  try {
    const cleanup = remoteCommon.onDestroyTransfer('transfer', sftpId)
    assert.equal(typeof cleanup?.then, 'function')
    await flush()
    assert.equal(session.transfers.transfer, old)
    session.transfers.transfer = replacement
    gate.resolve(true)
    assert.equal(await cleanup, true)
    assert.equal(session.transfers.transfer, replacement)

    const failure = new Error('close destroy failed')
    const failed = { destroy: async () => { throw failure } }
    session.transfers.failed = failed
    await assert.rejects(
      remoteCommon.onDestroyTransfer('failed', sftpId),
      error => error === failure
    )
    assert.equal(Object.hasOwn(session.transfers, 'failed'), false)
  } finally {
    globalState.removeSession(sftpId)
  }
})

test('SFTP client destroy preserves graceful teardown failure and still closes', async () => {
  const listeners = new Map()
  const ws = {
    closed: false,
    sent: [],
    s (message) {
      this.sent.push(message)
      if (message.action === 'sftp-destroy') {
        queueMicrotask(() => listeners.get(message.uid)?.({
          error: { message: 'server transfer cleanup failed' }
        }))
      }
    },
    once (listener, id) {
      listeners.set(id, listener)
      return Promise.resolve()
    },
    close () { this.closed = true }
  }
  try {
    const { default: createSftp } = await loadClientSftp(ws)
    const client = await createSftp(
      'terminal-id', 'sftp', 0, 'generation-one', 4242
    )

    await assert.rejects(client.destroy(), /server transfer cleanup failed/)
    assert.equal(ws.closed, true)
    assert.equal(client.ws, undefined)
  } finally {
    delete globalThis.__clientSftpWs
  }
})

test('SFTP client destroy rejects a bounded uncertain timeout, closes, and observes late acknowledgement', async () => {
  const listeners = new Map()
  const ws = {
    closed: false,
    sent: [],
    s (message) { this.sent.push(message) },
    once (listener, id) {
      listeners.set(id, listener)
      return Promise.resolve()
    },
    close () { this.closed = true }
  }
  const unhandled = []
  const onUnhandled = error => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)
  try {
    const { default: createSftp } = await loadClientSftp(ws)
    const client = await createSftp(
      'terminal-id', 'sftp', 0, 'generation-timeout', 4343
    )
    const result = await Promise.race([
      client.destroy().then(value => ({ value }), error => ({ error })),
      new Promise(resolve => setTimeout(() => resolve({ hung: true }), 100))
    ])

    assert.equal(result.hung, undefined)
    assert.equal(result.error?.code, 'TEARDOWN_TIMEOUT')
    assert.equal(result.error?.uncertain, true)
    assert.equal(ws.closed, true)
    assert.equal(client.ws, undefined)
    const request = ws.sent.find(message => message.action === 'sftp-destroy')
    listeners.get(request.uid)?.({ data: true })
    await flush()
    assert.deepEqual(unhandled, [])
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
    delete globalThis.__clientSftpWs
  }
})
