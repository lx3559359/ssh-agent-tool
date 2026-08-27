const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { importModule } = require('./helpers/import-esm')

const backendsModule =
  'src/client/components/sftp/remote-file-backends.js'

function sha256 (value) {
  return createHash('sha256').update(value).digest('hex')
}

function createTokenFactory () {
  let sequence = 0
  return () => (++sequence).toString(16).padStart(48, '0')
}

function missing (remotePath) {
  const error = new Error(`No such file: ${remotePath}`)
  error.code = 'SFTP_NO_SUCH_FILE'
  return error
}

function createBackendHarness (options = {}) {
  const home = '/home/login'
  const nodes = new Map([[home, {
    type: 'directory', mode: 0o700, uid: 1000, gid: 1000
  }]])
  const rootFiles = new Map(Object.entries(options.rootFiles || {}))
  let nextPrivilegedInode = 1000
  const privilegedNodes = new Map(Object.entries(options.privilegedTree || {}).map(
    ([remotePath, node]) => [remotePath, {
      mode: node.type === 'directory' ? 0o750 : 0o640,
      uid: 3,
      gid: 4,
      device: '1',
      inode: String(nextPrivilegedInode++),
      ...node,
      ...(node.content === undefined
        ? {}
        : { content: Buffer.from(node.content) })
    }]
  ))
  function ensurePrivilegedBinding (node) {
    if (!node) return null
    if (!node.device) node.device = '1'
    if (!node.inode) node.inode = String(nextPrivilegedInode++)
    return node
  }
  if (options.privilegedTree) {
    ensurePrivilegedBinding(privilegedNodes.get('/') || (() => {
      const node = { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
      privilegedNodes.set('/', node)
      return node
    })())
    for (const remotePath of [...privilegedNodes.keys()]) {
      let parent = remotePath
      while (parent !== '/') {
        const index = parent.lastIndexOf('/')
        parent = index <= 0 ? '/' : parent.slice(0, index)
        if (!privilegedNodes.has(parent)) {
          privilegedNodes.set(parent, ensurePrivilegedBinding({
            type: 'directory', mode: 0o755, uid: 0, gid: 0
          }))
        }
      }
    }
  }
  const requests = []
  const executions = []
  const events = []
  const sftpReads = []
  let leaseReleases = 0
  let activeLeaseExecutions = 0
  let peakLeaseExecutions = 0
  const sftp = {
    id: 'sftp-1',
    terminalId: 'term-1',
    async getHomeDir () { return home },
    async realpath (remotePath) { return remotePath || home },
    async lstat (remotePath) {
      const node = nodes.get(remotePath)
      if (!node) throw missing(remotePath)
      return {
        mode: ({ file: 0o100000, directory: 0o040000, symlink: 0o120000 })[node.type] |
          node.mode,
        size: node.type === 'file' ? node.content.length : 0,
        uid: node.uid,
        gid: node.gid,
        isDirectory: node.type === 'directory'
      }
    },
    async list (remotePath) {
      const prefix = `${remotePath}/`
      return [...nodes.keys()]
        .filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(path => ({ name: path.slice(prefix.length) }))
    },
    async mkdir (remotePath, attrs = {}) {
      if (nodes.has(remotePath)) throw new Error('Already exists')
      nodes.set(remotePath, {
        type: 'directory', mode: attrs.mode ?? 0o700, uid: 1000, gid: 1000
      })
      return 1
    },
    async chmod (remotePath, mode) {
      nodes.get(remotePath).mode = mode
      return 1
    },
    async createExclusiveFile (remotePath, base64, mode) {
      if (nodes.has(remotePath)) throw new Error('Target exists')
      if (options.uploadCreateFailure && remotePath.includes('/upload-')) {
        const cleanupSucceeded = options.uploadCleanupSucceeded !== false
        if (!cleanupSucceeded) {
          nodes.set(remotePath, {
            type: 'file',
            mode,
            uid: 1000,
            gid: 1000,
            content: options.uploadResidualMatches
              ? Buffer.from(base64, 'base64')
              : Buffer.from('partial upload')
          })
        }
        if (options.uploadCreateEndpointChange) sftp.id = 'sftp-2'
        const failure = Object.assign(new Error('remote upload write failed'), {
          ok: false,
          claimed: true,
          code: 'SFTP_EXCLUSIVE_WRITE_FAILED',
          message: 'remote upload write failed',
          cleanupAttempted: true,
          cleanupSucceeded,
          cleanupError: cleanupSucceeded ? null : 'remote unlink failed'
        })
        if (options.uploadCreateThrows) throw failure
        return failure
      }
      nodes.set(remotePath, {
        type: 'file',
        mode,
        uid: 1000,
        gid: 1000,
        content: Buffer.from(base64, 'base64')
      })
      events.push(`sftp:create:${remotePath}`)
      return 1
    },
    async readFile (remotePath) {
      const node = nodes.get(remotePath)
      if (!node) throw missing(remotePath)
      return node.content.toString('utf8')
    },
    async readFileChunk (remotePath, readOptions = {}) {
      events.push(`sftp:read:${remotePath}`)
      sftpReads.push({ remotePath, ...readOptions })
      const node = nodes.get(remotePath)
      if (!node) throw missing(remotePath)
      const offset = readOptions.offset || 0
      const maxBytes = readOptions.maxBytes || 64 * 1024
      const bytes = node.content.subarray(offset, offset + maxBytes)
      return {
        base64: bytes.toString('base64'),
        offset,
        nextOffset: offset + bytes.length,
        bytesRead: bytes.length,
        totalBytes: node.content.length,
        hasMore: offset + bytes.length < node.content.length
      }
    },
    async rm (remotePath) {
      if (!nodes.has(remotePath)) throw missing(remotePath)
      nodes.delete(remotePath)
      events.push(`sftp:rm:${remotePath}`)
      return 1
    },
    async removeEmptyDirectory (remotePath) {
      if ([...nodes.keys()].some(path => path.startsWith(`${remotePath}/`))) {
        throw new Error('Directory not empty')
      }
      if (!nodes.has(remotePath)) throw missing(remotePath)
      nodes.delete(remotePath)
      events.push(`sftp:rmdir:${remotePath}`)
      return 1
    }
  }

  async function executeCore ({ request, protocol }) {
    assert.equal(typeof protocol?.buildCommand, 'function')
    requests.push(request)
    const args = request.args
    if (request.operation === 'stage-handshake') {
      if (options.badHandshake) throw new Error('handshake rejected')
      const response = sha256(`${args.challenge}:root`)
      nodes.set(`${args.rootPath}/${args.responseName}`, {
        type: 'file',
        mode: 0o600,
        uid: 1000,
        gid: 1000,
        content: Buffer.from(response)
      })
      return {
        exitCode: 0,
        identity: { uid: '0', username: 'root' },
        kind: 'stage-handshake',
        response,
        uid: '1000',
        gid: '1000',
        mode: '700',
        rootRealPath: args.rootPath,
        rootDevice: '2049',
        rootInode: '777'
      }
    }
    if (request.operation === 'stage-cleanup') {
      events.push(`pty:cleanup:${args.objectName}`)
      if (options.cleanupFailure && args.objectName.startsWith(options.cleanupFailure)) {
        throw new Error('stage cleanup failed')
      }
      const remotePath = `${args.rootPath}/${args.objectName}`
      const node = nodes.get(remotePath)
      if (!node) return { exitCode: 0, kind: 'stage-cleanup', ok: true }
      if (node.type !== 'file' || sha256(node.content) !== args.sha256 ||
        String(node.content.length) !== args.size) {
        throw new Error('stage cleanup proof failed')
      }
      nodes.delete(remotePath)
      return { exitCode: 0, kind: 'stage-cleanup', ok: true }
    }
    if (request.operation === 'stage-export') {
      if (options.replaceSourceBeforeExport === args.sourcePath) {
        const current = privilegedNodes.get(args.sourcePath)
        privilegedNodes.set(args.sourcePath, {
          ...current,
          inode: String(nextPrivilegedInode++),
          content: Buffer.from(options.replacementSourceContent || 'evil')
        })
        options.replaceSourceBeforeExport = undefined
      }
      if (options.privilegedTree) {
        const source = ensurePrivilegedBinding(privilegedNodes.get(args.sourcePath))
        const parent = ensurePrivilegedBinding(privilegedNodes.get(
          args.sourceParentRealPath
        ))
        if (!source || source.type !== 'file' ||
          source.device !== args.sourceDevice || source.inode !== args.sourceInode ||
          parent.device !== args.sourceParentDevice ||
          parent.inode !== args.sourceParentInode) {
          throw new Error('stage export source binding changed')
        }
      }
      const bytes = options.privilegedTree
        ? Buffer.from(privilegedNodes.get(args.sourcePath)?.content || '')
        : Buffer.from(rootFiles.get(args.sourcePath) || '')
      nodes.set(`${args.rootPath}/${args.objectName}`, {
        type: 'file', mode: 0o600, uid: 1000, gid: 1000, content: bytes
      })
      return {
        exitCode: 0,
        kind: 'stage-export',
        sha256: options.exportDigest || sha256(bytes),
        size: options.exportSize ?? bytes.length
      }
    }
    if (request.operation === 'stage-import') {
      if (options.importFailure) throw new Error('stage import failed')
      const bytes = nodes.get(`${args.rootPath}/${args.objectName}`).content
      if (args.mustBeAbsent !== '1') {
        throw new Error('stage import requires an absent target')
      }
      if (options.privilegedTree) {
        const parent = ensurePrivilegedBinding(privilegedNodes.get(
          args.targetParentRealPath
        ))
        if (!parent || parent.type !== 'directory' ||
          parent.device !== args.targetParentDevice ||
          parent.inode !== args.targetParentInode) {
          throw new Error('stage import target parent binding changed')
        }
        if (privilegedNodes.has(args.targetPath)) {
          throw new Error('stage import target already exists')
        }
        if (options.failImportTarget === args.targetPath) {
          privilegedNodes.set(args.targetPath, {
            type: 'file',
            mode: 0o600,
            uid: 999,
            gid: 999,
            content: Buffer.from('foreign')
          })
          throw new Error('stage import raced target')
        }
        const installed = ensurePrivilegedBinding({
          type: 'file',
          mode: Number.parseInt(args.targetMode, 8),
          uid: Number(args.targetUid),
          gid: Number(args.targetGid),
          content: Buffer.from(bytes)
        })
        privilegedNodes.set(args.targetPath, installed)
      } else {
        rootFiles.set(args.targetPath, Buffer.from(bytes))
      }
      return {
        exitCode: 0,
        kind: 'stage-import',
        sha256: sha256(bytes),
        size: bytes.length,
        targetDevice: options.privilegedTree
          ? privilegedNodes.get(args.targetPath).device
          : '1',
        targetInode: options.privilegedTree
          ? privilegedNodes.get(args.targetPath).inode
          : '101'
      }
    }
    if (request.operation === 'list' || request.operation === 'list-bound') {
      if (options.privilegedTree) {
        if (request.operation === 'list-bound' &&
          options.replaceDirectoryBeforeBoundList === args.path) {
          privilegedNodes.set(args.path, ensurePrivilegedBinding({
            type: 'directory', mode: 0o755, uid: 99, gid: 99
          }))
          options.replaceDirectoryBeforeBoundList = undefined
        }
        const parent = privilegedNodes.get(args.path)
        if (!parent || parent.type !== 'directory') throw missing(args.path)
        ensurePrivilegedBinding(parent)
        if (request.operation === 'list-bound') {
          const lexicalParent = args.path.slice(0, args.path.lastIndexOf('/')) || '/'
          const lexicalParentNode = ensurePrivilegedBinding(
            privilegedNodes.get(lexicalParent)
          )
          if (!lexicalParentNode ||
            lexicalParentNode.device !== args.sourceParentDevice ||
            lexicalParentNode.inode !== args.sourceParentInode ||
            parent.device !== args.sourceDevice ||
            parent.inode !== args.sourceInode) {
            throw new Error('bound list directory binding changed')
          }
        }
        const prefix = `${args.path}/`
        const entries = [...privilegedNodes.entries()]
          .filter(([remotePath]) => remotePath.startsWith(prefix) &&
            !remotePath.slice(prefix.length).includes('/'))
          .map(([remotePath, node]) => ({
            name: remotePath.slice(prefix.length),
            type: node.type,
            mode: ({ file: 0o100000, directory: 0o040000, symlink: 0o120000 })[node.type] | node.mode,
            size: node.type === 'file' ? (node.size ?? node.content.length) : 0,
            atime: 1,
            mtime: 2,
            uid: node.uid,
            gid: node.gid
          }))
        return { exitCode: 0, kind: request.operation, entries }
      }
      return {
        exitCode: 0,
        kind: request.operation,
        entries: [
          { name: 'file.txt', type: 'file', mode: 0o100640, size: 12, atime: 1, mtime: 2, uid: 3, gid: 4 },
          { name: 'dir', type: 'directory', mode: 0o40750, size: 0, atime: 5, mtime: 6, uid: 7, gid: 8 },
          { name: 'link', type: 'symlink', mode: 0o120777, size: 3, atime: 9, mtime: 10, uid: 11, gid: 12 }
        ]
      }
    }
    if (['lstat', 'lstat-bound', 'stat'].includes(request.operation)) {
      if (options.privilegedTree) {
        if (request.operation === 'lstat-bound') {
          const parentPath = args.path.slice(0, args.path.lastIndexOf('/')) || '/'
          const boundParent = ensurePrivilegedBinding(privilegedNodes.get(parentPath))
          if (!boundParent || boundParent.device !== args.sourceParentDevice ||
            boundParent.inode !== args.sourceParentInode) {
            throw new Error('bound lstat parent binding changed')
          }
        }
        const node = privilegedNodes.get(args.path)
        if (!node) {
          options.onPrivilegedLstat?.(args.path, privilegedNodes)
          return { exitCode: 0, kind: request.operation, missing: true }
        }
        ensurePrivilegedBinding(node)
        const parentPath = args.path === '/'
          ? '/'
          : args.path.slice(0, args.path.lastIndexOf('/')) || '/'
        const parent = ensurePrivilegedBinding(privilegedNodes.get(parentPath))
        const result = {
          exitCode: 0,
          kind: request.operation,
          metadata: {
            mode: ({ file: 0o100000, directory: 0o040000, symlink: 0o120000 })[node.type] | node.mode,
            type: node.type,
            size: node.type === 'file' ? (node.size ?? node.content.length) : 0,
            atime: 1,
            mtime: 2,
            uid: node.uid,
            gid: node.gid,
            device: node.device,
            inode: node.inode,
            parentRealPath: parentPath,
            parentDevice: parent.device,
            parentInode: parent.inode
          }
        }
        options.onPrivilegedLstat?.(args.path, privilegedNodes)
        return result
      }
      if (!rootFiles.has(args.path) && args.path.includes('/missing')) {
        if (options.genericLstatFailure) {
          return { exitCode: 1, kind: request.operation, ok: false }
        }
        if (options.missingLstatResult) {
          return { exitCode: 0, kind: request.operation, missing: true }
        }
        throw missing(args.path)
      }
      const isDirectoryPath = ['/', '/root', '/srv', '/srv/app'].includes(args.path)
      return {
        exitCode: 0,
        kind: request.operation,
        metadata: {
          mode: isDirectoryPath ? 0o40755 : 0o100640,
          type: isDirectoryPath ? 'directory' : 'file',
          size: isDirectoryPath ? 0 : 12,
          atime: 1,
          mtime: 2,
          uid: 3,
          gid: 4,
          device: '1',
          inode: '100',
          parentRealPath: args.path.slice(0, args.path.lastIndexOf('/')) || '/',
          parentDevice: '1',
          parentInode: '99'
        }
      }
    }
    if (request.operation === 'readlink' || request.operation === 'realpath') {
      return { exitCode: 0, kind: request.operation, text: `/result${args.path}` }
    }
    if (request.operation === 'sha256') {
      const bytes = Buffer.from(rootFiles.get(args.path) || '')
      return { exitCode: 0, kind: 'sha256', sha256: sha256(bytes), size: bytes.length }
    }
    if (options.privilegedTree && request.operation === 'sha256-bound') {
      const node = ensurePrivilegedBinding(privilegedNodes.get(args.path))
      const parent = ensurePrivilegedBinding(privilegedNodes.get(
        args.sourceParentRealPath
      ))
      if (!node || node.type !== 'file' ||
        node.device !== args.sourceDevice || node.inode !== args.sourceInode ||
        parent.device !== args.sourceParentDevice ||
        parent.inode !== args.sourceParentInode) {
        throw new Error('sha256 source binding changed')
      }
      return {
        exitCode: 0,
        kind: 'sha256-bound',
        sha256: sha256(node.content),
        size: node.size ?? node.content.length
      }
    }
    if (options.privilegedTree && request.operation === 'mkdir') {
      if (privilegedNodes.has(args.path)) throw new Error('Target exists')
      privilegedNodes.set(args.path, {
        type: 'directory', mode: 0o700, uid: 0, gid: 0
      })
      return { exitCode: 0, kind: 'mkdir', ok: true }
    }
    if (options.privilegedTree && request.operation === 'mkdir-bound') {
      const parent = ensurePrivilegedBinding(privilegedNodes.get(
        args.targetParentRealPath
      ))
      if (!parent || parent.device !== args.targetParentDevice ||
        parent.inode !== args.targetParentInode ||
        privilegedNodes.has(args.targetPath)) {
        throw new Error('mkdir target parent binding changed')
      }
      const node = ensurePrivilegedBinding({
        type: 'directory',
        mode: Number.parseInt(args.targetMode, 8),
        uid: Number(args.targetUid),
        gid: Number(args.targetGid)
      })
      privilegedNodes.set(args.targetPath, node)
      return {
        exitCode: 0,
        kind: 'mkdir-bound',
        device: node.device,
        inode: node.inode
      }
    }
    if (options.privilegedTree && request.operation === 'chmod') {
      privilegedNodes.get(args.path).mode = Number.parseInt(args.mode, 8)
      return { exitCode: 0, kind: 'chmod', ok: true }
    }
    if (options.privilegedTree && request.operation === 'chown') {
      privilegedNodes.get(args.path).uid = Number(args.uid)
      privilegedNodes.get(args.path).gid = Number(args.gid)
      return { exitCode: 0, kind: 'chown', ok: true }
    }
    if (options.privilegedTree && request.operation === 'rename') {
      if (privilegedNodes.has(args.target)) throw new Error('Target exists')
      const moved = [...privilegedNodes.entries()].filter(([remotePath]) =>
        remotePath === args.source || remotePath.startsWith(`${args.source}/`))
      if (!moved.length) throw missing(args.source)
      for (const [remotePath] of moved) privilegedNodes.delete(remotePath)
      for (const [remotePath, node] of moved) {
        privilegedNodes.set(`${args.target}${remotePath.slice(args.source.length)}`, node)
      }
      return { exitCode: 0, kind: 'rename', ok: true }
    }
    if (options.privilegedTree && request.operation === 'rm') {
      const effectivePath = options.redirectRm?.[args.path] || args.path
      const node = privilegedNodes.get(effectivePath)
      if (!node || node.type !== 'file') throw new Error('not a file')
      privilegedNodes.delete(effectivePath)
      options.onTreeRemove?.(effectivePath)
      return { exitCode: 0, kind: 'rm', ok: true }
    }
    if (options.privilegedTree && request.operation === 'remove-empty-directory') {
      if ([...privilegedNodes.keys()].some(remotePath =>
        remotePath.startsWith(`${args.path}/`))) {
        throw new Error('Directory not empty')
      }
      const node = privilegedNodes.get(args.path)
      if (!node || node.type !== 'directory') throw new Error('not a directory')
      privilegedNodes.delete(args.path)
      return { exitCode: 0, kind: 'remove-empty-directory', ok: true }
    }
    if (options.privilegedTree && request.operation === 'remove-bound') {
      if (options.redirectRm?.[args.targetPath]) {
        throw new Error('remove parent binding changed')
      }
      const parent = ensurePrivilegedBinding(privilegedNodes.get(
        args.targetParentRealPath
      ))
      const node = ensurePrivilegedBinding(privilegedNodes.get(args.targetPath))
      if (!parent || !node || parent.device !== args.targetParentDevice ||
        parent.inode !== args.targetParentInode ||
        node.device !== args.targetDevice || node.inode !== args.targetInode ||
        node.type !== args.targetType) {
        throw new Error('remove entry binding changed')
      }
      if (node.type === 'directory' && [...privilegedNodes.keys()].some(path =>
        path.startsWith(`${args.targetPath}/`))) {
        throw new Error('Directory not empty')
      }
      privilegedNodes.delete(args.targetPath)
      options.onTreeRemove?.(args.targetPath)
      return { exitCode: 0, kind: 'remove-bound', ok: true }
    }
    return { exitCode: 0, kind: request.operation, ok: true }
  }

  const lease = {
    async execute (payload) {
      executions.push(payload)
      activeLeaseExecutions += 1
      peakLeaseExecutions = Math.max(peakLeaseExecutions, activeLeaseExecutions)
      events.push(`lease:start:${payload.request.operation}`)
      if (options.strictSingleActive && activeLeaseExecutions > 1) {
        activeLeaseExecutions -= 1
        throw new Error('strict lease active conflict')
      }
      try {
        if (options.executeDelayMs) {
          await new Promise(resolve => setTimeout(resolve, options.executeDelayMs))
        }
        return await executeCore(payload)
      } finally {
        events.push(`lease:end:${payload.request.operation}`)
        activeLeaseExecutions -= 1
      }
    },
    async release () {
      leaseReleases += 1
      events.push('lease:release')
      if (options.leaseReleaseFailure) throw new Error('lease release failed')
      return true
    }
  }
  return {
    sftp,
    lease,
    requests,
    executions,
    events,
    sftpReads,
    rootFiles,
    privilegedNodes,
    nodes,
    get peakLeaseExecutions () { return peakLeaseExecutions },
    get leaseReleases () { return leaseReleases }
  }
}

async function createRootBackend (harness, options = {}) {
  const { createPrivilegedFileBackend } = await importModule(backendsModule)
  return createPrivilegedFileBackend({
    sftp: harness.sftp,
    lease: harness.lease,
    identity: options.identity || { uid: '0', username: 'root' },
    ...(Object.hasOwn(options, 'capabilities')
      ? { capabilities: options.capabilities }
      : {}),
    createToken: createTokenFactory()
  })
}

test('native backend preserves the original SFTP object identity', async () => {
  const { createNativeSftpFileBackend } = await importModule(backendsModule)
  const sftp = { marker: true }
  const backend = createNativeSftpFileBackend(sftp)
  assert.equal(Object.isFrozen(backend), true)
  assert.equal(backend.channel, 'sftp')
  assert.equal(backend.runtimeIdentity, null)
  assert.equal(backend.sftp, sftp)
  assert.equal(backend.backend, sftp)
  assert.equal(await backend.release(), true)
  assert.throws(() => createNativeSftpFileBackend(), /SFTP|sftp/)
})

test('privileged backend validates root identity and bounded lease and releases failed creation', async () => {
  const { createPrivilegedFileBackend } = await importModule(backendsModule)
  const harness = createBackendHarness({ badHandshake: true })
  await assert.rejects(
    createPrivilegedFileBackend({
      sftp: harness.sftp,
      lease: harness.lease,
      identity: { uid: '0', username: 'root' },
      createToken: createTokenFactory()
    }),
    /handshake rejected/
  )
  assert.equal(harness.leaseReleases, 1)
  for (const value of [
    { sftp: harness.sftp, lease: {}, identity: { uid: '0', username: 'root' } },
    { sftp: harness.sftp, lease: harness.lease, identity: { uid: '1000', username: 'login' } },
    { sftp: harness.sftp, lease: harness.lease, identity: { uid: '0', username: '' } }
  ]) {
    await assert.rejects(createPrivilegedFileBackend(value), /lease|租约|root|身份|username/i)
  }
})

test('privileged backend releases every releasable lease after construction validation fails', async () => {
  const { createPrivilegedFileBackend } = await importModule(backendsModule)
  const harness = createBackendHarness()
  for (const setup of [
    {
      label: 'missing SFTP',
      pattern: /SFTP|sftp/,
      build: lease => ({
        lease,
        identity: { uid: '0', username: 'root' }
      })
    },
    {
      label: 'non-root identity',
      pattern: /root|身份/,
      build: lease => ({
        sftp: harness.sftp,
        lease,
        identity: { uid: '1000', username: 'login' }
      })
    },
    {
      label: 'missing execute',
      pattern: /lease|租约/,
      build: lease => ({
        sftp: harness.sftp,
        lease: { release: lease.release },
        identity: { uid: '0', username: 'root' }
      })
    }
  ]) {
    let releases = 0
    const lease = {
      async execute () {},
      async release () {
        releases += 1
        return true
      }
    }
    await assert.rejects(
      createPrivilegedFileBackend(setup.build(lease)),
      setup.pattern,
      setup.label
    )
    assert.equal(releases, 1, setup.label)
  }

  let releases = 0
  const releaseFailure = new Error('validation cleanup failed')
  const validationError = await createPrivilegedFileBackend({
    sftp: harness.sftp,
    lease: {
      async execute () {},
      async release () {
        releases += 1
        throw releaseFailure
      }
    },
    identity: { uid: '1000', username: 'login' }
  }).catch(error => error)
  assert.match(validationError.message, /root|身份/)
  assert.equal(validationError.releaseError, releaseFailure)
  assert.equal(releases, 1)

  await assert.rejects(createPrivilegedFileBackend({
    sftp: harness.sftp,
    lease: { execute () {} },
    identity: { uid: '0', username: 'root' }
  }), /lease|租约/)
})

test('privileged backend clones and freezes a validated boolean capability map', async () => {
  const capabilities = { list: true, copyEntry: false }
  const harness = createBackendHarness()
  const backend = await createRootBackend(harness, { capabilities })
  assert.notEqual(backend.capabilities, capabilities)
  assert.deepEqual(backend.capabilities, capabilities)
  assert.equal(Object.isFrozen(backend.capabilities), true)
  capabilities.list = false
  assert.equal(backend.capabilities.list, true)
  await backend.release()

  for (const invalid of [[], { list: 1 }, { 'bad key': true }]) {
    const invalidHarness = createBackendHarness()
    await assert.rejects(
      createRootBackend(invalidHarness, { capabilities: invalid }),
      /capabilit/i
    )
    assert.equal(invalidHarness.leaseReleases, 1)
  }
})

test('privileged facade rejects partial octal strings and unsafe numeric modes', async () => {
  const harness = createBackendHarness()
  const backend = await createRootBackend(harness)
  const before = harness.requests.length
  for (const mode of ['600junk', '08', 9007199254740992]) {
    await assert.rejects(backend.sftp.chmod('/root/file', mode), /mode/i)
  }
  assert.equal(harness.requests.length, before)
  await backend.release()
})

test('privileged backend serializes every PTY request and release waits for accepted work', async () => {
  const harness = createBackendHarness({
    strictSingleActive: true,
    executeDelayMs: 5
  })
  const backend = await createRootBackend(harness)

  await Promise.all([
    backend.sftp.list('/root'),
    backend.sftp.stat('/root/file'),
    backend.sftp.realpath('/root/file')
  ])
  assert.equal(harness.peakLeaseExecutions, 1)

  const accepted = backend.sftp.list('/root')
  const release = backend.release()
  assert.equal((await accepted).length, 3)
  assert.equal(await release, true)
  assert.equal(harness.peakLeaseExecutions, 1)
  assert.equal(harness.events.at(-1), 'lease:release')
  await assert.rejects(backend.sftp.stat('/root/file'), /released|释放|关闭/i)
})

test('privileged facade maps fixed metadata and mutation methods to protocol requests', async () => {
  const harness = createBackendHarness({ rootFiles: { '/root/file': 'content' } })
  const backend = await createRootBackend(harness)
  const facade = backend.sftp
  assert.equal(Object.isFrozen(backend), true)
  assert.equal(Object.isFrozen(backend.runtimeIdentity), true)
  assert.deepEqual(backend.runtimeIdentity, {
    channel: 'pty-root', effectiveUid: '0', effectiveUsername: 'root'
  })
  assert.equal(backend.channel, 'pty-root')
  assert.equal(backend.backend, facade)
  assert.equal(Object.isFrozen(facade), true)

  assert.deepEqual(await facade.list('/root'), [
    { name: 'file.txt', type: '-', size: 12, accessTime: 1000, modifyTime: 2000, mode: 0o100640, owner: 3, group: 4 },
    { name: 'dir', type: 'd', size: 0, accessTime: 5000, modifyTime: 6000, mode: 0o40750, owner: 7, group: 8 },
    { name: 'link', type: 'l', size: 3, accessTime: 9000, modifyTime: 10000, mode: 0o120777, owner: 11, group: 12 }
  ])
  assert.deepEqual(await facade.lstat('/root/file'), {
    mode: 0o100640,
    type: 'file',
    size: 12,
    atime: 1,
    mtime: 2,
    uid: 3,
    gid: 4,
    device: '1',
    inode: '100',
    parentRealPath: '/root',
    parentDevice: '1',
    parentInode: '99',
    isDirectory: false
  })
  assert.equal((await facade.stat('/root/file')).type, 'file')
  assert.equal(await facade.readlink('/root/link'), '/result/root/link')
  assert.equal(await facade.realpath('/root/file'), '/result/root/file')

  await facade.mkdir('/root/new-dir')
  await facade.touch('/root/new-file')
  await facade.rename('/root/a', '/root/b')
  await facade.rm('/root/file')
  await facade.rmdir('/root/dir')
  await facade.chmod('/root/file', 0o640)
  await facade.chown('/root/file', 10, 11)
  await facade.mv('/root/d', '/root/e')
  assert.equal(typeof facade.copyEntry, 'function')
  assert.equal(typeof facade.removeEntry, 'function')
  assert.equal(typeof facade.cp, 'function')

  assert.deepEqual(
    harness.requests.filter(request => !request.operation.startsWith('stage-'))
      .map(request => [request.operation, request.args]),
    [
      ['list', { path: '/root' }],
      ['lstat', { path: '/root/file' }],
      ['stat', { path: '/root/file' }],
      ['readlink', { path: '/root/link' }],
      ['realpath', { path: '/root/file' }],
      ['mkdir', { path: '/root/new-dir' }],
      ['touch', { path: '/root/new-file' }],
      ['rename', { source: '/root/a', target: '/root/b' }],
      ['rm', { path: '/root/file' }],
      ['rmdir', { path: '/root/dir' }],
      ['chmod', { path: '/root/file', mode: '640' }],
      ['chown', { path: '/root/file', uid: '10', gid: '11' }],
      ['rename', { source: '/root/d', target: '/root/e' }]
    ]
  )
  await backend.release()
})

test('privileged reads use bounded logical streams and never send secrets through PTY', async () => {
  const secret = Buffer.from('TOP-SECRET\u0000bytes')
  const harness = createBackendHarness({ rootFiles: { '/root/secret': secret } })
  const backend = await createRootBackend(harness)

  assert.equal(await backend.sftp.readFile('/root/secret'), secret.toString('utf8'))
  const prefix = await backend.sftp.readFileChunk('/root/secret', {
    offset: 0,
    maxBytes: 4
  })
  const chunk = await backend.sftp.readFileChunk('/root/secret', {
    offset: prefix.nextOffset,
    maxBytes: 6
  })
  assert.deepEqual(chunk, {
    base64: secret.subarray(4, 10).toString('base64'),
    offset: 4,
    nextOffset: 10,
    bytesRead: 6,
    totalBytes: secret.length,
    hasMore: true
  })
  const suffix = await backend.sftp.readFileChunk('/root/secret', {
    offset: chunk.nextOffset,
    maxBytes: 64 * 1024
  })
  assert.equal(suffix.hasMore, false)
  assert.equal(await backend.sftp.readFile('/root/secret'), secret.toString('utf8'))
  assert.equal((await backend.sftp.list('/')).length, 3)
  const resume = await backend.sftp.describeResumeEntry('/root/secret', 4)
  assert.deepEqual(resume, {
    size: secret.length,
    mtimeMs: 2000,
    firstSha256: sha256(secret.subarray(0, 4)),
    lastSha256: sha256(secret.subarray(secret.length - 4)),
    boundarySha256: sha256(secret.subarray(secret.length - 4))
  })
  assert.equal(harness.requests.filter(request => request.operation === 'stage-export').length, 4)
  assert.equal(harness.requests.filter(request => (
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('download-')
  )).length, 4)
  assert.equal(JSON.stringify(harness.requests).includes('TOP-SECRET'), false)
  assert.equal(JSON.stringify(harness.requests).includes(secret.toString('base64')), false)
  await backend.release()

  for (const mismatch of [
    { exportDigest: 'f'.repeat(64) },
    { exportSize: secret.length + 1 }
  ]) {
    const rejectedHarness = createBackendHarness({
      rootFiles: { '/root/secret': secret },
      ...mismatch
    })
    const rejected = await createRootBackend(rejectedHarness)
    await assert.rejects(
      rejected.sftp.readFile('/root/secret'),
      /SHA|digest|摘要|size|大小|chunk|分块/i
    )
    await assert.rejects(rejected.release(), /cleanup proof|摘要|大小/i)
  }
})

test('privileged chunk streams re-export after EOF and observe same-size source changes', async () => {
  const original = Buffer.from('AAAA-BBBB-CCCC')
  const replacement = Buffer.from('ZZZZ-YYYY-XXXX')
  assert.equal(replacement.length, original.length)
  const harness = createBackendHarness({
    rootFiles: { '/root/changing': original }
  })
  const backend = await createRootBackend(harness)

  const firstA = await backend.sftp.readFileChunk('/root/changing', {
    offset: 0,
    maxBytes: 5
  })
  const firstB = await backend.sftp.readFileChunk('/root/changing', {
    offset: firstA.nextOffset,
    maxBytes: 64 * 1024
  })
  assert.equal(Buffer.concat([
    Buffer.from(firstA.base64, 'base64'),
    Buffer.from(firstB.base64, 'base64')
  ]).toString(), original.toString())

  harness.rootFiles.set('/root/changing', replacement)
  const second = await backend.sftp.readFileChunk('/root/changing', {
    offset: 0,
    maxBytes: 64 * 1024
  })
  assert.equal(Buffer.from(second.base64, 'base64').toString(), replacement.toString())
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-export' &&
    request.args.sourcePath === '/root/changing'
  ).length, 2)
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('download-')
  ).length, 2)
  await backend.release()
})

