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

test('conversation plan confirmation stores an immutable grant instead of a boolean', async () => {
  const {
    commitAgentPlanCall,
    confirmAgentPlan,
    ensureAgentPlanConfirmed,
    markAgentPlanConfirmed
  } = await import(taskModeModuleUrl)
  const runtime = {}
  const confirmation = await confirmAgentPlan({
    args: {
      goal: 'inspect nginx',
      readonlyCommands: ['systemctl status nginx']
    },
    endpoint: {
      host: 'srv.test',
      port: 22,
      username: 'ops',
      tabId: 'tab-a',
      pid: 'pid-a',
      terminalPid: 'term-a',
      sessionType: 'ssh',
      hostKeyFingerprint: 'SHA256:abc'
    },
    confirm: () => true
  })
  markAgentPlanConfirmed(runtime, confirmation)

  assert.equal(runtime.planConfirmed, undefined)
  assert.match(runtime.planGrant.digest, /^[a-f0-9]{64}$/)
  assert.equal(await ensureAgentPlanConfirmed({
    toolName: 'send_terminal_command',
    args: { command: 'systemctl status nginx', tabId: 'tab-a' },
    runtime
  }), null)
  assert.equal(commitAgentPlanCall({
    toolName: 'send_terminal_command',
    args: { command: 'systemctl status nginx', tabId: 'tab-a' },
    runtime
  }), true)
  const repeated = await ensureAgentPlanConfirmed({
    toolName: 'send_terminal_command',
    args: { command: 'systemctl status nginx', tabId: 'tab-a' },
    runtime
  })
  assert.equal(repeated.reasonCode, 'PLAN_BINDING_CHANGED')
  const changed = await ensureAgentPlanConfirmed({
    toolName: 'send_terminal_command',
    args: { command: 'systemctl restart nginx', tabId: 'tab-a' },
    runtime
  })
  assert.equal(changed.reasonCode, 'PLAN_BINDING_CHANGED')
})

test('conversation plan ignores hidden calls and enforces visible command order', async () => {
  const {
    buildConversationPlanGrantPayload,
    commitAgentPlanCall,
    confirmAgentPlan,
    ensureAgentPlanConfirmed,
    markAgentPlanConfirmed
  } = await import(taskModeModuleUrl)
  const payload = buildConversationPlanGrantPayload({
    readonlyCommands: ['uptime', 'df -h'],
    impactTargets: ['hidden:target'],
    skillBindings: ['hidden-skill'],
    artifactDigests: ['hidden-digest'],
    recovery: { type: 'fake', verified: true },
    orderedCalls: [{
      name: 'send_terminal_command',
      args: { command: 'systemctl restart nginx' }
    }]
  })
  assert.deepEqual(payload.orderedCalls, [
    { name: 'send_terminal_command', args: { command: 'uptime' } },
    { name: 'send_terminal_command', args: { command: 'df -h' } }
  ])
  assert.deepEqual(payload.impactTargets, [])
  assert.deepEqual(payload.skillBindings, [])
  assert.deepEqual(payload.artifactDigests, [])
  assert.equal(payload.recovery, null)

  const runtime = {}
  markAgentPlanConfirmed(runtime, await confirmAgentPlan({
    args: { readonlyCommands: ['uptime', 'df -h'] },
    endpoint: { tabId: 'tab-a' },
    confirm: () => true
  }))
  const outOfOrder = await ensureAgentPlanConfirmed({
    toolName: 'send_terminal_command',
    args: { command: 'df -h', tabId: 'tab-a' },
    runtime
  })
  assert.equal(outOfOrder.reasonCode, 'PLAN_BINDING_CHANGED')
  assert.equal(await ensureAgentPlanConfirmed({
    toolName: 'send_terminal_command',
    args: { command: 'uptime', tabId: 'tab-a' },
    runtime
  }), null)
  commitAgentPlanCall({
    toolName: 'send_terminal_command',
    args: { command: 'uptime', tabId: 'tab-a' },
    runtime
  })
  assert.equal(await ensureAgentPlanConfirmed({
    toolName: 'send_terminal_command',
    args: { command: 'df -h', tabId: 'tab-a' },
    runtime
  }), null)
})

test('plan confirmation visibly renders target verification steps', async () => {
  const { buildAgentPlanConfirmationMessage } = await import(taskModeModuleUrl)
  const message = buildAgentPlanConfirmationMessage({
    goal: 'restart nginx',
    verification: [{
      name: 'read_service_status',
      args: { service: 'nginx' },
      expected: { contains: 'active' }
    }]
  })
  assert.match(message, /Risk target verification/)
  assert.match(message, /read_service_status/)
  assert.match(message, /nginx/)
  assert.match(message, /active/)
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
