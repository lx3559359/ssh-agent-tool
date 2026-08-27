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
  const requests = []
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
      const bytes = Buffer.from(rootFiles.get(args.sourcePath) || '')
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
      rootFiles.set(args.targetPath, Buffer.from(bytes))
      return {
        exitCode: 0,
        kind: 'stage-import',
        sha256: sha256(bytes),
        size: bytes.length
      }
    }
    if (request.operation === 'list') {
      return {
        exitCode: 0,
        kind: 'list',
        entries: [
          { name: 'file.txt', type: 'file', mode: 0o100640, size: 12, atime: 1, mtime: 2, uid: 3, gid: 4 },
          { name: 'dir', type: 'directory', mode: 0o40750, size: 0, atime: 5, mtime: 6, uid: 7, gid: 8 },
          { name: 'link', type: 'symlink', mode: 0o120777, size: 3, atime: 9, mtime: 10, uid: 11, gid: 12 }
        ]
      }
    }
    if (request.operation === 'lstat' || request.operation === 'stat') {
      if (!rootFiles.has(args.path) && args.path.includes('/missing')) {
        if (options.genericLstatFailure) {
          return { exitCode: 1, kind: request.operation, ok: false }
        }
        if (options.missingLstatResult) {
          return { exitCode: 0, kind: request.operation, missing: true }
        }
        throw missing(args.path)
      }
      return {
        exitCode: 0,
        kind: request.operation,
        metadata: {
          mode: 0o100640,
          type: 'file',
          size: 12,
          atime: 1,
          mtime: 2,
          uid: 3,
          gid: 4
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
    return { exitCode: 0, kind: request.operation, ok: true }
  }

  const lease = {
    async execute (payload) {
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
    events,
    sftpReads,
    rootFiles,
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
  await facade.copyEntry('/root/a', '/root/c', { signal: {} })
  await facade.removeEntry('/root/c', { signal: {} })
  await facade.cp('/root/a', '/root/d')
  await facade.mv('/root/d', '/root/e')

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
      ['copy-entry', { source: '/root/a', target: '/root/c' }],
      ['remove-entry', { path: '/root/c' }],
      ['copy-entry', { source: '/root/a', target: '/root/d' }],
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
  assert.equal(JSON.stringify(harness.requests).includes('WRITE-SECRET'), false)
  assert.equal(JSON.stringify(harness.requests).includes(secret.toString('base64')), false)
  assert.equal(harness.requests.some(request => request.operation === 'stage-cleanup'), true)
  await backend.release()

  const existingHarness = createBackendHarness({
    rootFiles: { '/root/existing-target': 'old' }
  })
  const existing = await createRootBackend(existingHarness)
  await existing.sftp.writeFile('/root/existing-target', secret)
  const existingImport = existingHarness.requests.find(
    request => request.operation === 'stage-import'
  )
  assert.equal(existingImport.args.targetMode, '640')
  assert.equal(existingImport.args.targetUid, '3')
  assert.equal(existingImport.args.targetGid, '4')
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
