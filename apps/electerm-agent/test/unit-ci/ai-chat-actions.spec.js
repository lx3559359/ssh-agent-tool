const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { pathToFileURL } = require('node:url')

function deferred () {
  let resolvePromise
  const promise = new Promise(resolve => { resolvePromise = resolve })
  return { promise, resolve: resolvePromise }
}

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
    '请使用简体中文回复'
  )
})

test('AI chat actions remove the legacy built-in SSH operations role from ordinary chat', async () => {
  const {
    buildAIChatRole
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))

  assert.equal(
    buildAIChatRole({
      roleAI: 'SSH 运维专家，优先排查服务器、网络、日志、进程、端口、磁盘、内存、Nginx、Docker 和部署问题。回答使用中文和 Markdown。',
      languageAI: '简体中文'
    }),
    '请使用简体中文回复'
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

test('AI chat history migrates legacy trace fields to metadata-only persistence', async () => {
  const {
    appendAIChatHistory,
    getAIChatTraceId,
    updateAIChatHistoryEntry
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))
  const legacyTraceId = 'sp-1784304000000-12345678'
  const appendedTraceId = 'sp-1784304000001-87654321'
  const store = {
    aiChatHistory: [{
      id: 'legacy-trace',
      traceId: legacyTraceId,
      traceContext: {
        traceId: legacyTraceId,
        requestId: 'legacy-request',
        password: 'must-not-persist'
      },
      metadata: { source: 'legacy' }
    }, {
      id: 'active-trace-write',
      response: ''
    }]
  }

  assert.equal(getAIChatTraceId(store.aiChatHistory[0]), legacyTraceId)
  updateAIChatHistoryEntry(store, 'active-trace-write', { response: 'updated' })
  assert.equal(store.aiChatHistory[0].traceId, undefined)
  assert.equal(store.aiChatHistory[0].traceContext, undefined)
  assert.deepEqual(store.aiChatHistory[0].metadata, {
    source: 'legacy',
    traceId: legacyTraceId
  })
  appendAIChatHistory(store, {
    id: 'appended-trace',
    traceId: appendedTraceId,
    traceContext: { traceId: appendedTraceId, password: 'must-not-persist' }
  })

  assert.deepEqual(store.aiChatHistory[0].metadata, {
    source: 'legacy',
    traceId: legacyTraceId
  })
  assert.equal(store.aiChatHistory[0].traceId, undefined)
  assert.equal(store.aiChatHistory[0].traceContext, undefined)
  assert.equal(store.aiChatHistory[1].response, 'updated')
  assert.deepEqual(store.aiChatHistory[2].metadata, { traceId: appendedTraceId })
  assert.equal(store.aiChatHistory[2].traceId, undefined)
  assert.equal(store.aiChatHistory[2].traceContext, undefined)
  assert.doesNotMatch(JSON.stringify(store.aiChatHistory), /must-not-persist|legacy-request/)
})

test('AI restart recovery emits one interrupted terminal for chat and Agent requests', async () => {
  const {
    recoverInterruptedAIChatEntry
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))
  const events = []
  const store = {
    aiChatHistory: [
      {
        id: 'chat-interrupted',
        mode: 'ask',
        completionStatus: 'running',
        pending: false,
        sessionId: '',
        requestId: 'chat-request',
        metadata: { traceId: 'sp-1784304000002-12345678' }
      },
      {
        id: 'agent-interrupted',
        mode: 'agent',
        completionStatus: 'running',
        pending: false,
        sessionId: '',
        traceId: 'sp-1784304000003-87654321'
      }
    ]
  }
  const options = {
    recordQualityEvent: (context, event) => {
      events.push({ context, event })
      return true
    }
  }

  for (const item of [...store.aiChatHistory]) {
    assert.equal(recoverInterruptedAIChatEntry(store, item, options), true)
    assert.equal(recoverInterruptedAIChatEntry(store, item, options), false)
  }

  assert.deepEqual(events.map(entry => [
    entry.context.traceId,
    entry.context.requestId || entry.context.taskId,
    entry.event.action,
    entry.event.phase,
    entry.event.result
  ]), [
    ['sp-1784304000002-12345678', 'chat-request', 'chat', 'interrupted', 'interrupted'],
    ['sp-1784304000003-87654321', 'agent-interrupted', 'agent', 'interrupted', 'interrupted']
  ])
  assert.deepEqual(
    store.aiChatHistory.map(item => item.completionStatus),
    ['failed', 'failed']
  )
  assert.equal(store.aiChatHistory[1].traceId, undefined)
  assert.deepEqual(store.aiChatHistory[1].metadata, {
    traceId: 'sp-1784304000003-87654321'
  })
})

