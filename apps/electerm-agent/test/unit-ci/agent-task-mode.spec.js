const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const taskModeModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/agent-task-mode.js')
).href
const confirmModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/agent-tool-confirm.js')
).href

test('Agent task mode prompt requires plan confirmation readonly execution and final report', async () => {
  const {
    buildAgentTaskModePrompt
  } = await import(taskModeModuleUrl)

  const prompt = buildAgentTaskModePrompt()

  assert.match(prompt, /分析计划/)
  assert.match(prompt, /用户确认/)
  assert.match(prompt, /只读命令/)
  assert.match(prompt, /总结报告/)
  assert.match(prompt, /confirm_agent_plan/)
})

test('Agent shared prompt keeps structured server diagnostics strictly readonly', async () => {
  const { buildAgentTaskModePrompt } = await import(taskModeModuleUrl)
  const prompt = buildAgentTaskModePrompt()

  assert.match(prompt, /summary.*steps.*expectedSignals.*stopConditions/s)
  assert.match(prompt, /classifyCommand|共享命令分类/)
  assert.match(prompt, /只读诊断/)
  assert.match(prompt, /不得执行.*修改|不允许.*修改/)
})

test('Agent command classifier separates readonly diagnostics from dangerous operations', async () => {
  const {
    classifyAgentCommand
  } = await import(taskModeModuleUrl)

  for (const command of [
    'df -hT',
    'journalctl -p warning -n 80',
    'docker ps -a',
    'kubectl get pods -A',
    'git status --short'
  ]) {
    const result = classifyAgentCommand(command)
    assert.equal(result.risk, 'readonly')
    assert.equal(result.needsSecondConfirmation, false)
  }

  for (const command of [
    'rm -rf /tmp/aigshell-test',
    'systemctl restart nginx',
    'kubectl delete pod nginx',
    'docker rm app',
    'git reset --hard HEAD'
  ]) {
    const result = classifyAgentCommand(command)
    assert.equal(result.risk, 'dangerous')
    assert.equal(result.needsSecondConfirmation, true)
  }
})

test('dangerous Agent commands require a second user confirmation', async () => {
  const {
    confirmAgentToolExecution
  } = await import(confirmModuleUrl)

  const messages = []
  const result = await confirmAgentToolExecution({
    toolName: 'send_terminal_command',
    args: {
      command: 'systemctl restart nginx'
    },
    confirm: message => {
      messages.push(message)
      return true
    }
  })

  assert.equal(result.accepted, true)
  assert.equal(result.risk, 'dangerous')
  assert.equal(messages.length, 2)
  assert.match(messages[1], /危险命令/)
  assert.match(messages[1], /二次确认/)
})

test('Agent tools expose plan confirmation and guard command tools until the plan is approved', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
    'utf8'
  )
  const agentSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
    'utf8'
  )

  assert.match(source, /name:\s*'confirm_agent_plan'/)
  assert.match(source, /ensureAgentPlanConfirmed/)
  assert.match(source, /case 'confirm_agent_plan':[\s\S]*markAgentPlanConfirmed/)
  assert.match(agentSource, /agentRuntime/)
  assert.match(agentSource, /executeToolCall\(toolCall\.function\.name, args, agentRuntime\)/)
})
