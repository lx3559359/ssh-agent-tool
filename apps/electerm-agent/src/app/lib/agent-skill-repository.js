const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')
const {
  assertSkillId,
  normalizeSkillRelativePath,
  resolveSkillEntry
} = require('./agent-skill-path')
const { validateSkillPackage } = require('./agent-skill-validator')

const STATES = Object.freeze(['enabled', 'disabled', 'drafts'])

function repositoryError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function uniqueToken () {
  return `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`
}

function sha256 (value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function legacySkillId (value, identity) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return normalized || `legacy-skill-${identity.slice(0, 8)}`
}

function quotedScalar (value, fallback) {
  const text = String(value || '').trim() || fallback
  return JSON.stringify(text.slice(0, 4096))
}

function legacySkillDocument (item, skillId) {
  const title = String(item.title || item.name || '').trim() || skillId
  const description = String(item.description || '').trim() || `Migrated workflow for ${title}.`
  const prompt = (String(item.prompt || '').trim() || description)
    .slice(0, 192 * 1024)
  const trigger = description.slice(0, 512) || title
  return [
    '---',
    `id: ${skillId}`,
    `name: ${quotedScalar(title, skillId)}`,
    `description: ${quotedScalar(description, `Migrated workflow for ${title}.`)}`,
    'version: 1.0.0',
    'triggers:',
    `  - ${quotedScalar(trigger, title)}`,
    '---',
    '',
    '# Workflow',
    '',
    prompt
  ].join('\n')
}

