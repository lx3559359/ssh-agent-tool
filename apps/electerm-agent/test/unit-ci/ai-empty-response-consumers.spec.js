const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')
const asyncResultUrl = pathToFileURL(path.join(
  root,
  'src/client/common/async-result.js'
)).href

function toDataUrl (source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

async function importStreamConsumer () {
  const source = read('src/client/components/ai/ai-chat-history-item.jsx')
  const start = source.indexOf('export function buildAIRequestFailureText')
  const componentStart = /\r?\n\r?\nexport default (?:memo\()?function AIChatHistoryItem/.exec(source.slice(start))
  const end = componentStart ? start + componentStart.index : -1

  assert.notEqual(start, -1, 'stream consumer must be exported from the real history item module')
  assert.notEqual(end, -1, 'stream consumer must end before the history item component')

  const functionSource = source.slice(start, end)
  return import(toDataUrl(`
    import { normalizeAsyncResult } from ${JSON.stringify(asyncResultUrl)}
    const aiAgentCopy = { errorLabel: 'Error' }
    const sanitizeAIStoredText = value => String(value ?? '')
    const createAIStoredTextAccumulator = () => ({
      sanitize: value => String(value ?? '')
    })
    const updateAIChatHistoryEntry = (store, id, updates) => {
      const index = store.aiChatHistory.findIndex(item => item.id === id)
      if (index === -1) return false
      store.aiChatHistory[index] = { ...store.aiChatHistory[index], ...updates }
      store.aiChatHistory = [...store.aiChatHistory]
      return true
    }
    ${functionSource}
  `))
}

async function importAgentModule () {
  let source = read('src/client/components/ai/agent.js')
  source = source
    .replace(
      /^import \{\r?\n\s*agentTools,\r?\n\s*executeToolCall,\r?\n\s*failAgentRiskBatch,\r?\n\s*prepareAgentRiskBatch\r?\n\} from '\.\/agent-tools'\r?\n/m,
      'const agentTools = []\n' +
      'const executeToolCall = (...args) => globalThis.__executeToolCall?.(...args) ?? \'\'\n' +
      'const failAgentRiskBatch = async () => null\n' +
      'const prepareAgentRiskBatch = async () => null\n'
    )
    .replace(
      /^import \{\r?\n\s*createAgentToolObservation,\r?\n\s*serializeAgentObservationForModel\r?\n\} from '\.\/agent-observation\.js'\r?\n/m,
      'const createAgentToolObservation = (toolName, value) => ({\n' +
      "  kind: 'untrusted-observation', toolName, data: String(value ?? '')\n" +
      '})\n' +
      'const serializeAgentObservationForModel = value => JSON.stringify(value)\n'
    )
    .replace(
      /^import \{ buildAgentSkillPrompt \} from '\.\/agent-skills'\r?\n/m,
      "const buildAgentSkillPrompt = () => ''\n"
    )
    .replace(
      /^import \{ selectAgentSkills \} from '\.\/agent-skill-selector\.js'\r?\n/m,
      'const selectAgentSkills = async () => ({\n' +
      '  catalog: [], selected: [], skillBindings: [], artifactDigests: []\n' +
      '})\n'
    )
    .replace(
      /^import \{ buildAgentMcpServerPrompt \} from '\.\/agent-mcp-servers'\r?\n/m,
      "const buildAgentMcpServerPrompt = () => ''\n"
    )
    .replace(
      /^import \{ buildAgentLocalCliPrompt \} from '\.\/agent-local-cli-tools'\r?\n/m,
      "const buildAgentLocalCliPrompt = () => ''\n"
    )
    .replace(
      /^import \{ buildAgentTaskModePrompt \} from '\.\/agent-task-mode\.js'\r?\n/m,
      "const buildAgentTaskModePrompt = () => ''\n"
    )
    .replace(
      /^import \{\r?\n\s*sanitizeAIChatHistory,\r?\n\s*sanitizeAIStoredText\r?\n\} from '\.\/ai-request-credentials\.js'\r?\n/m,
      'const sanitizeAIStoredText = value => String(value ?? \'\')\n' +
      'const sanitizeAIChatHistory = value => value\n'
    )
    .replace(
      /^import \{ updateAIChatHistoryEntry \} from '\.\/ai-chat-actions'\r?\n/m,
      `const updateAIChatHistoryEntry = (store, id, updates) => {
  const index = store.aiChatHistory.findIndex(item => item.id === id)
  if (index !== -1) {
    Object.assign(store.aiChatHistory[index], updates)
    store.aiChatHistory = [...store.aiChatHistory]
  }
}\n`
    )
    .replace(
      /^import \{ buildAIConversationMessages \} from '\.\/ai-conversation-context'\r?\n/m,
      "const buildAIConversationMessages = (history, entry) => [{ role: 'user', content: entry.prompt }]\n"
    )
    .replace(
      /^import \{\r?\n\s*boundAgentToolResult,\r?\n\s*buildBoundedAgentMessages,\r?\n\s*cancelAgentRuntimeOperations,\r?\n\s*resolveAgentRuntimeEndpoint\r?\n\} from '\.\/agent-runtime-context\.js'\r?\n/m,
      'const boundAgentToolResult = value => typeof value === \'string\' ? value : JSON.stringify(value)\n' +
      'const buildBoundedAgentMessages = (base, runtime) => [...base, ...runtime]\n' +
      'const cancelAgentRuntimeOperations = runtime => {\n' +
      '  for (const cancel of runtime.cancellations || []) cancel()\n' +
      '}\n' +
      'const resolveAgentRuntimeEndpoint = () => null\n'
    )
    .replace(
      /^import \{\r?\n\s*agentTakeoverRegistry\r?\n\} from '\.\/agent-takeover-registry\.js'\r?\n/m,
      'const agentTakeoverRegistry = { assertActive: () => ({ state: \'active-idle\' }) }\n'
    )
    .replace(
      /^import \{ agentTaskRegistry \} from '\.\/agent-task-registry\.js'\r?\n/m,
      `const __agentTasks = new Map()
const agentTaskRegistry = {
  register: entry => {
    if ([...__agentTasks.values()].some(item => item.scopeId === entry.scopeId)) {
      const error = new Error('busy')
      error.code = 'AI_AGENT_SESSION_BUSY'
      throw error
    }
    __agentTasks.set(String(entry.taskId), entry)
    return entry
  },
  unregister: id => __agentTasks.delete(String(id)),
  get: id => __agentTasks.get(String(id)),
  cancel: async id => {
    const key = String(id)
    const entry = __agentTasks.get(key)
    if (!entry) throw new Error('missing task')
    entry.controller?.abort?.()
    try {
      return await entry.runner.cancel(key)
    } finally {
      __agentTasks.delete(key)
    }
  },
  cancelByScope: async scopeId => {
    const matches = [...__agentTasks.values()].filter(entry => entry.scopeId === String(scopeId || ''))
    return Promise.all(matches.map(entry => agentTaskRegistry.cancel(entry.taskId)))
  }
}
`
    )
    .replace(
      /^import \{\r?\n\s*buildAgentCancellationUpdate,\r?\n\s*settleAgentCancellation\r?\n\} from '\.\/agent-cancellation-status\.js'\r?\n/m,
      `const buildAgentCancellationUpdate = ({ response = '', stoppedText = 'Stopped', error } = {}) => ({
  response: error
    ? response + '\\n\\n**Cancellation not confirmed:** ' + String(error)
    : response + '\\n\\n*(' + stoppedText + ')*',
  completionStatus: error ? 'partially-completed' : 'cancelled'
})
const settleAgentCancellation = async activeCancellation => {
  try {
    await activeCancellation
    return null
  } catch (error) {
    return error
  }
}
`
    )
    .replace(
      /^import aiAgentCopy from '\.\/ai-agent-copy\.json'\r?\n/m,
      `const aiAgentCopy = ${JSON.stringify({
        agentPromptRules: [],
        errorLabel: 'Error',
        stoppedText: 'Stopped',
        noResponseText: 'No response',
        maxIterationsText: 'Maximum iterations reached'
      })}\n`
    )
    .replace(
      /^import \{ normalizeAsyncResult \} from '\.\.\/\.\.\/common\/async-result\.js'\r?\n/m,
      `import { normalizeAsyncResult } from ${JSON.stringify(asyncResultUrl)}\n`
    )

  assert.doesNotMatch(source, /^import .*from '\./m, 'all local agent imports must be stubbed')
  return import(toDataUrl(source))
}

test('stream polling normalizes null and undefined before consuming content or hasMore', async () => {
  const { consumeAIStreamPoll } = await importStreamConsumer()

  for (const emptyResponse of [null, undefined]) {
    const events = []
    const result = await consumeAIStreamPoll({
      request: async () => emptyResponse,
      isActive: () => true,
      onResponse: response => events.push(['response', response]),
      onError: error => events.push(['error', error])
    })

    assert.deepEqual(result, { ok: false, data: null, error: 'empty-response' })
    assert.deepEqual(events, [['error', 'empty-response']])
  }
})

test('stream polling ignores an in-flight result after component disposal', async () => {
  const { consumeAIStreamPoll } = await importStreamConsumer()
  let active = true
  let resolveRequest
  const events = []
  const request = new Promise(resolve => {
    resolveRequest = resolve
  })
  const pending = consumeAIStreamPoll({
    request: () => request,
    isActive: () => active,
    onResponse: response => events.push(['response', response]),
    onError: error => events.push(['error', error])
  })

  active = false
  resolveRequest({ content: 'late response', hasMore: true })

  assert.deepEqual(
    await pending,
    {
      ok: true,
      data: { content: 'late response', hasMore: true },
      error: ''
    }
  )
  assert.deepEqual(events, [])
})

test('initial AI chat normalizes null and undefined into diagnostic errors', async () => {
  const { consumeAIChatRequest } = await importStreamConsumer()

  assert.equal(typeof consumeAIChatRequest, 'function', 'initial AI chat consumer must be exported')
  for (const emptyResponse of [null, undefined]) {
    const events = []
    const result = await consumeAIChatRequest({
      request: async () => emptyResponse,
      isActive: () => true,
      onResponse: response => events.push(['response', response]),
      onError: error => events.push(['error', error])
    })

    assert.deepEqual(result, { ok: false, data: null, error: 'empty-response' })
    assert.deepEqual(events, [['error', 'empty-response']])
  }
})

test('initial AI chat preserves a successful streaming session response', async () => {
  const { consumeAIChatRequest } = await importStreamConsumer()
  const streamResponse = {
    isStream: true,
    sessionId: 'stream-1',
    content: 'partial'
  }
  const responses = []

  assert.equal(typeof consumeAIChatRequest, 'function', 'initial AI chat consumer must be exported')
  const result = await consumeAIChatRequest({
    request: async () => streamResponse,
    isActive: () => true,
    onResponse: response => responses.push(response),
    onError: error => assert.fail(`unexpected AI chat error: ${error}`)
  })

  assert.deepEqual(result, { ok: true, data: streamResponse, error: '' })
  assert.equal(responses[0], streamResponse)
})

test('history item stops a known stream only after an explicit stop action', async () => {
  const { stopAIStreamSafely } = await importStreamConsumer()
  const stoppedSessions = []
  const stopErrors = []

  assert.equal(typeof stopAIStreamSafely, 'function')
  await assert.doesNotReject(() => stopAIStreamSafely({
    sessionId: 'known-session',
    stopStream: async sessionId => {
      stoppedSessions.push(sessionId)
      throw new Error('stop failed')
    },
    onError: error => stopErrors.push(error.message)
  }))

  assert.deepEqual(stoppedSessions, ['known-session'])
  assert.deepEqual(stopErrors, ['stop failed'])

  const source = read('src/client/components/ai/ai-chat-history-item.jsx')
  assert.match(
    source,
    /async function handleStop[\s\S]*?getAIChatStreamSessionId\(item,\s*window\.store\)[\s\S]*?runGlobalAsync\('stopStream'/
  )
  const effectStart = source.indexOf('useEffect(() => {')
  const effectEnd = source.indexOf('\n  async function handleStop', effectStart)
  assert.doesNotMatch(source.slice(effectStart, effectEnd), /stopStream|AIChatCancel/)
})

test('late async chat updates cannot overwrite an explicit cancelled state', async () => {
  const { shouldApplyAIChatAsyncUpdate } = await importStreamConsumer()
  const store = {
    aiChatHistory: [
      { id: 'running', completionStatus: 'running' },
      { id: 'cancelled', completionStatus: 'cancelled' }
    ]
  }

  assert.equal(shouldApplyAIChatAsyncUpdate(store, 'running'), true)
  assert.equal(shouldApplyAIChatAsyncUpdate(store, 'cancelled'), false)
  assert.equal(shouldApplyAIChatAsyncUpdate(store, 'missing'), false)
})

test('detached AI stream persists the final answer while the panel is closed', async () => {
  const { startDetachedAIStream } = await importStreamConsumer()
  const store = {
    aiChatHistory: [{ id: 'detached', completionStatus: 'running', response: '' }]
  }
  const responses = [
    {
      content: 'first',
      offset: 0,
      nextOffset: 5,
      incremental: true,
      hasMore: true
    },
    {
      content: ' final',
      offset: 5,
      nextOffset: 11,
      incremental: true,
      hasMore: false
    }
  ]

  await startDetachedAIStream({
    chatId: 'detached',
    sessionId: 'session-detached',
    store,
    request: async () => responses.shift()
  })

  assert.equal(store.aiChatHistory[0].response, 'first final')
  assert.equal(store.aiChatHistory[0].completionStatus, 'completed')
  assert.equal(responses.length, 0)
})

test('detached AI stream ignores a late response after explicit cancellation', async () => {
  const {
    cancelDetachedAIStream,
    startDetachedAIStream
  } = await importStreamConsumer()
  let resolveRequest
  let requestStarted
  const started = new Promise(resolve => { requestStarted = resolve })
  const response = new Promise(resolve => { resolveRequest = resolve })
  const store = {
    aiChatHistory: [{ id: 'detached-cancel', completionStatus: 'running', response: '' }]
  }

  const pending = startDetachedAIStream({
    chatId: 'detached-cancel',
    sessionId: 'session-cancel',
    store,
    request: async () => {
      requestStarted()
      return response
    }
  })
  await started
  store.aiChatHistory[0].completionStatus = 'cancelled'
  cancelDetachedAIStream('detached-cancel')
  resolveRequest({
    content: 'late answer',
    offset: 0,
    nextOffset: 11,
    incremental: true,
    hasMore: false
  })
  await pending

  assert.equal(store.aiChatHistory[0].response, '')
  assert.equal(store.aiChatHistory[0].completionStatus, 'cancelled')
})

test('history item persists the initial request id and resumes detached streams', () => {
  const source = read('src/client/components/ai/ai-chat-history-item.jsx')

  assert.match(source, /completionStatus:\s*'running',\s*\n\s*requestId/)
  assert.match(source, /getAIChatRequestId\(item,\s*window\.store\)/)
  assert.match(source, /onInactiveResponse:\s*aiResponse\s*=>[\s\S]{0,900}startDetachedAIStream\(/)
  assert.match(source, /return \(\) => \{[\s\S]{0,700}startDetachedAIStream\(/)
})

test('history item treats persisted completion status as authoritative after remount', () => {
  const source = read('src/client/components/ai/ai-chat-history-item.jsx')

  assert.match(source, /const requestIsRunning = item\.completionStatus === 'running' && isStreaming/)
  assert.match(source, /if \(!requestIsRunning\)[\s\S]{0,120}return null/)
  assert.match(source, /const retryDisabled = requestIsRunning/)
  assert.match(source, /if \(latest\?\.completionStatus !== 'running'\)[\s\S]{0,160}return/)
})

test('initial request rejection after disposal persists a failed state', () => {
  const source = read('src/client/components/ai/ai-chat-history-item.jsx')
  const catchStart = source.indexOf('    } catch (error) {', source.indexOf('const startRequest'))
  const catchEnd = source.indexOf('    } finally {', catchStart)
  const catchSource = source.slice(catchStart, catchEnd)

  assert.match(catchSource, /!isActive\(\)[\s\S]*shouldApplyAIChatAsyncUpdate\(window\.store, item\.id\)[\s\S]*markRequestFailed\(error\)/)
})

test('AI chat clear action uses the cancellation-aware boundary', () => {
  const source = read('src/client/components/ai/ai-chat.jsx')

  assert.match(source, /cancelAndClearAIChatContext\(window\.store, conversationScopeId/)
  assert.match(source, /cancelAgent:\s*cancelAgentRun/)
  assert.match(source, /cancelDetachedStream:\s*cancelDetachedAIStream/)
  assert.match(source, /'AIChatCancel'/)
  assert.match(source, /'stopStream'/)
})

test('initial AI chat preserves a stream session that arrives after disposal', async () => {
  const { consumeAIChatRequest } = await importStreamConsumer()
  let active = true
  let resolveRequest
  const inactiveResponses = []
  const request = new Promise(resolve => {
    resolveRequest = resolve
  })
  const pending = consumeAIChatRequest({
    request: () => request,
    isActive: () => active,
    onResponse: response => assert.fail(`unexpected active response: ${response}`),
    onError: error => assert.fail(`unexpected AI chat error: ${error}`),
    onInactiveResponse: response => inactiveResponses.push(response)
  })

  active = false
  resolveRequest({
    isStream: true,
    sessionId: 'late-session',
    content: ''
  })

  assert.deepEqual(
    await pending,
    {
      ok: true,
      data: {
        isStream: true,
        sessionId: 'late-session',
        content: ''
      },
      error: ''
    }
  )
  assert.equal(inactiveResponses[0].sessionId, 'late-session')

  const source = read('src/client/components/ai/ai-chat-history-item.jsx')
  assert.match(
    source,
    /consumeAIChatRequest\(\{[\s\S]*?onInactiveResponse:[\s\S]*?sessionId:\s*aiResponse\.sessionId/
  )
})

test('stream polling exposes partial output before reporting a stream error', async () => {
  const { consumeAIStreamPoll } = await importStreamConsumer()
  const events = []

  await consumeAIStreamPoll({
    request: async () => ({ content: 'partial answer', error: 'network failed' }),
    isActive: () => true,
    onResponse: response => events.push(['response', response.content]),
    onError: error => events.push(['error', error])
  })

  assert.deepEqual(events, [
    ['response', 'partial answer'],
    ['error', 'network failed']
  ])
})

test('history item wires stream consumption to mounted state and timer cleanup', () => {
  const source = read('src/client/components/ai/ai-chat-history-item.jsx')

  assert.match(source, /const\s+isActive\s*=\s*\(\)\s*=>[\s\S]*?mountedRef\.current[\s\S]*?requestEpochRef\.current/)
  assert.match(source, /return\s*\(\)\s*=>\s*\{[\s\S]*?mountedRef\.current\s*=\s*false/)
  assert.match(source, /clearTimeout\(pollTimerRef\.current\)/)
})

test('history item routes the initial AIchat response through its normalized consumer', () => {
  const source = read('src/client/components/ai/ai-chat-history-item.jsx')

  assert.match(source, /consumeAIChatRequest\(\{[\s\S]*?runGlobalAsync\(\s*'AIchat'/)
  assert.doesNotMatch(source, /const\s+aiResponse\s*=\s*await\s+window\.pre\.runGlobalAsync\(\s*'AIchat'/)
})

test('agent loop returns a diagnostic empty response for null and undefined backend results', async () => {
  const { runAgentLoop } = await importAgentModule()

  for (const emptyResponse of [null, undefined]) {
    const chatEntry = { id: `empty-${String(emptyResponse)}`, prompt: 'check status' }
    const streaming = []
    global.window = {
      pre: {
        runGlobalAsync: async action => {
          assert.equal(action, 'AIchatWithTools')
          return emptyResponse
        }
      },
      store: {
        agentRunning: false,
        aiChatHistory: [chatEntry],
        config: {},
        getLangName: () => 'English'
      }
    }

    const result = await runAgentLoop(
      chatEntry,
      {},
      { current: false },
      value => streaming.push(value)
    )

    assert.deepEqual(result, { ok: false, data: null, error: 'empty-response' })
    assert.match(window.store.aiChatHistory[0].response, /empty-response/)
    assert.deepEqual(streaming, [true, false])
    assert.equal(window.store.agentRunning, false)
  }
})

test('agent loop ignores an in-flight backend result after cancellation', async () => {
  const { runAgentLoop } = await importAgentModule()
  let resolveBackend
  let markRequestStarted
  const requestStarted = new Promise(resolve => {
    markRequestStarted = resolve
  })
  const backendResult = new Promise(resolve => {
    resolveBackend = resolve
  })
  const chatEntry = { id: 'cancel-in-flight', prompt: 'check status' }
  const abortRef = { current: false }
  const streaming = []
  global.window = {
    pre: {
      runGlobalAsync: async action => {
        assert.equal(action, 'AIchatWithTools')
        markRequestStarted()
        return backendResult
      }
    },
    store: {
      agentRunning: false,
      aiChatHistory: [chatEntry],
      config: {},
      getLangName: () => 'English'
    }
  }

  const pending = runAgentLoop(
    chatEntry,
    {},
    abortRef,
    value => streaming.push(value)
  )
  await requestStarted
  abortRef.current = true
  resolveBackend({
    message: {
      role: 'assistant',
      content: 'late result',
      tool_calls: []
    }
  })

  assert.equal(await pending, undefined)
  assert.equal(window.store.aiChatHistory[0].completionStatus, 'cancelled')
  assert.doesNotMatch(window.store.aiChatHistory[0].response, /late result/)
  assert.deepEqual(streaming, [true, false])
  assert.equal(window.store.agentRunning, false)
})

test('agent cancellation releases the lock without waiting for a hung backend request', async () => {
  const { runAgentLoop } = await importAgentModule()
  let markRequestStarted
  const requestStarted = new Promise(resolve => {
    markRequestStarted = resolve
  })
  const neverFinishes = new Promise(() => {})
  const cancelledRequests = []
  const chatEntry = { id: 'cancel-hung-backend', sourceTabId: 'tab-a', prompt: 'check status' }
  const abortRef = { current: false }
  global.window = {
    pre: {
      runGlobalAsync: async (action, requestId) => {
        if (action === 'AIchatWithTools') {
          markRequestStarted()
          return neverFinishes
        }
        if (action === 'AIAgentCancel') {
          cancelledRequests.push(requestId)
          return { cancelled: true }
        }
        throw new Error(`unexpected action: ${action}`)
      }
    },
    store: {
      agentRunning: false,
      aiChatHistory: [chatEntry],
      config: {},
      getLangName: () => 'English'
    }
  }

  const pending = runAgentLoop(chatEntry, {}, abortRef, () => {})
  await requestStarted
  assert.equal(typeof abortRef.cancelCurrent, 'function')
  abortRef.cancelCurrent()

  await assert.doesNotReject(Promise.race([
    pending,
    new Promise((resolve, reject) => setTimeout(
      () => reject(new Error('Agent lock was not released after cancellation')),
      250
    ))
  ]))
  assert.equal(window.store.agentRunning, false)
  assert.equal(window.store.aiChatHistory[0].completionStatus, 'cancelled')
  assert.equal(cancelledRequests.length, 1)
})

test('takeover stop cancels only the Agent run bound to that terminal scope', async () => {
  const {
    cancelAgentRunsForScope,
    isAgentRunActive,
    runAgentLoop
  } = await importAgentModule()
  let markRequestStarted
  const requestStarted = new Promise(resolve => {
    markRequestStarted = resolve
  })
  const neverFinishes = new Promise(() => {})
  const chatEntry = {
    id: 'cancel-by-terminal-scope',
    sourceTabId: 'tab-a',
    prompt: 'check status'
  }
  global.window = {
    pre: {
      runGlobalAsync: async action => {
        if (action === 'AIchatWithTools') {
          markRequestStarted()
          return neverFinishes
        }
        if (action === 'AIAgentCancel') return { cancelled: true }
        throw new Error(`unexpected action: ${action}`)
      }
    },
    store: {
      agentRunning: false,
      aiChatHistory: [chatEntry],
      config: {},
      getLangName: () => 'English'
    }
  }

  const pending = runAgentLoop(chatEntry, {}, { current: false }, () => {})
  await requestStarted
  assert.deepEqual(await cancelAgentRunsForScope('tab-b'), [])
  assert.equal(isAgentRunActive(chatEntry.id), true)
  assert.equal((await cancelAgentRunsForScope('tab-a')).length, 1)

  await assert.doesNotReject(Promise.race([
    pending,
    new Promise((resolve, reject) => setTimeout(
      () => reject(new Error('Scoped takeover stop did not cancel the Agent run')),
      250
    ))
  ]))
  assert.equal(isAgentRunActive(chatEntry.id), false)
  assert.equal(window.store.aiChatHistory[0].completionStatus, 'cancelled')
})

test('agent loop ignores an in-flight tool result after cancellation', async () => {
  const { runAgentLoop } = await importAgentModule()
  let resolveTool
  let markToolStarted
  const toolStarted = new Promise(resolve => {
    markToolStarted = resolve
  })
  const toolResult = new Promise(resolve => {
    resolveTool = resolve
  })
  const chatEntry = { id: 'cancel-tool-in-flight', prompt: 'check disk' }
  const abortRef = { current: false }
  const streaming = []
  global.__executeToolCall = async () => {
    markToolStarted()
    return toolResult
  }
  global.window = {
    pre: {
      runGlobalAsync: async action => {
        assert.equal(action, 'AIchatWithTools')
        return {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'tool-1',
                function: {
                  name: 'run_command',
                  arguments: '{"command":"df -h"}'
                }
              }
            ]
          }
        }
      }
    },
    store: {
      agentRunning: false,
      aiChatHistory: [chatEntry],
      config: {},
      getLangName: () => 'English'
    }
  }

  try {
    const pending = runAgentLoop(
      chatEntry,
      {},
      abortRef,
      value => streaming.push(value)
    )
    await toolStarted
    abortRef.current = true
    resolveTool('late tool result')

    assert.equal(await pending, undefined)
    assert.equal(window.store.aiChatHistory[0].completionStatus, 'cancelled')
    assert.doesNotMatch(window.store.aiChatHistory[0].response, /late tool result/)
    assert.deepEqual(streaming, [true, false])
    assert.equal(window.store.agentRunning, false)
  } finally {
    delete global.__executeToolCall
  }
})

test('agent cancellation releases the lock without waiting for a hung tool call', async () => {
  const { runAgentLoop } = await importAgentModule()
  let markToolStarted
  const toolStarted = new Promise(resolve => {
    markToolStarted = resolve
  })
  const neverFinishes = new Promise(() => {})
  const chatEntry = { id: 'cancel-hung-tool', sourceTabId: 'tab-a', prompt: 'check disk' }
  const abortRef = { current: false }
  global.__executeToolCall = async () => {
    markToolStarted()
    return neverFinishes
  }
  global.window = {
    pre: {
      runGlobalAsync: async action => {
        if (action === 'AIchatWithTools') {
          return {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                id: 'tool-hung',
                function: {
                  name: 'send_terminal_command',
                  arguments: '{"command":"sleep 999"}'
                }
              }]
            }
          }
        }
        if (action === 'AIAgentCancel') return { cancelled: true }
        throw new Error(`unexpected action: ${action}`)
      }
    },
    store: {
      agentRunning: false,
      aiChatHistory: [chatEntry],
      config: {},
      getLangName: () => 'English'
    }
  }

  try {
    const pending = runAgentLoop(chatEntry, {}, abortRef, () => {})
    await toolStarted
    abortRef.cancelCurrent()
    await assert.doesNotReject(Promise.race([
      pending,
      new Promise((resolve, reject) => setTimeout(
        () => reject(new Error('Agent lock was not released after tool cancellation')),
        250
      ))
    ]))
    assert.equal(window.store.agentRunning, false)
    assert.equal(window.store.aiChatHistory[0].completionStatus, 'cancelled')
  } finally {
    delete global.__executeToolCall
  }
})
