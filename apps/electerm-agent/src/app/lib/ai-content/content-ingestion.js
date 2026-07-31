const path = require('node:path')
const JSZip = require('jszip')
const ExcelJS = require('exceljs')
const pdf = require('pdf-parse')

const MAX_INPUT_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_TEXT_CHARS = 120000
const DOCUMENT_EXTENSIONS = new Set([
  '.txt', '.log', '.md', '.json', '.csv', '.xml', '.yaml', '.yml',
  '.ini', '.conf', '.cfg', '.html', '.htm', '.pdf', '.docx', '.xlsx',
  '.pptx'
])
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif'
])
const IMAGE_MIME_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
})
const SUPPORTED_IMAGE_MIMES = new Set(Object.values(IMAGE_MIME_BY_EXTENSION))

function decodeXml (value) {
  return String(value || '')
    .replace(/<w:tab\/>|<a:tab\/>/g, '\t')
    .replace(/<\/w:p>|<\/a:p>/g, '\n')
    .replace(/<w:br\/>|<a:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function boundedText (value, maxChars) {
  const text = String(value || '')
  const limit = Math.max(32, Number(maxChars) || DEFAULT_MAX_TEXT_CHARS)
  if (text.length <= limit) {
    return { text, truncated: false }
  }
  const suffix = '\n[内容已按上限截断]'
  return {
    text: `${text.slice(0, Math.max(0, limit - suffix.length))}${suffix}`,
    truncated: true
  }
}

async function readZipXml (buffer, selector) {
  const zip = await JSZip.loadAsync(buffer)
  const files = Object.values(zip.files)
    .filter(file => !file.dir && selector(file.name))
    .sort((left, right) => left.name.localeCompare(
      right.name,
      undefined,
      { numeric: true }
    ))
  const values = []
  for (const file of files) {
    values.push(decodeXml(await file.async('string')))
  }
  return values.filter(Boolean).join('\n\n')
}

async function readWorkbook (buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const rows = []
  workbook.eachSheet(sheet => {
    rows.push(`# 工作表：${sheet.name}`)
    sheet.eachRow({ includeEmpty: false }, row => {
      rows.push(row.values.slice(1).map(value => {
        if (value == null) return ''
        if (typeof value === 'object') {
          return value.text || value.result || value.hyperlink ||
            JSON.stringify(value)
        }
        return String(value)
      }).join('\t'))
    })
  })
  return rows.join('\n')
}

function normalizeBuffer (value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  if (typeof value === 'string') return Buffer.from(value, 'base64')
  throw new TypeError('文件内容格式无效。')
}

function isDocumentExtension (extension) {
  return DOCUMENT_EXTENSIONS.has(String(extension || '').toLowerCase())
}

async function ingestBuffer ({
  name = 'attachment',
  mimeType = '',
  buffer,
  maxInputBytes = MAX_INPUT_BYTES,
  maxTextChars = DEFAULT_MAX_TEXT_CHARS
} = {}) {
  const value = normalizeBuffer(buffer)
  if (!value.length) {
    throw new Error('文件为空，无法读取。')
  }
  if (value.length > maxInputBytes) {
    throw new Error(
      `文件超过 ${Math.round(maxInputBytes / 1024 / 1024)} MB 读取上限。`
    )
  }

  const extension = path.extname(name).toLowerCase()
  const declaredImageMime = String(mimeType || '').toLowerCase()
  const imageMime = SUPPORTED_IMAGE_MIMES.has(declaredImageMime)
    ? declaredImageMime
    : IMAGE_MIME_BY_EXTENSION[extension]
  if (imageMime || IMAGE_EXTENSIONS.has(extension)) {
    const resolvedMime = imageMime || 'image/png'
    return {
      kind: 'image',
      name,
      mimeType: resolvedMime,
      bytes: value.length,
      dataUrl: `data:${resolvedMime};base64,${value.toString('base64')}`
    }
  }
  if (
    declaredImageMime.startsWith('image/') ||
    ['.bmp', '.svg', '.tif', '.tiff', '.ico'].includes(extension)
  ) {
    throw new Error('暂不支持该图片格式，请转换为 PNG、JPEG、WebP 或 GIF。')
  }

  let text
  if (extension === '.docx') {
    text = await readZipXml(value, filename => (
      /^word\/(document|header\d+|footer\d+)\.xml$/i.test(filename)
    ))
  } else if (extension === '.pptx') {
    text = await readZipXml(value, filename => (
      /^ppt\/slides\/slide\d+\.xml$/i.test(filename)
    ))
  } else if (extension === '.xlsx') {
    text = await readWorkbook(value)
  } else if (extension === '.pdf') {
    text = String((await pdf(value))?.text || '')
  } else if (
    isDocumentExtension(extension) ||
    /^text\//i.test(mimeType) ||
    /(?:json|xml|yaml|csv)/i.test(mimeType)
  ) {
    text = value.toString('utf8').replace(/^\uFEFF/, '')
  } else {
    throw new Error(
      `暂不支持读取 ${extension || mimeType || '未知'} 格式。`
    )
  }

  const bounded = boundedText(text, maxTextChars)
  return {
    kind: 'text',
    name,
    mimeType: mimeType || 'text/plain',
    bytes: value.length,
    text: bounded.text,
    truncated: bounded.truncated
  }
}

module.exports = {
  ingestBuffer,
  isDocumentExtension,
  MAX_INPUT_BYTES,
  DEFAULT_MAX_TEXT_CHARS
}