test('real transaction adapter re-exports a privileged source and refuses same-size external delete changes', async () => {
  const { createSftpTransactionAdapter } = await importModule(
    'src/client/components/sftp/sftp-transaction-adapter.js'
  )
  const { buildSideEffectSafetyRequest } = await importModule(
    'src/client/common/safety-transactions/side-effect-model.js'
  )
  const sourcePath = '/srv/app/config.bin'
  const harness = createBackendHarness({
    privilegedTree: {
      '/srv': { type: 'directory', mode: 0o755, uid: 0, gid: 0 },
      '/srv/app': { type: 'directory', mode: 0o755, uid: 0, gid: 0 },
      [sourcePath]: { type: 'file', mode: 0o640, uid: 0, gid: 0, content: 'AAAA' }
    }
  })
  const backend = await createRootBackend(harness)
  const operation = await buildSideEffectSafetyRequest({
    id: 'privileged-delete-same-size-change',
    source: 'sftp',
    title: 'privileged delete regression',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      pid: 1001,
      sessionType: 'sftp'
    },
    effect: {
      adapter: 'sftp',
      action: 'delete',
      paths: { source: sourcePath },
      resources: [{ path: sourcePath, type: 'file' }],
      type: 'file',
      expected: { absent: true }
    }
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => backend.sftp })
  Object.assign(operation, await adapter.prepare(operation))
  const exportsAfterPrepare = harness.requests.filter(request =>
    request.operation === 'stage-export' &&
    request.args.sourcePath === sourcePath).length

  harness.privilegedNodes.get(sourcePath).content = Buffer.from('BBBB')
  await assert.rejects(
    adapter.beforeExecute(operation),
    /changed|external|original|变化|未执行/i
  )
  assert.equal(harness.privilegedNodes.get(sourcePath).content.toString(), 'BBBB')
  assert.ok(harness.requests.filter(request =>
    request.operation === 'stage-export' &&
    request.args.sourcePath === sourcePath).length > exportsAfterPrepare)
  await backend.release()
})

