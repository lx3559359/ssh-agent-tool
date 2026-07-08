const DEFAULT_MAX_CONTEXT_CHARS = 8000

function trimContextText (text = '', maxChars = DEFAULT_MAX_CONTEXT_CHARS) {
  const value = String(text || '').trim()
  if (value.length <= maxChars) {
    return {
      text: value,
      truncated: false
    }
  }
  return {
    text: value.slice(0, maxChars),
    truncated: true
  }
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
  const truncatedTip = context.truncated ? '\n\n注意：内容已截断，请先基于可见部分分析。' : ''
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
  const truncatedTip = context.truncated ? '\n\n注意：内容已截断，请先基于可见部分生成命令。' : ''
  return `${title}。只生成必要命令，并简要说明每条命令用途；不要直接执行命令，执行前必须由用户确认。\n\n\`\`\`text\n${context.text}\n\`\`\`${truncatedTip}`
}

export function buildSftpFileContextPrompt ({
  path = '',
  content = '',
  maxChars = DEFAULT_MAX_CONTEXT_CHARS
} = {}) {
  const context = trimContextText(content, maxChars)
  const truncatedTip = context.truncated ? '\n\n注意：内容已截断，请先基于可见部分分析。' : ''
  return `请分析下面的 SFTP 文件内容，指出可能的问题、风险和建议操作。\n\n远程路径：${path}\n\n\`\`\`text\n${context.text}\n\`\`\`${truncatedTip}`
}

export function prepareAICommandForTerminal (code = '') {
  return String(code || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .join('\n')
}

export async function confirmAndRunAICommand ({
  code = '',
  store,
  confirm
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
  store?.runCommandInTerminal?.(command)
  return true
}
