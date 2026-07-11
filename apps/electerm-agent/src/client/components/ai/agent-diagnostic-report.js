const REDACTED = '[已脱敏]'

function formatStamp (value) {
  const date = new Date(value || Date.now())
  const pad = n => String(n).padStart(2, '0')
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join('')
}

function redactText (value) {
  return String(value || '')
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, REDACTED)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^@\s/]+)(@)/ig, `$1${REDACTED}$3`)
    .replace(/((?:api[-_ ]?key|apikey|token|secret|password|passphrase|private[-_ ]?key|proxy[-_ ]?password)\s*[:=]\s*["']?)[^"'\r\n]+/ig, `$1${REDACTED}`)
}

function extractCodeBlocks (text) {
  const blocks = []
  const pattern = /```[^\n]*\n([\s\S]*?)```/g
  let match
  while ((match = pattern.exec(String(text || '')))) {
    const value = match[1].trim()
    if (value) {
      blocks.push(value)
    }
  }
  return blocks
}

function uniqueList (items) {
  return [...new Set(items.map(item => String(item || '').trim()).filter(Boolean))]
}

function escapeHtml (value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function markdownCode (value, lang = 'text') {
  return '```' + lang + '\n' + String(value || '').trim() + '\n```'
}

function buildReportData ({ item = {}, now } = {}) {
  const terminalSummary = redactText(
    extractCodeBlocks(item.prompt)[0] || item.prompt || ''
  )
  const aiAnalysis = redactText(item.response || '')
  const toolCommands = (item.toolCalls || [])
    .map(call => call?.args?.command)
  const suggestedActions = uniqueList([
    ...extractCodeBlocks(item.response),
    ...toolCommands
  ].map(redactText))

  return {
    app: 'ShellPilot',
    createdAt: now || new Date().toISOString(),
    model: item.modelAI || '',
    provider: item.nameAI || '',
    terminalSummary,
    aiAnalysis,
    suggestedActions
  }
}

function buildMarkdown (data) {
  const actions = data.suggestedActions.length
    ? data.suggestedActions.map(action => '- ' + markdownCode(action, 'bash')).join('\n')
    : '- 暂无明确建议操作。'
  return [
    '# ShellPilot Agent 诊断报告',
    '',
    `生成时间：${data.createdAt}`,
    data.provider || data.model ? `模型：${[data.provider, data.model].filter(Boolean).join(' / ')}` : '',
    '',
    '## 终端输出摘要',
    '',
    markdownCode(data.terminalSummary || '无终端上下文。'),
    '',
    '## AI 分析',
    '',
    data.aiAnalysis || '无 AI 分析内容。',
    '',
    '## 建议操作',
    '',
    actions,
    ''
  ].filter(line => line !== '').join('\n')
}

function buildHtml (data) {
  const actions = data.suggestedActions.length
    ? data.suggestedActions.map(action => `<li><pre><code>${escapeHtml(action)}</code></pre></li>`).join('\n')
    : '<li>暂无明确建议操作。</li>'
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>ShellPilot Agent 诊断报告</title>',
    '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6;padding:24px;color:#1f2937}pre{background:#0f172a;color:#e5e7eb;padding:12px;border-radius:6px;overflow:auto}</style>',
    '</head>',
    '<body>',
    '<h1>ShellPilot Agent 诊断报告</h1>',
    `<p>生成时间：${escapeHtml(data.createdAt)}</p>`,
    `<p>模型：${escapeHtml([data.provider, data.model].filter(Boolean).join(' / '))}</p>`,
    '<h2>终端输出摘要</h2>',
    `<pre><code>${escapeHtml(data.terminalSummary || '无终端上下文。')}</code></pre>`,
    '<h2>AI 分析</h2>',
    `<pre><code>${escapeHtml(data.aiAnalysis || '无 AI 分析内容。')}</code></pre>`,
    '<h2>建议操作</h2>',
    `<ul>${actions}</ul>`,
    '</body>',
    '</html>'
  ].join('\n')
}

export function buildAgentDiagnosticReportFiles (options = {}) {
  const data = buildReportData(options)
  const stamp = formatStamp(options.now || data.createdAt)
  return {
    markdown: {
      filename: `ShellPilot-agent-report-${stamp}.md`,
      content: buildMarkdown(data)
    },
    html: {
      filename: `ShellPilot-agent-report-${stamp}.html`,
      content: buildHtml(data)
    },
    json: {
      filename: `ShellPilot-agent-report-${stamp}.json`,
      content: JSON.stringify(data, null, 2)
    }
  }
}
