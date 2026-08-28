const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')

const serverPath = path.resolve(
  __dirname,
  '../../src/app/server/session-server.js'
)

function createTransferRouteHarness ({
  onDestroySftp = () => {},
  onDestroyTransfer,
  controlFailures = {}
} = {}) {
  const routes = new Map()
  const sessions = new Map()
  const constructed = []
  const processStub = new EventEmitter()
  processStub.env = {
    tokenElecterm: 'route-token',
    electermHost: '127.0.0.1',
    wsPort: '0',
    type: 'local'
  }
  processStub.send = () => {}
  processStub.exit = () => {}
  const app = {
    ws: (route, handler) => routes.set(route, handler),
    listen: (...args) => args.at(-1)()
  }
  class FakeTransfer {
    constructor (options) {
      this.options = options
      this.ws = options.ws
      this.calls = []
      constructed.push(this)
    }

    pause (...args) { this.calls.push(['pause', ...args]) }
    resume (...args) { this.calls.push(['resume', ...args]) }
    cancel (...args) {
      this.calls.push(['cancel', ...args])
      if (controlFailures.cancel) throw controlFailures.cancel
    }

    interrupt (...args) { this.calls.push(['interrupt', ...args]) }
    destroy (...args) { this.calls.push(['destroy', ...args]) }
    finishSuccessfulTransfer (...args) {
      this.calls.push(['finishSuccessfulTransfer', ...args])
    }

    renameAtomicUpload (...args) {
      this.calls.push(['renameAtomicUpload', ...args])
    }

    cleanupAtomicUpload (...args) {
      this.calls.push(['cleanupAtomicUpload', ...args])
    }
  }
  const transfer = (id, sftpId, instance) => {
    const session = sessions.get(sftpId)
    if (!session) return undefined
    if (instance) session.transfers[id] = instance
    return session.transfers[id]
  }
  const destroyTransfer = onDestroyTransfer || ((id, sftpId) => {
    const instance = transfer(id, sftpId)
    instance?.destroy?.()
    const session = sessions.get(sftpId)
    if (session?.transfers?.[id] === instance) {
      delete session.transfers[id]
    }
  })
  const stubs = new Map([
    ['express', () => app],
    ['./session-sftp', { Sftp: class {} }],
    ['./session-ftp', { Ftp: class {} }],
    ['./remote-common', {
      sftp: id => sessions.get(id),
      transfer,
      onDestroySftp,
      onDestroyTransfer: destroyTransfer,
      terminals: () => ({}),
      cleanAllSessions: () => {}
    }],
    ['./transfer', {
      Transfer: FakeTransfer,
      transferKeys: ['pause', 'resume', 'cancel', 'interrupt', 'destroy']
    }],
    ['./ftp-transfer', { Transfer: FakeTransfer }],
    ['../common/log', {
      debug: () => {},
      error: () => {},
      info: () => {},
      warn: () => {}
    }],
    ['./app-wrap', () => {}],
    ['./session-api', {
      createTerm: async () => ({}),
      testTerm: async () => ({}),
      resize: async () => {},
      runCmd: async () => {},
      cancelRunCmd: async () => {},
      startSshTunnel: async () => {},
      stopSshTunnel: async () => {},
      listSshTunnels: async () => [],
      testSshTunnel: async () => {},
      toggleTerminalLog: async () => {},
      toggleTerminalLogTimestamp: async () => {},
      setTerminalLogPath: async () => {},
      startTerminalLogFile: async () => {}
    }],
    ['../common/runtime-constants', { isWin: false }],
    ['./ws-dec', () => {}],
    ['./zmodem', { zmodemManager: {} }],
    ['./trzsz', { trzszManager: {} }],
    ['./xmodem', { xmodemManager: {} }],
    ['./terminal-control-message', {
      parseTerminalControlMessage: () => null
    }],
    ['./session-common', {
      serializeRunCmdError: error => ({ message: error?.message })
    }],
    ['./ssh-tunnel-runtime', {
      serializeTunnelError: error => ({ message: error?.message })
    }],
    ['../common/sftp-error-contract', {
      projectSftpError: error => ({ message: error?.message })
    }]
  ])
  const timerStub = () => ({ unref: () => {} })
  vm.runInNewContext(fs.readFileSync(serverPath, 'utf8'), {
    require: request => {
      if (!stubs.has(request)) throw new Error(`Unexpected require: ${request}`)
      return stubs.get(request)
    },
    process: processStub,
    setTimeout: timerStub,
    clearTimeout: () => {},
    Buffer
  }, { filename: serverPath })

  const session = {
    sftp: { name: 'bound-sftp' },
    client: { name: 'bound-client' },
    initOptions: { encode: 'utf8' },
    transfers: {}
  }
  sessions.set('sftp-bound', session)
  const ws = new EventEmitter()
  ws.sent = []
  ws.s = message => ws.sent.push(message)
  ws.close = () => { ws.closed = true }
  routes.get('/transfer/:id')(ws, {
    params: { id: 'transfer-bound' },
    query: { token: 'route-token', sftpId: 'sftp-bound' }
  })
  const send = message => ws.emit('message', JSON.stringify(message))
  return { constructed, routes, send, session, sessions, ws }
}

