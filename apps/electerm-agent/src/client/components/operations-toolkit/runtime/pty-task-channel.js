import {
  assertSameSessionEndpoint
} from '../../../common/safety-transactions/endpoint-guard.js'

const requiredEndpointFields = Object.freeze([
  'tabId',
  'pid',
  'terminalPid',
  'sessionType',
  'host',
  'port',
  'username',
  'connectionUsername',
  'hostKeyFingerprint'
])

function requireCompleteEndpoint (endpoint = {}) {
  for (const field of requiredEndpointFields) {
    if (endpoint[field] === undefined || endpoint[field] === null ||
      String(endpoint[field]).trim() === '') {
      throw new Error(`SSH 运维任务端点信息不完整：${field}`)
    }
  }
  if (String(endpoint.sessionType).toLowerCase() !== 'ssh') {
    throw new Error('SSH 运维任务端点会话类型无效')
  }
  if (String(endpoint.connectionUsername) !== String(endpoint.username)) {
    throw new Error('SSH 运维任务登录用户端点不一致')
  }
  return endpoint
}

function assertExactTerminalSession (endpoint, terminal) {
  const current = requireCompleteEndpoint(
    terminal.getTerminalSafetyEndpoint?.()
  )
  assertSameSessionEndpoint(endpoint, current)
  if (String(current.connectionUsername) !==
    String(endpoint.connectionUsername)) {
    throw new Error('当前 SSH 终端登录用户已经变化')
  }
  if (String(terminal.pid) !== String(endpoint.pid) ||
    String(terminal.pid) !== String(endpoint.terminalPid)) {
    throw new Error('当前 SSH 终端会话已经变化')
  }
}

export function createPtyTaskChannel ({ getTerminal } = {}) {
  if (typeof getTerminal !== 'function') {
    throw new Error('PTY 运维通道缺少终端解析器')
  }
  return Object.freeze({
    async acquire ({ endpoint: providedEndpoint, taskId } = {}) {
      const endpoint = requireCompleteEndpoint(providedEndpoint)
      if (!String(taskId || '').trim()) {
        throw new Error('PTY 运维任务缺少任务标识')
      }
      const terminal = getTerminal(endpoint.tabId)
      if (!terminal?.pid || terminal.isSsh?.() !== true ||
        typeof terminal.getTerminalSafetyEndpoint !== 'function' ||
        typeof terminal.acquireOperationsPtyTask !== 'function') {
        throw new Error('当前 SSH 终端不支持受控 PTY 运维任务')
      }
      assertExactTerminalSession(endpoint, terminal)
      return terminal.acquireOperationsPtyTask(taskId)
    }
  })
}
