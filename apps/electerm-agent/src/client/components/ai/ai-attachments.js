import uid from '../../common/uid.js'
import {
  AI_FILE_PREVIEW_MAX_BYTES,
  readSftpFileContext
} from './ai-chat-context-actions.js'
import { readAIWebContent } from './ai-web-access-client.js'

const MAX_AI_CONTENT_BYTES = 10 * 1024 * 1024
const LEGACY_TEXT_FILE_PATTERN = /\.(?:txt|log|md|json|csv|xml|ya?ml|ini|conf|cfg|sh|bash|zsh|fish|ps1|bat|cmd|sql|html?|css|js|jsx|ts|tsx|py|rb|php|java|go|rs|c|cc|cpp|h|hpp)$/i
const ARCHIVE_FILE_PATTERN = /\.(?:zip|tgz|tar\.gz|gz)$/i
const SAFE_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
])
const SAFE_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

function getAttachmentExtension (name = '') {
  const match = String(name).trim().toLowerCase().match(/\.([a-z0-9]+)$/)
  return match?.[1] || ''
}

function formatAttachmentSize (value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) {
    return `${Number(kilobytes.toFixed(1))} KB`
  }
  return `${Number((kilobytes / 1024).toFixed(1))} MB`
}

export function getAIAttachmentPresentation (attachment = {}) {
  const extension = getAttachmentExtension(attachment.name)
  const mimeType = String(
    attachment.mimeType || attachment.file?.type || ''
  ).trim().toLowerCase()
  const hasSupportedImageMime = SAFE_IMAGE_MIME_TYPES.has(mimeType)
  const hasSupportedImageExtension = !mimeType && SAFE_IMAGE_EXTENSIONS.has(extension)
  const kind = attachment.source === 'url'
    ? 'web'
    : (hasSupportedImageMime || hasSupportedImageExtension ? 'image' : 'file')
  const typeLabel = kind === 'web'
    ? 'WEB'
    : (extension ? extension.toUpperCase() : 'FILE')
  const sizeLabel = formatAttachmentSize(
    attachment.size ?? attachment.file?.size
  )

  return {
    kind,
    extension,
    typeLabel,
    sizeLabel,
    meta: [typeLabel, sizeLabel].filter(Boolean).join(' · ')
  }
}

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

function joinAttachmentPath (attachment = {}) {
  const file = attachment.file || {}
  const base = String(file.path || attachment.path || '')
  const name = String(file.name || attachment.name || '')
  if (!base) return name
  if (
    base === name ||
    base.endsWith(`/${name}`) ||
    base.endsWith(`\\${name}`)
  ) {
    return base
  }
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return `${base.replace(/[\\/]$/, '')}${separator}${name}`
}

function arrayBufferToBase64 (buffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    )
  }
  return btoa(binary)
}

async function unwrapIngestionResult (operation) {
  const result = await operation
  if (!result?.ok) {
    const error = new Error(result?.error?.message || '内容读取失败。')
    error.code = result?.error?.code
    error.details = result?.error?.details
    throw error
  }
  return result.value
}

async function ingestAIContent (payload) {
  return unwrapIngestionResult(
    window.pre.runGlobalAsync('ingestAIContent', payload)
  )
}

async function readBrowserFilePayload (attachment) {
  const file = attachment.file
  if (typeof file?.arrayBuffer !== 'function') {
    throw new Error('本地文件缺少可读取内容。')
  }
  if (Number(file.size || 0) > MAX_AI_CONTENT_BYTES) {
    throw new Error('文件超过 10 MB 读取上限。')
  }
  const value = await file.arrayBuffer()
  if (value.byteLength > MAX_AI_CONTENT_BYTES) {
    throw new Error('文件超过 10 MB 读取上限。')
  }
  return {
    name: attachment.name,
    mimeType: attachment.mimeType || file.type || '',
    dataBase64: arrayBufferToBase64(value)
  }
}

async function readPathFilePayload (attachment, reader) {
  if (typeof reader?.readFileBase64Preview !== 'function') {
    throw new Error('当前连接不支持安全读取该文件，请重新连接或升级客户端。')
  }
  const result = await reader.readFileBase64Preview(
    joinAttachmentPath(attachment),
    MAX_AI_CONTENT_BYTES
  )
  if (result?.truncated) {
    throw new Error('文件超过 10 MB 读取上限。')
  }
  return {
    name: attachment.name,
    mimeType: attachment.mimeType || attachment.file?.mimeType || '',
    dataBase64: result?.base64 || ''
  }
}

async function readRemoteFilePayload (attachment, sftpRef, signal) {
  if (typeof sftpRef?.readRemoteFileAttachment !== 'function') {
    throw new Error('当前连接不支持安全读取该文件，请重新连接或升级客户端。')
  }
  const result = await sftpRef.readRemoteFileAttachment(
    getLegacyAttachmentFile(attachment),
    { maxBytes: MAX_AI_CONTENT_BYTES, signal }
  )
  if (result?.truncated) {
    throw new Error('文件超过 10 MB 读取上限。')
  }
  return {
    name: attachment.name,
    mimeType: attachment.mimeType || attachment.file?.mimeType || '',
    dataBase64: result?.base64 || ''
  }
}

async function ingestAttachment (
  attachment,
  { fsApi, sftpRef, requestWebAccessAuthorization, signal }
) {
  if (attachment.source === 'url') {
    return readAIWebContent({
      url: attachment.url,
      readId: attachment.readId,
      requestAuthorization: requestWebAccessAuthorization
    })
  }
  let payload
  if (attachment.source === 'sftp') {
    payload = await readRemoteFilePayload(attachment, sftpRef, signal)
  } else if (attachment.path) {
    payload = await readPathFilePayload(attachment, fsApi)
  } else {
    payload = await readBrowserFilePayload(attachment)
  }
  return ingestAIContent({
    kind: 'file',
    ...payload
  })
}

