const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
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
  const error = new Error(`missing: ${remotePath}`)
  error.code = 'SFTP_NO_SUCH_FILE'
  return error
}

function deferred () {
  let resolve
  let reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}

async function createPrivilegedBackendHarness (overrides = {}) {
  const { createPrivilegedFileBackend } = await importModule(backendsModule)
  const home = '/home/hik'
  const nodes = new Map([[home, {
    type: 'directory', mode: 0o700, uid: 1000, gid: 1000
  }]])
  let nextInode = 10
  const privileged = new Map([
    ['/', directory(0o755, 0, 0, '1', '1')],
    ['/root', directory(0o700, 0, 0, '1', '2')],
    ['/root/source.bin', file(
      overrides.downloadBytes || Buffer.from('root-download'),
      0o600,
      0,
      0,
      '1',
      '3'
    )]
  ])
  if (overrides.existingUploadBytes !== undefined) {
    privileged.set('/root/app.conf', file(
      overrides.existingUploadBytes,
      0o640,
      0,
      0,
      '1',
      '4'
    ))
  }
  const requests = []
  const nativeCalls = []
  const controls = []
  const uploadGate = deferred()
  const downloadGate = deferred()
  let releaseCount = 0

  function directory (mode, uid, gid, device, inode) {
    return { type: 'directory', mode, uid, gid, device, inode }
  }

  function file (content, mode, uid, gid, device, inode) {
    return {
      type: 'file',
      mode,
      uid,
      gid,
      device,
      inode,
      content: Buffer.from(content)
    }
  }

  function typeMode (node) {
    return (node.type === 'directory' ? 0o040000 : 0o100000) | node.mode
  }

  function children (remotePath) {
    const prefix = `${remotePath}/`
    return [...nodes.keys()]
      .filter(candidate => candidate.startsWith(prefix) &&
        !candidate.slice(prefix.length).includes('/'))
      .map(candidate => ({ name: candidate.slice(prefix.length) }))
  }

  function createInnerHandle (kind) {
    return {
      pause () { controls.push(`${kind}:pause`) },
      resume () { controls.push(`${kind}:resume`) },
      cancel () { controls.push(`${kind}:cancel`) },
      interrupt () { controls.push(`${kind}:interrupt`) },
      destroy () { controls.push(`${kind}:destroy`) }
    }
  }

  const sftp = {
    id: 'sftp-1',
    terminalId: 'tab-1',
    port: 41001,
    type: 'sftp',
    async getHomeDir () { return home },
    async realpath (remotePath) { return remotePath || home },
    async lstat (remotePath) {
      const node = nodes.get(remotePath)
      if (!node) throw missing(remotePath)
      return {
        mode: typeMode(node),
        size: node.type === 'file' ? node.content.length : 0,
        uid: node.uid,
        gid: node.gid,
        isDirectory: node.type === 'directory'
      }
    },
    async list (remotePath) { return children(remotePath) },
    async mkdir (remotePath, attrs = {}) {
      if (nodes.has(remotePath)) throw new Error('exists')
      nodes.set(remotePath, directory(attrs.mode ?? 0o700, 1000, 1000))
      return 1
    },
    async createExclusiveFile (remotePath, base64, mode) {
      if (nodes.has(remotePath)) throw new Error('exists')
      nodes.set(remotePath, file(
        Buffer.from(base64, 'base64'),
        mode,
        1000,
        1000
      ))
      return 1
    },
    async readFileChunk (remotePath, { offset = 0, maxBytes = 65536 } = {}) {
      const node = nodes.get(remotePath)
      if (!node || node.type !== 'file') throw missing(remotePath)
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
    async removeEmptyDirectory (remotePath) {
      if (children(remotePath).length) throw new Error('not empty')
      nodes.delete(remotePath)
      return 1
    },
    async upload (options) {
      nativeCalls.push({ kind: 'upload', options })
      const bytes = Buffer.from(overrides.uploadBytes || 'root-upload')
      nodes.set(options.remotePath, file(bytes, 0o600, 1000, 1000))
      options.onData?.({
        transferred: overrides.uploadTransferred ?? bytes.length,
        total: bytes.length
      })
      uploadGate.resolve(options)
      return createInnerHandle('upload')
    },
    async download (options) {
      nativeCalls.push({ kind: 'download', options })
      const bytes = nodes.get(options.remotePath)?.content
      if (!bytes) throw missing(options.remotePath)
      options.onData?.({
        transferred: overrides.downloadTransferred ?? bytes.length,
        total: bytes.length
      })
      downloadGate.resolve(options)
      return createInnerHandle('download')
    }
  }

  function metadata (remotePath, node, parentPath, parent) {
    if (parent && !parent.device) {
      parent.device = remotePath.startsWith(home) ? '2049' : '1'
      parent.inode = String(nextInode++)
    }
    return {
      mode: typeMode(node),
      type: node.type,
      size: node.type === 'file' ? node.content.length : 0,
      atime: 1,
      mtime: 2,
      uid: node.uid,
      gid: node.gid,
      device: String(node.device),
      inode: String(node.inode),
      parentRealPath: parentPath,
      parentDevice: String(parent.device),
      parentInode: String(parent.inode)
    }
  }

  async function execute ({ request }, executionOptions = {}) {
    requests.push(request)
    const args = request.args
    if (request.operation === 'stage-handshake') {
      const response = sha256(`${args.challenge}:root`)
      Object.assign(nodes.get(args.rootPath), {
        device: '2049',
        inode: '777'
      })
      nodes.set(`${args.rootPath}/${args.responseName}`,
        file(response, 0o600, 1000, 1000))
      return {
        exitCode: 0,
        kind: 'stage-handshake',
        identity: { uid: '0', username: 'root' },
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
      if (overrides.cleanupFailure?.(args)) {
        throw new Error('stage cleanup failed')
      }
      const remotePath = `${args.rootPath}/${args.objectName}`
      const node = nodes.get(remotePath)
      if (node && (node.type !== 'file' ||
        sha256(node.content) !== args.sha256 ||
        String(node.content.length) !== args.size)) {
        throw new Error('stage cleanup proof changed')
      }
      nodes.delete(remotePath)
      return { exitCode: 0, kind: 'stage-cleanup', ok: true }
    }
    if (request.operation === 'digest-cleanup') {
      return { exitCode: 0, kind: 'digest-cleanup', ok: true }
    }
    if (request.operation === 'lstat' || request.operation === 'lstat-bound') {
      let node = privileged.get(args.path)
      let parentPath = args.path.slice(0, args.path.lastIndexOf('/')) || '/'
      let parent = privileged.get(parentPath) || nodes.get(parentPath)
      if (nodes.has(args.path)) {
        node = nodes.get(args.path)
        parentPath = args.rootPath || args.path.slice(0, args.path.lastIndexOf('/'))
        parent = nodes.get(parentPath) ||
          directory(0o700, 1000, 1000, '2049', '777')
        if (node && !node.device) {
          node.device = '2049'
          node.inode = String(nextInode++)
        }
      }
      if (!node) {
        return { exitCode: 0, kind: request.operation, missing: true }
      }
      return {
        exitCode: 0,
        kind: request.operation,
        metadata: metadata(args.path, node, parentPath, parent)
      }
    }
    if (request.operation === 'sha256-bound') {
      const node = nodes.get(args.path) || privileged.get(args.path)
      if (!node || node.type !== 'file' ||
        String(node.content.length) !== args.expectedSize ||
        node.content.length > Number(args.maxSize)) {
        throw new Error('bounded digest proof changed')
      }
      return {
        exitCode: 0,
        kind: 'sha256-bound',
        sha256: sha256(node.content),
        size: node.content.length
      }
    }
    if (request.operation === 'stage-export') {
      if (overrides.exportFailure) {
        throw new Error('stage export failed')
      }
      const source = nodes.get(args.sourcePath) || privileged.get(args.sourcePath)
      if (!source || source.type !== 'file') throw missing(args.sourcePath)
      const stagePath = `${args.rootPath}/${args.objectName}`
      nodes.set(stagePath, file(source.content, 0o600, 1000, 1000))
      return {
        exitCode: 0,
        kind: 'stage-export',
        sha256: sha256(source.content),
        size: source.content.length
      }
    }
    if (request.operation === 'stage-import') {
      await overrides.beforeImport?.({
        args,
        signal: executionOptions.signal,
        nodes,
        privileged
      })
      if (executionOptions.signal?.aborted) {
        throw executionOptions.signal.reason || new Error('cancelled')
      }
      if (overrides.importFailure && (
        typeof overrides.importFailure !== 'function' ||
        overrides.importFailure(args)
      )) {
        return {
          exitCode: 1,
          kind: 'stage-import',
          ok: false,
          cleanupSucceeded: true,
          residualLocation: 'none'
        }
      }
      const stage = nodes.get(`${args.rootPath}/${args.objectName}`)
      const targetMap = args.targetPath.startsWith(`${home}/`)
        ? nodes
        : privileged
      if (!stage || targetMap.has(args.targetPath)) {
        throw new Error('stage import no-clobber failed')
      }
      const installed = file(
        stage.content,
        Number.parseInt(args.targetMode, 8),
        Number(args.targetUid),
        Number(args.targetGid),
        '1',
        String(nextInode++)
      )
      targetMap.set(args.targetPath, installed)
      overrides.afterImport?.({ args, installed, nodes, privileged })
      return {
        exitCode: 0,
        kind: 'stage-import',
        sha256: sha256(stage.content),
        size: stage.content.length,
        targetDevice: installed.device,
        targetInode: installed.inode,
        targetClaim: {
          targetPath: args.targetPath,
          targetDevice: installed.device,
          targetInode: installed.inode,
          targetType: 'file',
          targetParentRealPath: args.targetParentRealPath,
          targetParentDevice: args.targetParentDevice,
          targetParentInode: args.targetParentInode,
          sha256: args.sha256,
          size: Number(args.size),
          mode: Number.parseInt(args.targetMode, 8),
          uid: Number(args.targetUid),
          gid: Number(args.targetGid)
        },
        cleanupSucceeded: true,
        residualLocation: 'complete'
      }
    }
    if (request.operation === 'remove-bound' ||
      request.operation === 'remove-peer-bound') {
      const targetMap = args.targetPath.startsWith(`${home}/`)
        ? nodes
        : privileged
      const target = targetMap.get(args.targetPath)
      if (!target || String(target.device) !== String(args.targetDevice) ||
        String(target.inode) !== String(args.targetInode)) {
        throw new Error('remove target proof changed')
      }
      if (target.type === 'file' && (
        sha256(target.content) !== args.sha256 ||
        String(target.content.length) !== String(args.size)
      )) {
        throw new Error('remove target digest changed')
      }
      if (request.operation === 'remove-peer-bound') {
        const peerMap = args.peerPath.startsWith(`${home}/`)
          ? nodes
          : privileged
        const peer = peerMap.get(args.peerPath)
        if (!peer || String(peer.device) !== String(args.peerDevice) ||
          String(peer.inode) !== String(args.peerInode)) {
          throw new Error('remove peer proof changed')
        }
      }
      targetMap.delete(args.targetPath)
      overrides.afterRemove?.({
        args,
        operation: request.operation,
        nodes,
        privileged,
        file
      })
      return { exitCode: 0, kind: request.operation, ok: true }
    }
    throw new Error(`unexpected privileged operation: ${request.operation}`)
  }

  const backend = await createPrivilegedFileBackend({
    sftp,
    lease: {
      execute,
      async release () {
        releaseCount += 1
        return true
      }
    },
    identity: { uid: '0', username: 'root' },
    capabilities: {},
    createToken: createTokenFactory()
  })

  return {
    backend,
    nativeCalls,
    nodes,
    privileged,
    requests,
    controls,
    uploadGate,
    downloadGate,
    get releaseCount () { return releaseCount }
  }
}

test('privileged upload transfers to stage then installs the verified target', async () => {
  const harness = await createPrivilegedBackendHarness({ uploadTransferred: 1 })
  const events = []
  const transport = await harness.backend.backend.upload({
    localPath: 'C:\\tmp\\app.conf',
    remotePath: '/root/app.conf',
    options: { mode: 0o600, atomicUpload: true },
    onData: data => events.push(['data', data]),
    onEnd: data => events.push(['end', data]),
    onError: error => events.push(['error', error.message])
  })
  const native = await harness.uploadGate.promise

  assert.match(native.remotePath,
    /^\/home\/hik\/\.shellpilot-privileged-transfers\//)
  assert.equal(harness.privileged.has('/root/app.conf'), false)
  await native.onEnd({ transferred: 11 })

  assert.equal(harness.requests.some(request =>
    request.operation === 'sha256-bound'), true)
  assert.equal(harness.requests.some(request =>
    request.operation === 'stage-import' &&
    request.args.targetPath === '/root/app.conf' &&
    request.args.mustBeAbsent === '1'), true)
  assert.equal(harness.privileged.get('/root/app.conf').content.toString(),
    'root-upload')
  assert.equal(events.at(-1)[0], 'end')
  assert.equal(Object.getPrototypeOf(transport), null)
  assert.equal(Object.isFrozen(transport), true)
  await harness.backend.release()
})

test('privileged upload atomically overwrites an exact existing file', async () => {
  const harness = await createPrivilegedBackendHarness({
    existingUploadBytes: Buffer.from('old-root-content')
  })
  const events = []
  await harness.backend.backend.upload({
    localPath: 'C:\\tmp\\app.conf',
    remotePath: '/root/app.conf',
    options: {
      mode: 0o600,
      atomicUpload: true,
      atomicOverwrite: true
    },
    onEnd: () => events.push('end'),
    onError: error => events.push(`error:${error.message}`)
  })
  const native = await harness.uploadGate.promise
  await native.onEnd({ transferred: Buffer.byteLength('root-upload') })

  assert.deepEqual(events, ['end'])
  assert.equal(harness.privileged.get('/root/app.conf').content.toString(),
    'root-upload')
  assert.equal(harness.requests.some(request =>
    request.operation === 'remove-peer-bound'), true)
  await harness.backend.release()
})

test('privileged overwrite restores the exact old content when install fails', async () => {
  let failedInstall = false
  const harness = await createPrivilegedBackendHarness({
    existingUploadBytes: Buffer.from('old-root-content'),
    importFailure: args => args.targetPath === '/root/app.conf' &&
      !failedInstall && (failedInstall = true)
  })
  const events = []
  await harness.backend.backend.upload({
    localPath: 'C:\\tmp\\app.conf',
    remotePath: '/root/app.conf',
    options: { atomicOverwrite: true },
    onEnd: () => events.push('end'),
    onError: error => events.push(`error:${error.message}`)
  })
  const native = await harness.uploadGate.promise
  await native.onEnd({ transferred: Buffer.byteLength('root-upload') })

  assert.equal(events.length, 1)
  assert.match(events[0], /^error:/)
  assert.equal(harness.privileged.get('/root/app.conf').content.toString(),
    'old-root-content')
  assert.equal([...harness.nodes.keys()].some(path => /\/download-/.test(path)),
    false)
  await harness.backend.release()
})

test('privileged overwrite cancellation during install restores old content before terminal', async () => {
  const installStarted = deferred()
  const continueInstall = deferred()
  let gated = false
  const harness = await createPrivilegedBackendHarness({
    existingUploadBytes: Buffer.from('old-root-content'),
    beforeImport: async ({ args }) => {
      if (!gated && args.targetPath === '/root/app.conf') {
        gated = true
        installStarted.resolve()
        await continueInstall.promise
      }
    }
  })
  const controller = new AbortController()
  const events = []
  await harness.backend.backend.upload({
    localPath: 'C:\\tmp\\app.conf',
    remotePath: '/root/app.conf',
    signal: controller.signal,
    options: { atomicOverwrite: true },
    onEnd: () => events.push('end'),
    onError: error => events.push(`error:${error.message}`)
  })
  const native = await harness.uploadGate.promise
  const finishing = native.onEnd({
    transferred: Buffer.byteLength('root-upload')
  })
  await installStarted.promise
  controller.abort(new Error('cancelled during install'))
  continueInstall.resolve()
  await finishing

  assert.deepEqual(events, ['error:cancelled during install'])
  assert.equal(harness.privileged.get('/root/app.conf').content.toString(),
    'old-root-content')
  assert.equal([...harness.nodes.keys()].some(path => /\/download-/.test(path)),
    false)
  await harness.backend.release()
})

test('privileged overwrite preserves displacement when a foreign target wins the race', async () => {
  let raced = false
  const harness = await createPrivilegedBackendHarness({
    existingUploadBytes: Buffer.from('old-root-content'),
    afterRemove: ({ args, operation, privileged, file }) => {
      if (!raced && operation === 'remove-peer-bound' &&
        args.targetPath === '/root/app.conf') {
        raced = true
        privileged.set('/root/app.conf', file(
          Buffer.from('foreign-content'),
          0o600,
          0,
          0,
          '1',
          '901'
        ))
      }
    }
  })
  const events = []
  await harness.backend.backend.upload({
    localPath: 'C:\\tmp\\app.conf',
    remotePath: '/root/app.conf',
    options: { overwrite: true },
    onError: error => events.push(error)
  })
  const native = await harness.uploadGate.promise
  await native.onEnd({ transferred: Buffer.byteLength('root-upload') })

  assert.equal(events.length, 1)
  assert.equal(events[0].code, 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH')
  assert.equal(events[0].recoveryUncertain, true)
  assert.equal(harness.privileged.get('/root/app.conf').content.toString(),
    'foreign-content')
  assert.equal([...harness.nodes.keys()].some(path => /\/download-/.test(path)),
    true)
  await assert.rejects(harness.backend.release(), /residual|owned/i)
})

test('privileged overwrite never deletes a foreign partial-copy displacement without an exact claim', async () => {
  const foreignBytes = Buffer.from('foreign-partial-copy')
  let racedPath
  const harness = await createPrivilegedBackendHarness({
    existingUploadBytes: Buffer.from('old-root-content'),
    afterImport: ({ args, nodes }) => {
      if (!racedPath && /\/download-/.test(args.targetPath)) {
        racedPath = args.targetPath
        nodes.set(racedPath, {
          type: 'file',
          mode: 0o600,
          uid: 1000,
          gid: 1000,
          device: '2049',
          inode: '9901',
          content: foreignBytes
        })
      }
    }
  })
  const events = []
  await harness.backend.backend.upload({
    localPath: 'C:\\tmp\\app.conf',
    remotePath: '/root/app.conf',
    options: { atomicOverwrite: true },
    onError: error => events.push(error)
  })
  const native = await harness.uploadGate.promise
  await native.onEnd({ transferred: Buffer.byteLength('root-upload') })

  assert.equal(events.length, 1)
  assert.equal(events[0].recoveryUncertain, true)
  assert.equal(events[0].path, racedPath)
  assert.equal(events[0].phase, 'overwrite-displacement-copy')
  assert.ok(events[0].cause instanceof Error)
  assert.equal(harness.nodes.get(racedPath)?.content.toString(),
    foreignBytes.toString())
  assert.equal(harness.requests.filter(request => (
    ['remove-bound', 'remove-peer-bound'].includes(request.operation) &&
    request.args.targetPath === racedPath
  )).length, 0)
  await assert.rejects(harness.backend.release(), /residual|owned/i)
  assert.equal(harness.nodes.get(racedPath)?.content.toString(),
    foreignBytes.toString())
  assert.equal(harness.requests.filter(request => (
    ['remove-bound', 'remove-peer-bound'].includes(request.operation) &&
    request.args.targetPath === racedPath
  )).length, 0)
})

test('privileged overwrite never deletes a same-inode rewrite after install', async () => {
  let rewrote = false
  const harness = await createPrivilegedBackendHarness({
    existingUploadBytes: Buffer.from('old-root-content'),
    afterImport: ({ args, installed }) => {
      if (!rewrote && args.targetPath === '/root/app.conf') {
        rewrote = true
        installed.content = Buffer.from('same-inode-foreign-rewrite')
      }
    }
  })
  const events = []
  await harness.backend.backend.upload({
    localPath: 'C:\\tmp\\app.conf',
    remotePath: '/root/app.conf',
    options: { mergeOrOverwrite: true },
    onError: error => events.push(error)
  })
  const native = await harness.uploadGate.promise
  await native.onEnd({ transferred: Buffer.byteLength('root-upload') })

  assert.equal(events.length, 1)
  assert.equal(events[0].code, 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH')
  assert.equal(harness.privileged.get('/root/app.conf').content.toString(),
    'same-inode-foreign-rewrite')
  assert.equal([...harness.nodes.keys()].some(path => /\/download-/.test(path)),
    true)
  await assert.rejects(harness.backend.release(), /residual|owned/i)
})

test('privileged directory merge accepts only an exactly bound existing directory', async () => {
  const harness = await createPrivilegedBackendHarness()
  harness.privileged.set('/root/merge', {
    type: 'directory',
    mode: 0o750,
    uid: 0,
    gid: 0,
    device: '1',
    inode: '920'
  })
  harness.privileged.set('/root/not-a-directory', {
    type: 'file',
    mode: 0o600,
    uid: 0,
    gid: 0,
    device: '1',
    inode: '921',
    content: Buffer.from('file')
  })

  assert.equal(await harness.backend.backend.mkdir('/root/merge'), 1)
  await assert.rejects(
    harness.backend.backend.mkdir('/root/not-a-directory'),
    error => error?.code === 'EEXIST'
  )
  assert.equal(harness.nativeCalls.length, 0)
  await harness.backend.release()
})

test('Transfer directory traversal forwards merge overwrite to every root file upload', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')
  const primary = source.slice(
    source.indexOf('transferFile = async'),
    source.indexOf('isTransferAction =')
  )
  const subtransfer = source.slice(
    source.indexOf('transferFileAsSubTransfer ='),
    source.indexOf('getDefaultTransfer =')
  )
  for (const body of [primary, subtransfer]) {
    assert.match(body, /fileActions\.mergeOrOverwriteAll/)
    assert.match(body, /atomicOverwrite:\s*atomicUpload\s*&&\s*mergeOrOverwrite/)
    assert.match(body, /overwrite:\s*atomicUpload\s*&&\s*mergeOrOverwrite/)
    assert.match(body, /mergeOrOverwrite,?/)
  }
})

test('privileged upload reports import failure after inner end and cleans its stage', async () => {
  const harness = await createPrivilegedBackendHarness({ importFailure: true })
  const events = []
  await harness.backend.backend.upload({
    localPath: 'C:\\tmp\\app.conf',
    remotePath: '/root/app.conf',
    onEnd: () => events.push('end'),
    onError: error => events.push(error.message)
  })
  const native = await harness.uploadGate.promise
  await native.onEnd()

  assert.equal(events.includes('end'), false)
  assert.match(events.at(-1), /stage-import|root 文件操作失败/)
  assert.equal([...harness.nodes.keys()].some(path => /\/upload-/.test(path)), false)
  await harness.backend.release()
})

test('privileged download exports one snapshot verifies transferred size then cleans', async () => {
  const harness = await createPrivilegedBackendHarness({ downloadTransferred: 1 })
  const events = []
  const transport = await harness.backend.backend.download({
    remotePath: '/root/source.bin',
    localPath: 'C:\\tmp\\source.bin',
    onData: data => events.push(['data', data]),
    onEnd: data => events.push(['end', data]),
    onError: error => events.push(['error', error.message])
  })
  const native = await harness.downloadGate.promise

  assert.equal(harness.requests.some(request =>
    request.operation === 'stage-export' &&
    request.args.sourcePath === '/root/source.bin'), true)
  assert.match(native.remotePath,
    /^\/home\/hik\/\.shellpilot-privileged-transfers\//)
  await native.onEnd({ transferred: Buffer.byteLength('root-download') })

  assert.equal(events.at(-1)[0], 'end')
  assert.equal([...harness.nodes.keys()].some(path => /\/download-/.test(path)), false)
  assert.equal(Object.getPrototypeOf(transport), null)
  await harness.backend.release()
})

test('privileged transfer pause resume and cancel never carry file bytes through PTY', async () => {
  const uploadBytes = Buffer.alloc(32 * 1024 * 1024, 0x61)
  const harness = await createPrivilegedBackendHarness({ uploadBytes })
  const transport = await harness.backend.backend.upload({
    localPath: 'C:\\tmp\\large.bin',
    remotePath: '/root/large.bin',
    onError () {}
  })
  await harness.uploadGate.promise
  await transport.pause()
  await transport.resume()
  await transport.cancel()

  assert.deepEqual(harness.controls, [
    'upload:pause', 'upload:resume', 'upload:cancel'
  ])
  assert.equal([...harness.nodes.keys()].some(path => /\/upload-/.test(path)), false)
  assert.equal(harness.requests.some(request => Object.values(request.args)
    .some(value => typeof value === 'string' && value.length > 4096)), false)
  await harness.backend.release()
})

test('privileged upload and download forward lifecycle abort to native startup', async () => {
  const uploadHarness = await createPrivilegedBackendHarness()
  const uploadController = new AbortController()
  await uploadHarness.backend.backend.upload({
    localPath: 'C:\\tmp\\signal-upload.bin',
    remotePath: '/root/signal-upload.bin',
    signal: uploadController.signal
  })
  const nativeUpload = await uploadHarness.uploadGate.promise
  assert.equal(nativeUpload.signal, uploadController.signal)
  await nativeUpload.onError(new Error('finish upload signal test'))
  await uploadHarness.backend.release()

  const downloadHarness = await createPrivilegedBackendHarness()
  const downloadController = new AbortController()
  await downloadHarness.backend.backend.download({
    localPath: 'C:\\tmp\\signal-download.bin',
    remotePath: '/root/source.bin',
    signal: downloadController.signal
  })
  const nativeDownload = await downloadHarness.downloadGate.promise
  assert.equal(nativeDownload.signal, downloadController.signal)
  await nativeDownload.onError(new Error('finish download signal test'))
  await downloadHarness.backend.release()
})

test('privileged download export failure never starts native transfer', async () => {
  const harness = await createPrivilegedBackendHarness({ exportFailure: true })
  await assert.rejects(harness.backend.backend.download({
    remotePath: '/root/source.bin',
    localPath: 'C:\\tmp\\source.bin'
  }), /stage export failed/)
  assert.equal(harness.nativeCalls.length, 0)
  assert.equal([...harness.nodes.keys()].some(path => /\/download-/.test(path)), false)
  await harness.backend.release()
})

test('privileged download size mismatch reports error and cleans snapshot', async () => {
  const harness = await createPrivilegedBackendHarness({
    downloadTransferred: 1
  })
  const events = []
  await harness.backend.backend.download({
    remotePath: '/root/source.bin',
    localPath: 'C:\\tmp\\source.bin',
    onEnd: () => events.push('end'),
    onError: error => events.push(error.message)
  })
  const native = await harness.downloadGate.promise
  await native.onEnd()

  assert.equal(events.includes('end'), false)
  assert.match(events.at(-1), /大小|size|snapshot/i)
  assert.equal([...harness.nodes.keys()].some(path => /\/download-/.test(path)), false)
  await harness.backend.release()
})

test('privileged inner error and cancel both perform proof-aware stage cleanup', async () => {
  const failed = await createPrivilegedBackendHarness()
  const errors = []
  await failed.backend.backend.upload({
    localPath: 'C:\\tmp\\failed.bin',
    remotePath: '/root/failed.bin',
    onError: error => errors.push(error.message)
  })
  const failedNative = await failed.uploadGate.promise
  await failedNative.onError(new Error('native upload failed'))
  assert.deepEqual(errors, ['native upload failed'])
  assert.equal([...failed.nodes.keys()].some(path => /\/upload-/.test(path)), false)
  await failed.backend.release()

  const cancelled = await createPrivilegedBackendHarness()
  const transport = await cancelled.backend.backend.download({
    remotePath: '/root/source.bin',
    localPath: 'C:\\tmp\\source.bin'
  })
  await cancelled.downloadGate.promise
  await transport.cancel()
  assert.deepEqual(cancelled.controls, ['download:cancel'])
  assert.equal([...cancelled.nodes.keys()].some(path => /\/download-/.test(path)), false)
  await cancelled.backend.release()
})

test('privileged cleanup failure becomes the only outer terminal and release retries it', async () => {
  let cleanupFailures = 1
  const harness = await createPrivilegedBackendHarness({
    cleanupFailure: args => args.objectName.startsWith('upload-') &&
      cleanupFailures-- > 0
  })
  const events = []
  await harness.backend.backend.upload({
    localPath: 'C:\\tmp\\app.conf',
    remotePath: '/root/app.conf',
    onEnd: () => events.push('end'),
    onError: error => events.push(`error:${error.message}`)
  })
  const native = await harness.uploadGate.promise
  await native.onEnd()
  await native.onError(new Error('late duplicate terminal'))

  assert.equal(events.length, 1)
  assert.match(events[0], /^error:stage cleanup failed/)
  assert.equal(await harness.backend.release(), true)
  assert.equal(harness.releaseCount, 1)
})

test('Transfer pins one effective session before remote checks and releases after terminals', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')
  const cancellationLifecycle = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer-cancellation-lifecycle.js'
  ), 'utf8')
  const init = source.slice(
    source.indexOf('initTransfer = async'),
    source.indexOf('checkConflict = async')
  )
  const pause = source.slice(
    source.indexOf('pause ='),
    source.indexOf('mvOrCp =')
  )
  const retry = source.slice(
    source.indexOf('scheduleRetry ='),
    source.indexOf('onError =')
  )
  const startTransfer = source.slice(
    source.indexOf('startTransfer = async'),
    source.indexOf('assertCurrentAttempt =')
  )
  const list = source.slice(
    source.indexOf('list = async'),
    source.indexOf('handleRename =')
  )
  const mkdir = source.slice(
    source.indexOf('mkdir = async'),
    source.indexOf('render ()')
  )
  const remoteCheck = source.slice(
    source.indexOf('remoteCheckExist ='),
    source.indexOf('checkExist =')
  )
  const unmount = source.slice(
    source.indexOf('componentWillUnmount'),
    source.indexOf('runTransferTask =')
  )
  const cancelProtected = source.slice(
    source.indexOf('cancelProtectedTransport ='),
    source.indexOf('cancelAndWait =')
  )
  const cancelAndWait = source.slice(
    source.indexOf('cancelAndWait ='),
    source.indexOf('cancel = async')
  )

  assert.match(source, /createTransferFileSessionController/)
  assert.match(source, /acquireTransferFileCapability\(\{[\s\S]*transferId:/)
  assert.match(init, /await this\.ensureRemoteFileSession\(\)[\s\S]*this\.checkExist/)
  assert.match(remoteCheck, /ensureRemoteFileSession\(\)/)
  assert.doesNotMatch(remoteCheck, /refs\.get/)
  assert.match(source, /session:\s*this\.remoteFileSessionController\.current/)
  assert.match(source, /runtimeIdentity:\s*this\.remoteFileSession\?\.runtimeIdentity/)
  assert.match(source, /const transport = this\.transport[\s\S]*await transport\?\.cancel\(\)/)
  assert.match(source, /releaseRemoteFileSession/)
  assert.doesNotMatch(pause, /releaseRemoteFileSession/)
  assert.match(pause, /pause = async[\s\S]*await this\.transport\?\.pause\(\)/)
  assert.match(pause, /resume = async[\s\S]*await this\.transport\?\.resume\(\)/)
  assert.match(pause, /catch \(error\)[\s\S]*this\.onError\(error/)
  assert.match(retry, /Promise\.resolve\(transport\?\.destroy\(\)\)[\s\S]*\.catch/)
  assert.match(startTransfer, /await this\.transferFolderRecursive/)
  assert.doesNotMatch(
    startTransfer,
    /else if \(!this\.isFtp\)[\s\S]*return await this\.transferFile/
  )
  assert.match(list, /if \(type === typeMap\.remote\)[\s\S]*sftpList\(runtime\.sftp, path\)/)
  assert.match(mkdir, /await window\.fs\.mkdir\(toPath\)[\s\S]*return true/)
  assert.doesNotMatch(mkdir, /window\.fs\.mkdir\(toPath\)[\s\S]*\.catch\(\(\) => false\)/)
  assert.match(mkdir, /await sftp\.mkdir\(toPath\)[\s\S]*return true/)
  assert.doesNotMatch(mkdir, /sftp\.mkdir\(toPath\)[\s\S]*\.catch\(\(\) => false\)/)
  assert.match(source, /componentWillUnmount[\s\S]*releaseRemoteFileSession/)
  assert.match(unmount, /finally[\s\S]*releaseRemoteFileSession/)
  assert.match(cancelProtected, /settleTransferCancellation/)
  assert.match(cancelProtected, /release:\s*\(\) => this\.releaseRemoteFileSession/)
  assert.match(cancelAndWait, /settleTransferCancellation/)
  assert.match(cancelAndWait, /release:\s*\(\) => this\.releaseRemoteFileSession/)
  assert.match(cancellationLifecycle, /finally[\s\S]*release/)
})
