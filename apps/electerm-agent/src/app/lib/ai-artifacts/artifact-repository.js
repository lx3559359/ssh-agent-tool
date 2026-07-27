const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')
const {
  ARTIFACT_ID_PATTERN,
  artifactError,
  assertArtifactId,
  validateArtifactDestination,
  validateArtifactDraft,
  validateArtifactFormat,
  validateArtifactFilters,
  validateArtifactProvenance,
  validateArtifactVersion
} = require('./artifact-validator')

const ROOT_MUTATION_LOCKS = new Map()

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

function unsafePathError () {
  return artifactError(
    'ARTIFACT_PATH_UNSAFE',
    'Artifact path contains a symbolic link or leaves the repository.'
  )
}

function isInside (rootPath, target, allowRoot = false) {
  const relative = path.relative(rootPath, target)
  return (allowRoot && relative === '') ||
    (
      Boolean(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
}

async function lstatOrNull (target) {
  try {
    return await fsp.lstat(target)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function ensureRepositoryRoot (rootPath) {
  await fsp.mkdir(rootPath, { recursive: true })
  const stat = await fsp.lstat(rootPath)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw unsafePathError()
  }
  return fsp.realpath(rootPath)
}

function normalizedRootKey (realRoot) {
  const normalized = path.normalize(realRoot)
  return process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized
}

function withRootMutationLock (realRoot, operation) {
  const key = normalizedRootKey(realRoot)
  const previous = ROOT_MUTATION_LOCKS.get(key) || Promise.resolve()
  const run = previous.catch(() => {}).then(operation)
  const settled = run.catch(() => {}).finally(() => {
    if (ROOT_MUTATION_LOCKS.get(key) === settled) {
      ROOT_MUTATION_LOCKS.delete(key)
    }
  })
  ROOT_MUTATION_LOCKS.set(key, settled)
  return run
}

async function withRepositoryMutation (rootPath, operation) {
  const initialRealRoot = await ensureRepositoryRoot(rootPath)
  return withRootMutationLock(initialRealRoot, async () => {
    const lockedRealRoot = await ensureRepositoryRoot(rootPath)
    if (normalizedRootKey(lockedRealRoot) !==
      normalizedRootKey(initialRealRoot)) {
      throw unsafePathError()
    }
    return operation(lockedRealRoot)
  })
}

async function assertExistingSafePath (
  rootPath,
  realRoot,
  target,
  expectedType
) {
  const relative = path.relative(rootPath, target)
  if (!isInside(rootPath, target)) throw unsafePathError()
  let current = rootPath
  let stat
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    stat = await lstatOrNull(current)
    if (!stat || stat.isSymbolicLink()) throw unsafePathError()
    const actual = await fsp.realpath(current)
    if (!isInside(realRoot, actual, true)) throw unsafePathError()
  }
  if (expectedType === 'directory' && !stat.isDirectory()) {
    throw unsafePathError()
  }
  if (expectedType === 'file' && !stat.isFile()) {
    throw unsafePathError()
  }
  return stat
}

async function assertSafeTree (rootPath, realRoot, target) {
  const stat = await assertExistingSafePath(
    rootPath,
    realRoot,
    target
  )
  if (stat.isDirectory()) {
    const entries = await fsp.readdir(target)
    for (const entry of entries) {
      await assertSafeTree(
        rootPath,
        realRoot,
        resolveInside(target, entry)
      )
    }
  } else if (!stat.isFile()) {
    throw unsafePathError()
  }
}

async function ensureSafeDirectory (rootPath, realRoot, target) {
  const relative = path.relative(rootPath, target)
  if (!isInside(rootPath, target)) throw unsafePathError()
  let current = rootPath
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    let stat = await lstatOrNull(current)
    if (!stat) {
      await fsp.mkdir(current)
      stat = await fsp.lstat(current)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw unsafePathError()
    }
    const actual = await fsp.realpath(current)
    if (!isInside(realRoot, actual, true)) throw unsafePathError()
  }
}

async function assertSafeWriteTarget (
  rootPath,
  realRoot,
  target
) {
  await assertExistingSafePath(
    rootPath,
    realRoot,
    path.dirname(target),
    'directory'
  )
  const stat = await lstatOrNull(target)
  if (stat) {
    await assertExistingSafePath(
      rootPath,
      realRoot,
      target,
      'file'
    )
  }
}

async function removeSafeTree (rootPath, realRoot, target) {
  if (!await lstatOrNull(target)) return
  await assertSafeTree(rootPath, realRoot, target)
  await fsp.rm(target, { recursive: true, force: true })
}

async function writeJsonAtomic (filePath, value, options = {}) {
  const rename = options.rename || fsp.rename
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fsp.writeFile(tempPath, JSON.stringify(value, null, 2), {
      encoding: 'utf8',
      flag: 'wx'
    })
    await rename(tempPath, filePath)
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
  }
}

