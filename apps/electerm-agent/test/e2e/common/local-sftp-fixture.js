const crypto = require('node:crypto')
const { promises: fs } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const prefix = 'shellpilot-quality-sftp-'

function assertPathInsideRoot (root, candidate) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(resolvedRoot + path.sep)
  ) {
    throw new Error('SFTP fixture path escaped its temporary root')
  }
  return resolvedCandidate
}

function resolveVirtualPath (root, input = '/') {
  const normalized = path.posix.normalize('/' + String(input || '/').replace(/\\/g, '/'))
  return assertPathInsideRoot(root, path.join(root, ...normalized.split('/').filter(Boolean)))
}

function hashBuffer (value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizeRootOnlyPath (input = '/') {
  return path.posix.normalize('/' + String(input || '/').replace(/\\/g, '/'))
}

function parentRootOnlyPath (input) {
  const normalized = normalizeRootOnlyPath(input)
  return normalized === '/' ? null : path.posix.dirname(normalized)
}

function cloneRootEntry (entry) {
  if (!entry) return null
  return {
    ...entry,
    ...(entry.content ? { content: Buffer.from(entry.content) } : {})
  }
}

async function createLocalSftpFixture () {
  const root = await fs.mkdtemp(path.join(tmpdir(), prefix))
  assertPathInsideRoot(root, root)
  const fixtureContent = Buffer.from('ShellPilot isolated SFTP quality fixture\n', 'utf8')
  await fs.mkdir(path.join(root, 'incoming'), { recursive: true })
  await fs.mkdir(path.join(root, 'home', 'shellpilot'), { recursive: true })
  const localRoot = path.join(root, 'local-client')
  await fs.mkdir(localRoot, { recursive: true })
  await fs.writeFile(
    path.join(localRoot, 'upload.txt'),
    'uploaded through root staging\n'
  )
  await fs.writeFile(path.join(root, 'remote-seed.txt'), fixtureContent)

  let nextInode = 1000
  const now = 1700000000
  const rootOnly = new Map()
  const addRootEntry = (remotePath, value) => {
    const normalized = normalizeRootOnlyPath(remotePath)
    rootOnly.set(normalized, {
      device: 77,
      inode: nextInode++,
      uid: 0,
      gid: 0,
      atime: now,
      mtime: now,
      ...value
    })
    return rootOnly.get(normalized)
  }
  addRootEntry('/', { type: 'directory', mode: 0o755 })
  addRootEntry('/root-only', { type: 'directory', mode: 0o700 })
  addRootEntry('/root-only/app.conf', {
    type: 'file',
    mode: 0o600,
    content: Buffer.from('enabled=false\n', 'utf8')
  })
  addRootEntry('/root-only/cancel.bin', {
    type: 'file',
    mode: 0o600,
    content: Buffer.alloc(512 * 1024, 0x63)
  })

  const requireRootEntry = remotePath => {
    const normalized = normalizeRootOnlyPath(remotePath)
    const entry = rootOnly.get(normalized)
    if (!entry) {
      const error = new Error(`Root-only fixture path does not exist: ${normalized}`)
      error.code = 'ENOENT'
      throw error
    }
    return entry
  }
  const requireRootDirectory = remotePath => {
    const entry = requireRootEntry(remotePath)
    if (entry.type !== 'directory') {
      const error = new Error('Root-only fixture path is not a directory')
      error.code = 'ENOTDIR'
      throw error
    }
    return entry
  }
  const requireRootParent = remotePath => {
    const parent = parentRootOnlyPath(remotePath)
    if (!parent) throw new Error('Root-only fixture root cannot be mutated')
    requireRootDirectory(parent)
    return parent
  }

  const privilegedFileRequests = []
  const stagingReads = []
  const stagingWrites = []
  const stagingCleanups = []

  return {
    root,
    localRoot,
    fixtureContent,
    fixtureHash: hashBuffer(fixtureContent),
    rootOnly,
    privilegedFileRequests,
    stagingReads,
    stagingWrites,
    stagingCleanups,
    resolve: input => resolveVirtualPath(root, input),
    localPath: input => assertPathInsideRoot(
      localRoot,
      path.resolve(localRoot, String(input || ''))
    ),
    hashFile: async input => hashBuffer(await fs.readFile(resolveVirtualPath(root, input))),
    isRootOnlyPath: input => {
      const normalized = normalizeRootOnlyPath(input)
      return normalized === '/root-only' || normalized.startsWith('/root-only/')
    },
    isStagingPath: input => {
      const normalized = normalizeRootOnlyPath(input)
      return normalized.endsWith('/.shellpilot-privileged-transfers') ||
        normalized.includes('/.shellpilot-privileged-transfers/')
    },
    getRootEntry: input => cloneRootEntry(rootOnly.get(normalizeRootOnlyPath(input))),
    statRootPath: input => cloneRootEntry(requireRootEntry(input)),
    listRootDirectory: input => {
      const normalized = normalizeRootOnlyPath(input)
      requireRootDirectory(normalized)
      const prefix = normalized === '/' ? '/' : `${normalized}/`
      const result = []
      for (const [candidate, entry] of rootOnly) {
        if (candidate === normalized || !candidate.startsWith(prefix)) continue
        const relative = candidate.slice(prefix.length)
        if (!relative || relative.includes('/')) continue
        result.push({ name: relative, ...cloneRootEntry(entry) })
      }
      return result.sort((left, right) => left.name.localeCompare(right.name))
    },
    readRootFile: input => {
      const entry = requireRootEntry(input)
      if (entry.type !== 'file') throw new Error('Root-only fixture path is not a file')
      return entry.content.toString('utf8')
    },
    readRootBuffer: input => {
      const entry = requireRootEntry(input)
      if (entry.type !== 'file') throw new Error('Root-only fixture path is not a file')
      return Buffer.from(entry.content)
    },
    writeRootFile: (input, content, attrs = {}) => {
      const normalized = normalizeRootOnlyPath(input)
      requireRootParent(normalized)
      const existing = rootOnly.get(normalized)
      if (existing?.type === 'directory') throw new Error('Cannot replace root fixture directory')
      const buffer = Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(String(content), 'utf8')
      if (existing) {
        existing.content = buffer
        existing.mtime += 1
        Object.assign(existing, attrs)
      } else {
        addRootEntry(normalized, {
          type: 'file',
          mode: 0o600,
          content: buffer,
          ...attrs
        })
      }
      return cloneRootEntry(rootOnly.get(normalized))
    },
    mkdirRootDirectory: (input, attrs = {}) => {
      const normalized = normalizeRootOnlyPath(input)
      requireRootParent(normalized)
      if (rootOnly.has(normalized)) {
        const error = new Error('Root-only fixture path already exists')
        error.code = 'EEXIST'
        throw error
      }
      return cloneRootEntry(addRootEntry(normalized, {
        type: 'directory',
        mode: 0o755,
        ...attrs
      }))
    },
    renameRootPath: (source, target) => {
      const normalizedSource = normalizeRootOnlyPath(source)
      const normalizedTarget = normalizeRootOnlyPath(target)
      requireRootParent(normalizedSource)
      requireRootParent(normalizedTarget)
      requireRootEntry(normalizedSource)
      if (rootOnly.has(normalizedTarget)) {
        const error = new Error('Root-only fixture target already exists')
        error.code = 'EEXIST'
        throw error
      }
      const moving = [...rootOnly.entries()]
        .filter(([candidate]) => candidate === normalizedSource || candidate.startsWith(`${normalizedSource}/`))
      for (const [candidate] of moving) rootOnly.delete(candidate)
      for (const [candidate, entry] of moving) {
        rootOnly.set(normalizedTarget + candidate.slice(normalizedSource.length), entry)
      }
    },
    chmodRootPath: (input, mode) => {
      const entry = requireRootEntry(input)
      entry.mode = Number(mode)
      entry.mtime += 1
    },
    touchRootPath: input => {
      const entry = requireRootEntry(input)
      entry.mtime += 1
    },
    removeRootPath: input => {
      const normalized = normalizeRootOnlyPath(input)
      const entry = requireRootEntry(normalized)
      if (entry.type === 'directory' && [...rootOnly.keys()].some(
        candidate => candidate.startsWith(`${normalized}/`)
      )) {
        const error = new Error('Root-only fixture directory is not empty')
        error.code = 'ENOTEMPTY'
        throw error
      }
      rootOnly.delete(normalized)
    },
    async listStagingFiles () {
      const found = []
      const visit = async current => {
        const entries = await fs.readdir(current, { withFileTypes: true })
        for (const entry of entries) {
          const candidate = assertPathInsideRoot(root, path.join(current, entry.name))
          if (entry.isDirectory()) {
            await visit(candidate)
          } else if (candidate.split(path.sep).includes('.shellpilot-privileged-transfers')) {
            found.push(path.relative(root, candidate).replace(/\\/g, '/'))
          }
        }
      }
      await visit(root)
      return found.sort()
    },
    async cleanup () {
      if (!path.basename(root).startsWith(prefix)) {
        throw new Error('Refusing to remove unexpected SFTP fixture root')
      }
      assertPathInsideRoot(path.dirname(root), root)
      await fs.rm(root, { recursive: true, force: true })
    }
  }
}

module.exports = {
  assertPathInsideRoot,
  createLocalSftpFixture,
  normalizeRootOnlyPath,
  resolveVirtualPath
}