test('privileged readFile rejects files over 8 MiB without unbounded reads', async () => {
  const harness = createBackendHarness({
    rootFiles: { '/root/too-large': Buffer.alloc(8 * 1024 * 1024 + 1, 7) }
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.readFile('/root/too-large'),
    /8 MiB|上限|limit/i
  )
  const contentReads = harness.sftpReads.filter(read =>
    read.remotePath.includes('/download-')
  )
  assert.equal(contentReads.length, 1)
  assert.equal(contentReads[0].maxBytes, 64 * 1024)
  assert.equal(harness.requests.some(request => (
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('download-')
  )), true)
  await backend.release()
})

test('privileged chunk streams reject non-contiguous offsets and replace active zero-offset reads', async () => {
  const content = Buffer.from('0123456789')
  const harness = createBackendHarness({ rootFiles: { '/root/stream': content } })
  const backend = await createRootBackend(harness)

  const first = await backend.sftp.readFileChunk('/root/stream', {
    offset: 0,
    maxBytes: 3
  })
  assert.equal(first.nextOffset, 3)
  const restarted = await backend.sftp.readFileChunk('/root/stream', {
    offset: 0,
    maxBytes: 2
  })
  assert.equal(restarted.nextOffset, 2)
  await assert.rejects(
    backend.sftp.readFileChunk('/root/stream', { offset: 1, maxBytes: 2 }),
    /offset|连续|logical|逻辑/i
  )
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-export' &&
    request.args.sourcePath === '/root/stream'
  ).length, 2)
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('download-')
  ).length, 2)
  await backend.release()
})

