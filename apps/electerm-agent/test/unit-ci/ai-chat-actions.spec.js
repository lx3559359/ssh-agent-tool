const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

test('AI chat actions build localized role prompts', async () => {
  const {
    buildAIChatRole
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))

  assert.equal(
    buildAIChatRole({
      roleAI: 'SSH 运维助手',
      languageAI: '简体中文'
    }),
    'SSH 运维助手; 请使用简体中文回复'
  )
  assert.equal(
    buildAIChatRole({
      roleAI: '',
      languageAI: '',
      getLangName: () => '简体中文'
    }),
    '你是中文 SSH 运维助手。; 请使用简体中文回复'
  )
})

test('AI chat actions copy the answer first and fall back to prompt', async () => {
  const {
    getAIChatCopyText
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))

  assert.equal(
    getAIChatCopyText({
      prompt: '查看磁盘',
      response: '磁盘使用率正常'
    }),
    '磁盘使用率正常'
  )
  assert.equal(
    getAIChatCopyText({
      prompt: '查看磁盘',
      response: '   '
    }),
    '查看磁盘'
  )
})

test('AI chat actions create a clean retry entry without stale stream state', async () => {
  const {
    createRetryChatEntry
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))

  const retry = createRetryChatEntry({
    id: 'old-chat',
    prompt: '解释 Nginx 报错',
    response: 'old answer',
    pending: false,
    isStreaming: true,
    sessionId: 'stream-1',
    mode: 'ask',
    toolCalls: [{ id: 'tool-1' }],
    modelAI: 'deepseek-chat',
    baseURLAI: 'https://api.deepseek.com',
    timestamp: 1
  }, {
    id: 'new-chat',
    timestamp: 2
  })

  assert.equal(retry.id, 'new-chat')
  assert.equal(retry.prompt, '解释 Nginx 报错')
  assert.equal(retry.response, '')
  assert.equal(retry.pending, true)
  assert.equal(retry.isStreaming, false)
  assert.equal(retry.sessionId, null)
  assert.deepEqual(retry.toolCalls, [])
  assert.equal(retry.modelAI, 'deepseek-chat')
  assert.equal(retry.timestamp, 2)
})

test('AI chat actions close orphaned running requests after an app restart', async () => {
  const {
    getInterruptedAIChatUpdate
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))

  assert.deepEqual(getInterruptedAIChatUpdate({
    completionStatus: 'running',
    pending: false,
    sessionId: '',
    requestId: '',
    response: 'partial answer'
  }), {
    pending: false,
    completionStatus: 'failed',
    requestId: '',
    response: 'partial answer\n\n**错误：** 上次请求因客户端退出或重启而中断，请重试。'
  })
  assert.equal(getInterruptedAIChatUpdate({
    completionStatus: 'running',
    sessionId: 'stream-can-resume'
  }), null)
  assert.equal(getInterruptedAIChatUpdate({
    completionStatus: 'pending',
    pending: true
  }), null)
})

test('AI chat actions clear conversation context from the store', async () => {
  const {
    clearAIChatContext
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))

  const store = {
    aiChatHistory: [{ id: 'chat-1' }]
  }

  clearAIChatContext(store)

  assert.deepEqual(store.aiChatHistory, [])
})

test('AI chat actions append new entries while keeping the newest history items', async () => {
  const {
    appendAIChatHistory
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))

  const store = {
    aiChatHistory: Array.from({ length: 100 }, (_, index) => ({
      id: `old-${index}`
    }))
  }

  appendAIChatHistory(store, {
    id: 'new-chat'
  }, 100)

  assert.equal(store.aiChatHistory.length, 100)
  assert.equal(store.aiChatHistory[0].id, 'old-1')
  assert.equal(store.aiChatHistory.at(-1).id, 'new-chat')
})

test('AI chat actions adopt legacy history into the active terminal scope', async () => {
  const {
    adoptLegacyAIChatHistoryScope,
    getAIChatHistoryForScope
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))
  const store = {
    aiChatHistory: [
      { id: 'legacy-complete', prompt: 'old question', response: 'old answer' },
      { id: 'legacy-partial', prompt: 'unfinished', response: '' },
      { id: 'scoped', conversationScopeId: 'tab-b', prompt: 'other', response: 'answer' }
    ]
  }

  assert.deepEqual(
    getAIChatHistoryForScope(store.aiChatHistory, 'tab-a').map(item => item.id),
    ['legacy-complete', 'legacy-partial']
  )
  assert.equal(adoptLegacyAIChatHistoryScope(store, 'tab-a'), true)
  assert.equal(store.aiChatHistory[0].conversationScopeId, 'tab-a')
  assert.equal(store.aiChatHistory[0].sourceTabId, 'tab-a')
  assert.equal(store.aiChatHistory[0].completionStatus, 'completed')
  assert.equal(store.aiChatHistory[1].completionStatus, undefined)
  assert.equal(adoptLegacyAIChatHistoryScope(store, 'tab-a'), false)
})

