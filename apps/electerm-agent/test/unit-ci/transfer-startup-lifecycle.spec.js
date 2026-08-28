const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const wsPath = path.resolve(__dirname, '../../src/client/common/ws.js')
const transferPath = path.resolve(
  __dirname,
  '../../src/client/common/transfer.js'
)
const workerPath = path.resolve(
  __dirname,
  '../../src/client/entry/worker.js'
)

function dataModule (source) {
  return import('data:text/javascript;base64,' + Buffer.from(
    `${source}\n//# sourceURL=transfer-startup-${Date.now()}-${Math.random()}.js`
  ).toString('base64'))
}

async function loadWsModule (worker) {
  let source = fs.readFileSync(wsPath, 'utf8')
  source = source
    .replace("import generate from './uid'", "const generate = () => 'generated-id'")
    .replace("import wait from './wait'", 'const wait = async () => {}')
    .replace(
      "import { pick } from 'lodash-es'",
      'const pick = (value, keys) => Object.fromEntries(keys.filter(key => key in value).map(key => [key, value[key]]))'
    )
    .replace('const wsStartTimeoutMs = 10000', 'const wsStartTimeoutMs = 20')
  globalThis.window = {
    worker,
    store: { config: {} }
  }
  return dataModule(source)
}

function createWorker () {
  const listeners = new Set()
  return {
    sent: [],
    postMessage (message) { this.sent.push(message) },
    addEventListener (type, listener) {
      if (type === 'message') listeners.add(listener)
    },
    emit (data) {
      for (const listener of listeners) listener({ data })
    }
  }
}

async function loadTransferModule (initWs) {
  let source = fs.readFileSync(transferPath, 'utf8')
  source = source
    .replace("import generate from './uid'", "let generated = 0; const generate = () => 'transfer-' + (++generated)")
    .replace("import initWs from './ws'", 'const initWs = globalThis.__transferInitWs')
    .replace(
      'const transferStartTimeout = 15000',
      'const transferStartTimeout = 20'
    )
  globalThis.__transferInitWs = initWs
  globalThis.window = {
    pre: {
      transferKeys: ['pause', 'resume', 'cancel', 'interrupt', 'destroy']
    }
  }
  return dataModule(source)
}

test.afterEach(() => {
  delete globalThis.__transferInitWs
  delete globalThis.window
})

test('initWs rejects pre-abort and times out while closing a late websocket', async () => {
  const worker = createWorker()
  const { default: initWs } = await loadWsModule(worker)
  const controller = new AbortController()
  const abortReason = new Error('startup cancelled before create')
  controller.abort(abortReason)

  const preAbortResult = await Promise.race([
    initWs('transfer', 'pre-abort', 'sftp-1', false, 0, {
      signal: controller.signal
    }).then(value => ({ value }), error => ({ error })),
    new Promise(resolve => setTimeout(() => resolve({ hung: true }), 100))
  ])
  assert.equal(preAbortResult.hung, undefined)
  assert.equal(preAbortResult.error, abortReason)
  assert.equal(worker.sent.length, 0)

  const timeoutResult = await Promise.race([
    initWs('transfer', 'late-ws', 'sftp-1').then(
      value => ({ value }),
      error => ({ error })
    ),
    new Promise(resolve => setTimeout(() => resolve({ hung: true }), 100))
  ])
  assert.equal(timeoutResult.hung, undefined)
  assert.match(timeoutResult.error?.message || '', /timed out|timeout/i)
  assert.equal(worker.sent.some(message => (
    message.action === 'close' && message.wsId === 'late-ws'
  )), true)
  const closeCount = worker.sent.filter(message => (
    message.action === 'close' && message.wsId === 'late-ws'
  )).length
  worker.emit({ id: 'late-ws', action: 'create', persist: false })
  assert.equal(worker.sent.filter(message => (
    message.action === 'close' && message.wsId === 'late-ws'
  )).length, closeCount + 1)
})

test('initWs closes a create aborted synchronously during dispatch', async () => {
  const controller = new AbortController()
  const worker = createWorker()
  const postMessage = worker.postMessage.bind(worker)
  worker.postMessage = message => {
    postMessage(message)
    if (message.action === 'create') {
      controller.abort(new Error('aborted during create dispatch'))
    }
  }
  const { default: initWs } = await loadWsModule(worker)

  await assert.rejects(
    initWs('transfer', 'dispatch-abort', 'sftp-1', false, 0, {
      signal: controller.signal
    }),
    /aborted during create dispatch/
  )
  assert.equal(worker.sent.some(message => (
    message.action === 'close' && message.wsId === 'dispatch-abort'
  )), true)
})