test('privileged mutations invalidate related logical read stages before changing paths', async () => {
  const harness = createBackendHarness({
    rootFiles: { '/root/file': 'abcdefgh' }
  })
  const backend = await createRootBackend(harness)
  const first = await backend.sftp.readFileChunk('/root/file', {
    offset: 0,
    maxBytes: 2
  })
  const cleanupBefore = harness.requests.filter(request =>
    request.operation === 'stage-cleanup').length

  await backend.sftp.rm('/root/file')
  assert.ok(harness.requests.filter(request =>
    request.operation === 'stage-cleanup').length > cleanupBefore)
  await assert.rejects(
    backend.sftp.readFileChunk('/root/file', {
      offset: first.nextOffset,
      maxBytes: 2
    }),
    /offset|连续/
  )

  const renamed = await backend.sftp.readFileChunk('/root/file', {
    offset: 0,
    maxBytes: 2
  })
  await backend.sftp.rename('/root/file', '/root/renamed')
  await assert.rejects(
    backend.sftp.readFileChunk('/root/file', {
      offset: renamed.nextOffset,
      maxBytes: 2
    }),
    /offset|连续/
  )
  await backend.release()
})

test('privileged writes upload exclusive bytes then import only digest size and metadata', async () => {
  const secret = Buffer.from('WRITE-SECRET\u0000bytes')
  const harness = createBackendHarness({ missingLstatResult: true })
  const backend = await createRootBackend(harness)
  assert.equal(await backend.sftp.writeFile('/root/missing-target', secret, 0o640), 1)
  assert.deepEqual(harness.rootFiles.get('/root/missing-target'), secret)
  const imported = harness.requests.find(request => request.operation === 'stage-import')
  assert.equal(imported.args.targetPath, '/root/missing-target')
  assert.equal(imported.args.sha256, sha256(secret))
  assert.equal(imported.args.size, String(secret.length))
  assert.equal(imported.args.targetMode, '640')
  assert.equal(imported.args.targetUid, '0')
  assert.equal(imported.args.targetGid, '0')
  assert.equal(imported.args.mustBeAbsent, '1')
  assert.equal(JSON.stringify(harness.requests).includes('WRITE-SECRET'), false)
  assert.equal(JSON.stringify(harness.requests).includes(secret.toString('base64')), false)
  assert.equal(harness.requests.some(request => request.operation === 'stage-cleanup'), true)
  await backend.release()

  const existingHarness = createBackendHarness({
    rootFiles: { '/root/existing-target': 'old' }
  })
  const existing = await createRootBackend(existingHarness)
  const createsBefore = existingHarness.events.filter(
    event => event.startsWith('sftp:create:')
  ).length
  await assert.rejects(
    existing.sftp.writeFile('/root/existing-target', secret),
    /安全事务|缺失目标/
  )
  assert.equal(existingHarness.events.filter(
    event => event.startsWith('sftp:create:')
  ).length, createsBefore)
  assert.equal(existingHarness.requests.some(
    request => request.operation === 'stage-import'
  ), false)
  await existing.release()

  const failedHarness = createBackendHarness({
    importFailure: true,
    missingLstatResult: true
  })
  const failed = await createRootBackend(failedHarness)
  await assert.rejects(
    failed.sftp.writeFile('/root/missing-target', secret, 0o600),
    /stage import failed/
  )
  assert.equal(failedHarness.requests.some(request => request.operation === 'stage-cleanup'), true)
  await failed.release()
})