test('AI chat legacy migration only completes stable answered records', async () => {
  const {
    adoptLegacyAIChatHistoryScope
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))
  const store = {
    aiChatHistory: [
      { id: 'stable', prompt: 'question', response: 'answer' },
      { id: 'pending', prompt: 'question', response: 'partial', pending: true },
      { id: 'streaming', prompt: 'question', response: 'partial', isStreaming: true },
      { id: 'session', prompt: 'question', response: 'partial', sessionId: 'stream-1' },
      { id: 'request', prompt: 'question', response: 'partial', requestId: 'request-1' },
      { id: 'empty', prompt: 'question', response: '' }
    ]
  }

  assert.equal(adoptLegacyAIChatHistoryScope(store, 'tab-a'), true)
  assert.equal(store.aiChatHistory[0].completionStatus, 'completed')
  for (const item of store.aiChatHistory.slice(1)) {
    assert.equal(item.completionStatus, undefined, item.id)
  }
})

test('AI chat clear cancels active work before removing scoped history', async () => {
  const {
    cancelAndClearAIChatContext
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))
  const events = []
  const store = {
    aiChatHistory: [
      {
        id: 'ask-running',
        conversationScopeId: 'tab-a',
        completionStatus: 'running',
        requestId: 'request-1',
        sessionId: 'session-1'
      },
      {
        id: 'agent-running',
        conversationScopeId: 'tab-a',
        completionStatus: 'running',
        mode: 'agent'
      },
      {
        id: 'other-running',
        conversationScopeId: 'tab-b',
        completionStatus: 'running',
        requestId: 'request-other'
      }
    ]
  }

  await cancelAndClearAIChatContext(store, 'tab-a', {
    cancelAgent: id => events.push(['agent', id]),
    cancelDetachedStream: id => events.push(['detached', id]),
    cancelRequest: async id => events.push(['request', id]),
    stopStream: async id => events.push(['stream', id])
  })

  assert.deepEqual(events, [
    ['detached', 'ask-running'],
    ['detached', 'agent-running'],
    ['agent', 'agent-running'],
    ['request', 'request-1'],
    ['stream', 'session-1']
  ])
  assert.deepEqual(store.aiChatHistory.map(item => item.id), ['other-running'])
})

test('AI chat actions keep legacy history unscoped until a real terminal is active', async () => {
  const {
    adoptLegacyAIChatHistoryScope,
    getAIChatHistoryForScope
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))
  const store = {
    aiChatHistory: [
      { id: 'legacy', prompt: 'old question', response: 'possibly partial answer' }
    ]
  }

  assert.equal(adoptLegacyAIChatHistoryScope(store, 'global'), false)
  assert.equal(store.aiChatHistory[0].conversationScopeId, undefined)
  assert.deepEqual(
    getAIChatHistoryForScope(store.aiChatHistory, 'tab-later').map(item => item.id),
    ['legacy']
  )
})

test('AI chat history has both per-scope and global retention bounds', async () => {
  const { appendAIChatHistory } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/ai/ai-chat-actions.js'
  )))
  const store = { aiChatHistory: [] }

  for (let index = 0; index < 13; index += 1) {
    appendAIChatHistory(store, {
      id: `entry-${index}`,
      conversationScopeId: `tab-${index}`
    }, 2)
  }

  assert.equal(store.aiChatHistory.length, 10)
  assert.equal(store.aiChatHistory[0].id, 'entry-3')
  assert.equal(store.aiChatHistory.at(-1).id, 'entry-12')
})

test('AI chat retention never removes pending or running requests', async () => {
  const { appendAIChatHistory } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/ai/ai-chat-actions.js'
  )))
  const store = {
    aiChatHistory: [
      { id: 'running-a', conversationScopeId: 'tab-a', completionStatus: 'running' },
      { id: 'completed-a', conversationScopeId: 'tab-a', completionStatus: 'completed' },
      { id: 'pending-b', conversationScopeId: 'tab-b', pending: true },
      { id: 'completed-c', conversationScopeId: 'tab-c', completionStatus: 'completed' }
    ]
  }

  appendAIChatHistory(store, {
    id: 'new-a',
    conversationScopeId: 'tab-a',
    completionStatus: 'completed'
  }, 1)

  assert.deepEqual(
    store.aiChatHistory.map(item => item.id),
    ['running-a', 'pending-b', 'completed-c', 'new-a']
  )
})

