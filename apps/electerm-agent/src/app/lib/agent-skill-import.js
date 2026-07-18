const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const tar = require('tar')
const yauzl = require('yauzl')
const { normalizeSkillRelativePath, resolveSkillEntry } = require('./agent-skill-path')
const { validateSkillPackage, DEFAULT_LIMITS } = require('./agent-skill-validator')

const DEFAULT_IMPORT_LIMITS = Object.freeze({
  ...DEFAULT_LIMITS,
  maxArchiveBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 100,
  compressionRatioMinBytes: 64 * 1024
})

function importError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function isInside (root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function normalizeArchivePath (entryPath, directory = false) {
  if (typeof entryPath !== 'string' || !entryPath || entryPath.includes('\0') || entryPath.includes('\\')) {
    throw importError('SKILL_IMPORT_PATH_INVALID', 'Archive contains an invalid path.')
  }
  const withoutTrailingSlash = directory && entryPath.endsWith('/')
    ? entryPath.slice(0, -1)
    : entryPath
  if (!withoutTrailingSlash) return ''
  try {
    return normalizeSkillRelativePath(withoutTrailingSlash)
  } catch {
    throw importError('SKILL_IMPORT_PATH_INVALID', 'Archive path escapes the Skill package.')
  }
}

function finalizeEntries (rawEntries, limits, archiveBytes) {
  const files = rawEntries.filter(entry => entry.type === 'file')
  if (files.length > limits.maxFiles) {
    throw importError('SKILL_IMPORT_FILE_COUNT_EXCEEDED', 'Skill import contains too many files.')
  }
  let totalBytes = 0
  for (const entry of files) {
    if (entry.size > limits.maxFileBytes) {
      throw importError('SKILL_IMPORT_FILE_TOO_LARGE', 'Skill import contains an oversized file.')
    }
    totalBytes += entry.size
    if (totalBytes > limits.maxTotalBytes) {
      throw importError('SKILL_IMPORT_PACKAGE_TOO_LARGE', 'Skill import exceeds the total size limit.')
    }
  }
  if (totalBytes >= limits.compressionRatioMinBytes &&
    totalBytes / Math.max(archiveBytes, 1) > limits.maxCompressionRatio) {
    throw importError('SKILL_IMPORT_COMPRESSION_RATIO_EXCEEDED', 'Skill archive compression ratio exceeds the safety limit.')
  }

  const fileParts = files.map(entry => entry.normalizedPath.split('/'))
  const commonRoot = fileParts.length && fileParts.every(parts => parts.length > 1 && parts[0] === fileParts[0][0])
    ? fileParts[0][0]
    : null
  const seen = new Set()
  const planned = []
  for (const entry of files) {
    const relativePath = commonRoot
      ? entry.normalizedPath.split('/').slice(1).join('/')
      : entry.normalizedPath
    const collisionKey = relativePath.toLowerCase()
    if (seen.has(collisionKey)) {
      throw importError('SKILL_IMPORT_DUPLICATE_PATH', 'Skill import contains duplicate normalized paths.')
    }
    seen.add(collisionKey)
    planned.push({ ...entry, relativePath })
  }
  return { entries: planned, commonRoot, totalBytes }
}

async function inspectFolder (sourcePath, limits) {
  const entries = []
  async function visit (directory, prefix = '') {
    const children = await fsp.readdir(directory, { withFileTypes: true })
    for (const child of children) {
      const fullPath = path.join(directory, child.name)
      const relativePath = prefix ? `${prefix}/${child.name}` : child.name
      const stat = await fsp.lstat(fullPath)
      if (stat.isSymbolicLink()) {
        throw importError('SKILL_IMPORT_LINK_REJECTED', 'Skill folders cannot contain links.')
      }
      if (child.isDirectory()) {
        await visit(fullPath, relativePath)
      } else if (child.isFile()) {
        entries.push({
          type: 'file',
          sourcePath: fullPath,
          normalizedPath: normalizeArchivePath(relativePath),
          size: stat.size
        })
      } else {
        throw importError('SKILL_IMPORT_ENTRY_TYPE_INVALID', 'Skill folders may contain only regular files and directories.')
      }
    }
  }
  await visit(sourcePath)
  return {
    ...finalizeEntries(entries, limits, Number.MAX_SAFE_INTEGER),
    sourceRoot: await fsp.realpath(sourcePath)
  }
}

function listZipEntries (archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, autoClose: true, strictFileNames: true }, (openError, zipFile) => {
      if (openError) return reject(importError('SKILL_IMPORT_ARCHIVE_INVALID', 'ZIP archive could not be opened.'))
      const entries = []
      let settled = false
      const fail = error => {
        if (settled) return
        settled = true
        zipFile.close()
        reject(error)
      }
      zipFile.on('error', () => fail(importError('SKILL_IMPORT_ARCHIVE_INVALID', 'ZIP archive is invalid.')))
      zipFile.on('entry', entry => {
        try {
          if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
            throw importError('SKILL_IMPORT_ENCRYPTED_ARCHIVE', 'Encrypted Skill archives are not supported.')
          }
          const isDirectory = entry.fileName.endsWith('/') || (entry.externalFileAttributes & 0x10) !== 0
          const unixMode = (entry.externalFileAttributes >>> 16) & 0xFFFF
          const unixType = unixMode & 0o170000
          if (unixType && unixType !== 0o100000 && unixType !== 0o040000) {
            throw importError('SKILL_IMPORT_LINK_REJECTED', 'ZIP links and special entries are not allowed.')
          }
          const normalizedPath = normalizeArchivePath(entry.fileName, isDirectory)
          if (!isDirectory) {
            entries.push({
              type: 'file',
              archivePath: entry.fileName,
              normalizedPath,
              size: entry.uncompressedSize,
              compressedSize: entry.compressedSize
            })
          }
          zipFile.readEntry()
        } catch (error) {
          fail(error)
        }
      })
      zipFile.on('end', () => {
        if (settled) return
        settled = true
        resolve(entries)
      })
      zipFile.readEntry()
    })
  })
}

