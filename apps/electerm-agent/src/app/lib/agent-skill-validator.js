const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { parseSkillDocument } = require('./agent-skill-parser')
const { normalizeSkillRelativePath, resolveSkillEntry } = require('./agent-skill-path')

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 256,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxManifestBytes: 64 * 1024
})
const MANIFEST_KEYS = new Set([
  'schemaVersion',
  'id',
  'version',
  'implicitMatching',
  'requestedPermissions',
  'tools',
  'prechecks',
  'scripts',
  'verification'
])
const SCRIPT_KEYS = new Set(['id', 'path', 'interpreter', 'target'])
const ALLOWED_INTERPRETERS = new Set(['bash', 'sh', 'powershell', 'pwsh', 'node', 'python', 'python3'])
const UNSAFE_SCRIPT_PATTERNS = [
  { name: 'download-and-execute', pattern: /(?:curl|wget|Invoke-WebRequest|\biwr\b)[^\r\n|;&]*(?:\||;|&&)\s*(?:ba)?sh\b|(?:Invoke-WebRequest|\biwr\b)[^\r\n|;&]*\|\s*(?:Invoke-Expression|iex)\b/i },
  { name: 'eval', pattern: /(?:^|[;&|\s])(?:eval|Invoke-Expression|iex)(?:\s|$)/im },
  { name: 'encoded-command', pattern: /(?:-|\/)(?:enc|encodedcommand)\b|frombase64string\s*\(/i },
  { name: 'command-substitution', pattern: /\$\([^\r\n]*\)|`[^`\r\n]+`/ }
]

function validationIssue (code, message, relativePath) {
  return { code, message, ...(relativePath ? { path: relativePath } : {}) }
}

function sha256 (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

async function listPackageFiles (root, limits, errors) {
  const files = []
  let totalBytes = 0

  async function visit (directory, prefix = '') {
    const entries = await fsp.readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const fullPath = path.join(directory, entry.name)
      const stat = await fsp.lstat(fullPath)
      if (stat.isSymbolicLink()) {
        errors.push(validationIssue('SKILL_PATH_SYMLINK', 'Symbolic links are not allowed.', relativePath))
        continue
      }
      if (entry.isDirectory()) {
        await visit(fullPath, relativePath)
        continue
      }
      if (!entry.isFile()) {
        errors.push(validationIssue('SKILL_FILE_TYPE_INVALID', 'Only regular files are allowed.', relativePath))
        continue
      }
      files.push({ relativePath, fullPath, size: stat.size })
      totalBytes += stat.size
      if (stat.size > limits.maxFileBytes) {
        errors.push(validationIssue('SKILL_FILE_TOO_LARGE', 'Skill file exceeds the size limit.', relativePath))
      }
      if (files.length > limits.maxFiles) {
        errors.push(validationIssue('SKILL_FILE_COUNT_EXCEEDED', 'Skill package has too many files.'))
        return
      }
      if (totalBytes > limits.maxTotalBytes) {
        errors.push(validationIssue('SKILL_PACKAGE_TOO_LARGE', 'Skill package exceeds the total size limit.'))
        return
      }
    }
  }

  await visit(root)
  return files
}

function parseJsonManifest (text, errors) {
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch {
    errors.push(validationIssue('SKILL_MANIFEST_JSON_INVALID', 'skill.json must contain valid JSON.'))
    return null
  }
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') {
    errors.push(validationIssue('SKILL_MANIFEST_INVALID', 'skill.json must contain an object.'))
    return null
  }
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(key)) {
      errors.push(validationIssue('SKILL_MANIFEST_KEY_INVALID', `Unsupported skill.json field: ${key}`))
    }
  }
  return manifest
}

function validateToolEntries (entries, field, errors) {
  if (entries === undefined) return []
  if (!Array.isArray(entries)) {
    errors.push(validationIssue('SKILL_MANIFEST_INVALID', `${field} must be an array.`))
    return []
  }
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || entry.type !== 'tool' || typeof entry.name !== 'string' || !entry.name.trim()) {
      errors.push(validationIssue('SKILL_ENTRY_TYPE_INVALID', `${field} contains an unsupported entry.`))
    }
  }
  return entries
}

function validateStringArray (value, field, errors) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    errors.push(validationIssue('SKILL_MANIFEST_INVALID', `${field} must be a string array.`))
    return []
  }
  return value.map(item => item.trim())
}

function scanScript (content) {
  return UNSAFE_SCRIPT_PATTERNS
    .filter(item => item.pattern.test(content))
    .map(item => item.name)
}

async function validateSkillPackage (root, options = {}) {
  const packageRoot = path.resolve(String(root || ''))
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }
  const errors = []
  const warnings = []
  let parsedDocument = null
  let manifest = null

  if (!fs.existsSync(packageRoot) || !fs.statSync(packageRoot).isDirectory()) {
    return {
      valid: false,
      errors: [validationIssue('SKILL_ROOT_INVALID', 'Skill package directory does not exist.')],
      warnings,
      manifest: null,
      fileDigests: {},
      packageDigest: null,
      riskSummary: { level: 'none', hasExecutableArtifacts: false, scripts: [] },
      requestedPermissions: []
    }
  }

  const files = await listPackageFiles(packageRoot, limits, errors)
  const fileByPath = new Map(files.map(file => [file.relativePath.replace(/\\/g, '/'), file]))
  const skillDocumentFile = fileByPath.get('SKILL.md')
  if (!skillDocumentFile) {
    errors.push(validationIssue('SKILL_DOCUMENT_REQUIRED', 'Skill package requires SKILL.md.'))
  } else if (skillDocumentFile.size <= limits.maxFileBytes) {
    try {
      parsedDocument = parseSkillDocument(await fsp.readFile(skillDocumentFile.fullPath, 'utf8'))
    } catch (error) {
      errors.push(validationIssue(error.code || 'SKILL_DOCUMENT_INVALID', error.message, 'SKILL.md'))
    }
  }

  const manifestFile = fileByPath.get('skill.json')
  if (manifestFile) {
    if (manifestFile.size > limits.maxManifestBytes) {
      errors.push(validationIssue('SKILL_MANIFEST_TOO_LARGE', 'skill.json exceeds the size limit.', 'skill.json'))
    } else {
      manifest = parseJsonManifest(await fsp.readFile(manifestFile.fullPath, 'utf8'), errors)
    }
  }

  if (!manifest && parsedDocument && !manifestFile) {
    manifest = {
      schemaVersion: 1,
      id: parsedDocument.frontmatter.id,
      version: parsedDocument.frontmatter.version,
      implicitMatching: false,
      requestedPermissions: parsedDocument.frontmatter.permissions,
      tools: [],
      prechecks: [],
      scripts: [],
      verification: []
    }
  }

  const scripts = []
  if (manifest) {
    if (manifest.schemaVersion !== 1) {
      errors.push(validationIssue('SKILL_SCHEMA_VERSION_INVALID', 'Only skill.json schemaVersion 1 is supported.'))
    }
    if (parsedDocument && (manifest.id !== parsedDocument.frontmatter.id || manifest.version !== parsedDocument.frontmatter.version)) {
      errors.push(validationIssue('SKILL_MANIFEST_MISMATCH', 'skill.json id and version must match SKILL.md.'))
    }
    if (manifest.implicitMatching !== undefined && typeof manifest.implicitMatching !== 'boolean') {
      errors.push(validationIssue('SKILL_MANIFEST_INVALID', 'implicitMatching must be boolean.'))
    }
    manifest.tools = validateStringArray(manifest.tools, 'tools', errors)
    manifest.requestedPermissions = validateStringArray(manifest.requestedPermissions, 'requestedPermissions', errors)
    manifest.prechecks = validateToolEntries(manifest.prechecks, 'prechecks', errors)
    manifest.verification = validateToolEntries(manifest.verification, 'verification', errors)
    if (manifest.scripts !== undefined && !Array.isArray(manifest.scripts)) {
      errors.push(validationIssue('SKILL_MANIFEST_INVALID', 'scripts must be an array.'))
    }
    for (const entry of Array.isArray(manifest.scripts) ? manifest.scripts : []) {
      if (!entry || typeof entry !== 'object') {
        errors.push(validationIssue('SKILL_ENTRY_TYPE_INVALID', 'scripts contains an invalid entry.'))
        continue
      }
      if (Object.keys(entry).some(key => !SCRIPT_KEYS.has(key)) ||
        typeof entry.id !== 'string' || !entry.id ||
        typeof entry.path !== 'string' || !entry.path ||
        !ALLOWED_INTERPRETERS.has(entry.interpreter) ||
        !['local', 'remote'].includes(entry.target)) {
        errors.push(validationIssue('SKILL_ENTRY_TYPE_INVALID', 'scripts contains an unsupported executable declaration.'))
        continue
      }
      let relativePath
      let artifactPath
      try {
        relativePath = normalizeSkillRelativePath(entry.path)
        artifactPath = resolveSkillEntry(packageRoot, relativePath)
      } catch {
        errors.push(validationIssue('SKILL_ARTIFACT_PATH_INVALID', 'Script path must resolve inside the Skill package.', entry.path))
        continue
      }
      const artifact = fileByPath.get(relativePath)
      if (!artifact || artifact.fullPath !== artifactPath) {
        errors.push(validationIssue('SKILL_ARTIFACT_MISSING', 'Declared script is missing.', relativePath))
        continue
      }
      const content = await fsp.readFile(artifact.fullPath, 'utf8')
      const unsafePatterns = scanScript(content)
      if (unsafePatterns.length) {
        errors.push(validationIssue('SKILL_SCRIPT_UNSAFE', `Script uses blocked patterns: ${unsafePatterns.join(', ')}.`, relativePath))
      }
      scripts.push({
        id: entry.id,
        path: relativePath,
        interpreter: entry.interpreter,
        target: entry.target,
        risk: 'risky',
        unsafePatterns
      })
    }
  }

  const fileDigests = {}
  for (const file of files) {
    if (file.size <= limits.maxFileBytes) {
      fileDigests[file.relativePath.replace(/\\/g, '/')] = sha256(await fsp.readFile(file.fullPath))
    }
  }
  const digestEntries = Object.keys(fileDigests)
    .sort()
    .map(relativePath => `${relativePath}\0${fileDigests[relativePath]}`)
    .join('\n')
  const requestedPermissions = [...new Set([
    ...(parsedDocument?.frontmatter.permissions || []),
    ...(manifest?.requestedPermissions || [])
  ])].sort()
  const packageDigest = Object.keys(fileDigests).length ? sha256(digestEntries) : null

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest: parsedDocument && manifest
      ? {
          ...manifest,
          name: parsedDocument.frontmatter.name,
          description: parsedDocument.frontmatter.description,
          triggers: parsedDocument.frontmatter.triggers
        }
      : manifest,
    fileDigests,
    packageDigest,
    riskSummary: {
      level: scripts.length ? 'risky' : 'none',
      hasExecutableArtifacts: scripts.length > 0,
      scripts
    },
    requestedPermissions
  }
}

module.exports = {
  DEFAULT_LIMITS,
  validateSkillPackage,
  scanScript
}
