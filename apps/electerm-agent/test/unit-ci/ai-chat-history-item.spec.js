const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const statusUrl = pathToFileURL(path.join(
  root,
  'src/client/components/ai/agent-run-status.js'
))

test('Agent status view keeps legacy history unchanged and renders bounded terminal metrics', async () => {
  const { buildAgentRunStatusView } = await import(statusUrl)

  assert.equal(buildAgentRunStatusView({ mode: 'agent', response: 'legacy' }), null)
  assert.equal(buildAgentRunStatusView({
    mode: 'agent',
    runState: { status: 'running', phase: 'model_request' }
  }), null)

  assert.deepEqual(buildAgentRunStatusView({
    mode: 'agent',
    runState: {
      status: 'failed',
      phase: 'budget_exceeded',
      terminationReason: 'budget_exceeded',
      errorCode: 'AGENT_BUDGET_EXCEEDED',
      endpointFingerprint: 'endpoint-12ab34cd',
      budget: { elapsedMs: 1250, modelRequests: 2, toolCalls: 3 }
    }
  }), {
    status: 'budget_exceeded',
    labelKey: 'shellpilotAiAgentStatusBudgetExceeded',
    tone: 'warning',
    endpointFingerprint: 'endpoint-12ab34cd',
    elapsedMs: 1250,
    modelRequests: 2,
    toolCalls: 3
  })
})

test('AI history item renders the Agent run status row only through the bounded view model', () => {
  const source = fs.readFileSync(path.join(
    root,
    'src/client/components/ai/ai-chat-history-item.jsx'
  ), 'utf8')

  assert.match(source, /buildAgentRunStatusView\(item\)/)
  assert.match(source, /agent-run-status/)
  assert.match(source, /shellpilotAiAgentStatusMetrics/)
  assert.match(source, /renderAgentRunStatus/)
})