async function inspectZip (archivePath, limits) {
  const entries = await listZipEntries(archivePath)
  const compressedBytes = entries.reduce((sum, entry) => sum + entry.compressedSize, 0)
  return finalizeEntries(entries, limits, compressedBytes)
}

async function inspectTar (archivePath, limits) {
  const entries = []
  let inspectionError = null
  try {
    await tar.t({
      file: archivePath,
      preservePaths: true,
      onReadEntry: entry => {
        try {
          if (inspectionError) return
          const isFile = entry.type === 'File' || entry.type === 'OldFile'
          const isDirectory = entry.type === 'Directory'
          if (!isFile && !isDirectory) {
            entries.push({ type: 'unsafe' })
            return
          }
          const normalizedPath = normalizeArchivePath(entry.path, isDirectory)
          if (isFile) {
            entries.push({
              type: 'file',
              archivePath: entry.path,
              normalizedPath,
              size: entry.size
            })
          }
        } catch (error) {
          inspectionError = error
        } finally {
          entry.resume()
        }
      }
    })
  } catch (error) {
    if (error.code?.startsWith('SKILL_IMPORT_')) throw error
    throw importError('SKILL_IMPORT_ARCHIVE_INVALID', 'TAR archive could not be inspected.')
  }
  if (inspectionError) throw inspectionError
  if (entries.some(entry => entry.type === 'unsafe')) {
    throw importError('SKILL_IMPORT_LINK_REJECTED', 'TAR links and special entries are not allowed.')
  }
  const archiveStat = await fsp.stat(archivePath)
  return finalizeEntries(entries, limits, archiveStat.size)
}