function flush () {
  return new Promise(resolve => setImmediate(resolve))
}

test('transfer route rejects spoofed internal controls and non-empty arguments', async () => {
  const harness = createTransferRouteHarness()
  assert.doesNotThrow(() => harness.send(null))
  assert.equal(harness.ws.sent[0]?.id, 'transfer:err:transfer-bound')
  harness.ws.sent = []
  harness.send({
    action: 'transfer-new',
    id: 'transfer-bound',
    sftpId: 'sftp-bound',
    type: 'upload'
  })
  assert.equal(harness.constructed.length, 1)
  assert.equal(harness.ws.sent.at(-1)?.id, 'transfer:started:transfer-bound')
  assert.equal(harness.ws.sent.at(-1)?.data?.ok, true)
  assert.equal(harness.ws.sent.at(-1)?.data?.id, 'transfer-bound')
  assert.equal(harness.ws.sent.at(-1)?.data?.sftpId, 'sftp-bound')
  harness.ws.sent = []
  const instance = harness.constructed[0]

  for (const [func, args] of [
    ['finishSuccessfulTransfer', []],
    ['renameAtomicUpload', []],
    ['cleanupAtomicUpload', []],
    ['pause', ['forged-argument']]
  ]) {
    harness.send({
      action: 'transfer-func',
      id: 'transfer-bound',
      sftpId: 'sftp-bound',
      func,
      args,
      controlId: `spoof-${func}`
    })
  }
  await flush()

  assert.deepEqual(instance.calls, [])
  assert.equal(harness.ws.sent.length, 4)
  assert.equal(harness.ws.sent.every(message => (
    message.data?.ok === false
  )), true)
})

test('transfer route binds ids and session identity and never overwrites active transfer', async () => {
  const harness = createTransferRouteHarness()
  harness.send({
    action: 'transfer-new',
    id: 'transfer-bound',
    sftpId: 'sftp-bound',
    isFtp: true,
    type: 'upload'
  })
  const instance = harness.constructed[0]
  assert.equal(harness.ws.sent.at(-1)?.data?.ok, true)
  harness.ws.sent = []
  assert.equal(instance.options.isFtp, false)
  harness.send({
    action: 'transfer-new',
    id: 'transfer-bound',
    sftpId: 'sftp-bound',
    type: 'download'
  })
  harness.send({
    action: 'transfer-func',
    id: 'another-transfer',
    sftpId: 'sftp-bound',
    func: 'pause',
    args: [],
    controlId: 'wrong-route-id'
  })
  harness.send({
    action: 'transfer-func',
    id: 'transfer-bound',
    sftpId: 'another-sftp',
    func: 'pause',
    args: [],
    controlId: 'wrong-sftp-id'
  })
  harness.sessions.set('sftp-bound', {
    sftp: {}, client: {}, initOptions: {}, transfers: {}
  })
  harness.send({
    action: 'transfer-func',
    id: 'transfer-bound',
    sftpId: 'sftp-bound',
    func: 'pause',
    args: [],
    controlId: 'replaced-session'
  })
  await flush()

  assert.equal(harness.constructed.length, 1)
  assert.equal(harness.session.transfers['transfer-bound'], instance)
  assert.deepEqual(instance.calls, [])
  assert.equal(harness.ws.sent.some(message => (
    message.id === 'transfer:started:transfer-bound' &&
    message.data?.ok === false
  )), true)
})

test('transfer startup and controls reject an exact session once teardown admission closes', async () => {
  const harness = createTransferRouteHarness()
  harness.session.closing = true
  harness.send({
    action: 'transfer-new',
    id: 'transfer-bound',
    sftpId: 'sftp-bound',
    type: 'upload'
  })

  assert.equal(harness.constructed.length, 0)
  assert.equal(harness.ws.sent.at(-1)?.id, 'transfer:started:transfer-bound')
  assert.equal(harness.ws.sent.at(-1)?.data?.ok, false)

  const existing = new (class {
    pause () { throw new Error('must not invoke closing session transfer') }
  })()
  harness.session.transfers['transfer-bound'] = existing
  harness.send({
    action: 'transfer-func',
    id: 'transfer-bound',
    sftpId: 'sftp-bound',
    func: 'pause',
    args: [],
    controlId: 'closing-control'
  })
  await flush()
  assert.equal(harness.ws.sent.at(-1)?.data?.ok, false)
})

