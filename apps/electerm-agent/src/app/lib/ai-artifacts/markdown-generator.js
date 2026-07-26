const {
  validateArtifactDraft
} = require('./artifact-validator')

function escapeMarkdown (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*{}[\]()#+!_|])/g, '\\$1')
    .replace(/(^|\n)-(?=\s)/g, '$1\\-')
}

function tableCell (value) {
  return escapeMarkdown(value)
    .replace(/\r\n|\r|\n/g, '<br>')
}

function renderTable (table, index) {
  const width = Math.max(
    1,
    table.columns.length,
    ...table.rows.map(row => row.length)
  )
  const columns = Array.from({ length: width }, (_, columnIndex) => (
    table.columns[columnIndex] ?? `Column ${columnIndex + 1}`
  ))
  const lines = [
    `## ${escapeMarkdown(table.title || `Table ${index + 1}`)}`,
    '',
    `| ${columns.map(tableCell).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`
  ]
  for (const row of table.rows) {
    lines.push(
      `| ${columns.map((_, columnIndex) => (
        tableCell(row[columnIndex] ?? '')
      )).join(' | ')} |`
    )
  }
  return lines.join('\n')
}

function renderList (heading, values) {
  return [
    `## ${heading}`,
    '',
    ...(values.length
      ? values.map(value => `- ${escapeMarkdown(value)}`)
      : ['_None._'])
  ].join('\n')
}

function generate (source) {
  const draft = validateArtifactDraft(source)
  const blocks = [
    `# ${escapeMarkdown(draft.title)}`
  ]
  if (draft.server) {
    blocks.push(`**Server:** ${escapeMarkdown(draft.server)}`)
  }
  blocks.push([
    '## Summary',
    '',
    escapeMarkdown(draft.summary)
  ].join('\n'))
  for (const [index, section] of draft.sections.entries()) {
    blocks.push([
      `## ${escapeMarkdown(section.title || `Section ${index + 1}`)}`,
      '',
      escapeMarkdown(section.content)
    ].join('\n'))
  }
  blocks.push(renderList('Risks', draft.risks))
  blocks.push(renderList('Recommendations', draft.recommendations))
  for (const [index, table] of draft.tables.entries()) {
    blocks.push(renderTable(table, index))
  }
  return {
    content: Buffer.from(`${blocks.join('\n\n')}\n`, 'utf8')
  }
}

module.exports = Object.freeze({
  format: 'md',
  generate
})