async function copyBoundedFile (source, target, maxBytes, expectedBytes) {
  let bytes = 0
  const limiter = new Transform({
    transform (chunk, encoding, callback) {
      bytes += chunk.length
      if (bytes > maxBytes) {
        callback(importError('SKILL_IMPORT_FILE_TOO_LARGE', 'Skill import source exceeded the size limit.'))
      } else {
        callback(null, chunk)
      }
    }
  })
  await pipeline(
    fs.createReadStream(source),
    limiter,
    fs.createWriteStream(target, { flags: 'wx' })
  )
  if (expectedBytes !== undefined && bytes !== expectedBytes) {
    throw importError('SKILL_IMPORT_SIZE_MISMATCH', 'Skill import source changed while it was copied.')
  }
}

async function copyFolderEntries (plan, stagingRoot, limits) {
  for (const entry of plan.entries) {
    const target = resolveSkillEntry(stagingRoot, entry.relativePath, { allowMissing: true })
    await fsp.mkdir(path.dirname(target), { recursive: true })
    const stat = await fsp.lstat(entry.sourcePath)
    const realSource = await fsp.realpath(entry.sourcePath)
    if (!stat.isFile() || stat.isSymbolicLink() || !isInside(plan.sourceRoot, realSource)) {
      throw importError('SKILL_IMPORT_LINK_REJECTED', 'Skill folder changed to an unsafe entry while importing.')
    }
    await copyBoundedFile(entry.sourcePath, target, limits.maxFileBytes, entry.size)
  }
}

function extractZip (archivePath, plan, stagingRoot, limits) {
  const plannedByArchivePath = new Map(plan.entries.map(entry => [entry.archivePath, entry]))
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, autoClose: true, strictFileNames: true }, (openError, zipFile) => {
      if (openError) return reject(importError('SKILL_IMPORT_ARCHIVE_INVALID', 'ZIP archive could not be reopened.'))
      let settled = false
      const fail = error => {
        if (settled) return
        settled = true
        zipFile.close()
        reject(error.code?.startsWith('SKILL_IMPORT_')
          ? error
          : importError('SKILL_IMPORT_EXTRACTION_FAILED', 'ZIP archive extraction failed.'))
      }
      zipFile.on('error', fail)
      zipFile.on('entry', entry => {
        const planned = plannedByArchivePath.get(entry.fileName)
        if (!planned) {
          zipFile.readEntry()
          return
        }
        zipFile.openReadStream(entry, async (streamError, readStream) => {
          if (streamError) return fail(streamError)
          try {
            const target = resolveSkillEntry(stagingRoot, planned.relativePath, { allowMissing: true })
            await fsp.mkdir(path.dirname(target), { recursive: true })
            let bytes = 0
            const limiter = new Transform({
              transform (chunk, encoding, callback) {
                bytes += chunk.length
                if (bytes > planned.size || bytes > limits.maxFileBytes) {
                  callback(importError('SKILL_IMPORT_SIZE_MISMATCH', 'ZIP entry exceeded its declared size.'))
                } else {
                  callback(null, chunk)
                }
              }
            })
            await pipeline(readStream, limiter, fs.createWriteStream(target, { flags: 'wx' }))
            if (bytes !== planned.size) {
              throw importError('SKILL_IMPORT_SIZE_MISMATCH', 'ZIP entry size did not match its declaration.')
            }
            zipFile.readEntry()
          } catch (error) {
            fail(error)
          }
        })
      })
      zipFile.on('end', () => {
        if (settled) return
        settled = true
        resolve()
      })
      zipFile.readEntry()
    })
  })
}

async function extractTar (archivePath, plan, stagingRoot) {
  const allowed = new Set(plan.entries.map(entry => entry.archivePath))
  try {
    await tar.x({
      file: archivePath,
      cwd: stagingRoot,
      preservePaths: false,
      strip: plan.commonRoot ? 1 : 0,
      filter: (entryPath, entry) => {
        return allowed.has(entryPath) && (entry.type === 'File' || entry.type === 'OldFile')
      }
    })
  } catch {
    throw importError('SKILL_IMPORT_EXTRACTION_FAILED', 'TAR archive extraction failed.')
  }
}

