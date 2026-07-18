const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function readSource (file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

test('server status renders AI diagnosis only beside abnormal alerts services containers and platforms', () => {
  const modal = readSource('src/client/components/server-status/server-status-modal.jsx')
  const topbar = readSource('src/client/components/main/aigshell-topbar.jsx')

  assert.match(modal, /AgentTaskRunner/)
  assert.match(modal, /isDiagnosticTargetAbnormal/)
  assert.match(modal, /openDiagnostic\(['"]alert['"]/)
  assert.match(modal, /openDiagnostic\(['"]service['"]/)
  assert.match(modal, /openDiagnostic\(['"]container['"]/)
  assert.match(modal, /openDiagnostic\(['"]platform['"]/)
  assert.match(modal, /AI 诊断/)
  assert.match(modal, /isDiagnosticTargetAbnormal\(service\)/)
  assert.match(modal, /isDiagnosticTargetAbnormal\(container\)/)
  assert.match(modal, /isDiagnosticTargetAbnormal\(platform\)/)
  assert.equal((topbar.match(/AI 诊断/g) || []).length, 0)
})

test('AgentTaskRunner confirms before execution and exposes live progress cancellation and final evidence', () => {
  const runner = readSource('src/client/components/ai/agent-task-runner.jsx')
  const styles = readSource('src/client/components/ai/agent-task-runner.styl')

  assert.match(runner, /requestDiagnosticPlanText/)
  assert.match(runner, /parseDiagnosticPlan/)
  assert.match(runner, /确认并执行/)
  assert.match(runner, /confirmAndRun\(plan\)/)
  assert.match(runner, /expectedSignals/)
  assert.match(runner, /stopConditions/)
  assert.match(runner, /pending|等待/)
  assert.match(runner, /running|执行中/)
  assert.match(runner, /completed|成功/)
  assert.match(runner, /failed|失败/)
  assert.match(runner, /cancelled|已取消/)
  assert.match(runner, /Progress/)
  assert.match(runner, /agentTaskRegistry\.cancel/)
  assert.match(runner, /audit.*code/s)
  assert.match(runner, /审计.*安全中心/)
  assert.match(runner, /发送到 AI 对话/)
  assert.match(runner, /refsStatic\.get\(['"]AIChat['"]\).*setPrompt/)
  assert.doesNotMatch(runner, /refsStatic\.get\(['"]AIChat['"]\).*handleSubmit/)
  assert.doesNotMatch(runner, /立即修复|执行修改/)
  assert.match(styles, /overflow-y\s+auto/)
  assert.match(styles, /border-radius\s+6px/)
  assert.match(styles, /@media \(max-width:/)
})

test('server status installs the registry capability and recovers restart orphans without polling', () => {
  const modal = readSource('src/client/components/server-status/server-status-modal.jsx')
  const registry = readSource('src/client/components/ai/agent-task-registry.js')

  assert.match(modal, /installSafetyTaskCapability/)
  assert.match(modal, /recoverOrphanedAgentTasks/)
  assert.match(modal, /transactionStore/)
  assert.match(registry, /任务已中断：执行器不可用/)
  assert.doesNotMatch(modal, /setInterval/)
  assert.match(modal, /getCurrentEndpoint=\{getCurrentDiagnosticEndpoint\}/)
  assert.match(
    readSource('src/client/components/ai/agent-task-runner.jsx'),
    /getCurrentEndpoint:\s*async[\s\S]*typeof getCurrentEndpoint === ['"]function['"][\s\S]*return getCurrentEndpoint\(\)/
  )
})

test('reopening diagnostics isolates visible progress from an older background task', () => {
  const runner = readSource('src/client/components/ai/agent-task-runner.jsx')

  assert.match(runner, /activeRunRef/)
  assert.match(runner, /runToken/)
  assert.match(runner, /activeRunRef\.current\s*!==\s*runToken/)
})

test('production AgentTaskRunner passes an internal parent trace only to the task controller', () => {
  const runner = readSource('src/client/components/ai/agent-task-runner.jsx')
  const modelRequest = runner.slice(
    runner.indexOf('const text = await requestDiagnosticPlanText({'),
    runner.indexOf('const nextPlan = parseDiagnosticPlan')
  )

  assert.match(runner, /createTraceContext/)
  assert.match(runner, /taskTraceContextRef\.current\s*=\s*createTraceContext\(/)
  assert.match(
    runner,
    /createAgentTaskController\(\{[\s\S]*traceContext:\s*taskTraceContextRef\.current/
  )
  assert.doesNotMatch(modelRequest, /traceContext|taskTraceContextRef/)
})
