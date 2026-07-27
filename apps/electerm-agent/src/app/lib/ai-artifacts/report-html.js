const {
  validateArtifactDraft
} = require('./artifact-validator')

function safeText (value) {
  return String(value || '')
    .replace(/javascript\s*:/gi, '[已拦截协议]')
    .replace(/on[a-z]+\s*=/gi, '[已拦截属性]')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function paragraphs (value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => `<p>${safeText(line)}</p>`)
    .join('')
}

function renderList (values, emptyText) {
  if (!values.length) return `<p class="muted">${safeText(emptyText)}</p>`
  return `<ul>${values.map(value => `<li>${safeText(value)}</li>`).join('')}</ul>`
}

function renderTable (table, index) {
  const width = Math.max(
    1,
    table.columns.length,
    ...table.rows.map(row => row.length)
  )
  const columns = Array.from(
    { length: width },
    (_, columnIndex) => table.columns[columnIndex] || `第 ${columnIndex + 1} 列`
  )
  return `
    <section>
      <h2>${safeText(table.title || `表格 ${index + 1}`)}</h2>
      <table>
        <thead><tr>${columns.map(value => `<th>${safeText(value)}</th>`).join('')}</tr></thead>
        <tbody>${table.rows.map(row => (
          `<tr>${columns.map((_, columnIndex) => (
            `<td>${safeText(row[columnIndex] || '')}</td>`
          )).join('')}</tr>`
        )).join('')}</tbody>
      </table>
    </section>`
}

function buildPrintableReportHtml (source) {
  const draft = validateArtifactDraft(source)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${safeText(draft.title)}</title>
  <style>
    @page { size: A4; margin: 16mm 14mm 18mm; }
    * { box-sizing: border-box; }
    body { color: #202124; font: 13px/1.65 "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
    h1 { margin: 0 0 6px; font-size: 25px; text-align: center; }
    h2 { margin: 20px 0 8px; font-size: 17px; color: #0b57d0; }
    p { margin: 4px 0; white-space: pre-wrap; }
    .server { margin-bottom: 20px; color: #5f6368; text-align: center; }
    .summary { padding: 12px 14px; background: #f2f6fc; border-left: 4px solid #0b57d0; }
    .muted { color: #6b7280; }
    table { width: 100%; border-collapse: collapse; break-inside: auto; }
    th, td { padding: 6px 8px; border: 1px solid #cbd5e1; vertical-align: top; }
    th { background: #e8f0fe; font-weight: 700; }
    tr { break-inside: avoid; }
    thead { display: table-header-group; }
  </style>
</head>
<body>
  <h1>${safeText(draft.title)}</h1>
  ${draft.server ? `<div class="server">服务器：${safeText(draft.server)}</div>` : ''}
  <section class="summary"><h2>摘要</h2>${paragraphs(draft.summary)}</section>
  ${draft.sections.map((section, index) => `
    <section>
      <h2>${safeText(section.title || `第 ${index + 1} 节`)}</h2>
      ${paragraphs(section.content)}
    </section>`).join('')}
  <section><h2>风险</h2>${renderList(draft.risks, '未发现明确风险。')}</section>
  <section><h2>建议</h2>${renderList(draft.recommendations, '暂无补充建议。')}</section>
  ${draft.tables.map(renderTable).join('')}
</body>
</html>`
}

module.exports = {
  buildPrintableReportHtml
}