async function readStagedFiles (root, fileDigests) {
  const files = {}
  for (const relativePath of Object.keys(fileDigests)) {
    files[relativePath] = await fsp.readFile(resolveSkillEntry(root, relativePath))
  }
  return files
}

function createAgentSkillImporter (options = {}) {
  if (!options.repository || typeof options.repository.createDraft !== 'function') {
    throw importError('SKILL_IMPORT_REPOSITORY_REQUIRED', 'Skill importer requires a repository.')
  }
  const repository = options.repository
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...(options.limits || {}) }
  const tempRoot = path.resolve(options.tempRoot || os.tmpdir())
  const repositoryRoot = options.repositoryRoot ? path.resolve(options.repositoryRoot) : null

  async function importSkill (source) {
    if (typeof source !== 'string' || !source) {
      throw importError('SKILL_IMPORT_SOURCE_INVALID', 'Skill import source is invalid.')
    }
    const sourcePath = path.resolve(source)
    const sourceStat = await fsp.lstat(sourcePath).catch(() => null)
    if (!sourceStat) throw importError('SKILL_IMPORT_SOURCE_MISSING', 'Skill import source does not exist.')
    if (sourceStat.isSymbolicLink()) throw importError('SKILL_IMPORT_LINK_REJECTED', 'Skill import source cannot be a link.')
    if (repositoryRoot && isInside(repositoryRoot, sourcePath)) {
      throw importError('SKILL_IMPORT_SOURCE_REJECTED', 'Skill repository content cannot be imported as a new package.')
    }

    await fsp.mkdir(tempRoot, { recursive: true })
    const stagingParent = await fsp.mkdtemp(path.join(tempRoot, 'agent-skill-import-'))
    const stagingRoot = path.join(stagingParent, 'package')
    await fsp.mkdir(stagingRoot)
    try {
      let plan
      if (sourceStat.isDirectory()) {
        plan = await inspectFolder(sourcePath, limits)
        await copyFolderEntries(plan, stagingRoot, limits)
      } else if (sourceStat.isFile() && sourcePath.toLowerCase().endsWith('.zip')) {
        const snapshotPath = path.join(stagingParent, 'source.zip')
        await copyBoundedFile(sourcePath, snapshotPath, limits.maxArchiveBytes, sourceStat.size)
        plan = await inspectZip(snapshotPath, limits)
        await extractZip(snapshotPath, plan, stagingRoot, limits)
      } else if (sourceStat.isFile() && /\.(?:tar|tar\.gz|tgz)$/i.test(sourcePath)) {
        const snapshotPath = path.join(stagingParent, 'source.tar')
        await copyBoundedFile(sourcePath, snapshotPath, limits.maxArchiveBytes, sourceStat.size)
        plan = await inspectTar(snapshotPath, limits)
        await extractTar(snapshotPath, plan, stagingRoot)
      } else {
        throw importError('SKILL_IMPORT_TYPE_UNSUPPORTED', 'Select a Skill folder, ZIP, TAR, TAR.GZ or TGZ package.')
      }

      const validation = await validateSkillPackage(stagingRoot, { limits })
      if (!validation.valid) {
        const error = importError('SKILL_IMPORT_VALIDATION_FAILED', 'Imported Skill package did not pass validation.')
        error.validation = validation
        throw error
      }
      return repository.createDraft(await readStagedFiles(stagingRoot, validation.fileDigests))
    } finally {
      await fsp.rm(stagingParent, { recursive: true, force: true })
    }
  }

  return Object.freeze({ importSkill })
}

module.exports = {
  DEFAULT_IMPORT_LIMITS,
  createAgentSkillImporter,
  importError
}
