const { redactDiagnosticText } = require('../diagnostic-pack')

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const FORMATS = new Set(['md', 'html', 'json'])

function escapeHtml (value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function redactText (value) {
  return redactDiagnosticText(String(value || ''))
    .replace(/(\bpassword\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/(\bapi[_-]?key\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
}

function redactValue (value) {
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item)])
    )
  }
  return typeof value === 'string' ? redactText(value) : value
}

function normalizeIncident (incident = {}) {
  return redactValue({
    id: incident.id || '',
    title: incident.title || '',
    endpointRef: incident.endpointRef || '',
    state: incident.state || '',
    severity: incident.severity || '',
    summary: incident.summary || '',
    rootCause: incident.rootCause || '',
    resolution: incident.resolution || '',
    verificationStatus: incident.verificationStatus || '',
    serviceTags: incident.serviceTags || [],
    customTags: incident.customTags || [],
    notes: (incident.notes || []).map(note => ({
      body: note.body || '',
      createdAt: note.createdAt || 0
    })),
    timelineEvents: (incident.timelineEvents || []).map(event => ({
      title: event.title || '',
      body: event.body || '',
      source: event.source || '',
      createdAt: event.createdAt || 0
    })),
    createdAt: incident.createdAt || 0,
    updatedAt: incident.updatedAt || 0
  })
}

function formatTime (value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toISOString()
}

function markdownList (items) {
  return items.length ? items.map(item => `- ${item}`).join('\n') : '- 无'
}

function toMarkdown (incident) {
  const notes = incident.notes.map(
    note => `- ${formatTime(note.createdAt)} ${note.body}`
  )
  const timeline = incident.timelineEvents.map(
    event => `- ${formatTime(event.createdAt)} [${event.source || 'manual'}] ${event.title}: ${event.body}`
  )
  return [
    `# ${incident.title || '故障档案'}`,
    '',
    `- 档案编号：${incident.id || '-'}`,
    `- 服务器：${incident.endpointRef || '-'}`,
    `- 状态：${incident.state || '-'}`,
    `- 严重程度：${incident.severity || '-'}`,
    `- 验证状态：${incident.verificationStatus || '-'}`,
    `- 创建时间：${formatTime(incident.createdAt)}`,
    `- 更新时间：${formatTime(incident.updatedAt)}`,
    '',
    '## 摘要',
    incident.summary || '无',
    '',
    '## 根因',
    incident.rootCause || '未确认',
    '',
    '## 处理方案',
    incident.resolution || '无',
    '',
    '## 服务标签',
    markdownList(incident.serviceTags),
    '',
    '## 自定义标签',
    markdownList(incident.customTags),
    '',
    '## 时间线',
    markdownList(timeline),
    '',
    '## 备注',
    markdownList(notes),
    ''
  ].join('\n')
}

function toHtml (incident) {
  const markdown = toMarkdown(incident)
  const body = markdown.split('\n').map(line => {
    if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`
    if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`
    if (line.startsWith('- ')) return `<li>${escapeHtml(line.slice(2))}</li>`
    return line ? `<p>${escapeHtml(line)}</p>` : ''
  }).join('\n')
  return [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(incident.title || '故障档案')}</title>`,
    '<style>body{max-width:960px;margin:32px auto;padding:0 24px;font:15px/1.7 system-ui;color:#1f2328}h1,h2{line-height:1.3}li{margin:4px 0}</style>',
    `</head><body>${body}</body></html>`
  ].join('')
}

function truncateUtf8 (content, maxBytes) {
  const buffer = Buffer.from(content, 'utf8')
  if (buffer.length <= maxBytes) return content
  const suffix = '\n\n[内容已按导出大小上限截断]\n'
  const suffixBuffer = Buffer.from(suffix, 'utf8')
  const safeSlice = (value, limit) => {
    let end = Math.min(value.length, Math.max(0, limit))
    while (end > 0 && (value[end] & 0xc0) === 0x80) {
      end -= 1
    }
    return value.subarray(0, end)
  }
  if (suffixBuffer.length >= maxBytes) {
    return safeSlice(suffixBuffer, maxBytes).toString('utf8')
  }
  return Buffer.concat([
    safeSlice(buffer, maxBytes - suffixBuffer.length),
    suffixBuffer
  ]).toString('utf8')
}

function exportIncident (incident, options = {}) {
  const format = FORMATS.has(options.format) ? options.format : 'md'
  const maxBytes = Math.max(
    4096,
    Number(options.maxBytes) || DEFAULT_MAX_BYTES
  )
  const normalized = normalizeIncident(incident)
  const content = format === 'json'
    ? JSON.stringify(normalized, null, 2)
    : format === 'html'
      ? toHtml(normalized)
      : toMarkdown(normalized)
  return {
    format,
    content: truncateUtf8(content, maxBytes),
    extension: format,
    mimeType: format === 'html'
      ? 'text/html'
      : format === 'json'
        ? 'application/json'
        : 'text/markdown'
  }
}

module.exports = {
  exportIncident
}
