const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')
const {
  ARTIFACT_ID_PATTERN,
  artifactError,
  assertArtifactId,
  validateArtifactDraft,
  validateArtifactFilters,
  validateArtifactProvenance,
  validateArtifactVersion
} = require('./artifact-validator')

function resolveInside (rootPath, ...segments) {
  const target = path.resolve(rootPath, ...segments)
  const relative = path.relative(rootPath, target)
  if (!relative || relative.startsWith(`..${path.sep}`) ||
    relative === '..' || path.isAbsolute(relative)) {
    throw artifactError(
      'ARTIFACT_PATH_INVALID',
      'Artifact path must remain inside the repository.'
    )
  }
  return target
}

async function pathExists (target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

async function writeJsonAtomic (filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fsp.writeFile(tempPath, JSON.stringify(value, null, 2), {
      encoding: 'utf8',
      flag: 'wx'
    })
    await fsp.rename(tempPath, filePath)
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
  }
}

async function readJson (filePath, code, message) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw artifactError(code, message)
  }
}

function versionName (version) {
  return String(validateArtifactVersion(version)).padStart(4, '0')
}

function generatedArtifactId (timestamp) {
  return `artifact-${Number(timestamp).toString(36)}-${crypto.randomBytes(6).toString('hex')}`
}

