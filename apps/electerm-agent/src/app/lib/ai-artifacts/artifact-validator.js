const path = require('node:path')

const ARTIFACT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,79}$/
const ARTIFACT_TYPES = new Set([
  'diagnostic-report',
  'inspection-report',
  'asset-inventory',
  'change-record',
  'security-report',
  'incident-review',
  'custom-document',
  'custom-spreadsheet'
])
const ARTIFACT_FORMATS = new Set(['docx', 'xlsx', 'pdf', 'md', 'csv'])
const MAX_JSON_LENGTH = 1_000_000
const MAX_VERSION = 9999

function artifactError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function isPlainObject (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertString (value, maximum, code, label, options = {}) {
  if (typeof value !== 'string' ||
    (!options.allowEmpty && value.length === 0) ||
    value.length > maximum) {
    throw artifactError(code, `${label} is invalid.`)
  }
  return value
}

function validateTextArray (value, code, label) {
  if (!Array.isArray(value) || value.length > 200) {
    throw artifactError(code, `${label} must be a bounded array.`)
  }
  return value.map(item => assertString(item, 32000, code, label, {
    allowEmpty: true
  }))
}

function validateSections (value) {
  if (!Array.isArray(value) || value.length > 128) {
    throw artifactError(
      'ARTIFACT_SECTIONS_INVALID',
      'Artifact sections must be a bounded array.'
    )
  }
  return value.map(section => {
    if (!isPlainObject(section)) {
      throw artifactError(
        'ARTIFACT_SECTIONS_INVALID',
        'Artifact section is invalid.'
      )
    }
    return {
      title: assertString(
        section.title,
        160,
        'ARTIFACT_SECTIONS_INVALID',
        'Artifact section title',
        { allowEmpty: true }
      ),
      content: assertString(
        section.content,
        MAX_JSON_LENGTH,
        'ARTIFACT_SECTIONS_INVALID',
        'Artifact section content',
        { allowEmpty: true }
      )
    }
  })
}

function validateTables (value) {
  if (!Array.isArray(value) || value.length > 32) {
    throw artifactError(
      'ARTIFACT_TABLES_INVALID',
      'Artifact tables must be a bounded array.'
    )
  }
  return value.map(table => {
    if (!isPlainObject(table) ||
      !Array.isArray(table.columns) ||
      table.columns.length > 64 ||
      !Array.isArray(table.rows) ||
      table.rows.length > 2000) {
      throw artifactError(
        'ARTIFACT_TABLES_INVALID',
        'Artifact table is invalid.'
      )
    }
    return {
      title: assertString(
        table.title,
        160,
        'ARTIFACT_TABLES_INVALID',
        'Artifact table title',
        { allowEmpty: true }
      ),
      columns: table.columns.map(column => assertString(
        column,
        32000,
        'ARTIFACT_TABLES_INVALID',
        'Artifact table column',
        { allowEmpty: true }
      )),
      rows: table.rows.map(row => {
        if (!Array.isArray(row) || row.length > 64) {
          throw artifactError(
            'ARTIFACT_TABLES_INVALID',
            'Artifact table row is invalid.'
          )
        }
        return row.map(cell => assertString(
          cell,
          32000,
          'ARTIFACT_TABLES_INVALID',
          'Artifact table cell',
          { allowEmpty: true }
        ))
      })
    }
  })
}

function validateArtifactDraft (value) {
  if (!isPlainObject(value)) {
    throw artifactError(
      'ARTIFACT_DRAFT_INVALID',
      'Artifact draft must be an object.'
    )
  }
  if (value.schemaVersion !== 1) {
    throw artifactError(
      'ARTIFACT_SCHEMA_VERSION_UNSUPPORTED',
      'Artifact schema version is unsupported.'
    )
  }
  if (!ARTIFACT_TYPES.has(value.type)) {
    throw artifactError(
      'ARTIFACT_TYPE_UNSUPPORTED',
      'Artifact type is unsupported.'
    )
  }

  const draft = {
    schemaVersion: 1,
    type: value.type,
    title: assertString(
      value.title,
      160,
      'ARTIFACT_TITLE_INVALID',
      'Artifact title'
    ),
    server: assertString(
      value.server,
      160,
      'ARTIFACT_SERVER_INVALID',
      'Artifact server',
      { allowEmpty: true }
    ),
    summary: assertString(
      value.summary,
      16000,
      'ARTIFACT_SUMMARY_INVALID',
      'Artifact summary',
      { allowEmpty: true }
    ),
    sections: validateSections(value.sections),
    tables: validateTables(value.tables),
    risks: validateTextArray(
      value.risks,
      'ARTIFACT_RISKS_INVALID',
      'Artifact risks'
    ),
    recommendations: validateTextArray(
      value.recommendations,
      'ARTIFACT_RECOMMENDATIONS_INVALID',
      'Artifact recommendations'
    )
  }

  if (JSON.stringify(draft).length > MAX_JSON_LENGTH) {
    throw artifactError(
      'ARTIFACT_TOO_LARGE',
      'Artifact draft exceeds the 1,000,000 character limit.'
    )
  }
  return draft
}

function assertArtifactId (value) {
  if (typeof value !== 'string' || !ARTIFACT_ID_PATTERN.test(value)) {
    throw artifactError(
      'ARTIFACT_ID_INVALID',
      'Artifact ID is invalid.'
    )
  }
  return value
}

function validateArtifactVersion (value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_VERSION) {
    throw artifactError(
      'ARTIFACT_VERSION_INVALID',
      'Artifact version is invalid.'
    )
  }
  return value
}

