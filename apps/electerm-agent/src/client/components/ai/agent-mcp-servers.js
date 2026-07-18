import { sanitizeAIStoredText } from './ai-request-credentials.js'

function normalizeMcpServer (server = {}) {
  return {
    name: String(server.name || '').trim(),
    transport: String(server.transport || 'stdio').trim().toLowerCase(),
    command: String(server.command || '').trim(),
    args: String(server.args || '').trim(),
    url: String(server.url || '').trim(),
    description: String(server.description || '').trim(),
    disabled: Boolean(server.disabled)
  }
}

export function getMcpServerConfigIssues (mcpServers = []) {
  return mcpServers
    .map(normalizeMcpServer)
    .flatMap((server, index) => {
      if (server.disabled) {
        return []
      }
      const issues = []
      if (!server.name) {
        issues.push({
          index,
          field: 'name',
          message: 'MCP Server 缺少名称'
        })
      }
      if (server.transport === 'http' && !server.url) {
        issues.push({
          index,
          field: 'url',
          message: `${server.name || 'MCP Server'} 使用 HTTP 连接方式时必须填写 URL`
        })
      }
      if (server.transport !== 'http' && !server.command) {
        issues.push({
          index,
          field: 'command',
          message: `${server.name || 'MCP Server'} 使用 stdio 连接方式时必须填写启动命令`
        })
      }
      return issues
    })
}

export function getEnabledMcpServers (mcpServers = []) {
  return mcpServers
    .map(normalizeMcpServer)
    .filter(server => {
      if (server.disabled || !server.name) {
        return false
      }
      if (server.transport === 'http') {
        return Boolean(server.url)
      }
      return Boolean(server.command)
    })
}

function describeServer (server) {
  const name = sanitizeAIStoredText(server.name).slice(0, 96) || 'MCP Server'
  const description = sanitizeAIStoredText(server.description).slice(0, 240)
  const desc = description ? `, description=${description}` : ''
  return `- ${name}: transport=${server.transport}${desc}`
}
export function buildAgentMcpServerPrompt ({ mcpServers = [] } = {}) {
  const servers = getEnabledMcpServers(mcpServers)
  if (!servers.length) {
    return ''
  }
  return `外部 MCP Server（用户已配置）：
${servers.map(describeServer).join('\n')}

MCP 使用规则：
- 这些 MCP Server 是 Agent 可接入的外部工具或数据源配置，例如 CMDB、Prometheus、文档和知识库。
- 调用或引用 MCP 能力前，先说明将使用哪个 Server、用途和需要读取的数据。
- 当前为 MCP 配置引用，尚未内置直接调用外部 MCP Server 的客户端。
- 如果当前运行环境尚未启动对应 MCP Client，请给出清晰的接入建议，不要假装已经完成调用。`
}

export function buildMcpServerContextPrompt ({ mcpServers = [] } = {}) {
  const servers = getEnabledMcpServers(mcpServers)
  if (!servers.length) {
    return ''
  }
  return `请参考以下已配置 MCP Server，判断是否可以用于当前排查任务：

${servers.map(describeServer).join('\n')}

当前为 MCP 配置引用，尚未内置直接调用外部 MCP Server 的客户端。
请说明建议使用哪个 MCP Server、能查询什么信息，以及下一步需要我确认的操作。`
}
