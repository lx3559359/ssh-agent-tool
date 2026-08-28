function requiredIdentity (value, label) {
  const identity = String(value ?? '').trim()
  if (!identity) throw new Error(`SFTP 安全端点缺少${label}。`)
  return identity
}

function normalizedHost (value) {
  return requiredIdentity(value, '服务器地址')
    .replace(/\.$/, '')
    .toLowerCase()
}

function normalizedPort (value) {
  const port = value === undefined || value === null || value === ''
    ? 22
    : Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SFTP 安全端点端口无效。')
  }
  return port
}

function assertEqualIdentity (actual, expected, label) {
  if (String(actual) !== String(expected)) {
    throw new Error(`SFTP 安全端点${label}不一致。`)
  }
}

export function assertExactSshTerminalEndpoint ({
  tab = {},
  terminalEndpoint = {}
} = {}) {
  const tabId = requiredIdentity(tab.id, '标签页标识')
  const host = normalizedHost(tab.host)
  const port = normalizedPort(tab.port)
  const username = requiredIdentity(tab.username || tab.user, '登录用户名')
  assertEqualIdentity(normalizedHost(terminalEndpoint.host), host, '主机')
  assertEqualIdentity(normalizedPort(terminalEndpoint.port), port, '端口')
  assertEqualIdentity(
    requiredIdentity(terminalEndpoint.tabId, 'SSH 标签页标识'),
    tabId,
    '标签页标识'
  )
  assertEqualIdentity(
    requiredIdentity(terminalEndpoint.username, 'SSH 用户名'),
    username,
    '用户名'
  )
  assertEqualIdentity(
    requiredIdentity(
      terminalEndpoint.connectionUsername,
      'SSH 连接用户名'
    ),
    username,
    '连接用户名'
  )
  const sshTerminalPid = requiredIdentity(
    terminalEndpoint.terminalPid || terminalEndpoint.pid,
    'SSH 终端进程标识'
  )
  if (terminalEndpoint.pid && terminalEndpoint.terminalPid) {
    assertEqualIdentity(
      terminalEndpoint.pid,
      terminalEndpoint.terminalPid,
      'SSH 终端进程标识'
    )
  }
  assertEqualIdentity(sshTerminalPid, tabId, 'SSH 终端进程标识')
  const expectedPid = tab.sshTerminalPid || tab.terminalPid || tab.pid
  if (expectedPid !== undefined && expectedPid !== null && expectedPid !== '') {
    assertEqualIdentity(sshTerminalPid, expectedPid, 'SSH 终端进程标识')
  }
  const hostKeyFingerprint = requiredIdentity(
    terminalEndpoint.hostKeyFingerprint,
    '主机密钥指纹'
  )
  const sshSessionGeneration = requiredIdentity(
    terminalEndpoint.sshSessionGeneration,
    'SSH session generation'
  )
  if (tab.hostKeyFingerprint) {
    assertEqualIdentity(
      hostKeyFingerprint,
      tab.hostKeyFingerprint,
      '主机密钥指纹'
    )
  }
  if (String(terminalEndpoint.sessionType || 'ssh').toLowerCase() !== 'ssh') {
    throw new Error('SFTP 安全端点不是 SSH 会话。')
  }
  return Object.freeze({
    tabId,
    host,
    port,
    username,
    connectionUsername: username,
    sshSessionGeneration,
    hostKeyFingerprint
  })
}

export function buildSftpSafetyEndpoint ({
  tab = {},
  terminalId,
  sftpSessionGeneration,
  terminalEndpoint = {}
} = {}) {
  const exact = assertExactSshTerminalEndpoint({ tab, terminalEndpoint })
  const terminalIdentity = requiredIdentity(
    terminalId ?? tab.terminalId ?? exact.tabId,
    '会话安全标识'
  )
  const boundGeneration = requiredIdentity(
    sftpSessionGeneration,
    'SFTP SSH session generation'
  )
  assertEqualIdentity(
    boundGeneration,
    exact.sshSessionGeneration,
    'SSH session generation'
  )
  return {
    host: tab.host,
    port: exact.port,
    username: exact.username,
    connectionUsername: exact.connectionUsername,
    title: tab.title || tab.name || '',
    tabId: exact.tabId,
    pid: `sftp:${exact.tabId}:${terminalIdentity}`,
    terminalPid: terminalIdentity,
    sshSessionGeneration: exact.sshSessionGeneration,
    hostKeyFingerprint: exact.hostKeyFingerprint,
    sessionType: 'sftp'
  }
}
