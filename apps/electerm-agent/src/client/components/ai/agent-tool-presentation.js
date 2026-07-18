import { sanitizeAIStoredText } from './ai-request-credentials.js'

const MAX_COMMAND_CHARS = 4096
const MAX_OUTPUT_CHARS = 32768
const MAX_ERROR_CHARS = 4096
const MAX_ENDPOINT_CHARS = 512
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function boundedSanitizedText (value, maxChars) {
  const text = sanitizeAIStoredText(value)
  return text.length <= maxChars ? text : text.slice(0, maxChars)
}

function parseToolResult (rawResult) {
  if (rawResult === null || rawResult === undefined) {
    return { state: 'running', value: null }
  }
  if (typeof rawResult === 'string') {
    try {
      return { state: 'settled', value: JSON.parse(rawResult) }
    } catch {
      return { state: 'invalid', value: null }
    }
  }
  return { state: 'settled', value: rawResult }
}

function projectPresentationEndpoint (endpoint) {
  if (!endpoint || typeof endpoint !== 'object') return null
  const tabId = boundedSanitizedText(endpoint.tabId, MAX_ENDPOINT_CHARS).trim()
  const username = boundedSanitizedText(endpoint.username, MAX_ENDPOINT_CHARS).trim()
  const host = boundedSanitizedText(endpoint.host, MAX_ENDPOINT_CHARS).trim()
  const port = Number(endpoint.port)
  if (
    !tabId || !username || !host ||
    !Number.isInteger(port) || port < 1 || port > 65535
  ) {
    return null
  }
  return Object.freeze({ tabId, username, host, port })
}

function formatTarget (endpoint) {
  const host = endpoint.host.includes(':')
    ? `[${endpoint.host}]`
    : endpoint.host
  return `${endpoint.username}@${host}:${endpoint.port}`
}

function addNumber (view, source, key) {
  if (!hasOwn(source, key)) return
  const number = Number(source[key])
  if (Number.isFinite(number)) view[key] = number
}

function resultError (result) {
  if (typeof result?.error === 'string') return result.error
  if (result?.error && typeof result.error.message === 'string') {
    return result.error.message
  }
  if (result?.error === true && typeof result.data === 'string') {
    return result.data
  }
  return ''
}

function resultOutput (result) {
  if (hasOwn(result, 'output')) return String(result.output ?? '')
  const parts = [result.stdout, result.stderr]
    .filter(value => value !== undefined && value !== null && value !== '')
    .map(String)
  return parts.length ? parts.join('\n') : undefined
}

function hasReadonlyEvidence (result) {
  return result && typeof result === 'object' && [
    'capturedAt',
    'durationMs',
    'exitCode',
    'truncated',
    'output',
    'stdout',
    'stderr',
    'error'
  ].some(key => hasOwn(result, key))
}

export function buildAgentToolPresentation (
  toolName,
  args = {},
  rawResult,
  options = {}
) {
  if (toolName !== 'run_readonly_command') return null
  const command = boundedSanitizedText(
    typeof args?.command === 'string' ? args.command : '',
    MAX_COMMAND_CHARS
  ).trim()
  const parsed = parseToolResult(rawResult)
  const result = parsed.value
  const endpoint = projectPresentationEndpoint(result?.endpoint) ||
    projectPresentationEndpoint(options.endpoint)
  const view = {
    kind: 'readonly-exec',
    command
  }
  if (endpoint) {
    view.tabId = endpoint.tabId
    view.target = formatTarget(endpoint)
  }
  if (parsed.state === 'running') return Object.freeze(view)

  if (!hasReadonlyEvidence(result)) {
    view.error = '只读执行结果无效'
    return Object.freeze(view)
  }

  addNumber(view, result, 'capturedAt')
  addNumber(view, result, 'durationMs')
  addNumber(view, result, 'exitCode')

  const error = resultError(result)
  if (hasOwn(result, 'error')) {
    view.error = boundedSanitizedText(
      error || '只读执行失败',
      MAX_ERROR_CHARS
    )
  }

  const rawOutput = resultOutput(result)
  if (rawOutput !== undefined) {
    const sanitized = sanitizeAIStoredText(rawOutput)
    view.output = sanitized.length <= MAX_OUTPUT_CHARS
      ? sanitized
      : sanitized.slice(0, MAX_OUTPUT_CHARS)
  }
  if (hasOwn(result, 'truncated')) {
    view.truncated = result.truncated === true ||
      (rawOutput !== undefined && sanitizeAIStoredText(rawOutput).length > MAX_OUTPUT_CHARS)
  } else if (
    rawOutput !== undefined &&
    sanitizeAIStoredText(rawOutput).length > MAX_OUTPUT_CHARS
  ) {
    view.truncated = true
  }
  return Object.freeze(view)
}

