const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const terminalApiPath = require.resolve('../../src/app/server/terminal-api.js')
const fetchFromServerPath = path.resolve(
  __dirname,
  '../../src/client/common/fetch-from-server.js'
)

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
