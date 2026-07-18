const topLevelKeys = new Set([
  'schemaVersion',
  'summary',
  'files',
  'requestedPermissions',
  'riskSummary',
  'validationIntent'
])
const fileKeys = new Set(['path', 'content'])
const maxFiles = 256
const maxFileBytes = 1024 * 1024
const maxTotalBytes = 8 * 1024 * 1024

function creatorError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function exactKeys (value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw creatorError('SKILL_CREATOR_SCHEMA_INVALID', `${label} must be an object.`)
  }
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown) {
    throw creatorError('SKILL_CREATOR_SCHEMA_INVALID', `${label} contains an unsupported field: ${unknown}`)
  }
}

function normalizedPath (value) {
  if (typeof value !== 'string' || !value || value.includes('\u0000')) {
    throw creatorError('SKILL_CREATOR_PATH_INVALID', 'Skill file path is invalid.')
  }
  const path = value.replace(/\\/g, '/')
  if (path.startsWith('/') || /^[a-z]:\//i.test(path) || path.startsWith('//')) {
    throw creatorError('SKILL_CREATOR_PATH_INVALID', 'Skill file path must be package-relative.')
  }
  const parts = path.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw creatorError('SKILL_CREATOR_PATH_INVALID', 'Skill file path escapes or is not normalized.')
  }
  return parts.join('/')
}

function stringValue (value, label, maxLength = 12000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw creatorError('SKILL_CREATOR_SCHEMA_INVALID', `${label} must be bounded non-empty text.`)
  }
  return value
}

function stringList (value, label, maxItems = 64) {
  if (!Array.isArray(value) || value.length > maxItems ||
    value.some(item => typeof item !== 'string' || !item.trim() || item.length > 2048)) {
    throw creatorError('SKILL_CREATOR_SCHEMA_INVALID', `${label} must be a bounded string list.`)
  }
  return [...new Set(value.map(item => item.trim()))]
}

function responseText (input) {
  if (typeof input === 'string') return input
  if (!input || typeof input !== 'object') {
    throw creatorError('SKILL_CREATOR_RESPONSE_INVALID', 'Skill creator returned no JSON response.')
  }
  if (input.tool_calls?.length || input.toolCalls?.length ||
    input.message?.tool_calls?.length || input.message?.toolCalls?.length) {
    throw creatorError('SKILL_CREATOR_TOOL_CALL_FORBIDDEN', 'Skill creation cannot contain executable tool calls.')
  }
  if (typeof input.response === 'string') return input.response
  if (typeof input.content === 'string') return input.content
  return JSON.stringify(input)
}

async function sha256 (value) {
  if (!globalThis.crypto?.subtle) {
    throw creatorError('SKILL_CREATOR_DIGEST_UNAVAILABLE', 'Secure digest support is unavailable.')
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function parseAgentSkillDraftResponse (input) {
  const raw = responseText(input).trim()
  if (!raw.startsWith('{') || !raw.endsWith('}')) {
    throw creatorError('SKILL_CREATOR_RESPONSE_INVALID', 'Skill creator must return one plain JSON object.')
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw creatorError('SKILL_CREATOR_RESPONSE_INVALID', 'Skill creator returned malformed JSON.')
  }
  exactKeys(parsed, topLevelKeys, 'Skill draft')
  if (parsed.schemaVersion !== 1) {
    throw creatorError('SKILL_CREATOR_SCHEMA_INVALID', 'Skill draft schemaVersion must be 1.')
  }
  const summary = stringValue(parsed.summary, 'summary')
  const requestedPermissions = stringList(
    parsed.requestedPermissions,
    'requestedPermissions'
  )
  const riskSummary = stringList(parsed.riskSummary, 'riskSummary')
  const validationIntent = stringList(parsed.validationIntent, 'validationIntent')
  if (!Array.isArray(parsed.files) || !parsed.files.length || parsed.files.length > maxFiles) {
    throw creatorError('SKILL_CREATOR_FILES_INVALID', 'Skill draft files are missing or exceed the limit.')
  }

  let totalBytes = 0
  const seen = new Set()
  const files = parsed.files.map(file => {
    exactKeys(file, fileKeys, 'Skill file')
    const path = normalizedPath(file.path)
    if (seen.has(path)) {
      throw creatorError('SKILL_CREATOR_PATH_DUPLICATE', `Duplicate Skill file: ${path}`)
    }
    seen.add(path)
    if (typeof file.content !== 'string') {
      throw creatorError('SKILL_CREATOR_CONTENT_INVALID', `Skill file must be text: ${path}`)
    }
    const bytes = new TextEncoder().encode(file.content).byteLength
    totalBytes += bytes
    if (bytes > maxFileBytes || totalBytes > maxTotalBytes) {
      throw creatorError('SKILL_CREATOR_CONTENT_TOO_LARGE', 'Skill draft content exceeds the size limit.')
    }
    return Object.freeze({ path, content: file.content })
  })
  if (!seen.has('SKILL.md')) {
    throw creatorError('SKILL_CREATOR_SKILL_DOCUMENT_REQUIRED', 'Skill draft must contain SKILL.md.')
  }

  files.sort((left, right) => left.path.localeCompare(right.path))
  const fileDigests = {}
  for (const file of files) fileDigests[file.path] = await sha256(file.content)
  const digestInput = files
    .map(file => `${file.path}\u0000${fileDigests[file.path]}`)
    .join('\n')
  const packageDigest = await sha256(digestInput)
  return Object.freeze({
    schemaVersion: 1,
    summary,
    files: Object.freeze(files),
    requestedPermissions: Object.freeze(requestedPermissions),
    riskSummary: Object.freeze(riskSummary),
    validationIntent: Object.freeze(validationIntent),
    fileDigests: Object.freeze(fileDigests),
    packageDigest
  })
}
