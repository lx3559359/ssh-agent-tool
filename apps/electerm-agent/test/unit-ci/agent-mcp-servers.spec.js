const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/agent-mcp-servers.js')
).href

function readSource (relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../', relativePath),
    'utf8'
  )
}

test('AI settings persistence includes external MCP servers', () => {
  const source = readSource('src/client/components/ai/ai-config-props.js')

  assert.match(source, /'mcpServers'/)
})

test('MCP server prompt lists enabled user configured servers only', async () => {
  const { buildAgentMcpServerPrompt } = await import(moduleUrl)

  const prompt = buildAgentMcpServerPrompt({
    mcpServers: [
      {
        name: 'Prometheus',
        transport: 'stdio',
        command: 'prometheus-mcp',
        args: '--url http://127.0.0.1:9090',
        description: '指标查询'
      },
      {
        name: 'CMDB',
        transport: 'http',
        url: 'https://cmdb.example.com/mcp',
        disabled: true
      }
    ]
  })

  assert.match(prompt, /MCP Server/)
  assert.match(prompt, /Prometheus/)
  assert.match(prompt, /stdio/)
  assert.match(prompt, /prometheus-mcp/)
  assert.match(prompt, /指标查询/)
  assert.doesNotMatch(prompt, /cmdb\.example\.com/)
})

test('MCP server config validation explains missing required connection fields', async () => {
  const {
    getMcpServerConfigIssues,
    buildMcpServerContextPrompt
  } = await import(moduleUrl)

  const issues = getMcpServerConfigIssues([
    {
      name: 'Prometheus',
      transport: 'stdio'
    },
    {
      name: 'CMDB',
      transport: 'http'
    },
    {
      name: '',
      transport: 'stdio',
      command: 'demo-mcp'
    }
  ])

  assert.deepEqual(issues.map(item => item.field), ['command', 'url', 'name'])

  const prompt = buildMcpServerContextPrompt({
    mcpServers: [
      {
        name: 'Prometheus',
        transport: 'stdio',
        command: 'prometheus-mcp'
      }
    ]
  })

  assert.match(prompt, /当前为 MCP 配置引用/)
  assert.match(prompt, /尚未内置直接调用外部 MCP Server/)
})

test('AI chat exposes MCP context action and no longer treats it as unavailable only', () => {
  const source = readSource('src/client/components/ai/ai-chat.jsx')

  assert.match(source, /handleQuoteMcpServers/)
  assert.match(source, /buildMcpServerContextPrompt/)
  assert.doesNotMatch(source, /showUnavailableContextAction\('mcp'\)/)
})

test('Agent system prompt includes configured MCP servers', () => {
  const source = readSource('src/client/components/ai/agent.js')

  assert.match(source, /buildAgentMcpServerPrompt/)
  assert.match(source, /mcpServers/)
})

test('AI settings form exposes external MCP server management fields', () => {
  const source = readSource('src/client/components/ai/ai-config.jsx')

  assert.match(source, /Form\.List\s+name=['"]mcpServers['"]/)
  assert.match(source, /name:\s*'name'/)
  assert.match(source, /name=\{\[name,\s*'transport'\]\}/)
  assert.match(source, /name:\s*'command'/)
  assert.match(source, /name:\s*'url'/)
  assert.match(source, /name=\{\[name,\s*'disabled'\]\}/)
  assert.match(source, /新增 MCP Server/)
})
