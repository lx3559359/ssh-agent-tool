const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const actionsPath = path.resolve(
  __dirname,
  '../../src/client/components/ai/ai-conversation-context.js'
)

function readSource (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8')
}

test('conversation context keeps completed turns before the current follow-up', async () => {
  const { buildAIConversationMessages } = await import(pathToFileURL(actionsPath))
  const history = [
    {
      id: 'first',
      prompt: '查看网卡信息',
      response: '建议执行 ip addr，并等待确认。',
      pending: false,
      completionStatus: 'completed'
    },
    {
      id: 'current',
      prompt: '确认',
      response: '',
      pending: true
    }
  ]

  assert.deepEqual(
    buildAIConversationMessages(history, history[1]),
    [
      { role: 'user', content: '查看网卡信息' },
      { role: 'assistant', content: '建议执行 ip addr，并等待确认。' },
      { role: 'user', content: '确认' }
    ]
  )
})

test('conversation context excludes incomplete turns and bounds older history', async () => {
  const { buildAIConversationMessages } = await import(pathToFileURL(actionsPath))
  const history = [
    { id: 'old', prompt: '旧问题', response: '旧回答', pending: false, completionStatus: 'completed' },
    { id: 'running', prompt: '仍在执行', response: '', pending: false },
    { id: 'recent', prompt: '最近问题', response: '最近回答', pending: false, completionStatus: 'completed' },
    { id: 'current', prompt: '继续', response: '', pending: true }
  ]

  assert.deepEqual(
    buildAIConversationMessages(history, history[3], {
      maxTurns: 1,
      maxHistoryChars: 100
    }),
    [
      { role: 'user', content: '最近问题' },
      { role: 'assistant', content: '最近回答' },
      { role: 'user', content: '继续' }
    ]
  )
})

test('failed or cancelled retries keep the last completed answer for follow-ups', async () => {
  const { buildAIConversationMessages } = await import(pathToFileURL(actionsPath))

  for (const completionStatus of ['failed', 'cancelled']) {
    const history = [
      {
        id: 'original',
        timestamp: 10,
        conversationScopeId: 'tab-a',
        prompt: 'check the service',
        response: 'the service is running',
        completionStatus: 'completed'
      },
      {
        id: `retry-${completionStatus}`,
        timestamp: 20,
        retryOfId: 'original',
        retryOfTimestamp: 10,
        conversationScopeId: 'tab-a',
        prompt: 'check the service',
        response: 'request stopped',
        completionStatus
      },
      {
        id: `follow-up-${completionStatus}`,
        timestamp: 30,
        conversationScopeId: 'tab-a',
        prompt: 'continue from that result',
        response: '',
        completionStatus: 'pending'
      }
    ]

    assert.deepEqual(buildAIConversationMessages(history, history[2]), [
      { role: 'user', content: 'check the service' },
      { role: 'assistant', content: 'the service is running' },
      { role: 'user', content: 'continue from that result' }
    ])
  }
})

test('normal chat and Agent both send the shared conversation context', () => {
  const historyItem = readSource('src/client/components/ai/ai-chat-history-item.jsx')
  const agent = readSource('src/client/components/ai/agent.js')
  const backend = readSource('src/app/lib/ai.js')

  assert.match(historyItem, /buildAIConversationMessages\(window\.store\.aiChatHistory, item\)/)
  assert.match(historyItem, /'AIchat',\s*conversationMessages,/)
  assert.match(agent, /\.\.\.buildAIConversationMessages\(history, chatEntry\)/)
  assert.match(backend, /Array\.isArray\(promptOrMessages\)/)
})

test('user messages and assistant responses are visible without per-message folding', () => {
  const historyItem = readSource('src/client/components/ai/ai-chat-history-item.jsx')
  const styles = readSource('src/client/components/ai/ai.styl')

  assert.doesNotMatch(historyItem, /showOutput|toggleOutput|CaretDownOutlined|CaretRightOutlined/)
  assert.match(historyItem, /<AIOutput item=\{item\} isStreaming=\{requestIsRunning\} \/>/)
  assert.match(styles, /\.ai-history-item-prompt[\s\S]*?white-space pre-wrap/)
  assert.doesNotMatch(styles, /\.ai-history-item-prompt[\s\S]*?text-overflow ellipsis[\s\S]*?white-space nowrap/)
})