async function pathExists (target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

async function syncFile (filePath) {
  const handle = await fsp.open(filePath, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncPackage (root) {
  const entries = await fsp.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) {
      await syncPackage(target)
    } else if (entry.isFile()) {
      await syncFile(target)
    }
  }
  try {
    await syncFile(root)
  } catch {
    // Directory fsync is not supported on every Windows filesystem.
  }
}

function createAgentSkillRepository (options = {}) {
  const rootPath = path.resolve(String(options.rootPath || ''))
  if (!options.rootPath) {
    throw repositoryError('SKILL_REPOSITORY_ROOT_REQUIRED', 'Skill repository root is required.')
  }
  const rename = options.rename || fsp.rename
  const onCleanupError = options.onCleanupError || (() => {})
  const onDigestInvalidated = options.onDigestInvalidated || (() => {})
  const locks = new Map()

  const statePath = state => path.join(rootPath, state)
  const historyPath = (skillId, digest) => path.join(rootPath, 'history', skillId, digest)

  async function ensureRoots () {
    await Promise.all([
      ...STATES.map(state => fsp.mkdir(statePath(state), { recursive: true })),
      fsp.mkdir(path.join(rootPath, 'history'), { recursive: true })
    ])
  }

  function withLock (key, operation) {
    const previous = locks.get(key) || Promise.resolve()
    const run = previous.catch(() => {}).then(operation)
    const settled = run.catch(() => {}).finally(() => {
      if (locks.get(key) === settled) locks.delete(key)
    })
    locks.set(key, settled)
    return run
  }

  async function createTempDirectory (parent) {
    await fsp.mkdir(parent, { recursive: true })
    return fsp.mkdtemp(path.join(parent, '.tmp-'))
  }

  async function atomicReplaceDirectory (candidate, target) {
    const backup = `${target}.backup-${uniqueToken()}`
    const hadTarget = await pathExists(target)
    if (hadTarget) await rename(target, backup)
    try {
      await rename(candidate, target)
    } catch (error) {
      if (hadTarget && await pathExists(backup)) {
        await rename(backup, target)
      }
      throw error
    }
    if (hadTarget) await fsp.rm(backup, { recursive: true, force: true })
  }

  async function copyToTemp (source, parent) {
    const candidate = await createTempDirectory(parent)
    try {
      await fsp.cp(source, candidate, { recursive: true, force: true })
      return candidate
    } catch (error) {
      await fsp.rm(candidate, { recursive: true, force: true })
      throw error
    }
  }

  async function writePackageFiles (target, files) {
    if (!files || Array.isArray(files) || typeof files !== 'object') {
      throw repositoryError('SKILL_FILES_INVALID', 'Skill draft files must be a path-to-content object.')
    }
    const normalized = new Map()
    for (const [relativePath, content] of Object.entries(files)) {
      const safePath = normalizeSkillRelativePath(relativePath)
      if (normalized.has(safePath)) {
        throw repositoryError('SKILL_FILE_DUPLICATE', `Duplicate Skill file: ${safePath}`)
      }
      if (!(typeof content === 'string' || Buffer.isBuffer(content))) {
        throw repositoryError('SKILL_FILE_CONTENT_INVALID', `Skill file must be text or bytes: ${safePath}`)
      }
      normalized.set(safePath, content)
    }
    for (const [relativePath, content] of normalized) {
      const filePath = resolveSkillEntry(target, relativePath, { allowMissing: true })
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await fsp.writeFile(filePath, content)
    }
  }

  async function validateOrThrow (directory, expectedDigest) {
    const validation = await validateSkillPackage(directory)
    if (!validation.valid) {
      const error = repositoryError('SKILL_VALIDATION_FAILED', 'Skill package did not pass validation.')
      error.validation = validation
      throw error
    }
    if (expectedDigest && validation.packageDigest !== expectedDigest) {
      throw repositoryError('SKILL_DIGEST_MISMATCH', 'Skill package changed after validation.')
    }
    return validation
  }

  async function historyDigests (skillId) {
    const parent = path.join(rootPath, 'history', skillId)
    if (!await pathExists(parent)) return []
    const entries = await fsp.readdir(parent, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  }

  async function metadataFor (directory, state, entryId, skillIdHint) {
    const validation = await validateSkillPackage(directory)
    const skillId = validation.manifest?.id || skillIdHint || entryId
    return {
      id: state === 'drafts' ? entryId : skillId,
      skillId,
      enabled: state === 'enabled',
      state: state === 'drafts' ? 'draft' : state,
      valid: validation.valid,
      name: validation.manifest?.name || skillId,
      description: validation.manifest?.description || '',
      version: validation.manifest?.version || '',
      triggers: validation.manifest?.triggers || [],
      implicitMatching: validation.manifest?.implicitMatching === true,
      requestedPermissions: validation.requestedPermissions,
      packageDigest: validation.packageDigest,
      riskSummary: validation.riskSummary,
      filePaths: Object.keys(validation.fileDigests || {}).sort(),
      errors: validation.errors,
      warnings: validation.warnings,
      historyDigests: await historyDigests(skillId)
    }
  }

  async function locate (id) {
    assertSkillId(id)
    await ensureRoots()
    for (const state of STATES) {
      const directory = path.join(statePath(state), id)
      if (await pathExists(directory)) return { state, directory, entryId: id }
    }
    return null
  }

  async function snapshotDirectory (skillId, directory, digest) {
    const target = historyPath(skillId, digest)
    if (await pathExists(target)) return
    const parent = path.dirname(target)
    const candidate = await copyToTemp(directory, parent)
    try {
      await validateOrThrow(candidate, digest)
      await syncPackage(candidate)
      if (await pathExists(target)) {
        await fsp.rm(candidate, { recursive: true, force: true })
      } else {
        await rename(candidate, target)
      }
    } catch (error) {
      await fsp.rm(candidate, { recursive: true, force: true })
      throw error
    }
  }

  async function snapshotEnabled (skillId) {
    const directory = path.join(statePath('enabled'), skillId)
    if (!await pathExists(directory)) return null
    const validation = await validateOrThrow(directory)
    await snapshotDirectory(skillId, directory, validation.packageDigest)
    return validation
  }

  async function createDraft (files) {
    await ensureRoots()
    const parent = statePath('drafts')
    const candidate = await createTempDirectory(parent)
    try {
      await writePackageFiles(candidate, files)
      const validation = await validateOrThrow(candidate)
      const draftId = `${validation.manifest.id}-draft-${uniqueToken()}`
      const target = path.join(parent, draftId)
      await syncPackage(candidate)
      await rename(candidate, target)
      return metadataFor(target, 'drafts', draftId, validation.manifest.id)
    } catch (error) {
      await fsp.rm(candidate, { recursive: true, force: true })
      throw error
    }
  }

  async function readMigrationMarker () {
    const markerPath = path.join(rootPath, 'migration-v1.json')
    if (!await pathExists(markerPath)) return null
    try {
      const marker = JSON.parse(await fsp.readFile(markerPath, 'utf8'))
      return marker?.version === 1 && marker.complete === true ? marker : null
    } catch {
      return null
    }
  }

  async function writeMigrationMarker (marker) {
    const target = path.join(rootPath, 'migration-v1.json')
    const candidate = path.join(rootPath, `.migration-v1-${uniqueToken()}.tmp`)
    try {
      await fsp.writeFile(candidate, JSON.stringify(marker, null, 2))
      await syncFile(candidate)
      await rename(candidate, target)
    } catch (error) {
      await fsp.rm(candidate, { force: true })
      throw error
    }
  }

  async function migrateLegacySkills (legacyItems = []) {
    return withLock('__migration-v1__', async () => {
      await ensureRoots()
      const completed = await readMigrationMarker()
      if (completed) return completed

      const sourceItems = Array.isArray(legacyItems) ? legacyItems : []
      const entriesByIdentity = new Map()
      for (const rawItem of sourceItems) {
        if (!rawItem || typeof rawItem !== 'object') continue
        const item = {
          id: String(rawItem.id || '').trim(),
          title: String(rawItem.title || rawItem.name || '').trim(),
          description: String(rawItem.description || '').trim(),
          prompt: String(rawItem.prompt || '').trim()
        }
        if (!item.id && !item.title && !item.description && !item.prompt) continue
        const identity = sha256(JSON.stringify(item))
        if (!entriesByIdentity.has(identity)) {
          entriesByIdentity.set(identity, { identity, item })
        }
      }
      const entries = [...entriesByIdentity.values()]
        .sort((left, right) => left.identity.localeCompare(right.identity))
      const catalog = await list()
      const usedSkillIds = new Set(catalog.map(item => item.skillId))
      const existingEntryIds = new Set(catalog.map(item => item.id))
      const migrated = []
      const warnings = []

      for (const entry of entries) {
        const baseId = legacySkillId(entry.item.id || entry.item.title, entry.identity)
        const draftId = `${baseId}-legacy-v1-${entry.identity.slice(0, 8)}`
        if (existingEntryIds.has(draftId)) {
          const existing = await getMetadata(draftId)
          migrated.push({
            sourceDigest: entry.identity,
            draftId,
            skillId: existing.skillId,
            status: 'accounted'
          })
          usedSkillIds.add(existing.skillId)
          continue
        }

        let skillId = baseId
        if (usedSkillIds.has(skillId)) {
          skillId = `${baseId}-legacy-${entry.identity.slice(0, 8)}`
          warnings.push({
            code: 'SKILL_MIGRATION_ID_CONFLICT',
            sourceDigest: entry.identity,
            requestedId: baseId,
            resolvedId: skillId
          })
        }
        const parent = statePath('drafts')
        const candidate = await createTempDirectory(parent)
        try {
          await writePackageFiles(candidate, {
            'SKILL.md': legacySkillDocument(entry.item, skillId)
          })
          await validateOrThrow(candidate)
          await syncPackage(candidate)
          await rename(candidate, path.join(parent, draftId))
        } catch (error) {
          await fsp.rm(candidate, { recursive: true, force: true })
          throw error
        }
        usedSkillIds.add(skillId)
        existingEntryIds.add(draftId)
        migrated.push({
          sourceDigest: entry.identity,
          draftId,
          skillId,
          status: 'migrated'
        })
      }

      const marker = {
        version: 1,
        complete: true,
        migrated,
        warnings
      }
      await writeMigrationMarker(marker)
      return marker
    })
  }

  async function list () {
    await ensureRoots()
    const catalog = []
    for (const state of STATES) {
      const entries = await fsp.readdir(statePath(state), { withFileTypes: true })
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        catalog.push(await metadataFor(path.join(statePath(state), entry.name), state, entry.name))
      }
    }
    return catalog
  }

  async function getMetadata (id) {
    const found = await locate(id)
    if (!found) return null
    return metadataFor(found.directory, found.state, found.entryId)
  }

  async function readFile (id, relativePath) {
    const found = await locate(id)
    if (!found) throw repositoryError('SKILL_NOT_FOUND', 'Skill was not found.')
    const safePath = normalizeSkillRelativePath(relativePath)
    const filePath = resolveSkillEntry(found.directory, safePath)
    const stat = await fsp.stat(filePath)
    if (!stat.isFile()) throw repositoryError('SKILL_FILE_INVALID', 'Skill path is not a regular file.')
    const content = await fsp.readFile(filePath, 'utf8')
    const digest = crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')
    return { path: safePath, content, digest }
  }

  function readDocument (id) {
    return readFile(id, 'SKILL.md')
  }

  async function validateDraft (id) {
    const found = await locate(id)
    if (!found || found.state !== 'drafts') {
      throw repositoryError('SKILL_DRAFT_NOT_FOUND', 'Skill draft was not found.')
    }
    return validateSkillPackage(found.directory)
  }

  async function updateDraftFile (id, relativePath, content) {
    const found = await locate(id)
    if (!found) throw repositoryError('SKILL_NOT_FOUND', 'Skill was not found.')
    const current = await metadataFor(found.directory, found.state, found.entryId)
    const skillId = current.skillId
    return withLock(skillId, async () => {
      const latest = await locate(id)
      if (!latest) throw repositoryError('SKILL_NOT_FOUND', 'Skill changed before it could be edited.')
      const parent = statePath('drafts')
      const candidate = await copyToTemp(latest.directory, parent)
      let target
      try {
        const safePath = normalizeSkillRelativePath(relativePath)
        const filePath = resolveSkillEntry(candidate, safePath, { allowMissing: true })
        await fsp.mkdir(path.dirname(filePath), { recursive: true })
        await fsp.writeFile(filePath, content)
        await syncPackage(candidate)
        if (latest.state === 'drafts') {
          target = latest.directory
          await atomicReplaceDirectory(candidate, target)
        } else {
          const draftId = `${skillId}-draft-${uniqueToken()}`
          target = path.join(parent, draftId)
          await rename(candidate, target)
          onDigestInvalidated({ skillId, packageDigest: current.packageDigest })
        }
        return metadataFor(target, 'drafts', path.basename(target), skillId)
      } catch (error) {
        await fsp.rm(candidate, { recursive: true, force: true })
        throw error
      }
    })
  }

  async function enableDraft (draftId, expectedDigest) {
    const found = await locate(draftId)
    if (!found || found.state !== 'drafts') {
      throw repositoryError('SKILL_DRAFT_NOT_FOUND', 'Skill draft was not found.')
    }
    const firstValidation = await validateOrThrow(found.directory, expectedDigest)
    const skillId = firstValidation.manifest.id
    return withLock(skillId, async () => {
      const latest = await locate(draftId)
      if (!latest || latest.state !== 'drafts') {
        throw repositoryError('SKILL_DRAFT_NOT_FOUND', 'Skill draft changed before it could be enabled.')
      }
      const validation = await validateOrThrow(latest.directory, expectedDigest)
      await snapshotEnabled(skillId)
      const target = path.join(statePath('enabled'), skillId)
      const candidate = await copyToTemp(latest.directory, statePath('enabled'))
      const consumed = path.join(
        statePath('drafts'),
        `.consumed-${draftId}-${uniqueToken()}`
      )
      let sourceHidden = false
      try {
        await validateOrThrow(candidate, expectedDigest)
        await syncPackage(candidate)
        await rename(latest.directory, consumed)
        sourceHidden = true
        await atomicReplaceDirectory(candidate, target)
        try {
          await fsp.rm(consumed, { recursive: true, force: true })
        } catch (error) {
          onCleanupError(error)
        }
        return metadataFor(target, 'enabled', skillId, validation.manifest.id)
      } catch (error) {
        if (sourceHidden && await pathExists(consumed) &&
          !await pathExists(latest.directory)) {
          await rename(consumed, latest.directory)
        }
        await fsp.rm(candidate, { recursive: true, force: true })
        throw error
      }
    })
  }

  async function disable (skillId) {
    assertSkillId(skillId)
    return withLock(skillId, async () => {
      await ensureRoots()
      const source = path.join(statePath('enabled'), skillId)
      if (!await pathExists(source)) throw repositoryError('SKILL_ENABLED_NOT_FOUND', 'Enabled Skill was not found.')
      const validation = await validateOrThrow(source)
      await snapshotDirectory(skillId, source, validation.packageDigest)
      const candidate = await copyToTemp(source, statePath('disabled'))
      const target = path.join(statePath('disabled'), skillId)
      const consumed = path.join(
        statePath('enabled'),
        `.consumed-${skillId}-${uniqueToken()}`
      )
      let sourceHidden = false
      try {
        await rename(source, consumed)
        sourceHidden = true
        await atomicReplaceDirectory(candidate, target)
      } catch (error) {
        if (sourceHidden && await pathExists(consumed) &&
          !await pathExists(source)) {
          await rename(consumed, source)
        }
        await fsp.rm(candidate, { recursive: true, force: true })
        throw error
      }
      try {
        await fsp.rm(consumed, { recursive: true, force: true })
      } catch (error) {
        onCleanupError(error)
      }
      onDigestInvalidated({ skillId, packageDigest: validation.packageDigest })
      return metadataFor(target, 'disabled', skillId, skillId)
    })
  }

  async function rollback (skillId, digest) {
    assertSkillId(skillId)
    if (!/^[a-f0-9]{64}$/.test(String(digest || ''))) {
      throw repositoryError('SKILL_DIGEST_INVALID', 'Skill history digest is invalid.')
    }
    return withLock(skillId, async () => {
      await ensureRoots()
      const source = historyPath(skillId, digest)
      if (!await pathExists(source)) throw repositoryError('SKILL_HISTORY_NOT_FOUND', 'Skill history version was not found.')
      await validateOrThrow(source, digest)
      await snapshotEnabled(skillId)
      const target = path.join(statePath('enabled'), skillId)
      const candidate = await copyToTemp(source, statePath('enabled'))
      try {
        await syncPackage(candidate)
        await atomicReplaceDirectory(candidate, target)
        return metadataFor(target, 'enabled', skillId, skillId)
      } catch (error) {
        await fsp.rm(candidate, { recursive: true, force: true })
        throw error
      }
    })
  }

  async function remove (id) {
    const found = await locate(id)
    if (!found) return false
    const current = await metadataFor(found.directory, found.state, found.entryId)
    return withLock(current.skillId, async () => {
      const latest = await locate(id)
      if (!latest) return false
      if (latest.state !== 'drafts' && current.valid && current.packageDigest) {
        await snapshotDirectory(current.skillId, latest.directory, current.packageDigest)
      }
      await fsp.rm(latest.directory, { recursive: true, force: true })
      if (latest.state === 'enabled') {
        onDigestInvalidated({ skillId: current.skillId, packageDigest: current.packageDigest })
      }
      return true
    })
  }

  return Object.freeze({
    list,
    getMetadata,
    readDocument,
    readFile,
    migrateLegacySkills,
    createDraft,
    updateDraftFile,
    validateDraft,
    enableDraft,
    disable,
    rollback,
    remove
  })
}

module.exports = {
  createAgentSkillRepository,
  repositoryError
}