test('AI startup interrupts a persisted stream session exactly once', async () => {
  const {
    normalizeAIChatHistoryOnStartup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))
  const events = []
  const options = {
    recordQualityEvent: (context, event) => {
      events.push({ context, event })
      return true
    }
  }
  const history = [{
    id: 'stream-from-previous-process',
    mode: 'ask',
    completionStatus: 'running',
    pending: false,
    isStreaming: true,
    sessionId: 'old-main-process-session',
    requestId: '',
    response: 'partial stream output',
    metadata: { traceId: 'sp-1784304000004-12345678' }
  }]

  const recovered = normalizeAIChatHistoryOnStartup(history, options)
  const recoveredAgain = normalizeAIChatHistoryOnStartup(recovered, options)

  assert.equal(recovered[0].completionStatus, 'failed')
  assert.equal(recovered[0].sessionId, null)
  assert.equal(recovered[0].requestId, '')
  assert.equal(recovered[0].isStreaming, false)
  assert.match(recovered[0].response, /partial stream output/)
  assert.deepEqual(recoveredAgain, recovered)
  assert.deepEqual(events.map(entry => [
    entry.context.traceId,
    entry.context.requestId || entry.context.sessionId,
    entry.event.action,
    entry.event.phase,
    entry.event.result
  ]), [[
    'sp-1784304000004-12345678',
    'old-main-process-session',
    'chat',
    'interrupted',
    'interrupted'
  ]])
})

test('AI startup migrates completed global legacy traces before persistence watch starts', async () => {
  const {
    normalizeAIChatHistoryOnStartup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))
  const legacyTraceId = 'sp-1784304000005-87654321'
  const legacyHistory = [{
    id: 'completed-global-legacy',
    completionStatus: 'completed',
    traceId: legacyTraceId,
    traceContext: {
      traceId: legacyTraceId,
      password: 'must-not-survive-startup'
    },
    response: 'completed answer'
  }]
  const normalized = normalizeAIChatHistoryOnStartup(legacyHistory)

  assert.equal(normalized[0].completionStatus, 'completed')
  assert.equal(normalized[0].traceId, undefined)
  assert.equal(normalized[0].traceContext, undefined)
  assert.deepEqual(normalized[0].metadata, { traceId: legacyTraceId })
  assert.doesNotMatch(JSON.stringify(normalized), /must-not-survive-startup/)

  const loadData = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/load-data.js'),
    'utf8'
  )
  assert.match(
    loadData,
    /refsStatic\.add\('oldState-' \+ name, dt\)[\s\S]{0,600}normalizeAIChatHistoryOnStartup\(dt\)/
  )
  assert.match(
    loadData,
    /Object\.assign\(store, ext\)[\s\S]{0,400}initWatch\(store\)/
  )

  const { persistStateSnapshot } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/store/state-persistence-queue.js'
  )))
  const { default: dataCompare } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/common/data-compare.js'
  )))
  const upserts = []
  await persistStateSnapshot({
    oldState: legacyHistory,
    snapshot: normalized,
    getChanges: dataCompare,
    removeItem: () => {},
    upsertItem: item => upserts.push(item),
    writeOrder: () => {}
  })
  assert.deepEqual(upserts, normalized)
})

