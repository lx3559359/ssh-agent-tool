const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const childProcess = require('node:child_process')

const terminalApiPath = require.resolve('../../src/app/server/terminal-api.js')
const sessionProcessPath = require.resolve('../../src/app/server/session-process.js')
const sessionServerPath = require.resolve('../../src/app/server/session-server.js')
const sessionCommonPath = require.resolve('../../src/app/server/session-common.js')
const fetchFromServerPath = path.resolve(
  __dirname,
  '../../src/client/common/fetch-from-server.js'
)
const originalFork = childProcess.fork

test.afterEach(() => {
  childProcess.fork = originalFork
  delete require.cache[terminalApiPath]
  delete require.cache[sessionProcessPath]
})

function loadTerminalApi (terminal) {
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === './session-process' && parent?.filename === terminalApiPath) {
      return {
        testConnection: async () => {},
        terminal: async () => {},
        terminals: () => terminal
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[terminalApiPath]
    return require(terminalApiPath)
  } finally {
    Module._load = originalLoad
  }
}

async function loadFetchFromServer () {
  let source = fs.readFileSync(fetchFromServerPath, 'utf8')
  source = source
    .replace("import initWs from './ws'", 'const initWs = async () => undefined')
    .replace("import generate from './uid'", "const generate = () => 'fetch-contract'")
    .replace(
      "import { NewPromise } from './promise-timeout'",
      'const NewPromise = Promise'
    )
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  return import(url)
}

async function sessionServerErrorPayload (action, error) {
  const sent = []
  const processStub = new EventEmitter()
  processStub.env = {
    tokenElecterm: 'test-token',
    electermHost: '127.0.0.1',
    wsPort: '0',
    type: 'local'
  }
  processStub.send = message => sent.push(message)
  processStub.exit = () => {}
  const app = {
    ws: () => {},
    listen: (...args) => args.at(-1)()
  }
  const sessionApi = {
    createTerm: async () => ({}),
    testTerm: async () => ({}),
    resize: async () => {},
    runCmd: async () => { throw error },
    cancelRunCmd: async () => { throw error },
    toggleTerminalLog: async () => {},
    toggleTerminalLogTimestamp: async () => {},
    setTerminalLogPath: async () => {},
    startTerminalLogFile: async () => {}
  }
  const emptyManager = {}
  const stubs = new Map([
    ['express', () => app],
    ['./session-sftp', { Sftp: class {} }],
    ['./session-ftp', { Ftp: class {} }],
    ['./remote-common', {
      sftp: () => {},
      transfer: () => {},
      onDestroySftp: () => {},
      onDestroyTransfer: () => {},
      terminals: () => ({}),
      cleanAllSessions: () => {}
    }],
    ['./transfer', { Transfer: class {} }],
    ['./ftp-transfer', { Transfer: class {} }],
    ['../common/log', {
      debug: () => {},
      error: () => {},
      info: () => {},
      warn: () => {}
    }],
    ['./app-wrap', () => {}],
    ['./session-api', sessionApi],
    ['../common/runtime-constants', { isWin: false }],
    ['./ws-dec', () => {}],
    ['./zmodem', { zmodemManager: emptyManager }],
    ['./trzsz', { trzszManager: emptyManager }],
    ['./xmodem', { xmodemManager: emptyManager }],
    ['./terminal-control-message', {
      parseTerminalControlMessage: () => null
    }],
    ['./session-common', require(sessionCommonPath)]
  ])
  const timerStub = () => ({ unref: () => {} })
  const source = fs.readFileSync(sessionServerPath, 'utf8')

  vm.runInNewContext(source, {
    require: request => {
      if (!stubs.has(request)) throw new Error(`Unexpected require: ${request}`)
      return stubs.get(request)
    },
    process: processStub,
    setTimeout: timerStub,
    clearTimeout: () => {},
    Buffer
  }, { filename: sessionServerPath })

  await new Promise(resolve => setImmediate(resolve))
  const id = `inner-${action}`
  processStub.emit('message', {
    type: 'common',
    data: { id, action, body: {} }
  })
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = sent.find(message => message?.id === id)
    if (response) return response.error
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error(`Session server did not answer ${action}`)
}

