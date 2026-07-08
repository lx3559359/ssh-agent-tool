function normalizeMcpServer (server = {}) {
  return {
    name: String(server.name || '').trim(),
    transport: String(server.transport || 'stdio').trim(),
    command: String(server.command || '').trim(),
    args: String(server.args || '').trim(),
    url: String(server.url || '').trim(),
    description: String(server.description || '').trim(),
    disabled: Boolean(server.disabled)
  }
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
  const endpoint = server.transport === 'http'
    ? `URL=${server.url}`
    : `命令=${[server.command, server.args].filter(Boolean).join(' ')}`
  const desc = server.description ? `，用途=${server.description}` : ''
  return `- ${server.name}：transport=${server.transport}，${endpoint}${desc}`
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
- 如果当前运行环境尚未启动对应 MCP Client，请给出清晰的接入建议，不要假装已经完成调用。`
}

export function buildMcpServerContextPrompt ({ mcpServers = [] } = {}) {
  const servers = getEnabledMcpServers(mcpServers)
  if (!servers.length) {
    return ''
  }
  return `请参考以下已配置 MCP Server，判断是否可以用于当前排查任务：

${servers.map(describeServer).join('\n')}

请说明建议使用哪个 MCP Server、能查询什么信息，以及下一步需要我确认的操作。`
}