function createArtifactRepository (options = {}) {
  if (!options.rootPath) {
    throw artifactError(
      'ARTIFACT_REPOSITORY_ROOT_REQUIRED',
      'Artifact repository root is required.'
    )
  }
  const rootPath = path.resolve(String(options.rootPath))
  const now = typeof options.now === 'function' ? options.now : Date.now
  const locks = new Map()

  function withLock (id, operation) {
    const previous = locks.get(id) || Promise.resolve()
    const run = previous.catch(() => {}).then(operation)
    const settled = run.catch(() => {}).finally(() => {
      if (locks.get(id) === settled) locks.delete(id)
    })
    locks.set(id, settled)
    return run
  }

  function artifactPath (id) {
    return resolveInside(rootPath, assertArtifactId(id))
  }

  function manifestPath (id) {
    return resolveInside(artifactPath(id), 'manifest.json')
  }

  function versionPath (id, version) {
    return resolveInside(
      artifactPath(id),
      'versions',
      versionName(version)
    )
  }

  async function readManifest (id) {
    const manifest = await readJson(
      manifestPath(id),
      'ARTIFACT_MANIFEST_INVALID',
      'Artifact manifest is invalid.'
    )
    if (!manifest) return null
    if (manifest.id !== id || !Array.isArray(manifest.versions)) {
      throw artifactError(
        'ARTIFACT_MANIFEST_INVALID',
        'Artifact manifest is invalid.'
      )
    }
    return manifest
  }

  async function readVersion (id, entry) {
    const version = validateArtifactVersion(entry?.version)
    const source = await readJson(
      resolveInside(versionPath(id, version), 'source.json'),
      'ARTIFACT_SOURCE_INVALID',
      'Artifact source is invalid.'
    )
    if (!source) {
      throw artifactError(
        'ARTIFACT_SOURCE_INVALID',
        'Artifact source is missing.'
      )
    }
    return {
      ...entry,
      version,
      source: validateArtifactDraft(source)
    }
  }

  async function get (id) {
    assertArtifactId(id)
    const manifest = await readManifest(id)
    if (!manifest) return null
    const versions = await Promise.all(manifest.versions.map(entry => (
      readVersion(id, entry)
    )))
    const latest = versions.find(item => item.version === manifest.version) ||
      versions[versions.length - 1]
    return {
      ...manifest,
      version: latest?.version || manifest.version,
      source: latest?.source,
      versions
    }
  }

  async function allocateId (timestamp) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const id = generatedArtifactId(timestamp)
      if (!await pathExists(artifactPath(id))) return id
    }
    throw artifactError(
      'ARTIFACT_ID_ALLOCATION_FAILED',
      'Artifact ID could not be allocated.'
    )
  }

  function sourceFromCreateInput (input) {
    if (!input || typeof input !== 'object' || !input.source) {
      return validateArtifactDraft(input)
    }
    return validateArtifactDraft({
      ...input.source,
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.title === undefined ? {} : { title: input.title })
    })
  }

  async function create (input, provenance = {}) {
    const source = sourceFromCreateInput(input)
    const safeProvenance = validateArtifactProvenance(
      input?.source && input.provenance !== undefined
        ? input.provenance
        : provenance
    )
    await fsp.mkdir(rootPath, { recursive: true })
    const timestamp = now()
    const id = await allocateId(timestamp)
    const directory = artifactPath(id)
    const firstVersionPath = versionPath(id, 1)
    const manifest = {
      schemaVersion: 1,
      id,
      type: source.type,
      title: source.title,
      server: source.server,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      provenance: safeProvenance,
      versions: [{
        version: 1,
        createdAt: timestamp,
        formats: []
      }]
    }

    await fsp.mkdir(directory)
    try {
      await fsp.mkdir(
        resolveInside(firstVersionPath, 'files'),
        { recursive: true }
      )
      await writeJsonAtomic(
        resolveInside(firstVersionPath, 'source.json'),
        source
      )
      await writeJsonAtomic(manifestPath(id), manifest)
      return get(id)
    } catch (error) {
      await fsp.rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  async function createVersion (id, draft) {
    assertArtifactId(id)
    const source = validateArtifactDraft(draft)
    return withLock(id, async () => {
      const manifest = await readManifest(id)
      if (!manifest) {
        throw artifactError(
          'ARTIFACT_NOT_FOUND',
          'Artifact was not found.'
        )
      }
      const version = validateArtifactVersion(
        Math.max(0, ...manifest.versions.map(item => item.version)) + 1
      )
      const directory = versionPath(id, version)
      const timestamp = now()
      const nextManifest = {
        ...manifest,
        type: source.type,
        title: source.title,
        server: source.server,
        updatedAt: timestamp,
        version,
        versions: [
          ...manifest.versions,
          {
            version,
            createdAt: timestamp,
            formats: []
          }
        ]
      }

      await fsp.mkdir(path.dirname(directory), { recursive: true })
      try {
        await fsp.mkdir(directory)
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw artifactError(
            'ARTIFACT_VERSION_EXISTS',
            'Artifact version already exists.'
          )
        }
        throw error
      }
      try {
        await fsp.mkdir(resolveInside(directory, 'files'))
        await writeJsonAtomic(
          resolveInside(directory, 'source.json'),
          source
        )
        await writeJsonAtomic(manifestPath(id), nextManifest)
        return get(id)
      } catch (error) {
        await fsp.rm(directory, { recursive: true, force: true })
        throw error
      }
    })
  }

  async function list (input = {}) {
    const filters = validateArtifactFilters(input)
    await fsp.mkdir(rootPath, { recursive: true })
    const entries = await fsp.readdir(rootPath, { withFileTypes: true })
    const manifests = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !ARTIFACT_ID_PATTERN.test(entry.name)) {
        continue
      }
      const manifest = await readManifest(entry.name)
      if (!manifest) continue
      const haystack = `${manifest.title || ''}\n${manifest.server || ''}`
        .toLowerCase()
      if (filters.query && !haystack.includes(filters.query.toLowerCase())) {
        continue
      }
      if (filters.server &&
        !String(manifest.server || '').toLowerCase()
          .includes(filters.server.toLowerCase())) {
        continue
      }
      if (filters.format && !manifest.versions.some(version => (
        Array.isArray(version.formats) &&
        version.formats.some(item => (
          typeof item === 'string'
            ? item === filters.format
            : item?.format === filters.format
        ))
      ))) {
        continue
      }
      manifests.push(manifest)
    }
    return manifests.sort((left, right) => (
      Number(right.updatedAt) - Number(left.updatedAt) ||
      left.id.localeCompare(right.id)
    ))
  }

  async function remove (id) {
    assertArtifactId(id)
    return withLock(id, async () => {
      const directory = artifactPath(id)
      if (!await pathExists(manifestPath(id))) return false
      await fsp.rm(directory, { recursive: true, force: true })
      return true
    })
  }

  return Object.freeze({
    create,
    createVersion,
    delete: remove,
    get,
    list
  })
}

module.exports = {
  createArtifactRepository,
  writeJsonAtomic
}