async function openDefaultSession (responses) {
  let child
  childProcess.fork = () => {
    child = new EventEmitter()
    child.connected = true
    child.exitCode = null
    child.kill = () => {
      child.connected = false
      child.exitCode = 0
      child.emit('exit', 0, null)
    }
    child.send = (payload, callback) => {
      callback?.()
      const request = payload?.data
      if (!request) return
      queueMicrotask(() => {
        if (request.action === 'create-terminal') {
          child.emit('message', {
            id: request.id,
            data: { pid: request.body.uid }
          })
          return
        }
        child.emit('message', {
          id: request.id,
          error: responses[request.action]
        })
      })
    }
    queueMicrotask(() => child.emit('message', { serverInited: true }))
    return child
  }
  delete require.cache[sessionProcessPath]
  delete require.cache[terminalApiPath]
  const sessionProcess = require(sessionProcessPath)
  await sessionProcess.terminal({
    uid: 'inner-error-contract-session',
    termType: 'local'
  }, null, 'create-inner-error-contract-session')
  return {
    api: require(terminalApiPath),
    sessionProcess,
    child
  }
}

async function fetchErrorFromMessage (message) {
  const previousWindow = globalThis.window
  globalThis.window = {
    et: {},
    pre: { ipcOnEvent () {} },
    store: {}
  }
  try {
    const fetchModule = await loadFetchFromServer()
    let receive
    globalThis.window.et.wsOpened = true
    globalThis.window.et.commonWs = {
      once: callback => { receive = callback },
      s: () => queueMicrotask(() => receive(message))
    }
    try {
      await fetchModule.default({ action: 'run-cmd' })
    } catch (error) {
      return error
    }
    throw new Error('Expected fetch to reject')
  } finally {
    globalThis.window = previousWindow
  }
}

for (const contract of [
  {
    action: 'run-cmd',
    name: 'RunCmdTimeoutError',
    code: 'RUN_CMD_TIMEOUT',
    message: 'bounded command timed out'
  },
  {
    action: 'cancel-run-cmd',
    name: 'RunCmdCancelledError',
    code: 'AGENT_REMOTE_CANCEL_FAILED',
    message: 'remote cancellation failed'
  }
]) {
  test(`inner ${contract.action} IPC preserves safe error identity only`, async () => {
    const sourceError = new Error(contract.message)
    sourceError.name = contract.name
    sourceError.code = contract.code
    sourceError.remoteState = 'unknown'
    sourceError.canAutoRetry = false
    sourceError.stack = 'SECRET child stack and filesystem details'
    sourceError.cause = new Error('SECRET nested cause')
    sourceError.command = 'cat /root/secret'
    sourceError.password = 'SECRET password'
    sourceError.arbitrary = 'must not cross IPC'

    const payload = await sessionServerErrorPayload(contract.action, sourceError)

    assert.deepEqual(payload, {
      message: contract.message,
      name: contract.name,
      code: contract.code,
      remoteState: 'unknown',
      canAutoRetry: false
    })
  })
}

test('ordinary inner IPC errors remain ordinary errors without unsafe fields', async () => {
  const sourceError = new Error('ordinary child failure')
  sourceError.stack = 'SECRET ordinary child stack'
  sourceError.command = 'SECRET command'

  const payload = await sessionServerErrorPayload('run-cmd', sourceError)
  payload.stack = 'SECRET forged parent stack'
  payload.cause = { message: 'SECRET forged cause' }
  payload.command = 'SECRET forged command'
  payload.password = 'SECRET forged password'
  payload.arbitrary = 'SECRET forged field'
  const { sessionProcess } = await openDefaultSession({ 'run-cmd': payload })
  try {
    await assert.rejects(
      sessionProcess.getTerminal('inner-error-contract-session').runCmd(
        'hostname',
        'ordinary-inner-error'
      ),
      error => {
        assert.equal(error.name, 'Error')
        assert.equal(error.message, 'ordinary child failure')
        assert.doesNotMatch(error.stack, /SECRET/)
        assert.equal(Object.hasOwn(error, 'command'), false)
        assert.equal(Object.hasOwn(error, 'cause'), false)
        assert.equal(Object.hasOwn(error, 'password'), false)
        assert.equal(Object.hasOwn(error, 'arbitrary'), false)
        return true
      }
    )
  } finally {
    await sessionProcess.closeTerminal('inner-error-contract-session', {
      timeoutMs: 10
    })
  }
})

