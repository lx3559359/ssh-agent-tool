const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
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
