function requiredIdentity (value, label) {
  const identity = String(value ?? '').trim()
  if (!identity) throw new Error(`SFTP 安全端点缺少${label}。`)
  return identity
}

export function buildSftpSafetyEndpoint ({ tab = {}, terminalId } = {}) {
  const tabId = requiredIdentity(tab.id, '标签页标识')
  const terminalIdentity = requiredIdentity(
    terminalId ?? tab.terminalId ?? tabId,
    '会话安全标识'
  )
  return {
    host: tab.host,
    port: Number(tab.port || 22),
    username: tab.username || tab.user,
    title: tab.title || tab.name || '',
    tabId,
    pid: `sftp:${tabId}:${terminalIdentity}`,
    terminalPid: terminalIdentity,
    sessionType: 'sftp'
  }
}
