export const LEGACY_DEFAULT_AI_ROLE = 'SSH 运维专家，优先排查服务器、网络、日志、进程、端口、磁盘、内存、Nginx、Docker 和部署问题。回答使用中文和 Markdown。'

export function normalizeAIChatRole (value) {
  const role = String(value || '').trim()
  return role === LEGACY_DEFAULT_AI_ROLE ? '' : role
}
