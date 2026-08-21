const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/ai-run-cancellation.js'
))

function deferred () {
  let release
  const promise = new Promise(resolve => {
    release = resolve
  })
  return { promise, resolve: release }
}

test('selects the newest active run from the requested conversation scope', async () => {
  const { getActiveScopedAIChatRun } = await import(moduleUrl)
  const history = [
    { id: 'done-a', conversationScopeId: 'tab-a', completionStatus: 'completed' },
    { id: 'running-b', conversationScopeId: 'tab-b', completionStatus: 'running' },
    { id: 'pending-a', conversationScopeId: 'tab-a', completionStatus: 'pending' },
    { id: 'stopping-a', conversationScopeId: 'tab-a', completionStatus: 'stopping' }
  ]

  assert.equal(getActiveScopedAIChatRun(history, 'tab-a').id, 'stopping-a')
  assert.equal(getActiveScopedAIChatRun(history, 'tab-b').id, 'running-b')
  assert.equal(getActiveScopedAIChatRun(history, 'tab-c'), null)
})

test('cancels an ordinary streamed response once and preserves partial output', async () => {
  const { cancelScopedAIChatRun } = await import(moduleUrl)
  const calls = []
  const store = {
    aiChatHistory: [{
      id: 'chat-1',
      conversationScopeId: 'tab-a',
      completionStatus: 'running',
      response: 'partial answer',
      requestId: 'request-1',
      sessionId: 'stream-1'
    }]
  }

  const result = await cancelScopedAIChatRun({
    store,
    item: store.aiChatHistory[0],
    cancelDetachedStream: id => calls.push(['detached', id]),
    cancelRequest: async id => calls.push(['request', id]),
    stopStream: async id => calls.push(['stream', id]),
    stoppedText: '已由用户停止'
  })

  assert.equal(result.cancelled, true)
  assert.deepEqual(calls, [
    ['detached', 'chat-1'],
    ['request', 'request-1'],
    ['stream', 'stream-1']
  ])
  assert.equal(store.aiChatHistory[0].completionStatus, 'cancelled')
  assert.match(store.aiChatHistory[0].response, /partial answer/)
  assert.match(store.aiChatHistory[0].response, /已由用户停止/)

  const repeated = await cancelScopedAIChatRun({
    store,
    item: store.aiChatHistory[0],
    cancelRequest: async () => calls.push(['unexpected'])
  })
  assert.equal(repeated.cancelled, false)
  assert.equal(calls.some(call => call[0] === 'unexpected'), false)
})

test('deduplicates concurrent Agent cancellation and reports cancellation failure', async () => {
  const { cancelScopedAIChatRun } = await import(moduleUrl)
  const release = deferred()
  let calls = 0
  const store = {
    aiChatHistory: [{
      id: 'agent-1',
      conversationScopeId: 'tab-a',
      completionStatus: 'running',
      response: 'collected evidence',
      mode: 'agent'
    }]
  }
  const cancelAgent = async () => {
    calls += 1
    await release.promise
    throw new Error('remote cancellation not confirmed')
  }
  const options = {
    store,
    item: store.aiChatHistory[0],
    cancelAgent,
    stoppedText: '已由用户停止'
  }

  const first = cancelScopedAIChatRun(options)
  const second = cancelScopedAIChatRun(options)
  assert.equal(store.aiChatHistory[0].runState.status, 'cancelling')
  assert.equal(store.aiChatHistory[0].runState.phase, 'cancelling')
  release.resolve()
  const [firstResult, secondResult] = await Promise.all([first, second])

  assert.equal(calls, 1)
  assert.deepEqual(firstResult, secondResult)
  assert.equal(store.aiChatHistory[0].completionStatus, 'partially-completed')
  assert.equal(store.aiChatHistory[0].runState.status, 'cancel_failed')
  assert.equal(store.aiChatHistory[0].runState.phase, 'cancel_failed')
  assert.equal(store.aiChatHistory[0].runState.terminationReason, 'cancel_failed')
  assert.match(store.aiChatHistory[0].response, /remote cancellation not confirmed/)
})

test('confirmed Agent cancellation stores a cancelled runState', async () => {
  const { cancelScopedAIChatRun } = await import(moduleUrl)
  const store = {
    aiChatHistory: [{
      id: 'agent-confirmed-cancel',
      conversationScopeId: 'tab-a',
      completionStatus: 'running',
      response: 'evidence',
      mode: 'agent',
      runState: {
        status: 'running',
        phase: 'tool_execution',
        endpointFingerprint: 'endpoint-12345678',
        budget: { elapsedMs: 10, modelRequests: 1, toolCalls: 1 }
      }
    }]
  }

  const result = await cancelScopedAIChatRun({
    store,
    item: store.aiChatHistory[0],
    cancelAgent: async () => ({ cancelled: true }),
    stoppedText: 'stopped'
  })

  assert.equal(result.cancelled, true)
  assert.equal(store.aiChatHistory[0].completionStatus, 'cancelled')
  assert.deepEqual(store.aiChatHistory[0].runState, {
    status: 'cancelled',
    phase: 'cancelled',
    terminationReason: 'cancelled',
    errorCode: '',
    endpointFingerprint: 'endpoint-12345678',
    budget: { elapsedMs: 10, modelRequests: 1, toolCalls: 1 }
  })
})

test('keeps completed state when completion wins the cancellation race', async () => {
  const { cancelScopedAIChatRun } = await import(moduleUrl)
  const release = deferred()
  const store = {
    aiChatHistory: [{
      id: 'chat-race',
      conversationScopeId: 'tab-a',
      completionStatus: 'running',
      response: ''
    }]
  }

  const cancelling = cancelScopedAIChatRun({
    store,
    item: store.aiChatHistory[0],
    cancelRequest: () => release.promise,
    stoppedText: '已由用户停止'
  })
  store.aiChatHistory[0] = {
    ...store.aiChatHistory[0],
    completionStatus: 'completed',
    response: 'final answer'
  }
  release.resolve()

  const result = await cancelling
  assert.equal(result.cancelled, false)
  assert.equal(result.reason, 'completed')
  assert.equal(store.aiChatHistory[0].completionStatus, 'completed')
  assert.equal(store.aiChatHistory[0].response, 'final answer')
})

test('selects the newest active run from an already scoped history', async () => {
  const { getActiveAIChatRun } = await import(moduleUrl)
  const done = { id: 'done', completionStatus: 'completed' }
  const pending = { id: 'pending', completionStatus: 'pending' }
  const stopping = { id: 'stopping', completionStatus: 'stopping' }
  const scoped = [done, pending, stopping]

  assert.equal(getActiveAIChatRun(scoped), stopping)
  assert.equal(getActiveAIChatRun([done]), null)
})
