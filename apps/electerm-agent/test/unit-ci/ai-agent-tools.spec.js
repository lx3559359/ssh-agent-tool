const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')

function readSource (name) {
  return fs.readFileSync(path.join(aiRoot, name), 'utf8')
}

function toolDefinition (source, name) {
  const start = source.indexOf(`name: '${name}'`)
  const next = source.indexOf("name: '", start + 7)
  return source.slice(start, next === -1 ? undefined : next)
}

test('Agent tool execution routes risky tools through frozen transaction confirmation', () => {
  const source = readSource('agent-tools.js')

  assert.match(source, /buildRiskTransaction/)
  assert.match(source, /confirmRiskTransaction/)
  assert.match(source, /requestAgentRiskConfirmation/)
  assert.match(source, /combineRiskTransactions/)
  assert.match(source, /export async function prepareAgentRiskBatch/)
  assert.match(source, /prepareRisky:\s*context\s*=>\s*prepareResolvedAgentTool/)
  assert.match(source, /validateDelegatedRisk:\s*validateDelegatedAgentSafetyPreparation/)
  assert.match(source, /executeAgentTool\(\{/)
})

test('Agent tools route every executor through the single takeover gate', () => {
  const source = readSource('agent-tools.js')
  const agentSource = readSource('agent.js')

  assert.match(source, /withAgentToolPolicy\(withAgentToolScopes\(\[/)
  assert.match(source, /executeAgentTool/)
  assert.match(source, /function executeResolvedAgentTool/)
  assert.match(source, /\.\.\.structuredAgentTools/)
  assert.match(source, /case 'run_readonly_command'/)
  assert.match(source, /case 'read_service_status'/)
  assert.match(source, /case 'read_recent_logs'/)
  assert.match(source, /case 'verify_listening_port'/)
  assert.match(source, /case 'read_file_range'/)
  assert.match(source, /case 'send_terminal_command'/)
  assert.match(source, /case 'sftp_del'/)
  assert.match(source, /case 'run_local_cli'/)
  assert.match(source, /case 'run_background_command'/)
  assert.match(agentSource, /agentTools\.map\(\(\{ type, function: definition \}\)/)
  assert.match(agentSource, /prepareAgentRiskBatch\(assistantMessage\.tool_calls, agentRuntime\)/)
  assert.match(agentSource, /failAgentRiskBatch\(agentRuntime, err/)
})

test('Agent readonly commands use SSH exec without terminal or safety fallback', () => {
  const source = readSource('agent-tools.js')
  const readonlyHelper = source.match(
    /(?:export\s+)?async function runReadonlyTool[\s\S]*?\n}/
  )?.[0] || ''
  const structuredCases = source.match(
    /case 'read_service_status':[\s\S]*?case 'send_terminal_command'/
  )?.[0] || ''
  const terminalCase = source.match(
    /case 'send_terminal_command':[\s\S]*?(?=\n\s*case ')/
  )?.[0] || ''

  assert.match(readonlyHelper, /executeAgentReadonlyCommand/)
  assert.doesNotMatch(readonlyHelper, /runSafetyCommand|sendTerminalCommand|runTerminalTool|pty/i)
  assert.match(structuredCases, /runReadonlyTool/)
  assert.doesNotMatch(structuredCases, /runTerminalTool/)
  assert.match(terminalCase, /allowlisted-readonly[\s\S]*runReadonlyTool/)
})

test('Agent exposes readonly exec without the old plan-confirmation tool', () => {
  const source = readSource('agent-tools.js')

  assert.match(source, /name:\s*'run_readonly_command'/)
  assert.doesNotMatch(source, /name:\s*'confirm_agent_plan'/)
  assert.doesNotMatch(source, /ensureAgentPlanAvailable|ensureAgentPlanConfirmed|commitAgentPlanCall/)
})

test('structured reads use readonly exec while file ranges keep SFTP read', () => {
  const source = readSource('agent-tools.js')
  const structuredCases = source.match(
    /case 'read_service_status':[\s\S]*?case 'send_terminal_command'/
  )?.[0] || ''

  assert.match(structuredCases, /executeCommand:\s*command\s*=>\s*runReadonlyTool/)
  assert.match(structuredCases, /readFile:\s*fileArgs\s*=>\s*store\.mcpSftpReadFile/)
  assert.doesNotMatch(structuredCases, /mcpSendTerminal|runSafetyCommand|runTerminalTool/)
})

test('risky tool schemas require complete risk context without breaking readonly send compatibility', () => {
  const source = readSource('agent-tools.js')

  for (const name of [
    'run_background_command',
    'sftp_del',
    'sftp_upload',
    'sftp_download',
    'run_local_cli'
  ]) {
    assert.match(
      toolDefinition(source, name),
      /required:\s*\[[^\]]*'riskContext'[^\]]*\]/,
      name
    )
  }

  const send = toolDefinition(source, 'send_terminal_command')
  assert.match(send, /riskContext:\s*agentRiskContextSchema/)
  assert.match(send, /required:\s*\['command'\]/)
  assert.doesNotMatch(send, /required:\s*\[[^\]]*'riskContext'/)
})

test('runtime rejects risky calls without context before risk preparation', () => {
  const source = readSource('agent-tools.js')
  const entrypoint = source.slice(source.indexOf('export async function executeToolCall'))

  assert.match(entrypoint, /assertAgentRiskContextForCall\([\s\S]*initialClassification/)
  assert.ok(
    entrypoint.indexOf('assertAgentRiskContextForCall') <
      entrypoint.indexOf('executeAgentTool({')
  )
  assert.doesNotMatch(source, /const riskContext = args\.riskContext \|\| \{\}/)
})