test('privileged write never overwrites a creator raced after trusted missing', async () => {
  const targetPath = '/root/new-target'
  const options = {
    privilegedTree: {
      '/root': { type: 'directory', mode: 0o755, uid: 0, gid: 0 }
    },
    onPrivilegedLstat (remotePath, nodes) {
      if (remotePath !== targetPath || nodes.has(targetPath)) return
      nodes.set(targetPath, {
        type: 'file',
        mode: 0o600,
        uid: 99,
        gid: 99,
        content: Buffer.from('foreign')
      })
    }
  }
  const harness = createBackendHarness(options)
  const backend = await createRootBackend(harness)
  await assert.rejects(
    backend.sftp.writeFile(targetPath, 'owned', 0o600),
    /exists|operation|操作|import/i
  )
  assert.equal(harness.privilegedNodes.get(targetPath).content.toString(), 'foreign')
  await backend.release()
})

test('privileged lstat maps only trusted missing results to transaction ENOENT', async () => {
  const { describeSftpTransferEntry } = await importModule(
    'src/client/components/sftp/sftp-transaction-adapter.js'
  )
  const harness = createBackendHarness({ missingLstatResult: true })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.lstat('/root/missing-target'),
    error => error?.code === 'ENOENT' &&
      error.message === 'No such privileged file: /root/missing-target'
  )
  assert.deepEqual(
    await describeSftpTransferEntry(backend.sftp, '/root/missing-target'),
    { absent: true }
  )
  await backend.release()
})

