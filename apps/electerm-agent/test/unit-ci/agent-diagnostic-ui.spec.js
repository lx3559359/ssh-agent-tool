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
  assert.match(modal, /e\('shellpilotServerStatusAiDiagnosis'\)/)
  assert.match(modal, /isDiagnosticTargetAbnormal\(service\)/)
  assert.match(modal, /isDiagnosticTargetAbnormal\(container\)/)
  assert.match(modal, /isDiagnosticTargetAbnormal\(platform\)/)
  assert.equal((topbar.match(/shellpilotServerStatusAiDiagnosis/g) || []).length, 0)
})

test('AgentTaskRunner confirms before execution and exposes live progress cancellation and final evidence', () => {
  const runner = readSource('src/client/components/ai/agent-task-runner.jsx')
  const styles = readSource('src/client/components/ai/agent-task-runner.styl')

  assert.match(runner, /requestDiagnosticPlanText/)
  assert.match(runner, /parseDiagnosticPlan/)
  assert.match(runner, /e\('shellpilotAgentTaskConfirmRun'\)/)
  assert.match(runner, /confirmAndRun\(plan\)/)
  assert.match(runner, /expectedSignals/)
  assert.match(runner, /stopConditions/)
  assert.match(runner, /shellpilotSafetyStepPending/)
  assert.match(runner, /shellpilotSafetyStepRunning/)
  assert.match(runner, /shellpilotSafetyStepSuccess/)
  assert.match(runner, /shellpilotSafetyStepFailed/)
  assert.match(runner, /shellpilotSafetyStepCancelled/)
  assert.match(runner, /Progress/)
  assert.match(runner, /agentTaskRegistry\.cancel/)
  assert.match(runner, /cancellation\?\.\('cancelling'\)/)
  assert.match(runner, /cancellation\?\.\('cancel_confirmed'\)/)
  assert.match(runner, /cancellation\?\.\([\s\S]{0,40}'cancel_failed'/)
  assert.match(runner, /audit.*code/s)
  assert.match(runner, /shellpilotAgentTaskAuditRecorded/)
  assert.match(runner, /shellpilotAgentTaskSendToAi/)
  assert.match(runner, /getAiChat:\s*\(\)\s*=>\s*refsStatic\.get\(['"]AIChat['"]\)/)
  assert.doesNotMatch(runner, /refsStatic\.get\(['"]AIChat['"]\).*handleSubmit/)
  assert.doesNotMatch(runner, /shellpilotAgentTaskImmediateFix|shellpilotAgentTaskExecuteMutation/)
  assert.match(styles, /overflow-y\s+auto/)
  assert.match(styles, /border-radius\s+var\(--sp-radius-card\)/)
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
  assert.match(runner, /createAgentDiagnosticKey\(target\)/)
  assert.match(runner, /restoreAgentDiagnosticTask\(\{/)
  assert.ok(
    runner.indexOf('const restored = await restoreAgentDiagnosticTask') <
      runner.indexOf('await generatePlan(endpoint)')
  )
  assert.match(
    runner,
    /createAgentTaskController\(\{[\s\S]*diagnosticKey/
  )
})

test('diagnostic UI exposes run creation errors and uses bounded AI handoff', () => {
  const runner = readSource('src/client/components/ai/agent-task-runner.jsx')
  const modal = readSource('src/client/components/server-status/server-status-modal.jsx')

  assert.match(runner, /getAgentTaskViewState/)
  assert.match(runner, /const terminalPhase = runError\?\.code/)
  assert.match(runner, /setPhase\(terminalPhase\)/)
  assert.match(runner, /shellpilotAgentTaskRetryRun/)
  assert.match(runner, /handoffAgentPromptToAi/)
  assert.match(modal, /handoffAgentPromptToAi/)
  assert.doesNotMatch(runner, /setTimeout\([\s\S]{0,240},\s*120\)/)
  assert.doesNotMatch(modal, /setTimeout\([\s\S]{0,240},\s*120\)/)
})

test('diagnostic UI renders phase metrics endpoint and recovery actions from the task view model', () => {
  const runner = readSource('src/client/components/ai/agent-task-runner.jsx')
  const styles = readSource('src/client/components/ai/agent-task-runner.styl')

  assert.match(runner, /getAgentTaskViewState\(\{[\s\S]*cancelling[\s\S]*runState/)
  assert.match(runner, /viewState\.titleKey/)
  assert.match(runner, /viewState\.endpointFingerprint/)
  assert.match(runner, /shellpilotAgentTaskStateMetrics/)
  assert.match(runner, /viewState\.canCancel/)
  assert.match(runner, /viewState\.canRetry/)
  assert.match(runner, /viewState\.canClose/)
  assert.match(runner, /viewState\.showEvidence/)
  assert.match(styles, /agent-task-state-meta/)
  assert.match(styles, /agent-task-state-actions/)
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
