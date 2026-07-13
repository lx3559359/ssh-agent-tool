const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const agentTerminalUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-terminal-command.js'
)).href

function readClientSource (relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../src/client', relativePath),
    'utf8'
  )
}

test('Agent terminal commands use the safety entrypoint and preserve idle results', async () => {
  const { runAgentTerminalCommand } = await import(agentTerminalUrl)
  const calls = []
  const idle = { output: 'ok', timedOut: false, tabId: 'tab-1' }
  const store = {
    activeTabId: 'tab-1',
    async runSafetyCommand (command, options) {
      calls.push(['safety', command, options])
      return { sent: true, operationId: 'operation-1' }
    },
    async mcpWaitForTerminalIdle (options) {
      calls.push(['wait', options])
      return idle
    }
  }

  const result = await runAgentTerminalCommand({
    store,
    args: { command: 'uptime' }
  })

  assert.deepEqual(result, idle)
  assert.deepEqual(calls, [
    ['safety', 'uptime', {
      tabId: 'tab-1',
      source: 'agent',
      title: 'Agent 终端命令'
    }],
    ['wait', {
      tabId: 'tab-1',
      timeout: 30000,
      lines: 100
    }]
  ])
})

test('Agent safety cancellation never waits for terminal output', async () => {
  const { runAgentTerminalCommand } = await import(agentTerminalUrl)
  let waits = 0
  const result = await runAgentTerminalCommand({
    store: {
      activeTabId: 'tab-1',
      runSafetyCommand: async () => ({ sent: false, cancelled: true }),
      mcpWaitForTerminalIdle: async () => { waits += 1 }
    },
    args: { command: 'custom-mutate target' }
  })

  assert.equal(result.cancelled, true)
  assert.equal(waits, 0)
})

test('quick, AI, Agent and MCP callers contain no naked terminal command send', () => {
  const quick = readClientSource('store/quick-command.js')
  const ai = readClientSource('components/ai/ai-ssh-context.js')
  const agent = readClientSource('components/ai/agent-tools.js')
  const mcp = readClientSource('store/mcp-handler.js')

  assert.match(quick, /Store\.prototype\.runSafetyCommand/)
  assert.match(quick, /term\?\.runSafetyCommand/)
  assert.match(quick, /await store\.runQuickCommand/)
  assert.match(ai, /store\?\.runSafetyCommand/)
  assert.doesNotMatch(ai, /mcpSendTerminalCommand/)
  assert.match(agent, /runAgentTerminalCommand/)
  assert.doesNotMatch(
    agent.match(/case 'send_terminal_command':[\s\S]*?case 'get_terminal_output'/)?.[0] || '',
    /mcpSendTerminalCommand|_sendData/
  )
  assert.match(mcp, /Store\.prototype\.mcpSendTerminalCommand = async/)
  assert.match(mcp, /await store\.runSafetyCommand/)
})

test('new quick command execution does not create legacy localStorage records', () => {
  const source = readClientSource(
    'components/quick-commands/quick-commands-box.jsx'
  )
  const start = source.indexOf('function handlePendingOk ()')
  const end = source.indexOf('function handleClose ()', start)
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.doesNotMatch(body, /createQuickCommandSafetyRecord|saveRollbackRecord/)
  assert.match(source, /readSafetyOperationRecords/)
  assert.match(source, /handleRollbackAction/)
})
