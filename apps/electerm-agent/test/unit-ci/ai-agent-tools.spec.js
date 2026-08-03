const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const scopesUrl = pathToFileURL(path.join(aiRoot, 'agent-tool-scopes.js')).href

function readSource (name) {
  return fs.readFileSync(path.join(aiRoot, name), 'utf8')
}

function toolDefinition (source, name) {
  const start = source.indexOf(`name: '${name}'`)
  const next = source.indexOf("name: '", start + 7)
  return source.slice(start, next === -1 ? undefined : next)
}

test('Agent tool execution routes risky tools through frozen transaction confirmation', () => {
  const riskSource = readSource('agent-tool-risk-lifecycle.js')
  const executionSource = readSource('agent-tool-execution.js')

  assert.match(riskSource, /buildRiskTransaction/)
  assert.match(riskSource, /confirmRiskTransaction/)
  assert.match(riskSource, /requestAgentRiskConfirmation/)
  assert.match(riskSource, /combineRiskTransactions/)
  assert.match(riskSource, /export async function prepareAgentRiskBatch/)
  assert.match(executionSource, /prepareRisky:\s*context\s*=>\s*prepareResolvedAgentTool/)
  assert.match(executionSource, /validateDelegatedRisk:\s*validateDelegatedAgentSafetyPreparation/)
  assert.match(executionSource, /executeAgentTool\(\{/)
})

test('Agent tools route every executor through the single takeover gate', () => {
  const catalogSource = readSource('agent-tool-catalog.js')
  const executionSource = readSource('agent-tool-execution.js')
  const agentSource = readSource('agent.js')

  assert.match(catalogSource, /withAgentToolPolicy\(withAgentToolScopes\(\[/)
  assert.match(catalogSource, /\.\.\.structuredAgentTools/)
  assert.match(executionSource, /executeAgentTool/)
  assert.match(executionSource, /function executeResolvedAgentTool/)
  assert.match(executionSource, /case 'run_readonly_command'/)
  assert.match(executionSource, /case 'read_service_status'/)
  assert.match(executionSource, /case 'read_recent_logs'/)
  assert.match(executionSource, /case 'verify_listening_port'/)
  assert.match(executionSource, /case 'read_file_range'/)
  assert.match(executionSource, /case 'send_terminal_command'/)
  assert.match(executionSource, /case 'sftp_del'/)
  assert.match(executionSource, /case 'run_local_cli'/)
  assert.match(executionSource, /case 'run_background_command'/)
  assert.match(agentSource, /agentTools\.map\(\(\{ type, function: definition \}\)/)
  assert.match(agentSource, /runValidatedAgentToolCalls\(\{/)
  assert.match(agentSource, /prepareAgentRiskBatch\(parsedCalls, agentRuntime\)/)
  assert.match(agentSource, /failAgentRiskBatch\(agentRuntime, err/)
})

test('Agent readonly commands use SSH exec without terminal or safety fallback', () => {
  const source = readSource('agent-tool-execution.js')
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
  const source = `${readSource('agent-tool-catalog.js')}\n${readSource('agent-tool-execution.js')}`

  assert.match(source, /name:\s*'run_readonly_command'/)
  assert.doesNotMatch(source, /name:\s*'confirm_agent_plan'/)
  assert.doesNotMatch(source, /ensureAgentPlanAvailable|ensureAgentPlanConfirmed|commitAgentPlanCall/)
})

test('structured reads use readonly exec while file ranges keep SFTP read', () => {
  const source = readSource('agent-tool-execution.js')
  const structuredCases = source.match(
    /case 'read_service_status':[\s\S]*?case 'send_terminal_command'/
  )?.[0] || ''

  assert.match(structuredCases, /executeCommand:\s*command\s*=>\s*runReadonlyTool/)
  assert.match(structuredCases, /readFile:\s*fileArgs\s*=>\s*store\.mcpSftpReadFile/)
  assert.doesNotMatch(structuredCases, /mcpSendTerminal|runSafetyCommand|runTerminalTool/)
})

test('every write and control tool schema matches its policy risk context mode', async () => {
  const source = [
    'agent-tool-catalog.js',
    'agent-structured-tools.js',
    'artifact-agent-tools.js'
  ].map(readSource).join('\n')
  const { AGENT_TOOL_SCOPES } = await import(scopesUrl)
  const contextTools = Object.entries(AGENT_TOOL_SCOPES).filter(([, scope]) => (
    scope === 'session-write' || scope === 'session-control'
  ))

  for (const [name, scope] of contextTools) {
    const definition = toolDefinition(source, name)
    assert.ok(definition, `missing tool definition: ${name}`)
    const schemaName = name === 'run_skill_artifact'
      ? 'agentArtifactRiskContextSchema'
      : scope === 'session-control'
        ? 'agentSessionControlRiskContextSchema'
        : 'agentRemoteRiskContextSchema'
    assert.match(definition, new RegExp(schemaName), name)
    if (name === 'send_terminal_command') continue
    assert.equal(
      /required:\s*\[[^\]]*'riskContext'[^\]]*\]/.test(definition) ||
        /withRequiredRiskContextParameters/.test(definition),
      true,
      `${name} must require riskContext`
    )
  }

  const send = toolDefinition(source, 'send_terminal_command')
  assert.match(send, /riskContext:\s*agentRemoteRiskContextSchema/)
  assert.match(send, /required:\s*\['command'\]/)
  assert.doesNotMatch(send, /required:\s*\[[^\]]*'riskContext'/)
})

test('runtime rejects risky calls without context before risk preparation', () => {
  const source = readSource('agent-tool-execution.js')
  const entrypoint = source.slice(source.indexOf('export async function executeToolCall'))

  assert.match(entrypoint, /assertAgentRiskContextForCall\([\s\S]*initialClassification/)
  assert.ok(
    entrypoint.indexOf('assertAgentRiskContextForCall') <
      entrypoint.indexOf('executeAgentTool({')
  )
  const skillWrapper = entrypoint.slice(
    entrypoint.indexOf("toolName === 'run_skill_artifact'")
  )
  assert.ok(
    skillWrapper.indexOf('assertAgentRiskContextForCall') <
      skillWrapper.indexOf('prepareSelectedSkillArtifactCall')
  )
  assert.match(skillWrapper, /prepareSelectedSkillArtifactCall\([\s\S]*riskContext/)
  assert.doesNotMatch(source, /const riskContext = args\.riskContext \|\| \{\}/)
})
