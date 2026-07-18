const fs = require('node:fs')
const path = require('node:path')

const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function skillPathError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function assertSkillId (value) {
  const id = String(value || '')
  if (!SKILL_ID_PATTERN.test(id)) {
    throw skillPathError('SKILL_ID_INVALID', 'Skill ID must use lowercase kebab-case.')
  }
  return id
}

function normalizeSkillRelativePath (value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    throw skillPathError('SKILL_PATH_INVALID', 'Skill path is invalid.')
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    throw skillPathError('SKILL_PATH_ESCAPE', 'Skill path must be package-relative.')
  }
  const normalizedSeparators = value.replace(/\\/g, '/')
  const parts = normalizedSeparators.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw skillPathError('SKILL_PATH_ESCAPE', 'Skill path escapes or is not normalized.')
  }
  const normalized = path.posix.normalize(normalizedSeparators)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw skillPathError('SKILL_PATH_ESCAPE', 'Skill path escapes its package.')
  }
  return normalized
}

function isDescendant (root, candidate) {
  const relative = path.relative(root, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function resolveSkillEntry (root, relativePath, options = {}) {
  const rootPath = path.resolve(String(root || ''))
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    throw skillPathError('SKILL_ROOT_INVALID', 'Skill package root does not exist.')
  }
  const normalized = normalizeSkillRelativePath(relativePath)
  const target = path.resolve(rootPath, ...normalized.split('/'))
  if (!isDescendant(rootPath, target)) {
    throw skillPathError('SKILL_PATH_ESCAPE', 'Skill path escapes its package.')
  }

  const realRoot = fs.realpathSync(rootPath)
  let cursor = rootPath
  for (const part of normalized.split('/')) {
    cursor = path.join(cursor, part)
    if (!fs.existsSync(cursor)) break
    const stat = fs.lstatSync(cursor)
    if (stat.isSymbolicLink()) {
      throw skillPathError('SKILL_PATH_SYMLINK', 'Symbolic links are not allowed in Skill packages.')
    }
  }

  if (fs.existsSync(target)) {
    const realTarget = fs.realpathSync(target)
    if (!isDescendant(realRoot, realTarget)) {
      throw skillPathError('SKILL_PATH_ESCAPE', 'Resolved Skill path escapes its package.')
    }
  } else if (!options.allowMissing) {
    throw skillPathError('SKILL_PATH_MISSING', `Skill file is missing: ${normalized}`)
  }
  return target
}

module.exports = {
  SKILL_ID_PATTERN,
  assertSkillId,
  normalizeSkillRelativePath,
  resolveSkillEntry,
  skillPathError
}
