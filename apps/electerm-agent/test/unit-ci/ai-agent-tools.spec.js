const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const confirmModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/agent-tool-confirm.js')
).href

test('Agent command confirmation blocks terminal execution when the user cancels', async () => {
  const {
    confirmAgentToolExecution
  } = await import(confirmModuleUrl)

  const result = await confirmAgentToolExecution({
    toolName: 'send_terminal_command',
    args: {
      command: 'systemctl status nginx'
    },
    confirm: message => {
      assert.match(message, /systemctl status nginx/)
      return false
    }
  })

  assert.equal(result.accepted, false)
  assert.equal(result.cancelled, true)
})

test('Agent command confirmation allows terminal execution only after approval', async () => {
  const {
    confirmAgentToolExecution
  } = await import(confirmModuleUrl)

  const result = await confirmAgentToolExecution({
    toolName: 'run_background_command',
    args: {
      command: 'tail -f /var/log/nginx/error.log'
    },
    confirm: message => {
      assert.match(message, /tail -f \/var\/log\/nginx\/error\.log/)
      return true
    }
  })

  assert.equal(result.accepted, true)
  assert.equal(result.cancelled, false)
})

test('Agent tool execution routes risky tools through frozen transaction confirmation', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
    'utf8'
  )

  assert.match(source, /buildRiskTransaction/)
  assert.match(source, /confirmRiskTransaction/)
  assert.match(source, /requestAgentRiskConfirmation/)
  assert.match(source, /combineRiskTransactions/)
  assert.match(source, /export async function prepareAgentRiskBatch/)
  assert.match(source, /prepareRisky:\s*context\s*=>\s*prepareResolvedAgentTool/)
  assert.match(source, /executeAgentTool\(\{/)
})

test('Agent tools route every executor through the single takeover gate', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
    'utf8'
  )
  const agentSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
    'utf8'
  )

  assert.match(source, /withAgentToolPolicy\(withAgentToolScopes\(\[/)
  assert.match(source, /executeAgentTool/)
  assert.match(source, /function executeResolvedAgentTool/)
  assert.match(source, /\.\.\.structuredAgentTools/)
  assert.match(source, /case 'read_service_status'/)
  assert.match(source, /case 'read_recent_logs'/)
  assert.match(source, /case 'verify_listening_port'/)
  assert.match(source, /case 'read_file_range'/)
  assert.match(source, /executeStructuredAgentTool/)
  assert.match(source, /case 'send_terminal_command'/)
  assert.match(source, /case 'sftp_del'/)
  assert.match(source, /case 'run_local_cli'/)
  assert.match(source, /case 'run_background_command'/)
  assert.match(agentSource, /agentTools\.map\(\(\{ type, function: definition \}\)/)
  assert.match(agentSource, /prepareAgentRiskBatch\(assistantMessage\.tool_calls, agentRuntime\)/)
})

test('Agent prompt rules do not allow direct command execution without confirmation', () => {
  const copy = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-agent-copy.json'),
    'utf8'
  )

  assert.doesNotMatch(copy, /可以直接执行/)
  assert.match(copy, /必须等待用户确认/)
})
