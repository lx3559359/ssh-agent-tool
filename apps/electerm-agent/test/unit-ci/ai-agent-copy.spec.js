const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const copy = require(path.resolve(__dirname, '../../src/client/components/ai/ai-agent-copy.json'))
const aiChatSource = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/ai-chat.jsx'), 'utf8')
const aiHistoryItemSource = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'), 'utf8')

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

test('Agent default rules are SSH operations focused and safety aware', () => {
  const rules = copy.agentPromptRules.join('\n')
  assert.match(rules, /AIGShell/)
  assert.match(rules, /当前终端/)
  assert.match(rules, /高风险命令/)
  assert.match(rules, /必须等待用户确认/)
  assert.match(rules, /中文/)
})

test('Agent chat preserves custom API auth header configuration', () => {
  assert.match(aiChatSource, /'authHeaderNameAI'/)
  assert.match(aiHistoryItemSource, /authHeaderNameAI/)
})

test('normal AI chat passes custom API auth header to backend requests', () => {
  assert.match(
    aiHistoryItemSource,
    /window\.pre\.runGlobalAsync\(\s*'AIchat'[\s\S]*?true,\s*authHeaderNameAI\s*\)/
  )
})