test('initWs rejects when a connecting websocket closes before open', async () => {
  const worker = createWorker()
  const { default: initWs } = await loadWsModule(worker)
  const starting = initWs('transfer', 'closed-before-open', 'sftp-1')
  worker.emit({ id: 'closed-before-open', action: 'close' })

  await assert.rejects(starting, /closed before startup|startup.*closed/i)
})

test('non-persistent websocket records closed after it was opened then closed', async () => {
  const worker = createWorker()
  const { default: initWs } = await loadWsModule(worker)
  const starting = initWs('transfer', 'opened-then-closed', 'sftp-1')
  worker.emit({ id: 'opened-then-closed', action: 'create', persist: false })
  const ws = await starting

  assert.equal(ws.closed, false)
  worker.emit({ id: 'opened-then-closed', action: 'close' })
  assert.equal(ws.closed, true)
})

test('worker registers and can close a websocket while it is still connecting', async () => {
  let onMessage
  const posted = []
  const sockets = []
  class FakeWebSocket {
    constructor (url) {
      this.url = url
      this.closeCount = 0
      sockets.push(this)
    }

    close () {
      this.closeCount += 1
      this.onclose?.()
    }

    send () {}
    addEventListener () {}
    removeEventListener () {}
  }
  const self = {
    postMessage: message => posted.push(message),
    addEventListener: (type, listener) => {
      if (type === 'message') onMessage = listener
    }
  }
  vm.runInNewContext(fs.readFileSync(workerPath, 'utf8'), {
    self,
    WebSocket: FakeWebSocket,
    console,
    setTimeout: () => 1
  }, { filename: workerPath })

  const creating = onMessage({
    data: {
      action: 'create',
      id: 'connecting-transfer',
      type: 'transfer',
      persist: false,
      args: ['transfer', 'connecting-transfer', 'sftp-1', {
        host: '127.0.0.1',
        port: 1234,
        tokenElecterm: 'token'
      }]
    }
  })
  await new Promise(resolve => setImmediate(resolve))
  await onMessage({
    data: { action: 'close', wsId: 'connecting-transfer' }
  })
  const result = await Promise.race([
    Promise.resolve(creating).then(() => ({ settled: true })),
    new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 50))
  ])

  assert.equal(result.timeout, undefined)
  assert.equal(sockets[0].closeCount, 1)
  assert.equal(self.insts['connecting-transfer'], undefined)
  assert.equal(posted.some(message => (
    message.action === 'create' && message.id === 'connecting-transfer'
  )), false)
})

test('transfer factory bounds a never-resolving websocket startup', async () => {
  const { default: createTransfer } = await loadTransferModule(
    () => new Promise(() => {})
  )
  const result = await Promise.race([
    createTransfer({
      sftpId: 'sftp-never',
      type: 'upload',
      localPath: 'C:\\tmp\\source.bin',
      remotePath: '/tmp/target.bin'
    }).then(
      value => ({ value }),
      error => ({ error })
    ),
    new Promise(resolve => setTimeout(() => resolve({ hung: true }), 100))
  ])

  assert.equal(result.hung, undefined)
  assert.match(result.error?.message || '', /timed out|timeout/i)
})

