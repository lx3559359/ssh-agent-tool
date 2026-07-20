const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const copy = require(path.resolve(__dirname, '../../src/client/components/ai/ai-agent-copy.json'))
const aiChatSource = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/ai-chat.jsx'), 'utf8')
const aiHistoryItemSource = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'), 'utf8')
const aiCredentialSource = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/ai-request-credentials.js'), 'utf8')
const i18nModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/shellpilot-i18n-overrides.js'
)).href

test('AI panel copy uses Chinese labels for the SSH Agent product', () => {
  assert.equal(copy.modeLabels.ask, '对话')
  assert.equal(copy.modeLabels.agent, 'Agent')
  assert.equal(copy.inputPlaceholder, '输入你的问题，或让 Agent 分析当前 SSH 终端输出...')
  assert.equal(copy.runningTitle, 'Agent 正在执行，请稍候')
  assert.equal(copy.sendTitle, 'Enter 发送，Shift+Enter 换行')
  assert.equal(copy.clearHistoryTitle, '清空 AI 对话历史')
  assert.equal(copy.stopTitle, '停止当前 AI 请求')
  assert.equal(copy.copyPromptTitle, '复制问题')
  assert.equal(copy.copyAnswerTitle, '复制回答')
  assert.equal(copy.retryTitle, '重试')
  assert.equal(copy.deleteTitle, '删除')
})

test('Agent tool call copy is localized', () => {
  assert.equal(copy.toolCall.status.running, '执行中')
  assert.equal(copy.toolCall.status.completed, '已完成')
  assert.equal(copy.toolCall.status.error, '失败')
  assert.equal(copy.toolCall.argumentsLabel, '参数')
  assert.equal(copy.toolCall.resultLabel, '结果')
})

test('AI composer copy follows the active Chinese or English interface language', async () => {
  const { getShellPilotTranslation } = await import(i18nModuleUrl)
  const expected = {
    shellpilotAiInputPlaceholder: [
      '输入你的问题，或让 Agent 分析当前 SSH 终端输出...',
      'Ask a question, or let Agent analyze the current SSH terminal output...'
    ],
    shellpilotAiRunningTitle: [
      'Agent 正在执行，请稍候',
      'Agent is running. Please wait.'
    ],
    shellpilotAiSendTitle: [
      'Enter 发送，Shift+Enter 换行',
      'Press Enter to send; Shift+Enter for a new line'
    ],
    shellpilotAiClearHistoryTitle: [
      '清空 AI 对话历史',
      'Clear AI conversation history'
    ]
  }

  for (const [key, [chinese, english]] of Object.entries(expected)) {
    assert.equal(getShellPilotTranslation(key, 'zh_cn'), chinese)
    assert.equal(getShellPilotTranslation(key, 'en_us'), english)
  }

  assert.match(aiChatSource, /placeholder=\{e\('shellpilotAiInputPlaceholder'\)\}/)
  assert.match(aiChatSource, /title=\{e\('shellpilotAiRunningTitle'\)\}/)
  assert.match(aiChatSource, /title=\{e\('shellpilotAiSendTitle'\)\}/)
  assert.match(aiChatSource, /title=\{e\('shellpilotAiClearHistoryTitle'\)\}/)
})

test('Agent default rules are SSH operations focused and safety aware', () => {
  const rules = copy.agentPromptRules.join('\n')
  assert.match(rules, /AIGShell/)
  assert.match(rules, /当前终端/)
  assert.match(rules, /高风险命令/)
  assert.match(rules, /必须等待用户确认/)
  assert.match(rules, /中文/)
})

test('Agent chat keeps custom auth headers in the memory-only request reference', () => {
  assert.match(aiChatSource, /createAIRequestCredentialReference/)
  assert.doesNotMatch(aiChatSource, /'authHeaderNameAI'/)
  assert.match(aiCredentialSource, /'authHeaderNameAI'/)
  assert.match(aiHistoryItemSource, /authHeaderNameAI/)
})

test('normal AI chat passes custom API auth header to backend requests', () => {
  assert.match(
    aiHistoryItemSource,
    /window\.pre\.runGlobalAsync\(\s*'AIchat'[\s\S]*?true,\s*authHeaderNameAI,\s*requestId\s*\)/
  )
})