test('privileged write fails closed on an indeterminate lstat error', async () => {
  const harness = createBackendHarness({ genericLstatFailure: true })
  const backend = await createRootBackend(harness)
  const createsBefore = harness.events.filter(
    event => event.startsWith('sftp:create:')
  ).length

  await assert.rejects(
    backend.sftp.writeFile('/root/missing-target', Buffer.from('secret'), 0o600),
    /root 文件操作失败：lstat/
  )
  assert.equal(harness.events.filter(
    event => event.startsWith('sftp:create:')
  ).length, createsBefore)
  assert.equal(harness.requests.some(request => request.operation === 'stage-import'), false)
  await backend.release()
})

test('privileged write rejects a claimed upload stage failure before import', async () => {
  const harness = createBackendHarness({
    missingLstatResult: true,
    uploadCreateFailure: true
  })
  const backend = await createRootBackend(harness)

  await assert.rejects(
    backend.sftp.writeFile('/root/missing-target', Buffer.from('secret'), 0o600),
    /remote upload write failed/
  )
  assert.equal(harness.requests.some(request => request.operation === 'stage-import'), false)
  await backend.release()
})

test('privileged write retains an unclean claimed upload for immediate and release cleanup', async () => {
  for (const uploadCreateThrows of [false, true]) {
    const harness = createBackendHarness({
      missingLstatResult: true,
      uploadCreateFailure: true,
      uploadCleanupSucceeded: false,
      uploadResidualMatches: true,
      uploadCreateThrows,
      cleanupFailure: 'upload-'
    })
    const backend = await createRootBackend(harness)

    const error = await backend.sftp.writeFile(
      '/root/missing-target',
      Buffer.from('secret'),
      0o600
    ).catch(error => error)
    assert.equal(error.message, 'remote upload write failed')
    assert.match(error.cleanupError?.message || '', /remote unlink failed/)
    assert.match(error.cleanupRetryError?.message || '', /stage cleanup failed/)
    assert.equal(harness.requests.filter(request =>
      request.operation === 'stage-cleanup' &&
      request.args.objectName.startsWith('upload-')
    ).length, 1)
    const cleanup = harness.requests.find(request =>
      request.operation === 'stage-cleanup' &&
      request.args.objectName.startsWith('upload-')
    )
    assert.equal(cleanup.args.sha256, sha256(Buffer.from('secret')))
    assert.equal(cleanup.args.size, '6')

    await assert.rejects(backend.release(), /stage cleanup failed/)
    assert.equal(harness.requests.filter(request =>
      request.operation === 'stage-cleanup' &&
      request.args.objectName.startsWith('upload-')
    ).length, 2)
    assert.equal(harness.leaseReleases, 1)
  }
})

