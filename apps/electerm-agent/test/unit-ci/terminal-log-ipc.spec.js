process.env.NODE_ENV = 'development'

const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const Module = require('node:module')
const childProcess = require('node:child_process')

const originalFork = childProcess.fork
const originalLoad = Module._load
const sessionProcessPath = require.resolve('../../src/app/server/session-process')
const terminalApiPath = require.resolve('../../src/app/server/terminal-api')

const operations = [
  {
    name: 'toggle terminal log',
    apiMethod: 'toggleTerminalLog',
    terminalMethod: 'toggleTerminalLog',
    action: 'toggle-terminal-log',
    message: {
      id: 'toggle-request',
      pid: 'session-1'
    },
    expectedArgs: ['toggle-request']
  },
  {
    name: 'set terminal log path',
    apiMethod: 'setTerminalLogPath',
    terminalMethod: 'setTerminalLogPath',
    action: 'set-terminal-log-path',
    message: {
      id: 'path-request',
      pid: 'session-1',
      logPath: 'C:\\logs'
    },
    expectedArgs: ['path-request', 'C:\\logs']
  },
  {
    name: 'start terminal log file',
    apiMethod: 'startTerminalLogFile',
    terminalMethod: 'startTerminalLogFile',
    action: 'start-terminal-log-file',
    message: {
      id: 'start-request',
      pid: 'session-1',
      logFilePath: 'C:\\logs\\session.log',
      addTimeStampToTermLog: true
    },
    expectedArgs: ['start-request', 'C:\\logs\\session.log', true]
  }
]

afterEach(() => {
  childProcess.fork = originalFork
  Module._load = originalLoad
  delete require.cache[sessionProcessPath]
  delete require.cache[terminalApiPath]
})

function deferred () {
  let resolve
  let reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  promise.catch(() => {})
  return { promise, resolve, reject }
}

function loadTerminalApi (terminals) {
  Module._load = function (request, parent, isMain) {
    if (request === './session-process' && parent?.filename === terminalApiPath) {
      return {
        testConnection: async () => {},
        terminal: async () => {},
        terminals
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

function createWs () {
  const messages = []
  return {
    messages,
    ws: {
      s: message => messages.push(message)
    }
  }
}

for (const operation of operations) {
  test(`${operation.name} waits for the child process before returning ok`, async () => {
    const childResponse = deferred()
    let receivedArgs
    const api = loadTerminalApi(() => ({
      [operation.terminalMethod]: (...args) => {
        receivedArgs = args
        return childResponse.promise
      }
    }))
    const { ws, messages } = createWs()

    const result = api[operation.apiMethod](ws, operation.message)
    const messagesBeforeAck = messages.slice()
    const isThenable = typeof result?.then === 'function'
    childResponse.resolve('child-ok')
    await result

    assert.equal(isThenable, true)
    assert.deepEqual(messagesBeforeAck, [])
    assert.deepEqual(receivedArgs, operation.expectedArgs)
    assert.deepEqual(messages, [{
      id: operation.message.id,
      data: 'ok'
    }])
  })

  test(`${operation.name} returns the child process rejection through websocket error`, async () => {
    const childResponse = deferred()
    const expectedError = new Error(`${operation.action} rejected`)
    const api = loadTerminalApi(() => ({
      [operation.terminalMethod]: () => childResponse.promise
    }))
    const { ws, messages } = createWs()

    const result = api[operation.apiMethod](ws, operation.message)
    childResponse.reject(expectedError)
    await result

    assert.equal(messages.length, 1)
    assert.equal(messages[0].id, operation.message.id)
    assert.equal(messages[0].data, undefined)
    assert.equal(messages[0].error.message, expectedError.message)
    assert.equal(messages[0].error.stack, expectedError.stack)
  })

  test(`${operation.name} reports a missing terminal through websocket error`, async () => {
    const api = loadTerminalApi(() => null)
    const { ws, messages } = createWs()

    await api[operation.apiMethod](ws, operation.message)

    assert.equal(messages.length, 1)
    assert.equal(messages[0].id, operation.message.id)
    assert.equal(messages[0].data, undefined)
    assert.equal(
      messages[0].error.message,
      `Terminal with PID ${operation.message.pid} not found`
    )
  })
}

test('terminal log controls expose child process response promises', async () => {
  const requests = new Map()
  const child = new EventEmitter()
  child.kill = () => child.emit('exit')
  child.send = (payload) => {
    const request = payload?.data
    if (request?.action === 'create-terminal') {
      queueMicrotask(() => {
        child.emit('message', {
          id: request.id,
          data: { pid: request.body.uid }
        })
      })
      return
    }
    if (request) {
      requests.set(request.id, request)
    }
  }
  childProcess.fork = () => {
    queueMicrotask(() => child.emit('message', { serverInited: true }))
    return child
  }
  Module._load = function (request, parent, isMain) {
    if (request === 'find-free-port' && parent?.filename === sessionProcessPath) {
      return (startPort, host, callback) => {
        queueMicrotask(() => callback(null, 41000))
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  let sessionProcess
  try {
    sessionProcess = require(sessionProcessPath)
  } finally {
    Module._load = originalLoad
  }

  const pid = 'session-process-log-test'
  await sessionProcess.terminal({
    uid: pid,
    type: 'local'
  }, null, 'create-request')

  try {
    const terminal = sessionProcess.terminals(pid)
    for (const operation of operations) {
      const successId = `${operation.action}-success`
      const successArgs = [successId, ...operation.expectedArgs.slice(1)]
      const success = terminal[operation.terminalMethod](...successArgs)

      assert.equal(typeof success?.then, 'function')
      assert.equal(requests.get(successId).action, operation.action)
      child.emit('message', {
        id: successId,
        data: `${operation.action}-ok`
      })
      assert.equal(await success, `${operation.action}-ok`)

      const rejectionId = `${operation.action}-rejection`
      const rejectionArgs = [rejectionId, ...operation.expectedArgs.slice(1)]
      const rejection = terminal[operation.terminalMethod](...rejectionArgs)

      assert.equal(typeof rejection?.then, 'function')
      child.emit('message', {
        id: rejectionId,
        error: {
          message: `${operation.action} failed`,
          stack: 'child-stack'
        }
      })
      await assert.rejects(rejection, error => {
        assert.equal(error.message, `${operation.action} failed`)
        assert.equal(error.stack, 'child-stack')
        return true
      })
    }
  } finally {
    sessionProcess.cleanupTerminals()
  }
})