test('AI startup migration replaces legacy NeDB plaintext with one encrypted record', async () => {
  const {
    normalizeAIChatHistoryOnStartup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))
  const { persistStateSnapshot } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/store/state-persistence-queue.js'
  )))
  const { default: dataCompare } = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/common/data-compare.js'
  )))
  const { createDb } = require('../../src/app/lib/nedb')
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-ai-history-migration-'))
  const traceId = 'sp-1784304000006-12345678'
  const password = 'legacy-plaintext-password'
  const legacyRecord = {
    _id: 'legacy-ai-history',
    completionStatus: 'completed',
    response: 'completed response',
    traceId,
    traceContext: {
      traceId,
      password
    },
    password
  }
  const enc = value => Buffer.from(value, 'utf8').toString('base64')
  const dec = value => Buffer.from(value, 'base64').toString('utf8')

  const legacyDb = createDb(appPath, 'default_user')
  await legacyDb.dbAction('aiChatHistory', 'insert', legacyRecord)

  const encryptedDb = createDb(appPath, 'default_user', { enc, dec })
  const loaded = await encryptedDb.dbAction('aiChatHistory', 'find', {})
  const oldState = loaded.map(({ _id, ...item }) => ({ id: _id, ...item }))
  const normalized = normalizeAIChatHistoryOnStartup(oldState)

  await persistStateSnapshot({
    oldState,
    snapshot: normalized,
    getChanges: dataCompare,
    removeItem: () => {},
    upsertItem: item => {
      const { id, ...value } = item
      return encryptedDb.dbAction(
        'aiChatHistory',
        'update',
        { _id: id },
        { $set: value },
        { upsert: true }
      )
    },
    writeOrder: () => {}
  })

  const rawDb = createDb(appPath, 'default_user')
  const rawRecord = await rawDb.dbAction('aiChatHistory', 'findOne', {
    _id: legacyRecord._id
  })
  assert.deepEqual(Object.keys(rawRecord).sort(), ['_encdata', '_id'])

  const reopenedDb = createDb(appPath, 'default_user', { enc, dec })
  const migrated = await reopenedDb.dbAction('aiChatHistory', 'findOne', {
    _id: legacyRecord._id
  })
  assert.equal(migrated.traceId, undefined)
  assert.equal(migrated.traceContext, undefined)
  assert.equal(migrated.password, undefined)
  assert.deepEqual(migrated.metadata, { traceId })
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
  const qualityEvents = []
  const store = {
    aiChatHistory: [
      {
        id: 'ask-running',
        conversationScopeId: 'tab-a',
        completionStatus: 'running',
        requestId: 'request-1',
        sessionId: 'session-1',
        metadata: { traceId: 'sp-1784304000009-12345678' }
      },
      {
        id: 'agent-running',
        conversationScopeId: 'tab-a',
        completionStatus: 'running',
        mode: 'agent',
        metadata: { traceId: 'sp-1784304000010-87654321' }
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
    stopStream: async id => events.push(['stream', id]),
    recordQualityEvent: (context, event) => {
      qualityEvents.push({ context, event })
      return true
    }
  })

  assert.deepEqual(events, [
    ['detached', 'ask-running'],
    ['detached', 'agent-running'],
    ['agent', 'agent-running'],
    ['request', 'request-1'],
    ['stream', 'session-1']
  ])
  assert.deepEqual(qualityEvents.map(entry => [
    entry.context.traceId,
    entry.context.requestId || entry.context.sessionId || entry.context.taskId,
    entry.event.action,
    entry.event.phase,
    entry.event.result
  ]), [
    ['sp-1784304000009-12345678', 'request-1', 'chat', 'cancelled', 'cancelled'],
    ['sp-1784304000010-87654321', 'agent-running', 'agent', 'cancelled', 'cancelled']
  ])
  assert.deepEqual(store.aiChatHistory.map(item => item.id), ['other-running'])
})

test('AI chat clear and Stop share one cancelled terminal across repeated clears', async () => {
  const {
    cancelAIChatEntryLifecycle,
    cancelAndClearAIChatContext
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-actions.js')))
  assert.equal(typeof cancelAIChatEntryLifecycle, 'function')
  const qualityEvents = []
  const recordQualityEvent = (context, event) => {
    qualityEvents.push({ context, event })
    return true
  }
  const releaseCancellation = deferred()
  const store = {
    aiChatHistory: [
      {
        id: 'stop-first',
        conversationScopeId: 'tab-a',
        completionStatus: 'running',
        requestId: 'request-stop-first',
        metadata: { traceId: 'sp-1784304000011-12345678' }
      },
      {
        id: 'clear-no-session',
        conversationScopeId: 'tab-a',
        pending: true,
        requestId: 'request-no-session',
        metadata: { traceId: 'sp-1784304000012-12345678' }
      },
      {
        id: 'clear-with-session',
        conversationScopeId: 'tab-a',
        completionStatus: 'running',
        sessionId: 'session-clear',
        metadata: { traceId: 'sp-1784304000013-12345678' }
      }
    ]
  }

  assert.equal(cancelAIChatEntryLifecycle(store, store.aiChatHistory[0], {
    recordQualityEvent
  }), true)
  const clearing = cancelAndClearAIChatContext(store, 'tab-a', {
    cancelDetachedStream: () => {},
    cancelRequest: () => releaseCancellation.promise,
    stopStream: () => releaseCancellation.promise,
    recordQualityEvent
  })
  assert.equal(cancelAIChatEntryLifecycle(store, {
    id: 'clear-with-session'
  }, { recordQualityEvent }), false)
  const repeatedClear = cancelAndClearAIChatContext(store, 'tab-a', {
    recordQualityEvent
  })
  releaseCancellation.resolve()
  await Promise.all([clearing, repeatedClear])

  assert.deepEqual(qualityEvents.map(entry => [
    entry.context.traceId,
    entry.context.requestId || entry.context.sessionId,
    entry.event.phase
  ]), [
    ['sp-1784304000011-12345678', 'request-stop-first', 'cancelled'],
    ['sp-1784304000012-12345678', 'request-no-session', 'cancelled'],
    ['sp-1784304000013-12345678', 'session-clear', 'cancelled']
  ])
  assert.deepEqual(store.aiChatHistory, [])
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
  assert.match(
    historyItem,
    /recoverInterruptedAIChatEntry\(window\.store,\s*item\)/
  )
  assert.equal(
    (historyItem.match(/metadata:\s*\{\s*traceId:\s*traceContext\.traceId\s*\}/g) || []).length,
    2
  )

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
