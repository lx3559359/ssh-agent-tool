const DEFAULT_MAX_CONTEXT_CHARS = 8000
const MAX_AI_COMMAND_CHARS = 2000
export const MAX_AI_FILE_CONTEXT_CHARS = 12000
export const MAX_AI_TERMINAL_CONTEXT_CHARS = 12000

const SHELL_CODE_LANGUAGES = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'fish',
  'powershell',
  'ps1',
  'cmd',
  'bat',
  'batch'
])

export function truncateAIContextText (text = '', maxChars = DEFAULT_MAX_CONTEXT_CHARS) {
  const value = String(text || '').trim()
  if (value.length <= maxChars) {
    return {
      text: value,
      truncated: false,
      originalLength: value.length
    }
  }
  return {
    text: value.slice(0, maxChars),
    truncated: true,
    originalLength: value.length
  }
}

function trimContextText (text = '', maxChars = DEFAULT_MAX_CONTEXT_CHARS) {
  return truncateAIContextText(text, maxChars)
}

function buildTruncatedTip (context, action = '分析') {
  return context.truncated
    ? `\n\n注意：内容已截断，原始长度 ${context.originalLength} 字符，请先基于可见部分${action}。`
    : ''
}

export function buildTerminalContextPrompt ({
  source = 'terminal',
  text = '',
  maxChars = DEFAULT_MAX_CONTEXT_CHARS
} = {}) {
  const context = trimContextText(text, maxChars)
  const title = source === 'selection'
    ? '请解释下面选中的终端内容'
    : '请分析当前 SSH 终端输出'
  const truncatedTip = buildTruncatedTip(context)
  return `${title}，请给出结论、证据和下一步建议。\n\n\`\`\`text\n${context.text}\n\`\`\`${truncatedTip}`
}

export function buildCommandSuggestionPrompt ({
  source = 'terminal',
  text = '',
  maxChars = DEFAULT_MAX_CONTEXT_CHARS
} = {}) {
  const context = trimContextText(text, maxChars)
  const title = source === 'selection'
    ? '请根据下面选中的终端内容生成排查命令'
    : '请根据当前 SSH 终端输出生成排查命令'
  const truncatedTip = buildTruncatedTip(context, '生成命令')
  return `${title}。只生成必要命令，并简要说明每条命令用途；不要直接执行命令，执行前必须由用户确认。\n\n\`\`\`text\n${context.text}\n\`\`\`${truncatedTip}`
}

export function buildSftpFileContextPrompt ({
  path = '',
  content = '',
  maxChars = DEFAULT_MAX_CONTEXT_CHARS
} = {}) {
  const context = trimContextText(content, maxChars)
  const truncatedTip = buildTruncatedTip(context)
  return `请分析下面的 SFTP 文件内容，指出可能的问题、风险和建议操作。\n\n远程路径：${path}\n\n\`\`\`text\n${context.text}\n\`\`\`${truncatedTip}`
}

export function buildSftpFileTerminalAnalysisPrompt ({
  source = '远程 SFTP',
  path = '',
  size = '',
  content = '',
  terminalOutput = '',
  filePreviewTruncated = false,
  previewBytesRead = 0,
  contentLimit = MAX_AI_FILE_CONTEXT_CHARS,
  terminalLimit = MAX_AI_TERMINAL_CONTEXT_CHARS
} = {}) {
  const fileContext = truncateAIContextText(content, contentLimit)
  const terminalContext = truncateAIContextText(terminalOutput, terminalLimit)
  const fileTip = buildTruncatedTip(fileContext)
  const terminalTip = terminalContext.truncated
    ? `\n\n注意：终端上下文已截断，原始长度 ${terminalContext.originalLength} 字符。`
    : ''
  const sizeText = size ? `\n文件大小：${size}` : ''
  const previewStatus = filePreviewTruncated
    ? `\n内容状态：仅安全读取前 ${previewBytesRead || '-'} 字节，文件仍有后续内容。`
    : ''
  const terminalBlock = terminalContext.text
    ? `\n\n当前终端上下文：\n\`\`\`text\n${terminalContext.text}\n\`\`\`${terminalTip}`
    : '\n\n当前终端上下文：未获取到可用终端输出。'

  return `请结合 SFTP 文件内容和当前 SSH 终端上下文进行排查分析。

要求：
1. 先判断这个文件可能和当前问题的关系。
2. 指出高风险配置、错误日志线索或可疑脚本逻辑。
3. 给出下一步排查建议。
4. 只生成命令建议，不要自动执行命令；危险命令必须标注风险。

文件来源：${source}
文件路径：${path}${sizeText}${previewStatus}

文件内容：
\`\`\`text
${fileContext.text}
\`\`\`${fileTip}${terminalBlock}`
}