test('AI chat history limits and clears only the active terminal scope', async () => {
  const {
    appendAIChatHistory,
    clearAIChatContext,
    getAIChatHistoryForScope
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))
  const store = {
    aiChatHistory: [
      { id: 'a-1', conversationScopeId: 'tab-a' },
      { id: 'b-1', conversationScopeId: 'tab-b' },
      { id: 'a-2', conversationScopeId: 'tab-a' },
      { id: 'b-2', conversationScopeId: 'tab-b' }
    ]
  }

  appendAIChatHistory(store, {
    id: 'a-3',
    conversationScopeId: 'tab-a'
  }, 2)

  assert.deepEqual(store.aiChatHistory.map(item => item.id), [
    'b-1',
    'a-2',
    'b-2',
    'a-3'
  ])
  assert.deepEqual(
    getAIChatHistoryForScope(store.aiChatHistory, 'tab-a').map(item => item.id),
    ['a-2', 'a-3']
  )

  clearAIChatContext(store, 'tab-a')
  assert.deepEqual(store.aiChatHistory.map(item => item.id), ['b-1', 'b-2'])
})

test('AI chat actions sanitize follow-up updates before they reach history', async () => {
  const actions = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))

  assert.equal(typeof actions.updateAIChatHistoryEntry, 'function')

  const store = {
    aiChatHistory: [{
      id: 'chat-1',
      prompt: 'keep this prompt'
    }]
  }
  actions.updateAIChatHistoryEntry(store, 'chat-1', {
    response: 'safe answer\nAuthorization: Bearer response-secret-value',
    toolCalls: [{
      status: 'completed',
      result: 'command output\nPROXY_URL=http://proxy-user:proxy-pass@proxy.example.com?token=proxy-secret\n    at run (agent.js:1:1)'
    }]
  })

  const serialized = JSON.stringify(store.aiChatHistory)
  assert.match(serialized, /keep this prompt|safe answer|command output/)
  assert.doesNotMatch(serialized, /response-secret-value|proxy-user|proxy-pass|proxy-secret|at run|agent\.js:/)
})

test('AI chat actions update only the changed history entry', async () => {
  const { updateAIChatHistoryEntry } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))
  const untouched = {
    id: 'chat-untouched',
    prompt: 'keep object identity',
    response: 'existing response'
  }
  const store = {
    aiChatHistory: [untouched, { id: 'chat-active', response: '' }]
  }

  updateAIChatHistoryEntry(store, 'chat-active', {
    response: 'next chunk\nAPI Key: fake-stream-secret'
  })

  assert.equal(store.aiChatHistory[0], untouched)
  assert.equal(store.aiChatHistory[1].response.includes('next chunk'), true)
  assert.doesNotMatch(store.aiChatHistory[1].response, /fake-stream-secret/)
})

test('agent and history response consumers use the sanitized history update boundary', () => {
  const agent = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
    'utf8'
  )
  const historyItem = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'),
    'utf8'
  )

  assert.match(agent, /updateAIChatHistoryEntry\(window\.store/)
  assert.doesNotMatch(agent, /Object\.assign\(window\.store\.aiChatHistory/)
  assert.match(historyItem, /updateAIChatHistoryEntry\(window\.store/)
  assert.doesNotMatch(
    historyItem,
    /window\.store\.aiChatHistory\[index\]\.(?:response|sessionId|pending)\s*=/
  )
  assert.match(historyItem, /createAIStoredTextAccumulator/)
  assert.match(historyItem, /\{\s*sanitized:\s*true\s*\}/)

  const output = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-output.jsx'),
    'utf8'
  )
  assert.match(output, /isStreaming\s*\?\s*\(/)
  assert.match(output, /ai-stream-plain-output/)
})
test('AI chat actions resolve the latest stream session id from store history', async () => {
  const {
    getAIChatStreamSessionId
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))

  const item = {
    id: 'chat-1',
    sessionId: null
  }
  const store = {
    aiChatHistory: [
      {
        id: 'chat-1',
        sessionId: 'stream-current'
      }
    ]
  }

  assert.equal(getAIChatStreamSessionId(item, store), 'stream-current')
  assert.equal(getAIChatStreamSessionId({ id: 'chat-2', sessionId: 'stream-original' }, store), 'stream-original')
})