test('default session IPC keeps timeout and cancellation types through fetch', async () => {
  const timeout = new Error('bounded command timed out')
  timeout.name = 'RunCmdTimeoutError'
  timeout.code = 'RUN_CMD_TIMEOUT'
  timeout.remoteState = 'unknown'
  timeout.canAutoRetry = false
  timeout.stack = 'SECRET timeout stack'
  const cancellation = new Error('remote cancellation failed')
  cancellation.name = 'RunCmdCancelledError'
  cancellation.code = 'AGENT_REMOTE_CANCEL_FAILED'
  cancellation.remoteState = 'unknown'
  cancellation.canAutoRetry = false
  cancellation.stack = 'SECRET cancellation stack'
  const responses = {
    'run-cmd': await sessionServerErrorPayload('run-cmd', timeout),
    'cancel-run-cmd': await sessionServerErrorPayload(
      'cancel-run-cmd',
      cancellation
    )
  }
  const { api, sessionProcess } = await openDefaultSession(responses)

  try {
    for (const request of [
      {
        method: 'runCmd',
        message: {
          id: 'outer-timeout',
          pid: 'inner-error-contract-session',
          cmd: 'sleep 60'
        },
        name: 'RunCmdTimeoutError',
        code: 'RUN_CMD_TIMEOUT'
      },
      {
        method: 'cancelRunCmd',
        message: {
          id: 'outer-cancellation',
          pid: 'inner-error-contract-session',
          executionId: 'readonly-execution'
        },
        name: 'RunCmdCancelledError',
        code: 'AGENT_REMOTE_CANCEL_FAILED'
      }
    ]) {
      const messages = []
      await api[request.method]({ s: message => messages.push(message) }, request.message)
      const error = await fetchErrorFromMessage(messages[0])
      assert.equal(error.name, request.name)
      assert.equal(error.code, request.code)
      assert.equal(error.remoteState, 'unknown')
      assert.equal(error.canAutoRetry, false)
      assert.doesNotMatch(error.stack, /SECRET/)
    }
  } finally {
    await sessionProcess.closeTerminal('inner-error-contract-session', {
      timeoutMs: 10
    })
  }
})

test('terminal run-cmd serializes only safe structured error fields', async () => {
  const remoteError = new Error('bounded command timed out')
  remoteError.name = 'RunCmdTimeoutError'
  remoteError.code = 'RUN_CMD_TIMEOUT'
  remoteError.remoteState = 'unknown'
  remoteError.canAutoRetry = false
  remoteError.stack = 'SECRET server stack and filesystem details'
  const api = loadTerminalApi({
    runCmd: async () => { throw remoteError }
  })
  const messages = []

  await api.runCmd({ s: message => messages.push(message) }, {
    id: 'terminal-error-contract',
    pid: 'terminal-contract-pid',
    cmd: 'ip addr',
    timeoutMs: 7,
    maxOutputBytes: 11,
    executionId: 'agent-readonly-error-contract'
  })

  assert.deepEqual(messages, [{
    id: 'terminal-error-contract',
    error: {
      message: 'bounded command timed out',
      name: 'RunCmdTimeoutError',
      code: 'RUN_CMD_TIMEOUT',
      remoteState: 'unknown',
      canAutoRetry: false
    }
  }])
})

test('fetch reconstructs safe remote error identity without adopting server stack', async t => {
  const previousWindow = globalThis.window
  globalThis.window = {
    et: {},
    pre: { ipcOnEvent () {} },
    store: {}
  }
  t.after(() => { globalThis.window = previousWindow })
  const fetchModule = await loadFetchFromServer()
  let receive
  globalThis.window.et.wsOpened = true
  globalThis.window.et.commonWs = {
    once: callback => { receive = callback },
    s: () => queueMicrotask(() => receive({
      error: {
        message: 'remote cancellation failed',
        name: 'RunCmdCancelledError',
        code: 'AGENT_REMOTE_CANCEL_FAILED',
        remoteState: 'unknown',
        canAutoRetry: false,
        stack: 'SECRET remote stack'
      }
    }))
  }
  const originalConsoleError = console.error
  const loggedErrors = []
  console.error = (...args) => { loggedErrors.push(args) }

  try {
    await assert.rejects(fetchModule.default({ action: 'run-cmd' }), error => {
      assert.equal(error.message, 'remote cancellation failed')
      assert.equal(error.name, 'RunCmdCancelledError')
      assert.equal(error.code, 'AGENT_REMOTE_CANCEL_FAILED')
      assert.equal(error.remoteState, 'unknown')
      assert.equal(error.canAutoRetry, false)
      assert.doesNotMatch(error.stack, /SECRET remote stack/)
      return true
    })
    assert.doesNotMatch(JSON.stringify(loggedErrors), /SECRET remote stack/)
  } finally {
    console.error = originalConsoleError
  }
})