async function writeBufferAtomic (filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`
  try {
    await fsp.writeFile(tempPath, content, { flag: 'wx' })
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

function validateGeneratedOutput (value) {
  if (!value || typeof value !== 'object' || !Buffer.isBuffer(value.content) ||
    typeof value.filename !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value.filename) ||
    !Number.isSafeInteger(value.generatedAt) || value.generatedAt < 0) {
    throw artifactError(
      'ARTIFACT_OUTPUT_INVALID',
      'Artifact generated output is invalid.'
    )
  }
  const format = validateArtifactFormat(value.format)
  const sha256 = crypto.createHash('sha256')
    .update(value.content)
    .digest('hex')
  if (value.bytes !== value.content.byteLength || value.sha256 !== sha256) {
    throw artifactError(
      'ARTIFACT_OUTPUT_INVALID',
      'Artifact generated output is invalid.'
    )
  }
  return {
    format,
    filename: value.filename,
    bytes: value.bytes,
    sha256,
    generatedAt: value.generatedAt,
    content: value.content
  }
}

function outputMetadata (output) {
  return {
    format: output.format,
    filename: output.filename,
    bytes: output.bytes,
    sha256: output.sha256,
    generatedAt: output.generatedAt
  }
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

  async function readManifest (id, realRoot) {
    const directory = artifactPath(id)
    const directoryStat = await lstatOrNull(directory)
    if (!directoryStat) return null
    await assertSafeTree(rootPath, realRoot, directory)
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

  async function readVersion (id, entry, realRoot) {
    const version = validateArtifactVersion(entry?.version)
    const directory = versionPath(id, version)
    await assertExistingSafePath(
      rootPath,
      realRoot,
      directory,
      'directory'
    )
    await assertExistingSafePath(
      rootPath,
      realRoot,
      resolveInside(directory, 'files'),
      'directory'
    )
    const sourcePath = resolveInside(directory, 'source.json')
    await assertExistingSafePath(
      rootPath,
      realRoot,
      sourcePath,
      'file'
    )
    const source = await readJson(
      sourcePath,
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
    const realRoot = await ensureRepositoryRoot(rootPath)
    const manifest = await readManifest(id, realRoot)
    if (!manifest) return null
    const versions = await Promise.all(manifest.versions.map(entry => (
      readVersion(id, entry, realRoot)
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
      if (!await lstatOrNull(artifactPath(id))) return id
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
    return withRepositoryMutation(rootPath, async realRoot => {
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

      await ensureSafeDirectory(rootPath, realRoot, directory)
      try {
        await ensureSafeDirectory(
          rootPath,
          realRoot,
          resolveInside(firstVersionPath, 'files')
        )
        const sourcePath = resolveInside(firstVersionPath, 'source.json')
        await assertSafeWriteTarget(rootPath, realRoot, sourcePath)
        await writeJsonAtomic(
          sourcePath,
          source
        )
        const targetManifestPath = manifestPath(id)
        await assertSafeWriteTarget(
          rootPath,
          realRoot,
          targetManifestPath
        )
        await writeJsonAtomic(targetManifestPath, manifest)
        return get(id)
      } catch (error) {
        await removeSafeTree(rootPath, realRoot, directory)
        throw error
      }
    })
  }

  async function createVersion (id, draft) {
    assertArtifactId(id)
    const source = validateArtifactDraft(draft)
    return withRepositoryMutation(rootPath, async realRoot => {
      const manifest = await readManifest(id, realRoot)
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

      const existingVersion = await lstatOrNull(directory)
      if (existingVersion) {
        await assertExistingSafePath(
          rootPath,
          realRoot,
          directory
        )
        throw artifactError(
          'ARTIFACT_VERSION_EXISTS',
          'Artifact version already exists.'
        )
      }
      await ensureSafeDirectory(rootPath, realRoot, directory)
      try {
        await ensureSafeDirectory(
          rootPath,
          realRoot,
          resolveInside(directory, 'files')
        )
        const sourcePath = resolveInside(directory, 'source.json')
        await assertSafeWriteTarget(rootPath, realRoot, sourcePath)
        await writeJsonAtomic(
          sourcePath,
          source
        )
        const targetManifestPath = manifestPath(id)
        await assertSafeWriteTarget(
          rootPath,
          realRoot,
          targetManifestPath
        )
        await writeJsonAtomic(targetManifestPath, nextManifest)
        return get(id)
      } catch (error) {
        await removeSafeTree(rootPath, realRoot, directory)
        throw error
      }
    })
  }

  async function saveGeneratedOutputs (id, version, values) {
    assertArtifactId(id)
    const safeVersion = validateArtifactVersion(version)
    if (!Array.isArray(values) || values.length < 1) {
      throw artifactError(
        'ARTIFACT_OUTPUT_INVALID',
        'Artifact generated output is invalid.'
      )
    }
    const outputs = values.map(validateGeneratedOutput)
    if (new Set(outputs.map(output => output.format)).size !== outputs.length) {
      throw artifactError(
        'ARTIFACT_OUTPUT_INVALID',
        'Artifact generated output is invalid.'
      )
    }

    return withRepositoryMutation(rootPath, async realRoot => {
      const manifest = await readManifest(id, realRoot)
      if (!manifest) {
        throw artifactError('ARTIFACT_NOT_FOUND', 'Artifact was not found.')
      }
      const versionIndex = manifest.versions.findIndex(
        item => item.version === safeVersion
      )
      if (versionIndex < 0) {
        throw artifactError(
          'ARTIFACT_VERSION_NOT_FOUND',
          'Artifact version was not found.'
        )
      }

      const directory = versionPath(id, safeVersion)
      const filesPath = resolveInside(directory, 'files')
      await assertExistingSafePath(
        rootPath,
        realRoot,
        filesPath,
        'directory'
      )
      const replacements = []
      try {
        for (const [index, output] of outputs.entries()) {
          const target = resolveInside(filesPath, output.filename)
          await assertSafeWriteTarget(rootPath, realRoot, target)
          const existing = await lstatOrNull(target)
          const replacement = {
            target,
            backup: null,
            targetWritten: false
          }
          replacements.push(replacement)
          if (existing) {
            const backup = resolveInside(
              filesPath,
              `.${output.filename}.${process.pid}.${Date.now()}.${index}.bak`
            )
            await fsp.rename(target, backup)
            replacement.backup = backup
          }
          await writeBufferAtomic(target, output.content)
          replacement.targetWritten = true
        }

        const currentVersion = manifest.versions[versionIndex]
        const replacementFormats = new Map(
          outputs.map(output => [output.format, outputMetadata(output)])
        )
        const nextFormats = []
        for (const existing of currentVersion.formats || []) {
          const format = typeof existing === 'string'
            ? existing
            : existing?.format
          if (replacementFormats.has(format)) {
            nextFormats.push(replacementFormats.get(format))
            replacementFormats.delete(format)
          } else {
            nextFormats.push(existing)
          }
        }
        nextFormats.push(...replacementFormats.values())
        const nextVersions = manifest.versions.map((entry, index) => (
          index === versionIndex
            ? { ...entry, formats: nextFormats }
            : entry
        ))
        const nextManifest = {
          ...manifest,
          updatedAt: Math.max(
            Number(manifest.updatedAt) || 0,
            ...outputs.map(output => output.generatedAt)
          ),
          versions: nextVersions
        }
        const targetManifestPath = manifestPath(id)
        await assertSafeWriteTarget(
          rootPath,
          realRoot,
          targetManifestPath
        )
        await writeJsonAtomic(targetManifestPath, nextManifest)
      } catch (error) {
        for (const replacement of replacements.reverse()) {
          if (replacement.backup || replacement.targetWritten) {
            await fsp.rm(replacement.target, { force: true }).catch(() => {})
          }
          if (replacement.backup) {
            await fsp.rename(
              replacement.backup,
              replacement.target
            ).catch(() => {})
          }
        }
        throw error
      }
      for (const replacement of replacements) {
        if (replacement.backup) {
          await fsp.rm(replacement.backup, { force: true }).catch(() => {})
        }
      }
      return get(id)
    })
  }

  function validateTrustedArtifactDestination (destination) {
    if (
      typeof destination !== 'string' ||
      destination.length < 1 ||
      destination.length > 4096 ||
      destination.includes('\0') ||
      !path.isAbsolute(destination)
    ) {
      throw artifactError(
        'ARTIFACT_DESTINATION_INVALID',
        'Artifact destination is invalid.'
      )
    }
    return path.resolve(destination)
  }

  async function exportGeneratedFileInternal (
    id,
    version,
    format,
    safeDestination
  ) {
    return withRepositoryMutation(rootPath, async realRoot => {
      const manifest = await readManifest(id, realRoot)
      if (!manifest) {
        throw artifactError('ARTIFACT_NOT_FOUND', 'Artifact was not found.')
      }
      const versionEntry = manifest.versions.find(
        item => item.version === version
      )
      if (!versionEntry) {
        throw artifactError(
          'ARTIFACT_VERSION_NOT_FOUND',
          'Artifact version was not found.'
        )
      }
      const registered = (versionEntry.formats || []).find(item => (
        item && typeof item === 'object' && item.format === format
      ))
      if (!registered) {
        throw artifactError(
          'ARTIFACT_FILE_NOT_GENERATED',
          'Artifact file has not been generated.'
        )
      }
      let output
      try {
        output = validateGeneratedOutput({
          ...registered,
          content: await fsp.readFile(resolveInside(
            versionPath(id, version),
            'files',
            registered.filename
          ))
        })
      } catch (error) {
        if (String(error?.code || '').startsWith('ARTIFACT_')) throw error
        throw artifactError(
          'ARTIFACT_FILE_READ_FAILED',
          'Artifact file could not be read.'
        )
      }
      try {
        await writeBufferAtomic(path.resolve(safeDestination), output.content)
      } catch {
        throw artifactError(
          'ARTIFACT_EXPORT_FAILED',
          'Artifact file could not be exported.'
        )
      }
      return outputMetadata(output)
    })
  }

  function exportGeneratedFile (id, version, format, destination) {
    return exportGeneratedFileInternal(
      assertArtifactId(id),
      validateArtifactVersion(version),
      validateArtifactFormat(format),
      validateArtifactDestination(destination)
    )
  }

  function exportGeneratedFileToTrustedPath (
    id,
    version,
    format,
    destination
  ) {
    return exportGeneratedFileInternal(
      assertArtifactId(id),
      validateArtifactVersion(version),
      validateArtifactFormat(format),
      validateTrustedArtifactDestination(destination)
    )
  }

  async function list (input = {}) {
    const filters = validateArtifactFilters(input)
    const realRoot = await ensureRepositoryRoot(rootPath)
    const entries = await fsp.readdir(rootPath, { withFileTypes: true })
    const manifests = []
    for (const entry of entries) {
      if (!ARTIFACT_ID_PATTERN.test(entry.name)) {
        continue
      }
      const directory = artifactPath(entry.name)
      const stat = await assertExistingSafePath(
        rootPath,
        realRoot,
        directory
      )
      if (!stat.isDirectory()) continue
      const manifest = await readManifest(entry.name, realRoot)
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
      (Number(right.updatedAt) - Number(left.updatedAt)) ||
      left.id.localeCompare(right.id)
    ))
  }

  async function remove (id) {
    assertArtifactId(id)
    return withRepositoryMutation(rootPath, async realRoot => {
      const directory = artifactPath(id)
      if (!await lstatOrNull(directory)) return false
      await assertSafeTree(rootPath, realRoot, directory)
      await fsp.rm(directory, { recursive: true, force: true })
      return true
    })
  }

  return Object.freeze({
    create,
    createVersion,
    delete: remove,
    exportGeneratedFile,
    exportGeneratedFileToTrustedPath,
    get,
    list,
    saveGeneratedOutputs
  })
}

module.exports = {
  createArtifactRepository,
  writeJsonAtomic
}