test('transfer factory aborts before start and closes a websocket resolving late', async () => {
  const lateWs = {
    closed: false,
    closeCount: 0,
    sent: [],
    once: async () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    s (message) { this.sent.push(message) },
    close () {
      this.closed = true
      this.closeCount += 1
    }
  }
  let resolveWs
  let initCalls = 0
  const { default: createTransfer } = await loadTransferModule((
    type,
    id,
    sftpId,
    persist,
    port,
    { signal } = {}
  ) => {
    initCalls += 1
    assert.equal(signal instanceof AbortSignal, true)
    return new Promise(resolve => { resolveWs = resolve })
  })
  const preAborted = new AbortController()
  preAborted.abort(new Error('already unmounted'))
  const preAbortResult = await Promise.race([
    createTransfer({
      sftpId: 'sftp-pre-abort',
      type: 'download',
      signal: preAborted.signal
    }).then(value => ({ value }), error => ({ error })),
    new Promise(resolve => setTimeout(() => resolve({ hung: true }), 100))
  ])
  assert.equal(preAbortResult.hung, undefined)
  assert.match(preAbortResult.error?.message || '', /already unmounted/)
  assert.equal(initCalls, 0)

  const active = new AbortController()
  const start = createTransfer({
    sftpId: 'sftp-late',
    type: 'upload',
    signal: active.signal
  })
  const lateResult = await Promise.race([
    start.then(value => ({ value }), error => ({ error })),
    new Promise(resolve => setTimeout(() => resolve({ hung: true }), 100))
  ])
  assert.equal(lateResult.hung, undefined)
  assert.match(lateResult.error?.message || '', /timed out|timeout/i)
  resolveWs(lateWs)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(lateWs.closed, true)
  assert.equal(lateWs.closeCount, 1)
  assert.equal(lateWs.sent.some(message => (
    message.action === 'transfer-new'
  )), false)
})

test('transfer startup abort closes websocket while subscriptions are pending', async () => {
  const ws = {
    closed: false,
    sent: [],
    once: () => new Promise(() => {}),
    addEventListener: () => {},
    removeEventListener: () => {},
    s (message) { this.sent.push(message) },
    close () { this.closed = true }
  }
  const { default: createTransfer } = await loadTransferModule(
    async () => ws
  )
  const controller = new AbortController()
  const starting = createTransfer({
    sftpId: 'sftp-subscription-abort',
    type: 'download',
    signal: controller.signal
  })
  await new Promise(resolve => setImmediate(resolve))
  controller.abort(new Error('unmounted during subscription'))
  const result = await Promise.race([
    starting.then(value => ({ value }), error => ({ error })),
    new Promise(resolve => setTimeout(() => resolve({ hung: true }), 100))
  ])

  assert.equal(result.hung, undefined)
  assert.match(result.error?.message || '', /unmounted during subscription/)
  assert.equal(ws.closed, true)
  assert.equal(ws.sent.some(message => message.action === 'transfer-new'), false)
})