test('successful immediate cleanup removes an unclean claimed upload record', async () => {
  const harness = createBackendHarness({
    missingLstatResult: true,
    uploadCreateFailure: true,
    uploadCleanupSucceeded: false,
    uploadResidualMatches: true
  })
  const backend = await createRootBackend(harness)

  const error = await backend.sftp.writeFile(
    '/root/missing-target',
    Buffer.from('secret'),
    0o600
  ).catch(error => error)
  assert.equal(error.message, 'remote upload write failed')
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('upload-')
  ).length, 1)
  assert.equal(await backend.release(), true)
  assert.equal(harness.requests.filter(request =>
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('upload-')
  ).length, 1)
})

test('privileged write preserves an unverified partial upload without cleanup proof', async () => {
  const harness = createBackendHarness({
    missingLstatResult: true,
    uploadCreateFailure: true,
    uploadCleanupSucceeded: false
  })
  const backend = await createRootBackend(harness)

  const error = await backend.sftp.writeFile(
    '/root/missing-target',
    Buffer.from('secret'),
    0o600
  ).catch(error => error)
  assert.equal(error.message, 'remote upload write failed')
  assert.match(error.cleanupRetryError?.message || '', /摘要|大小|digest|size/i)
  assert.equal(harness.requests.some(request =>
    request.operation === 'stage-cleanup' &&
    request.args.objectName.startsWith('upload-')
  ), false)
  assert.equal([...harness.nodes.values()].some(node =>
    node.type === 'file' && node.content?.toString() === 'partial upload'
  ), true)
  await assert.rejects(backend.release(), /residual|验证|保留/i)
  assert.equal(harness.leaseReleases, 1)
})

test('privileged write keeps its create error when abandoning the stage fails', async () => {
  const harness = createBackendHarness({
    missingLstatResult: true,
    uploadCreateFailure: true,
    uploadCleanupSucceeded: false,
    uploadCreateEndpointChange: true
  })
  const backend = await createRootBackend(harness)
  const readsBefore = harness.events.filter(event =>
    event.startsWith('sftp:read:')
  ).length

  const error = await backend.sftp.writeFile(
    '/root/missing-target',
    Buffer.from('secret'),
    0o600
  ).catch(error => error)
  assert.equal(error.message, 'remote upload write failed')
  assert.match(error.cleanupError?.message || '', /remote unlink failed/)
  assert.match(error.cleanupRetryError?.message || '', /session|endpoint|会话|端点/i)
  assert.equal(harness.requests.some(request => request.operation === 'stage-import'), false)
  assert.equal(harness.requests.some(request => request.operation === 'stage-cleanup'), false)
  assert.equal(harness.events.filter(event =>
    event.startsWith('sftp:read:')
  ).length, readsBefore)
  assert.equal([...harness.nodes.keys()].some(path => path.includes('/upload-')), true)
  await assert.rejects(backend.release(), /session|endpoint|会话|端点/i)
  assert.equal(harness.leaseReleases, 1)
})

test('privileged release closes first continues cleanup and lease release and is idempotent', async () => {
  const harness = createBackendHarness({
    rootFiles: { '/root/secret': 'secret' },
    cleanupFailure: 'download-'
  })
  const backend = await createRootBackend(harness)
  await backend.sftp.readFileChunk('/root/secret', { offset: 0, maxBytes: 1 })
  await assert.rejects(backend.release(), /stage cleanup failed/)
  assert.equal(harness.leaseReleases, 1)
  assert.equal(harness.events.at(-1), 'lease:release')
  await assert.rejects(backend.release(), /stage cleanup failed/)
  assert.equal(harness.leaseReleases, 1)
  await assert.rejects(backend.sftp.list('/root'), /released|释放|关闭/i)
})

test('privileged backend still releases its lease when staging endpoint changed', async () => {
  const harness = createBackendHarness()
  const backend = await createRootBackend(harness)
  const requestsBefore = harness.requests.length
  harness.sftp.id = 'sftp-2'

  const firstError = await backend.release().catch(error => error)
  assert.match(firstError.message, /session|endpoint|会话|端点/i)
  assert.equal(harness.requests.length, requestsBefore)
  assert.equal(harness.leaseReleases, 1)
  assert.equal(harness.events.at(-1), 'lease:release')

  const secondError = await backend.release().catch(error => error)
  assert.equal(secondError, firstError)
  assert.equal(harness.leaseReleases, 1)
})

test('privileged copyEntry copies a bounded tree without recursive shell operations and preserves metadata', async () => {
  const controller = new AbortController()
  const harness = createBackendHarness({
    privilegedTree: {
      '/root/source': { type: 'directory', mode: 0o751, uid: 21, gid: 22 },
      '/root/source/file': { type: 'file', mode: 0o640, uid: 23, gid: 24, content: 'alpha' },
      '/root/source/sub': { type: 'directory', mode: 0o750, uid: 25, gid: 26 },
      '/root/source/sub/nested': { type: 'file', mode: 0o600, uid: 27, gid: 28, content: 'beta' }
    }
  })
  const backend = await createRootBackend(harness)
  const start = harness.executions.length

  assert.equal(await backend.sftp.copyEntry(
    '/root/source',
    '/root/copied',
    { signal: controller.signal }
  ), 1)
  assert.equal(harness.privilegedNodes.get('/root/copied').mode, 0o751)
  assert.equal(harness.privilegedNodes.get('/root/copied').uid, 21)
  assert.equal(harness.privilegedNodes.get('/root/copied/file').content.toString(), 'alpha')
  assert.equal(harness.privilegedNodes.get('/root/copied/file').mode, 0o640)
  assert.equal(harness.privilegedNodes.get('/root/copied/sub/nested').content.toString(), 'beta')
  assert.equal(harness.requests.some(request => request.operation === 'copy-entry'), false)
  assert.equal(harness.requests.some(request => request.operation === 'remove-entry'), false)
  assert.ok(harness.requests.filter(request => request.operation === 'stage-import')
    .every(request => request.args.mustBeAbsent === '1'))
  const publicExecutions = harness.executions.slice(start).filter(({ request }) =>
    request.operation !== 'stage-cleanup')
  assert.ok(publicExecutions.length > 0)
  assert.ok(publicExecutions.every(execution => execution.signal === controller.signal))

  await backend.release()
})