function getLegacyAttachmentFile (attachment = {}) {
  if (attachment.file?.name) return attachment.file
  const value = splitLocalPath(attachment.path, attachment.name)
  return {
    name: attachment.name || value.name,
    path: value.path,
    type: attachment.source === 'sftp' ? 'remote' : 'local',
    size: attachment.size,
    isDirectory: false
  }
}

function shouldUseLegacyFileReader (attachment = {}, { fsApi } = {}) {
  if (!['local', 'sftp'].includes(attachment.source)) return false
  if (attachment.source === 'local' && !attachment.path) return false
  const name = String(attachment.name || attachment.path || '')
  if (attachment.source === 'sftp') {
    return LEGACY_TEXT_FILE_PATTERN.test(name) || ARCHIVE_FILE_PATTERN.test(name)
  }
  const reader = fsApi
  if (ARCHIVE_FILE_PATTERN.test(name)) {
    return typeof reader?.listArchive === 'function' &&
      typeof reader?.readArchiveTextEntry === 'function'
  }
  return LEGACY_TEXT_FILE_PATTERN.test(name) &&
    typeof reader?.readFilePreview === 'function'
}

async function readLegacyAttachmentContext (
  attachment,
  { fsApi, sftpRef, maxBytes, signal }
) {
  if (attachment.source === 'sftp') {
    if (typeof sftpRef?.readRemoteFileContext !== 'function') {
      throw new Error('当前连接不支持安全读取该文件，请重新连接或升级客户端。')
    }
    const context = await sftpRef.readRemoteFileContext(
      getLegacyAttachmentFile(attachment),
      { maxBytes, signal }
    )
    if (!context?.ok) {
      throw new Error(context?.message || '文件读取失败。')
    }
    return context
  }
  const context = await readSftpFileContext({
    file: getLegacyAttachmentFile(attachment),
    fsApi,
    maxBytes
  })
  if (!context?.ok) {
    throw new Error(context?.message || '文件读取失败。')
  }
  return context
}

function formatLegacyFileContext (context) {
  const details = []
  if (context.archiveType) {
    details.push(`压缩包类型：${context.archiveType}`)
  }
  if (context.truncated) {
    details.push('内容状态：当前为安全预览，文件仍有后续内容，可继续读取（支持分段）。')
  }
  return `文件：${context.path}
来源：${context.source}
${details.length ? `${details.join('\n')}\n` : ''}
\`\`\`text
${context.content}
\`\`\``
}

function formatTextContent (content) {
  const status = content.truncated
    ? '\n内容状态：已按安全上限截断。'
    : ''
  return `文件：${content.name}
来源：${content.url ? `网页 ${content.url}` : '附件'}${status}

\`\`\`text
${content.text}
\`\`\``
}

export function createLocalFileAttachments (fileList = []) {
  return Array.from(fileList || []).map(file => ({
    id: uid(),
    source: 'local',
    name: file.name || splitLocalPath(file.path).name,
    path: file.path || '',
    size: file.size,
    mimeType: file.type || '',
    file
  })).filter(item => item.name)
}

export function createWebAttachment (url) {
  const value = String(url || '').trim()
  return value
    ? {
        id: uid(),
        source: 'url',
        name: value,
        path: value,
        url: value,
        readId: uid()
      }
    : null
}

export function parseSftpDropPayload (payload = '') {
  if (!payload) return []
  let files = []
  try {
    files = JSON.parse(payload)
  } catch {
    return []
  }
  return files
    ? createSftpFileAttachments(files)
    : []
}

export function createSftpFileAttachments (files = []) {
  return Array.from(files || [])
    .filter(file => file && !file.isDirectory && file.name)
    .map(file => ({
      id: uid(),
      source: 'sftp',
      name: file.name,
      path: file.path,
      size: file.size,
      mimeType: file.mimeType || '',
      file
    }))
}

export async function buildAttachmentAIContent ({
  attachments = [],
  fsApi,
  sftpRef,
  requestWebAccessAuthorization,
  maxBytes = AI_FILE_PREVIEW_MAX_BYTES,
  signal
} = {}) {
  const blocks = []
  const imageParts = []
  const errors = []
  for (const attachment of attachments) {
    try {
      if (shouldUseLegacyFileReader(attachment, { fsApi, sftpRef })) {
        const context = await readLegacyAttachmentContext(attachment, {
          fsApi,
          sftpRef,
          maxBytes,
          signal
        })
        blocks.push(formatLegacyFileContext(context))
        continue
      }
      const content = await ingestAttachment(attachment, {
        fsApi,
        sftpRef,
        requestWebAccessAuthorization,
        signal
      })
      if (content.kind === 'image') {
        blocks.push(`图片：${content.name}（已作为视觉内容发送）`)
        imageParts.push({
          type: 'image_url',
          image_url: {
            url: content.dataUrl,
            detail: 'auto'
          }
        })
      } else if (content.kind === 'web') {
        blocks.push(formatTextContent({
          ...content,
          name: content.title || content.url
        }))
      } else {
        blocks.push(formatTextContent(content))
      }
    } catch (error) {
      if (error?.code === 'WEB_ACCESS_CANCELLED') {
        continue
      }
      errors.push(
        `${attachment.name}：${error?.message || '读取失败'}`
      )
    }
  }
  return {
    prompt: blocks.length
      ? `请结合以下内容回答用户问题。\n\n${blocks.join('\n\n---\n\n')}`
      : '',
    aiContentParts: imageParts,
    errors
  }
}

export async function buildAttachmentContextPrompt (options = {}) {
  const result = await buildAttachmentAIContent(options)
  return result.prompt
}