function validateArtifactFormat (value) {
  const format = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!ARTIFACT_FORMATS.has(format)) {
    throw artifactError(
      'ARTIFACT_FORMAT_UNSUPPORTED',
      'Artifact format is unsupported.'
    )
  }
  return format
}

function validateArtifactFormats (value) {
  if (!Array.isArray(value) || value.length < 1 ||
    value.length > ARTIFACT_FORMATS.size) {
    throw artifactError(
      'ARTIFACT_FORMATS_INVALID',
      'Artifact formats must be a bounded array.'
    )
  }
  const formats = value.map(validateArtifactFormat)
  if (new Set(formats).size !== formats.length) {
    throw artifactError(
      'ARTIFACT_FORMATS_INVALID',
      'Artifact formats must not contain duplicates.'
    )
  }
  return formats
}

function cloneJsonValue (value, depth = 0) {
  if (value === null || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))) {
    return value
  }
  if (typeof value === 'string') {
    if (value.length > 4096) {
      throw artifactError(
        'ARTIFACT_PROVENANCE_INVALID',
        'Artifact provenance string is too long.'
      )
    }
    return value
  }
  if (depth >= 8) {
    throw artifactError(
      'ARTIFACT_PROVENANCE_INVALID',
      'Artifact provenance is too deeply nested.'
    )
  }
  if (Array.isArray(value)) {
    if (value.length > 200) {
      throw artifactError(
        'ARTIFACT_PROVENANCE_INVALID',
        'Artifact provenance array is too large.'
      )
    }
    return value.map(item => cloneJsonValue(item, depth + 1))
  }
  if (!isPlainObject(value) || Object.keys(value).length > 100) {
    throw artifactError(
      'ARTIFACT_PROVENANCE_INVALID',
      'Artifact provenance is invalid.'
    )
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key)) {
      throw artifactError(
        'ARTIFACT_PROVENANCE_INVALID',
        'Artifact provenance key is invalid.'
      )
    }
    return [key, cloneJsonValue(item, depth + 1)]
  }))
}

function validateArtifactProvenance (value = {}) {
  const provenance = cloneJsonValue(value)
  if (!isPlainObject(provenance) ||
    JSON.stringify(provenance).length > 64 * 1024) {
    throw artifactError(
      'ARTIFACT_PROVENANCE_INVALID',
      'Artifact provenance is too large.'
    )
  }
  return provenance
}

function validateArtifactFilters (value = {}) {
  if (!isPlainObject(value)) {
    throw artifactError(
      'ARTIFACT_FILTERS_INVALID',
      'Artifact filters must be an object.'
    )
  }
  const filters = {}
  for (const [key, maximum] of [
    ['query', 160],
    ['server', 160],
    ['category', 40]
  ]) {
    if (value[key] !== undefined) {
      filters[key] = assertString(
        value[key],
        maximum,
        'ARTIFACT_FILTERS_INVALID',
        `Artifact ${key} filter`,
        { allowEmpty: true }
      )
    }
  }
  if (value.format !== undefined && value.format !== '') {
    filters.format = validateArtifactFormat(value.format)
  }
  return filters
}

function validateArtifactDestination (value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096 ||
    value.includes('\0') || path.isAbsolute(value)) {
    throw artifactError(
      'ARTIFACT_DESTINATION_INVALID',
      'Artifact destination is invalid.'
    )
  }
  const normalized = path.normalize(value)
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw artifactError(
      'ARTIFACT_DESTINATION_INVALID',
      'Artifact destination is invalid.'
    )
  }
  return normalized
}

module.exports = {
  ARTIFACT_FORMATS,
  ARTIFACT_ID_PATTERN,
  ARTIFACT_TYPES,
  artifactError,
  assertArtifactId,
  validateArtifactDestination,
  validateArtifactDraft,
  validateArtifactFormat,
  validateArtifactFormats,
  validateArtifactFilters,
  validateArtifactProvenance,
  validateArtifactVersion
}