test('privileged copyEntry rejects special files, nested targets, excessive depth, and raced targets', async () => {
  const special = createBackendHarness({
    privilegedTree: {
      '/root/link': { type: 'symlink', mode: 0o777, uid: 3, gid: 4 }
    }
  })
  const specialBackend = await createRootBackend(special)
  await assert.rejects(
    specialBackend.sftp.copyEntry('/root/link', '/root/copy', {}),
    /special|symlink|类型|特殊/i
  )
  assert.equal(special.privilegedNodes.has('/root/copy'), false)
  await specialBackend.release()

  const tree = {
    '/root/deep': { type: 'directory' }
  }
  let parent = '/root/deep'
  for (let depth = 1; depth <= 129; depth += 1) {
    parent += `/d${depth}`
    tree[parent] = { type: 'directory' }
  }
  const deep = createBackendHarness({ privilegedTree: tree })
  const deepBackend = await createRootBackend(deep)
  await assert.rejects(
    deepBackend.sftp.copyEntry('/root/deep', '/root/copy', {}),
    /深度|budget|预算/i
  )
  assert.equal(deep.privilegedNodes.has('/root/copy'), false)
  await assert.rejects(
    deepBackend.sftp.copyEntry('/root/deep', '/root/deep/copy', {}),
    /内部|source|源/i
  )
  await deepBackend.release()

  const huge = createBackendHarness({
    privilegedTree: {
      '/root/huge': {
        type: 'file',
        content: '',
        size: 8 * 1024 * 1024 * 1024 + 1
      }
    }
  })
  const hugeBackend = await createRootBackend(huge)
  await assert.rejects(
    hugeBackend.sftp.copyEntry('/root/huge', '/root/copy', {}),
    /字节|budget|预算/i
  )
  assert.equal(huge.requests.some(request =>
    request.operation === 'stage-export'), false)
  await hugeBackend.release()

  const wideTree = { '/root/wide': { type: 'directory' } }
  for (let index = 0; index < 10000; index += 1) {
    wideTree[`/root/wide/f${index}`] = { type: 'file', content: '' }
  }
  const wide = createBackendHarness({ privilegedTree: wideTree })
  const wideBackend = await createRootBackend(wide)
  await assert.rejects(
    wideBackend.sftp.copyEntry('/root/wide', '/root/copy', {}),
    /节点|budget|预算/i
  )
  assert.equal(wide.privilegedNodes.has('/root/copy'), false)
  await wideBackend.release()

  const raced = createBackendHarness({
    failImportTarget: '/root/copied/b',
    privilegedTree: {
      '/root/source': { type: 'directory' },
      '/root/source/a': { type: 'file', content: 'owned' },
      '/root/source/b': { type: 'file', content: 'source-b' }
    }
  })
  const racedBackend = await createRootBackend(raced)
  await assert.rejects(
    racedBackend.sftp.copyEntry('/root/source', '/root/copied', {}),
    /raced|exists|操作失败/i
  )
  assert.equal(raced.privilegedNodes.has('/root/copied/a'), false)
  assert.equal(raced.privilegedNodes.get('/root/copied/b').content.toString(), 'foreign')
  assert.equal(raced.privilegedNodes.has('/root/copied'), true,
    'foreign raced child prevents empty-directory rollback')
  await racedBackend.release()
})

test('privileged copyEntry rolls back a proven imported target when stage cleanup fails', async () => {
  const options = {
    cleanupFailure: 'download-',
    privilegedTree: {
      '/root/source': { type: 'file', mode: 0o640, content: 'owned' }
    }
  }
  const harness = createBackendHarness(options)
  const backend = await createRootBackend(harness)
  await assert.rejects(
    backend.sftp.copyEntry('/root/source', '/root/copied', {}),
    /stage cleanup failed/
  )
  assert.equal(harness.privilegedNodes.has('/root/copied'), false)
  options.cleanupFailure = undefined
  await backend.release()
})

test('privileged copy rejects a same-size source replacement after its manifest', async () => {
  const harness = createBackendHarness({
    replaceSourceBeforeExport: '/root/source',
    replacementSourceContent: 'evil',
    privilegedTree: {
      '/root/source': { type: 'file', mode: 0o640, content: 'safe' }
    }
  })
  const backend = await createRootBackend(harness)
  await assert.rejects(
    backend.sftp.copyEntry('/root/source', '/root/copied', {}),
    /source|源|identity|binding|摘要|digest/i
  )
  assert.equal(harness.privilegedNodes.has('/root/copied'), false)
  await assert.rejects(backend.release(), /owned residual|无法验证/)
})

test('privileged removeEntry builds a bounded manifest, propagates AbortSignal, and stops after cancellation', async () => {
  const controller = new AbortController()
  const removed = []
  const harness = createBackendHarness({
    onTreeRemove (remotePath) {
      removed.push(remotePath)
      if (removed.length === 1) controller.abort(new Error('stop tree removal'))
    },
    privilegedTree: {
      '/root/tree': { type: 'directory' },
      '/root/tree/a': { type: 'file', content: 'a' },
      '/root/tree/b': { type: 'file', content: 'b' }
    }
  })
  const backend = await createRootBackend(harness)
  const start = harness.executions.length
  await assert.rejects(
    backend.sftp.removeEntry('/root/tree', { signal: controller.signal }),
    /stop tree removal|abort/i
  )
  assert.equal(removed.length, 1)
  assert.equal(harness.privilegedNodes.has('/root/tree'), true)
  assert.equal([...harness.privilegedNodes.keys()].filter(path =>
    path.startsWith('/root/tree/')).length, 1)
  const mutationExecutions = harness.executions.slice(start).filter(({ request }) =>
    ['rm', 'remove-empty-directory'].includes(request.operation))
  assert.ok(mutationExecutions.every(execution => execution.signal === controller.signal))
  await assert.rejects(
    backend.sftp.removeEntry('/root/tree', { signal: {} }),
    /signal|AbortSignal/i
  )
  for (const options of [new Date(), { signal: controller.signal, extra: true }]) {
    await assert.rejects(
      backend.sftp.removeEntry('/root/tree', options),
      /options/i
    )
  }
  await backend.release()
})

test('privileged remove never follows a replaced manifest parent into a foreign tree', async () => {
  const harness = createBackendHarness({
    redirectRm: { '/root/tree/victim': '/foreign/victim' },
    privilegedTree: {
      '/root/tree': { type: 'directory' },
      '/root/tree/victim': { type: 'file', content: 'owned' },
      '/foreign': { type: 'directory' },
      '/foreign/victim': { type: 'file', content: 'foreign' }
    }
  })
  const backend = await createRootBackend(harness)
  await assert.rejects(
    backend.sftp.removeEntry('/root/tree', {}),
    /binding|parent|inode|操作|empty/i
  )
  assert.equal(harness.privilegedNodes.get('/foreign/victim').content.toString(), 'foreign')
  await backend.release()
})

test('privileged directory manifests enumerate only through a bound directory', async () => {
  const harness = createBackendHarness({
    privilegedTree: {
      '/root/source': { type: 'directory', mode: 0o750 },
      '/root/source/file': { type: 'file', mode: 0o640, content: 'safe' }
    }
  })
  const backend = await createRootBackend(harness)
  await backend.sftp.copyEntry('/root/source', '/root/copied', {})
  assert.equal(harness.requests.some(request =>
    request.operation === 'list-bound' &&
    request.args.path === '/root/source' &&
    request.args.sourceDevice &&
    request.args.sourceInode), true)
  await backend.release()

  const raced = createBackendHarness({
    replaceDirectoryBeforeBoundList: '/root/source',
    privilegedTree: {
      '/root/source': { type: 'directory', mode: 0o750 },
      '/root/source/file': { type: 'file', mode: 0o640, content: 'safe' }
    }
  })
  const racedBackend = await createRootBackend(raced)
  await assert.rejects(
    racedBackend.sftp.copyEntry('/root/source', '/root/copied', {}),
    /binding|directory|操作/i
  )
  assert.equal(raced.privilegedNodes.has('/root/copied'), false)
  await racedBackend.release()
})
