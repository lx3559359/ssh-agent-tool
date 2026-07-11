import { buildSftpFileTerminalAnalysisPrompt } from './ai-ssh-context.js'

const DEFAULT_CONTEXT_LINES = 120
const REMOTE_TYPE = 'remote'
export const AI_FILE_PREVIEW_MAX_BYTES = 64 * 1024

export function replacePromptIfUnchanged (currentPrompt, expectedPrompt, nextPrompt) {
  return currentPrompt === expectedPrompt
    ? nextPrompt
    : currentPrompt
}

function joinPath (base = '', name = '') {
  const left = String(base || '')
  const right = String(name || '')
  if (!left) {
    return right
  }
  if (!right) {
    return left
  }
  const separator = left.includes('\\') ? '\\' : '/'
  return left.endsWith('/') || left.endsWith('\\')
    ? left + right
    : left + separator + right
}

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

export function getActiveSftpRef ({
  store = window.store,
  refs = window.refs
} = {}) {
  const tabId = store?.activeTabId
  if (!tabId || !refs?.get) {
    return null
  }
  return refs.get('sftp-' + tabId) || null
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
    file: '请在 SFTP 文件上右键选择“让 AI 分析此文件”。',
    web: '联网搜索入口还在开发中，后续会接入可配置搜索工具。',
    mcp: '当前没有启用的 MCP Server，请在模型 API 配置中添加并启用 MCP Server 后再引用。',
    cli: 'CLI 能力已可引用；执行本地命令或高风险命令前会要求用户确认。'
  }
  return messages[type] || '该能力还在开发中。'
}

export function shouldAutoAttachSelectedSftpFileContext (prompt = '') {
  const text = String(prompt || '').trim()
  if (!text) {
    return false
  }
  if (/SFTP\s+文件内容|远程路径：|本地路径：/.test(text)) {
    return false
  }
  return [
    /(查看|看看|看下|分析|解释|读取|检查|审查|总结|帮我看).{0,16}(这个|当前|选中|所选).{0,12}(文件|脚本|配置|日志)/,
    /(这个|当前|选中|所选).{0,12}(文件|脚本|配置|日志).{0,16}(查看|看看|看下|分析|解释|读取|检查|审查|总结)/,
    /(this|current|selected)\s+(file|script|config|configuration|log)/i
  ].some(pattern => pattern.test(text))
}

export async function readSftpFileContext ({
  file,
  sftp,
  fsApi = typeof window === 'undefined' ? undefined : window.fs,
  maxBytes = AI_FILE_PREVIEW_MAX_BYTES
} = {}) {
  if (!file) {
    return {
      ok: false,
      message: '当前没有可读取的文件。'
    }
  }
  if (file.isDirectory) {
    return {
      ok: false,
      message: '当前选择的是目录，请选择一个文件后再引用。'
    }
  }

  const filePath = joinPath(file.path, file.name)
  const isRemote = file.type === REMOTE_TYPE
  const reader = isRemote ? sftp : fsApi
  const size = file.size ?? ''

  try {
    if (typeof reader?.readFilePreview !== 'function') {
      return {
        ok: false,
        message: '当前连接不支持有界安全预览，无法保证安全读取上限，也无法判断文件是否为二进制，请重新连接或升级客户端。'
      }
    }
    const preview = await reader.readFilePreview(filePath, maxBytes)

    if (!preview || typeof preview !== 'object') {
      throw new Error('未返回文件预览内容')
    }
    if (preview.binary) {
      return {
        ok: false,
        message: '当前文件疑似二进制文件，已阻止发送给 AI。'
      }
    }

    return {
      ok: true,
      path: filePath,
      source: isRemote ? '远程 SFTP' : '本地文件',
      size,
      content: String(preview.content || ''),
      truncated: Boolean(preview.truncated),
      binary: false,
      bytesRead: Number(preview.bytesRead) || 0
    }
  } catch (err) {
    return {
      ok: false,
      message: `读取文件失败：${err?.message || '未知错误'}`
    }
  }
}

export async function readSelectedSftpFileContext ({
  sftpRef,
  fsApi
} = {}) {
  const files = sftpRef?.getSelectedFiles?.() || []
  if (!files.length) {
    return {
      ok: false,
      message: '当前 SFTP 没有选中文件，请先选择一个文件。'
    }
  }
  if (files.length > 1) {
    return {
      ok: false,
      message: '当前选择了多个文件，只允许一次分析单个文件。'
    }
  }
  return readSftpFileContext({
    file: files[0],
    sftp: sftpRef?.sftp,
    fsApi
  })
}

export async function buildSelectedSftpFileAnalysisPrompt ({
  sftpRef,
  termRef,
  fsApi
} = {}) {
  const fileContext = await readSelectedSftpFileContext({
    sftpRef,
    fsApi
  })
  if (!fileContext.ok) {
    return fileContext
  }
  return {
    ok: true,
    prompt: buildSftpFileTerminalAnalysisPrompt({
      source: fileContext.source,
      path: fileContext.path,
      size: fileContext.size,
      content: fileContext.content,
      terminalOutput: getTerminalOutputText(termRef),
      filePreviewTruncated: fileContext.truncated,
      previewBytesRead: fileContext.bytesRead
    })
  }
}