export function prepareAICommandForTerminal (code = '') {
  return String(code || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .join('\n')
}

export function isShellCodeBlock (className = '') {
  return String(className)
    .split(/\s+/)
    .some(name => {
      const prefix = 'language-'
      return name.startsWith(prefix) &&
        SHELL_CODE_LANGUAGES.has(name.slice(prefix.length).toLowerCase())
    })
}

export function acquireAICommandExecutionLock (runningCommands, code = '') {
  const key = String(code)
  if (runningCommands.has(key)) {
    return false
  }
  runningCommands.add(key)
  return true
}

export function releaseAICommandExecutionLock (runningCommands, code = '') {
  runningCommands.delete(String(code))
}

export function buildAICommandResultSummaryPrompt ({
  command = '',
  result = '',
  maxChars = DEFAULT_MAX_CONTEXT_CHARS
} = {}) {
  const commandContext = truncateAIContextText(command, MAX_AI_COMMAND_CHARS)
  const resultText = typeof result === 'string'
    ? result
    : JSON.stringify(result, null, 2)
  const resultContext = truncateAIContextText(resultText, maxChars)
  const commandTip = commandContext.truncated
    ? `\n\n注意：命令内容已截断，原始长度 ${commandContext.originalLength} 字符。`
    : ''
  const resultTip = resultContext.truncated
    ? `\n\n注意：执行结果已截断，原始长度 ${resultContext.originalLength} 字符。`
    : ''

  return `请总结执行结果，说明命令是否成功、关键输出、风险和建议的下一步。\n\n执行命令：\n\`\`\`shell\n${commandContext.text}\n\`\`\`${commandTip}\n\n执行结果：\n\`\`\`text\n${resultContext.text}\n\`\`\`${resultTip}`
}

export async function confirmAndRunAICommand ({
  code = '',
  store,
  confirm,
  confirmResult,
  onResult
} = {}) {
  const command = prepareAICommandForTerminal(code)
  if (!command) {
    return false
  }
  const ask = typeof confirm === 'function'
    ? confirm
    : message => window.confirm(message)
  const accepted = await ask(`确认发送以下命令到当前终端：\n\n${command}`)
  if (!accepted) {
    return false
  }

  const tabId = store?.activeTabId
  if (
    typeof store?.runSafetyCommand === 'function' &&
    typeof store?.mcpWaitForTerminalIdle === 'function'
  ) {
    if (!tabId) {
      return false
    }
    const safetyResult = await store.runSafetyCommand(command, {
      tabId,
      source: 'agent',
      title: 'AI 代码块'
    })
    if (safetyResult?.sent !== true) {
      return false
    }
    const result = await store.mcpWaitForTerminalIdle({
      tabId,
      timeout: 30000,
      lines: 100
    })
    if (typeof onResult === 'function') {
      const confirmResultUpload = typeof confirmResult === 'function'
        ? confirmResult
        : ask
      const resultAccepted = await confirmResultUpload(
        '是否将最近终端输出发送给 AI？最近终端输出可能包含历史命令、路径、令牌或其他敏感信息，请确认后再发送。'
      )
      if (resultAccepted) {
        await onResult({ command, tabId, result })
      }
    }
  } else {
    return false
  }
  return true
}
