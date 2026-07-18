const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const taskModeModuleUrl = pathToFileURL(
  path.join(aiRoot, 'agent-task-mode.js')
).href

test('Agent task mode prefers zero-confirmation readonly exec and structured reads', async () => {
  const { buildAgentTaskModePrompt } = await import(taskModeModuleUrl)
  const prompt = buildAgentTaskModePrompt()

  assert.match(prompt, /简短分析/)
  assert.match(prompt, /结构化读取/)
  assert.match(prompt, /run_readonly_command/)
  assert.match(prompt, /目的.*影响.*结构化验证/s)
  assert.match(prompt, /读取成功.*不得.*get_terminal_status/s)
  assert.match(prompt, /不得调用.*通用计划确认/)
  assert.doesNotMatch(prompt, /confirm_agent_plan/)
})

test('Agent command classifier separates readonly diagnostics from dangerous operations', async () => {
  const { classifyAgentCommand } = await import(taskModeModuleUrl)

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

test('Agent tools remove the generic plan grant and expose readonly exec', () => {
  const source = fs.readFileSync(path.join(aiRoot, 'agent-tools.js'), 'utf8')
  const agentSource = fs.readFileSync(path.join(aiRoot, 'agent.js'), 'utf8')

  assert.match(source, /name:\s*'run_readonly_command'/)
  assert.doesNotMatch(source, /name:\s*'confirm_agent_plan'/)
  assert.doesNotMatch(source, /ensureAgentPlanAvailable/)
  assert.doesNotMatch(source, /ensureAgentPlanConfirmed/)
  assert.doesNotMatch(source, /commitAgentPlanCall/)
  assert.match(agentSource, /goal:\s*String\(chatEntry\.prompt\s*\|\|\s*'Agent SSH task'\)/)
  assert.doesNotMatch(agentSource, /planGrant:\s*null/)
})

test('readonly execution is not gated on runtime.planGrant', () => {
  const source = fs.readFileSync(path.join(aiRoot, 'agent-tools.js'), 'utf8')
  const readonlyCase = source.match(
    /case 'run_readonly_command':[\s\S]*?(?=\n\s*case '|\n\s*default:)/
  )?.[0] || ''

  assert.match(readonlyCase, /runReadonlyTool/)
  assert.doesNotMatch(readonlyCase, /planGrant|confirm/)
})
