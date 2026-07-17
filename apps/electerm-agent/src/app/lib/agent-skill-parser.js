const { assertSkillId } = require('./agent-skill-path')

const MAX_SKILL_DOCUMENT_BYTES = 256 * 1024
const MAX_SKILL_FRONTMATTER_BYTES = 32 * 1024
const ALLOWED_KEYS = new Set([
  'id',
  'name',
  'description',
  'version',
  'triggers',
  'permissions'
])
const LIST_KEYS = new Set(['triggers', 'permissions'])
const REQUIRED_KEYS = ['id', 'name', 'description', 'version', 'triggers']

function parserError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function parseScalar (raw, key) {
  const value = raw.trim()
  if (!value) {
    throw parserError('SKILL_FRONTMATTER_INVALID', `Skill field ${key} cannot be empty.`)
  }
  if (/^(?:[|>{[]|[&*!][A-Za-z0-9_-])/.test(value) || /(?:^|\s)[&*!][A-Za-z0-9_-]+/.test(value)) {
    throw parserError('SKILL_FRONTMATTER_UNSAFE', 'YAML tags, anchors, aliases and nested values are not supported.')
  }
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed !== 'string') throw new Error('not a string')
      return parsed
    } catch {
      throw parserError('SKILL_FRONTMATTER_INVALID', `Skill field ${key} has invalid quoting.`)
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw parserError('SKILL_FRONTMATTER_INVALID', `Skill field ${key} has invalid quoting.`)
    }
    return value.slice(1, -1)
  }
  return value
}

function parseSkillDocument (input, options = {}) {
  if (typeof input !== 'string') {
    throw parserError('SKILL_DOCUMENT_INVALID', 'SKILL.md must be UTF-8 text.')
  }
  const maxDocumentBytes = options.maxDocumentBytes || MAX_SKILL_DOCUMENT_BYTES
  if (Buffer.byteLength(input, 'utf8') > maxDocumentBytes) {
    throw parserError('SKILL_DOCUMENT_TOO_LARGE', 'SKILL.md exceeds the size limit.')
  }
  const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0] !== '---') {
    throw parserError('SKILL_FRONTMATTER_REQUIRED', 'SKILL.md must start with controlled frontmatter.')
  }
  const closingIndex = lines.indexOf('---', 1)
  if (closingIndex < 0) {
    throw parserError('SKILL_FRONTMATTER_INVALID', 'SKILL.md frontmatter is not closed.')
  }
  const frontmatterText = lines.slice(1, closingIndex).join('\n')
  if (Buffer.byteLength(frontmatterText, 'utf8') > MAX_SKILL_FRONTMATTER_BYTES) {
    throw parserError('SKILL_FRONTMATTER_TOO_LARGE', 'Skill frontmatter exceeds the size limit.')
  }

  const frontmatter = {}
  let activeList = null
  for (const line of lines.slice(1, closingIndex)) {
    if (!line.trim()) continue
    const listMatch = line.match(/^ {2}-\s+(.+)$/)
    if (listMatch) {
      if (!activeList) {
        throw parserError('SKILL_FRONTMATTER_INVALID', 'Unexpected frontmatter list item.')
      }
      const item = parseScalar(listMatch[1], activeList)
      if (/^[^'"\s]+:\s/.test(item)) {
        throw parserError('SKILL_FRONTMATTER_UNSAFE', 'Nested frontmatter objects are not supported.')
      }
      frontmatter[activeList].push(item)
      continue
    }
    if (/^\s/.test(line)) {
      throw parserError('SKILL_FRONTMATTER_UNSAFE', 'Nested frontmatter values are not supported.')
    }
    const match = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):(?:\s*(.*))$/)
    if (!match) {
      throw parserError('SKILL_FRONTMATTER_INVALID', 'Invalid Skill frontmatter line.')
    }
    const key = match[1]
    if (!ALLOWED_KEYS.has(key)) {
      throw parserError('SKILL_FRONTMATTER_KEY_INVALID', `Unsupported Skill frontmatter key: ${key}`)
    }
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      throw parserError('SKILL_FRONTMATTER_DUPLICATE', `Duplicate Skill frontmatter key: ${key}`)
    }
    const rawValue = match[2]
    if (LIST_KEYS.has(key)) {
      if (rawValue.trim()) {
        throw parserError('SKILL_FRONTMATTER_UNSAFE', `Skill field ${key} must be a string list.`)
      }
      frontmatter[key] = []
      activeList = key
    } else {
      frontmatter[key] = parseScalar(rawValue, key)
      activeList = null
    }
  }

  for (const key of REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(frontmatter, key) || (Array.isArray(frontmatter[key]) && !frontmatter[key].length)) {
      throw parserError('SKILL_FRONTMATTER_REQUIRED_FIELD', `Skill frontmatter requires ${key}.`)
    }
  }
  assertSkillId(frontmatter.id)
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(frontmatter.version)) {
    throw parserError('SKILL_VERSION_INVALID', 'Skill version must be semantic version text.')
  }
  if (!frontmatter.permissions) frontmatter.permissions = []

  return {
    frontmatter,
    body: lines.slice(closingIndex + 1).join('\n')
  }
}

module.exports = {
  MAX_SKILL_DOCUMENT_BYTES,
  MAX_SKILL_FRONTMATTER_BYTES,
  parseSkillDocument,
  parserError
}
