const MAX_ARTIFACTS = 5
const MAX_ARTIFACT_CHARACTERS = 256 * 1024

const formatExtensions = Object.freeze({
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  csv: 'csv',
  json: 'json',
  html: 'html'
})

export const GENERATED_ARTIFACT_FORMATS = new Set(
  Object.keys(formatExtensions)
)

function normalizeFormat (value) {
  const format = String(value || '').trim().toLowerCase()
  return GENERATED_ARTIFACT_FORMATS.has(format) ? format : 'txt'
}

function extensionFor (format) {
  return formatExtensions[normalizeFormat(format)]
}

function escapeHtml (value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function readAttribute (attributes, name) {
  const expression = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i')
  return attributes.match(expression)?.[2] || ''
}

function replaceInvalidFilenameCharacters (value) {
  return [...String(value || '')].map(character => {
    const code = character.charCodeAt(0)
    return code <= 31 || /[\\/:*?"<>|]/.test(character)
      ? '-'
      : character
  }).join('')
}

export function sanitizeAIGeneratedFilename (value, format = 'txt') {
  const extension = extensionFor(format)
  const raw = replaceInvalidFilenameCharacters(value).trim()
    .replace(/\s+/g, ' ')
    .replace(/^[-. ]+|[-. ]+$/g, '')
  const stem = raw.replace(/\.[a-z0-9]{1,12}$/i, '').slice(0, 96) || 'ShellPilot-AI-输出'
  return `${stem}.${extension}`
}

function parseMarkdownTable (value) {
  const lines = String(value || '').split(/\r?\n/)
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (!/\|/.test(lines[index]) || !/^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) continue
    const rows = [lines[index]]
    for (let cursor = index + 2; cursor < lines.length && /\|/.test(lines[cursor]); cursor += 1) {
      rows.push(lines[cursor])
    }
    if (rows.length < 2) continue
    return rows.map(line => line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map(cell => cell.trim())
    )
  }
  return null
}

function toCsv (rows) {
  return rows.map(row => row.map(cell => {
    const value = String(cell || '')
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  }).join(',')).join('\n') + '\n'
}

export function stripAIGeneratedArtifactBlocks (response) {
  return String(response || '')
    .replace(/<shellpilot-file\b[^>]*>[\s\S]*?<\/shellpilot-file>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
}

export function extractAIGeneratedArtifacts (response) {
  const source = String(response || '')
  const expression = /<shellpilot-file\b([^>]*)>([\s\S]*?)<\/shellpilot-file>/gi
  const files = []
  let match
  while ((match = expression.exec(source)) && files.length < MAX_ARTIFACTS) {
    const content = match[2]
    if (content.length > MAX_ARTIFACT_CHARACTERS) continue
    const format = normalizeFormat(readAttribute(match[1], 'format'))
    files.push(Object.freeze({
      format: extensionFor(format),
      filename: sanitizeAIGeneratedFilename(readAttribute(match[1], 'name'), format),
      content
    }))
  }
  return files
}

function htmlDocument (content, title) {
  return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>body{max-width:960px;margin:40px auto;padding:0 20px;color:#1f2937;font:15px/1.65 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif}pre{padding:16px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f8fa;border-radius:8px}</style>\n</head>\n<body><pre>${escapeHtml(content)}</pre></body>\n</html>\n`
}

export function buildAIResponseExports (response, options = {}) {
  const content = stripAIGeneratedArtifactBlocks(response).trim()
  const stem = String(options.filenameStem || 'ShellPilot-AI-回答')
  const make = (format, value) => Object.freeze({
    format,
    filename: sanitizeAIGeneratedFilename(stem, format),
    content: value
  })
  const responseFiles = {
    markdown: make('md', content),
    text: make('txt', content),
    html: make('html', htmlDocument(content, stem)),
    json: make('json', JSON.stringify({
      generatedAt: new Date().toISOString(),
      content
    }, null, 2) + '\n')
  }
  const table = parseMarkdownTable(content)
  if (table) responseFiles.csv = make('csv', toCsv(table))
  return Object.freeze(responseFiles)
}
