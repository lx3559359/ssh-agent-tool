import uid from '../../common/uid.js'
import {
  AI_FILE_PREVIEW_MAX_BYTES,
  readSftpFileContext
} from './ai-chat-context-actions.js'

function splitLocalPath (filePath = '', fallbackName = '') {
  const value = String(filePath || '')
  const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  if (index === -1) {
    return {
      path: '',
      name: fallbackName || value
    }
  }
  return {
    path: value.slice(0, index),
    name: value.slice(index + 1)
  }
}

export function createLocalFileAttachments (fileList = []) {
  return Array.from(fileList || []).map(file => ({
    id: uid(),
    source: 'local',
    name: file.name || splitLocalPath(file.path).name,
    path: file.path || '',
    size: file.size,
    file
  })).filter(item => item.name)
}

export function parseSftpDropPayload (payload = '') {
  if (!payload) {
    return []
  }
  let files = []
  try {
    files = JSON.parse(payload)
  } catch {
    return []
  }
  return files
    .filter(file => file && !file.isDirectory)
    .map(file => ({
      id: uid(),
      source: 'sftp',
      name: file.name,
      path: file.path,
      size: file.size,
      file
    }))
}

async function readBrowserFileAttachment (attachment, maxBytes) {
  if (typeof attachment.file?.text !== 'function') {
    return {
      ok: false,
      message: '本地文件缺少可读取路径，无法引用。'
    }
  }
  const text = await attachment.file.text()
  const content = text.slice(0, maxBytes)
  return {
    ok: true,
    source: '本地文件',
    path: attachment.name,
    size: attachment.size,
    content,
    truncated: text.length > content.length,
    bytesRead: content.length
  }
}

async function readLocalAttachment (attachment, fsApi, maxBytes) {
  if (!attachment.path) {
    return readBrowserFileAttachment(attachment, maxBytes)
  }
  const localPath = splitLocalPath(attachment.path, attachment.name)
  return readSftpFileContext({
    file: {
      name: localPath.name,
      path: localPath.path,
      type: 'local',
      size: attachment.size,
      isDirectory: false
    },
    fsApi,
    maxBytes
  })
}

async function readSftpAttachment (attachment, sftpRef, fsApi, maxBytes) {
  return readSftpFileContext({
    file: attachment.file,
    sftp: sftpRef?.sftp,
    fsApi,
    maxBytes
  })
}

function formatAttachmentContext (context) {
  const truncated = context.truncated
    ? `\n内容状态：已读取前 ${context.bytesRead || '-'} 字节，后续内容未全部发送；如需更多上下文，请继续读取下一段或按关键词搜索。`
    : ''
  return `文件：${context.path}
来源：${context.source}${context.size ? `\n大小：${context.size}` : ''}${truncated}

\`\`\`text
${context.content}
\`\`\``
}

export async function buildAttachmentContextPrompt ({
  attachments = [],
  fsApi,
  sftpRef,
  maxBytes = AI_FILE_PREVIEW_MAX_BYTES
} = {}) {
  const blocks = []
  for (const attachment of attachments) {
    const context = attachment.source === 'sftp'
      ? await readSftpAttachment(attachment, sftpRef, fsApi, maxBytes)
      : await readLocalAttachment(attachment, fsApi, maxBytes)
    if (!context.ok) {
      blocks.push(`文件：${attachment.name}\n读取失败：${context.message}`)
      continue
    }
    blocks.push(formatAttachmentContext(context))
  }
  return blocks.length
    ? `请结合以下附件内容回答用户问题。\n\n${blocks.join('\n\n---\n\n')}`
    : ''
}
