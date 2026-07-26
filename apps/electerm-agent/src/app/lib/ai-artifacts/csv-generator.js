const {
  validateArtifactDraft
} = require('./artifact-validator')

const ORDINARY_NEGATIVE_NUMBER =
  /^-(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

function neutralizeFormula (value) {
  let index = 0
  while (index < value.length && value.charCodeAt(index) <= 32) {
    index += 1
  }
  const candidate = value.slice(index)
  if (/^[=+@]/.test(candidate) ||
    (candidate.startsWith('-') &&
      !ORDINARY_NEGATIVE_NUMBER.test(candidate))) {
    return `'${value}`
  }
  return value
}

function csvCell (value) {
  const safeValue = neutralizeFormula(
    String(value).replace(/\r\n|\r|\n/g, '\r\n')
  )
  return /[",\r\n]/.test(safeValue)
    ? `"${safeValue.replace(/"/g, '""')}"`
    : safeValue
}

function generate (source) {
  const draft = validateArtifactDraft(source)
  const lines = []
  for (const [index, table] of draft.tables.entries()) {
    if (index > 0) lines.push('')
    lines.push(['Table', table.title || `Table ${index + 1}`].map(csvCell).join(','))
    lines.push(table.columns.map(csvCell).join(','))
    for (const row of table.rows) {
      lines.push(row.map(csvCell).join(','))
    }
  }
  return {
    content: Buffer.from(
      lines.length ? `${lines.join('\r\n')}\r\n` : '',
      'utf8'
    )
  }
}

module.exports = Object.freeze({
  format: 'csv',
  generate
})
