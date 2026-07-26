const ARTIFACT_TYPE_VALUES = [
  'diagnostic-report',
  'inspection-report',
  'asset-inventory',
  'change-record',
  'security-report',
  'incident-review',
  'custom-document',
  'custom-spreadsheet'
]

const ARTIFACT_FORMAT_VALUES = ['docx', 'xlsx', 'pdf', 'md', 'csv']

const MAX_TITLE_LENGTH = 160
const MAX_SERVER_LENGTH = 160
const MAX_SUMMARY_LENGTH = 16000
const MAX_SECTIONS = 128
const MAX_TABLES = 32
const MAX_ROWS_PER_TABLE = 2000
const MAX_COLUMNS_PER_TABLE = 64
const MAX_CELL_LENGTH = 32000
const MAX_ARRAY_ITEMS = 200
const MAX_JSON_LENGTH = 1_000_000
const REDACTED_VALUE = '[宸查殣钘廬'
const REDACTED_PRIVATE_KEY = '[宸查殣钘廬'

export const ARTIFACT_TYPES = Object.freeze(new Set(ARTIFACT_TYPE_VALUES))
export const ARTIFACT_FORMATS = Object.freeze(new Set(ARTIFACT_FORMAT_VALUES))

function artifactError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function deepFreeze (value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const item of Object.values(value)) {
    deepFreeze(item, seen)
  }
  return Object.freeze(value)
}

function normalizeWhitespace (value) {
  return [...String(value ?? '')].map(character => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 ? ' ' : character
  }).join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeFreeText (value, maxLength, fallback = '') {
  const text = redactArtifactText(normalizeWhitespace(value))
  return (text || fallback).slice(0, maxLength)
}

function normalizeLongText (value, maxLength) {
  return redactArtifactText(String(value ?? '')).slice(0, maxLength)
}

function normalizeArrayText (value, maxItems) {
  if (!Array.isArray(value)) return []
  return value.slice(0, maxItems).map(item => redactArtifactText(String(item ?? '')))
}

function normalizeTableCell (value) {
  const text = redactArtifactText(String(value ?? ''))
  return text.slice(0, MAX_CELL_LENGTH)
}

function normalizeTable (value = {}) {
  const columns = Array.isArray(value.columns) ? value.columns.slice(0, MAX_COLUMNS_PER_TABLE) : []
  const rows = Array.isArray(value.rows) ? value.rows.slice(0, MAX_ROWS_PER_TABLE) : []

  return {
    title: normalizeFreeText(value.title, MAX_TITLE_LENGTH),
    columns: columns.map(column => normalizeFreeText(column, MAX_CELL_LENGTH)),
    rows: rows.map(row => (Array.isArray(row) ? row.slice(0, MAX_COLUMNS_PER_TABLE) : [])
      .map(cell => normalizeTableCell(cell)))
  }
}

function normalizeSections (value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_SECTIONS).map(section => ({
    title: normalizeFreeText(section?.title, MAX_TITLE_LENGTH),
    content: redactArtifactText(String(section?.content ?? ''))
  }))
}

function normalizeTables (value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_TABLES).map(table => normalizeTable(table))
}

function normalizePemBlockLabel (value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function pemBlockLabelFromLine (value) {
  const match = String(value || '').match(/^\s*-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----\s*$/i) ||
    String(value || '').match(/^\s*-----END ((?:[A-Z0-9]+ )*PRIVATE KEY)-----\s*$/i)
  return match ? normalizePemBlockLabel(match[1]) : ''
}

function isPemBodyLine (value) {
  return /^[A-Za-z0-9+/=]{4,128}$/.test(String(value || '').trim())
}

function redactPemBlocks (value) {
  const lines = String(value ?? '').split(/\r?\n/)
  const output = []
  let index = 0
  let redacting = false
  let pemLabel = ''

  while (index < lines.length) {
    const line = lines[index]
    if (!redacting) {
      const beginMatch = String(line || '').match(/^(.*?)(-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----)(.*)$/i)
      if (!beginMatch) {
        output.push(line)
        index += 1
        continue
      }

      output.push(`${beginMatch[1]}${REDACTED_PRIVATE_KEY}`)
      pemLabel = normalizePemBlockLabel(beginMatch[3])
      redacting = true
      index += 1
      continue
    }

    const currentLabel = pemBlockLabelFromLine(line)
    if (currentLabel && currentLabel === pemLabel && /^\s*-----END /i.test(line)) {
      redacting = false
      pemLabel = ''
      index += 1
      continue
    }

    if (!String(line || '').trim()) {
      output.push(line)
      redacting = false
      pemLabel = ''
      index += 1
      continue
    }

    if (isPemBodyLine(line)) {
      index += 1
      continue
    }

    redacting = false
    pemLabel = ''
    output.push(line)
    index += 1
  }

  return output.join('\n')
}

export function redactArtifactText (value) {
  const source = redactPemBlocks(String(value ?? ''))
  const redactedSecrets = source.replace(
    /\b(api[_ -]?key|token|password|passwd|cookie)\b\s*[:=]\s*[^\r\n,;]+/gi,
    (_, name) => `${name}=${REDACTED_VALUE}`
  )

  return redactedSecrets
}

export function normalizeArtifactDraft (input = {}) {
  const type = normalizeWhitespace(input.type)
  if (!ARTIFACT_TYPES.has(type)) {
    throw artifactError('ARTIFACT_TYPE_UNSUPPORTED', 'Unsupported artifact type.')
  }

  const draft = {
    schemaVersion: 1,
    type,
    title: normalizeFreeText(input.title, MAX_TITLE_LENGTH, '未命名成果'),
    server: normalizeFreeText(input.server, MAX_SERVER_LENGTH),
    summary: normalizeLongText(input.summary, MAX_SUMMARY_LENGTH),
    sections: normalizeSections(input.sections),
    tables: normalizeTables(input.tables),
    risks: normalizeArrayText(input.risks, MAX_ARRAY_ITEMS),
    recommendations: normalizeArrayText(input.recommendations, MAX_ARRAY_ITEMS)
  }

  if (JSON.stringify(draft).length > MAX_JSON_LENGTH) {
    throw artifactError('ARTIFACT_TOO_LARGE', 'Artifact draft exceeds the 1,000,000 character limit.')
  }

  return deepFreeze(draft)
}