test('transfer factory resolves only after an exact startup acknowledgement', async () => {
  const listeners = new Map()
  const ws = {
    closed: false,
    sent: [],
    once (listener, id) {
      listeners.set(id, listener)
      return Promise.resolve()
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    s (message) { this.sent.push(message) },
    close () { this.closed = true }
  }
  const { default: createTransfer } = await loadTransferModule(async () => ws)
  let settled = false
  const starting = createTransfer({
    sftpId: 'sftp-ack',
    type: 'upload'
  }).finally(() => { settled = true })
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(ws.sent.some(message => message.action === 'transfer-new'), true)
  assert.equal(settled, false)
  listeners.get('transfer:started:transfer-1')({
    ok: true,
    id: 'transfer-1',
    sftpId: 'wrong-session'
  })
  const result = await Promise.race([
    starting.then(value => ({ value }), error => ({ error })),
    new Promise(resolve => setTimeout(() => resolve({ hung: true }), 100))
  ])
  assert.equal(result.hung, undefined)
  assert.match(result.error?.message || '', /identity|session|match/i)
  assert.equal(ws.closed, true)
})

test('duplicate startup failure acknowledgement rejects promptly without waiting for timeout', async () => {
  const listeners = new Map()
  const ws = {
    closed: false,
    once (listener, id) {
      listeners.set(id, listener)
      return Promise.resolve()
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    s (message) {
      if (message.action === 'transfer-new') {
        queueMicrotask(() => listeners.get('transfer:started:transfer-1')?.({
          ok: false,
          id: 'transfer-1',
          sftpId: 'sftp-duplicate',
          error: { message: 'Transfer is already active' }
        }))
      }
    },
    close () { this.closed = true }
  }
  const { default: createTransfer } = await loadTransferModule(async () => ws)

  await assert.rejects(createTransfer({
    sftpId: 'sftp-duplicate',
    type: 'download'
  }), /already active/)
  assert.equal(ws.closed, true)
})

test('missing startup acknowledgement times out, closes, and ignores a late acknowledgement', async () => {
  const listeners = new Map()
  const unhandled = []
  const onUnhandled = error => unhandled.push(error)
  const ws = {
    closed: false,
    sent: [],
    once (listener, id) {
      listeners.set(id, listener)
      return Promise.resolve()
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    s (message) { this.sent.push(message) },
    close () {
      if (this.closed) return
      this.closed = true
      this.onclose?.()
    }
  }
  process.on('unhandledRejection', onUnhandled)
  try {
    const { default: createTransfer } = await loadTransferModule(async () => ws)
    const result = await Promise.race([
      createTransfer({
        sftpId: 'sftp-no-start-ack',
        type: 'upload'
      }).then(value => ({ value }), error => ({ error })),
      new Promise(resolve => setTimeout(() => resolve({ hung: true }), 100))
    ])

    assert.equal(result.hung, undefined)
    assert.match(result.error?.message || '', /timed out|timeout/i)
    assert.equal(ws.closed, true)
    listeners.get('transfer:started:transfer-1')?.({
      ok: true,
      id: 'transfer-1',
      sftpId: 'sftp-no-start-ack'
    })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(unhandled, [])
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
  }
})

test('transfer startup fails closed when socket closes between subscription and send', async () => {
  let subscriptions = 0
  const unhandled = []
  const onUnhandled = error => unhandled.push(error)
  const ws = {
    closed: false,
    sent: [],
    once () {
      subscriptions += 1
      if (subscriptions === 4) {
        this.closed = true
        this.onclose?.()
      }
      return Promise.resolve()
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    s (message) { this.sent.push(message) },
    close () { this.closed = true }
  }
  const { default: createTransfer } = await loadTransferModule(async () => ws)
  process.on('unhandledRejection', onUnhandled)
  try {
    await assert.rejects(createTransfer({
      sftpId: 'sftp-close-race',
      type: 'upload'
    }), /closed.*startup|startup.*closed/i)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(ws.sent.some(message => message.action === 'transfer-new'), false)
    assert.deepEqual(unhandled, [])
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
  }
})

test('transfer projects bounded residual fields from control and terminal errors', async () => {
  const listeners = new Map()
  const errors = []
  const ws = {
    closed: false,
    sent: [],
    once (listener, id) {
      listeners.set(id, listener)
      return Promise.resolve()
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    s (message) {
      this.sent.push(message)
      if (message.action === 'transfer-new') {
        queueMicrotask(() => listeners.get('transfer:started:transfer-1')?.({
          ok: true,
          id: 'transfer-1',
          sftpId: 'sftp-residual'
        }))
      }
    },
    close () { this.closed = true }
  }
  const { default: createTransfer } = await loadTransferModule(async () => ws)
  const transport = await createTransfer({
    sftpId: 'sftp-residual',
    type: 'upload',
    onData: () => {},
    onEnd: () => {},
    onError: error => errors.push(error)
  })
  const remoteError = {
    message: 'atomic partial unlink denied',
    code: 'EACCES',
    partialResidual: true,
    residualPath: '/tmp/.upload.part',
    cleanupPhase: 'atomic-upload-partial-unlink'
  }

  const cancelling = transport.cancel()
  const control = ws.sent.find(message => message.action === 'transfer-func')
  listeners.get(
    `transfer:control:transfer-1:${control.controlId}`
  )({ ok: false, error: remoteError })
  await assert.rejects(cancelling, error => {
    assert.equal(error.code, remoteError.code)
    assert.equal(error.partialResidual, true)
    assert.equal(error.residualPath, remoteError.residualPath)
    assert.equal(error.cleanupPhase, remoteError.cleanupPhase)
    return true
  })

  const terminalWs = {
    ...ws,
    closed: false,
    sent: [],
    close () { this.closed = true }
  }
  listeners.clear()
  const { default: createTerminalTransfer } = await loadTransferModule(
    async () => terminalWs
  )
  await createTerminalTransfer({
    sftpId: 'sftp-residual',
    type: 'upload',
    onData: () => {},
    onEnd: () => {},
    onError: error => errors.push(error)
  })
  listeners.get('transfer:err:transfer-1')({ error: remoteError })

  assert.equal(errors.length, 1)
  assert.equal(errors[0].code, remoteError.code)
  assert.equal(errors[0].partialResidual, true)
  assert.equal(errors[0].residualPath, remoteError.residualPath)
  assert.equal(errors[0].cleanupPhase, remoteError.cleanupPhase)
})