function denied (reason) {
  return Object.freeze({ allowed: false, reason })
}

function terminalConnected (terminal) {
  const status = terminal?.props?.tab?.status ?? terminal?.status
  if (status !== undefined) {
    return status === true || status === 'success' || status === 'connected'
  }
  if (terminal?.connected !== undefined) return terminal.connected === true
  return false
}

function terminalPasswordState (terminal) {
  if (
    terminal?.passwordMode === true ||
    terminal?.attachAddon?._passwordPromptDetected === true ||
    terminal?.props?.tab?.hasPasswordPrompt === true
  ) return true
  if (
    terminal?.passwordMode === false ||
    terminal?.attachAddon?._passwordPromptDetected === false ||
    terminal?.props?.tab?.hasPasswordPrompt === false
  ) return false
  try {
    const passwordMode = terminal?.getTerminalSafetyContext?.().passwordMode
    return typeof passwordMode === 'boolean' ? passwordMode : undefined
  } catch {
    return undefined
  }
}

function terminalAtTrustedShellPrompt (terminal) {
  try {
    return terminal?.isCommandSafetyTrackerReady?.() === true &&
      terminal?.cmdAddon?.hasShellIntegration?.() === true &&
      terminal?.cmdAddon?.isCommandInputActive?.() === true &&
      terminal?.cmdAddon?.getCurrentCommandInput?.() === ''
  } catch {
    return false
  }
}

export function getAgentCommandFillState ({
  presentation,
  activeTabId,
  terminal
} = {}) {
  if (presentation?.kind !== 'readonly-exec') {
    return denied('仅支持只读执行命令')
  }
  if (!String(presentation.command || '').trim()) {
    return denied('没有可填入的命令')
  }
  const settled = hasOwn(presentation, 'capturedAt') ||
    hasOwn(presentation, 'exitCode') ||
    hasOwn(presentation, 'output') ||
    hasOwn(presentation, 'error')
  if (!settled) return denied('只读执行仍在运行')
  if (!presentation.tabId) return denied('只读执行没有绑定 SSH 会话')
  if (String(activeTabId || '') !== String(presentation.tabId)) {
    return denied('请切换到执行该命令的 SSH 标签页')
  }
  if (!terminal) return denied('当前终端不可用')
  try {
    if (terminal.isSsh?.() !== true) return denied('当前标签页不是 SSH 终端')
  } catch {
    return denied('当前 SSH 终端不可用')
  }
  if (!terminalConnected(terminal)) return denied('当前 SSH 终端未连接')
  const passwordState = terminalPasswordState(terminal)
  if (passwordState === true) return denied('密码输入期间不能填入命令')
  if (passwordState !== false) return denied('无法可靠确认当前终端不在密码输入状态')
  const bufferType = terminal?.term?.buffer?.active?.type || terminal?.bufferMode
  if (bufferType !== 'normal') return denied('交互程序中不能填入命令')
  if (!terminalAtTrustedShellPrompt(terminal)) {
    return denied('无法可靠确认当前处于普通 Shell 提示符')
  }
  let currentInput
  try {
    if (typeof terminal.getCurrentInput !== 'function') {
      return denied('无法确认当前终端输入')
    }
    currentInput = String(terminal.getCurrentInput() ?? '')
  } catch {
    return denied('无法确认当前终端输入')
  }
  if (currentInput.length) return denied('当前终端已有输入')
  return Object.freeze({ allowed: true, reason: '' })
}

export async function fillAgentCommandIntoTerminal ({
  presentation,
  getActiveTabId,
  getTerminal,
  sendTerminalCommand,
  onError
} = {}) {
  let activeTabId
  let terminal
  try {
    activeTabId = getActiveTabId?.()
    terminal = activeTabId ? getTerminal?.(activeTabId) : null
  } catch {
    return Object.freeze({ sent: false, reason: '当前终端状态不可用' })
  }
  const fillState = getAgentCommandFillState({
    presentation,
    activeTabId,
    terminal
  })
  if (!fillState.allowed) {
    return Object.freeze({ sent: false, reason: fillState.reason })
  }
  try {
    await sendTerminalCommand?.({
      command: presentation.command,
      tabId: presentation.tabId,
      inputOnly: true,
      title: 'Agent 命令预览'
    })
    return Object.freeze({ sent: true, reason: '' })
  } catch (error) {
    onError?.(error)
    return Object.freeze({
      sent: false,
      reason: String(error?.message || '填入终端失败')
    })
  }
}
