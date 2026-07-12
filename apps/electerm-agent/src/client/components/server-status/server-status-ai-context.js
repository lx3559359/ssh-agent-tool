import { buildServerStatusMarkdown } from './server-status-report.js'

export function buildServerStatusAiPrompt (snapshot = {}) {
  const endpoint = snapshot.endpoint || {}
  const target = `${endpoint.username ? `${endpoint.username}@` : ''}${endpoint.host || '未知服务器'}:${endpoint.port || 22}`
  return [
    `请分析 ${target} 的只读服务器状态快照。`,
    '请优先解释异常和风险，给出只读排查步骤；任何修改命令都必须单独说明风险并等待确认。',
    '',
    buildServerStatusMarkdown(snapshot)
  ].join('\n').slice(0, 29000)
}