test('transfer control acknowledgement propagates atomic cleanup failure', async () => {
  const cleanupFailure = new Error('atomic partial unlink denied')
  cleanupFailure.code = 'EACCES'
  cleanupFailure.partialResidual = true
  cleanupFailure.residualPath = '/tmp/.upload.part'
  cleanupFailure.cleanupPhase = 'atomic-upload-partial-unlink'
  const harness = createTransferRouteHarness({
    controlFailures: { cancel: cleanupFailure }
  })
  harness.send({
    action: 'transfer-new',
    id: 'transfer-bound',
    sftpId: 'sftp-bound',
    type: 'upload'
  })
  harness.send({
    action: 'transfer-func',
    id: 'transfer-bound',
    sftpId: 'sftp-bound',
    func: 'cancel',
    args: [],
    controlId: 'cleanup-failed'
  })
  await flush()

  assert.equal(harness.constructed[0].calls.length, 1)
  assert.deepEqual(harness.constructed[0].calls[0], ['cancel'])
  const acknowledgement = harness.ws.sent.find(message => (
    message.id === 'transfer:control:transfer-bound:cleanup-failed'
  ))
  assert.equal(acknowledgement.data?.ok, false)
  assert.equal(acknowledgement.data?.error?.message, cleanupFailure.message)
  assert.equal(acknowledgement.data?.error?.code, 'EACCES')
  assert.equal(acknowledgement.data?.error?.partialResidual, true)
  assert.equal(
    acknowledgement.data?.error?.residualPath,
    cleanupFailure.residualPath
  )
})

test('closing a duplicate transfer socket cannot destroy the active owner', async () => {
  const harness = createTransferRouteHarness()
  harness.send({
    action: 'transfer-new',
    id: 'transfer-bound',
    sftpId: 'sftp-bound',
    type: 'upload'
  })
  const instance = harness.constructed[0]
  const duplicateWs = new EventEmitter()
  duplicateWs.sent = []
  duplicateWs.s = message => duplicateWs.sent.push(message)
  duplicateWs.close = () => duplicateWs.emit('close')
  harness.routes.get('/transfer/:id')(duplicateWs, {
    params: { id: 'transfer-bound' },
    query: { token: 'route-token', sftpId: 'sftp-bound' }
  })
  duplicateWs.emit('message', JSON.stringify({
    action: 'transfer-new',
    id: 'transfer-bound',
    sftpId: 'sftp-bound',
    type: 'download'
  }))
  assert.equal(duplicateWs.sent.at(-1)?.id, 'transfer:started:transfer-bound')
  assert.equal(duplicateWs.sent.at(-1)?.data?.ok, false)
  duplicateWs.emit('message', JSON.stringify({
    action: 'transfer-func',
    id: 'transfer-bound',
    sftpId: 'sftp-bound',
    func: 'cancel',
    args: [],
    controlId: 'duplicate-cancel'
  }))
  await flush()
  assert.equal(duplicateWs.sent.at(-1)?.data?.ok, false)
  duplicateWs.close()
  await flush()

  assert.equal(harness.session.transfers['transfer-bound'], instance)
  assert.equal(instance.calls.some(([name]) => name === 'destroy'), false)
})

test('SFTP destroy reports graceful teardown failure instead of success', async () => {
  const failure = new Error('transfer cleanup failed before channel close')
  const harness = createTransferRouteHarness({
    onDestroySftp: () => Promise.reject(failure)
  })
  const ws = new EventEmitter()
  ws.sent = []
  ws.s = message => ws.sent.push(message)
  ws.close = () => { ws.closed = true }
  harness.routes.get('/sftp/:id')(ws, {
    params: { id: 'sftp-bound' },
    query: { token: 'route-token' }
  })

  ws.emit('message', JSON.stringify({
    action: 'sftp-destroy',
    id: 'sftp-bound',
    uid: 'destroy-result'
  }))
  await flush()

  assert.equal(ws.closed, true)
  assert.equal(ws.sent.length, 1)
  assert.equal(ws.sent[0].id, 'destroy-result')
  assert.equal(ws.sent[0].error?.message, failure.message)
  assert.equal(ws.sent[0].data, undefined)
})

test('abrupt SFTP websocket close still uses bounded graceful teardown', async () => {
  const calls = []
  const harness = createTransferRouteHarness({
    onDestroySftp: (...args) => { calls.push(args) }
  })
  const ws = new EventEmitter()
  ws.s = () => {}
  ws.close = () => { ws.closed = true }
  harness.routes.get('/sftp/:id')(ws, {
    params: { id: 'sftp-bound' },
    query: { token: 'route-token' }
  })

  ws.emit('close')
  await flush()

  assert.deepEqual(calls, [['sftp-bound', true]])
})
