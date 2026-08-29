const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { importModule } = require('./helpers/import-esm')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generateCode = require('@babel/generator').default

const appRoot = path.resolve(__dirname, '../..')
const transferPath = path.join(
  appRoot,
  'src/client/components/file-transfer/transfer.jsx'
)
const transferSource = fs.readFileSync(transferPath, 'utf8')
const transferAst = parser.parse(transferSource, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining']
})

function transferClassFieldInitializer (name) {
  let initializer
  traverse(transferAst, {
    ClassProperty (nodePath) {
      if (nodePath.node.key?.name === name) initializer = nodePath.node.value
    }
  })
  assert.ok(initializer, `transfer.jsx must define ${name}`)
  return generateCode(initializer).code
}

function installTransferClassField (entry, name, dependencies = {}) {
  entry[name] = vm.runInNewContext(`
    (function installClassField () {
      return (${transferClassFieldInitializer(name)})
    }).call(__entry)
  `, {
    ...dependencies,
    __entry: entry
  })
  return entry[name]
}

async function loadCancellationLifecycle () {
  return importModule(
    'src/client/components/file-transfer/transfer-cancellation-lifecycle.js'
  )
}

function authoritativeCancellation (origin = 'user') {
  const error = new Error('localized text must not be inspected')
  error.name = 'AbortError'
  error.code = 'PTY_TASK_CANCELLED'
  error.cancelled = true
  error.cancellationOrigin = origin
  return error
}

function plain (value) {
  return JSON.parse(JSON.stringify(value))
}

test('only the structured managed PTY cancellation contract is authoritative', async () => {
  const {
    isAuthoritativeTransferCancellation,
    transferTerminalUpdateForError
  } = await loadCancellationLifecycle()
  const cancellation = authoritativeCancellation()

  assert.equal(isAuthoritativeTransferCancellation(cancellation), true)
  assert.deepEqual(transferTerminalUpdateForError(cancellation), {
    status: 'cancelled',
    error: '',
    skipSourceVerification: true
  })

  const unmarkedAbort = new Error('same visible message')
  unmarkedAbort.name = 'AbortError'
  assert.equal(isAuthoritativeTransferCancellation(unmarkedAbort), false)
  assert.deepEqual(transferTerminalUpdateForError(unmarkedAbort), {
    status: 'exception',
    error: 'same visible message'
  })

  const realFailure = new Error('transport failed')
  realFailure.code = 'PTY_TASK_CANCELLED'
  realFailure.cancelled = true
  assert.equal(isAuthoritativeTransferCancellation(realFailure), false)
})

test('Transfer onError routes an authoritative PTY cancellation to cancelled without reporting exception', async () => {
  const { transferTerminalUpdateForError } = await loadCancellationLifecycle()
  const terminalUpdates = []
  const reported = []
  let retries = 0
  const entry = {
    userCancelling: false,
    onCancel: false,
    transferAttempts: {
      completing: false,
      isCurrent: token => token === 7
    },
    scheduleRetry: () => {
      retries += 1
      return false
    },
    onEnd: async update => {
      terminalUpdates.push(update)
    }
  }
  installTransferClassField(entry, 'onError', {
    transferTerminalUpdateForError,
    window: { store: { onError: error => reported.push(error) } }
  })

  await entry.onError(authoritativeCancellation(), 7)

  assert.deepEqual(plain(terminalUpdates), [{
    status: 'cancelled',
    error: '',
    skipSourceVerification: true
  }])
  assert.equal(retries, 0)
  assert.deepEqual(reported, [])
})

test('Transfer keeps unmarked AbortError and real failures on the exception path', async () => {
  const { transferTerminalUpdateForError } = await loadCancellationLifecycle()
  const terminalUpdates = []
  const reported = []
  const entry = {
    userCancelling: false,
    onCancel: false,
    transferAttempts: {
      completing: false,
      isCurrent: () => true
    },
    scheduleRetry: () => false,
    onEnd: async update => terminalUpdates.push(update)
  }
  installTransferClassField(entry, 'onError', {
    transferTerminalUpdateForError,
    window: { store: { onError: error => reported.push(error) } }
  })

  const unmarkedAbort = new Error('unmarked abort')
  unmarkedAbort.name = 'AbortError'
  const realFailure = new Error('real failure')
  await entry.onError(unmarkedAbort, 1)
  entry.transferAttempts.completing = false
  await entry.onError(realFailure, 1)

  assert.deepEqual(plain(terminalUpdates), [
    { status: 'exception', error: 'unmarked abort' },
    { status: 'exception', error: 'real failure' }
  ])
  assert.deepEqual(reported, [unmarkedAbort, realFailure])
})

test('authoritative cancellation persists cancelled history and terminal consumers without completing safety', async () => {
  const calls = []
  const history = []
  const entry = {
    onCancel: false,
    finishing: false,
    folderItemResults: [],
    total: 64,
    startTime: 100,
    props: {
      transfer: {
        id: 'transfer-cancelled',
        typeTo: 'local',
        fromFile: { size: 64 }
      },
      config: { disableTransferHistory: false }
    },
    transferAttempts: {
      completing: false,
      beginCompletion: () => true,
      finishCompletion: () => calls.push('attempt-finished')
    },
    getLocalSourceSkippedResults: () => [],
    verifyLocalSource: async () => { throw new Error('cancel must not verify source') },
    stopTransport: async reason => calls.push(`stop:${reason}`),
    transferSafety: {
      complete: async () => { calls.push('safety-complete') },
      cancel: async options => {
        calls.push(`safety-cancel:${options.externalAlreadyAttempted}`)
        return { state: 'cancelled' }
      }
    },
    notifyAgentRiskTerminal: async outcome => calls.push(`risk:${outcome.status}`),
    runTransferTask: async method => calls.push(`task:${method}`),
    recordTransferHistory: update => {
      history.push({ status: update.status, error: update.error || '' })
      calls.push(`history:${update.status}`)
    },
    recordTransferBatchResult: (transfer, update) => calls.push(`batch:${update.status}`),
    getTransferTaskEndpoint: () => ({ username: 'root' }),
    localList: () => calls.push('local-list'),
    finishTransfer: async (callback, reason) => {
      calls.push(`finish:${reason}`)
      callback()
    },
    releaseRemoteFileSession: async () => {
      calls.push('release')
    }
  }
  installTransferClassField(entry, 'onEnd', {
    assign: Object.assign,
    copy: value => structuredClone(value),
    format: () => '0 B/s',
    getTransferSafetyCompletionFailure: () => null,
    window: {
      store: {
        addTransferHistory: value => history.push(value),
        onError: error => { throw error }
      }
    }
  })

  await entry.onEnd({
    status: 'cancelled',
    error: '',
    skipSourceVerification: true
  }, 7)
  await Promise.resolve()

  assert.deepEqual(history.map(item => ({
    status: item.status,
    error: item.error || ''
  })), [{ status: 'cancelled', error: '' }])
  assert.equal(calls.includes('safety-complete'), false)
  assert.equal(calls.includes('task:onCompleted'), false)
  assert.deepEqual(calls, [
    'stop:authoritative-cancelled',
    'safety-cancel:true',
    'risk:cancelled',
    'task:onCancelled',
    'history:cancelled',
    'batch:cancelled',
    'attempt-finished',
    'finish:authoritative-cancelled',
    'local-list',
    'release'
  ])
})
