const DEFAULT_CONTEXT_LINES = 120

export function getActiveTerminalRef ({
  store = window.store,
  refs = window.refs
} = {}) {
  const tabId = store?.activeTabId
  if (!tabId || !refs?.get) {
    return null
  }
  return refs.get('term-' + tabId) || null
}

export function getTerminalSelectionText (termRef) {
  return termRef?.term?.getSelection?.() || ''
}

export function getTerminalOutputText (termRef, lineCount = DEFAULT_CONTEXT_LINES) {
  if (typeof termRef?.getTerminalBufferText === 'function') {
    return termRef.getTerminalBufferText()
  }
  const buffer = termRef?.term?.buffer?.active
  if (!buffer) {
    return ''
  }
  const cursorY = buffer.cursorY || 0
  const baseY = buffer.baseY || 0
  const totalLines = buffer.length || 0
  const contentEnd = baseY + cursorY + 1
  const startLine = Math.max(0, contentEnd - lineCount)
  const endLine = Math.min(totalLines, contentEnd)
  const lines = []

  for (let index = startLine; index < endLine; index++) {
    const line = buffer.getLine(index)
    if (line) {
      lines.push(line.translateToString(true))
    }
  }

  return lines.join('\n').trim()
}

export function getAIContextUnavailableMessage (type) {
  const messages = {
    terminal: '当前没有可引用的终端输出，请先打开或连接一个终端。',
    selection: '当前终端没有选中文本，请先在终端中选中内容。',
    file: '请在 SFTP 文件上右键选择“AI 引用文件”。',
    web: '联网搜索入口还在开发中，后续会接入可配置搜索工具。',
    mcp: 'MCP 入口还在开发中，后续会读取已配置的 MCP Server。',
    cli: 'CLI 工具入口还在开发中，危险命令会要求用户确认。'
  }
  return messages[type] || '该能力还在开发中。'
}
