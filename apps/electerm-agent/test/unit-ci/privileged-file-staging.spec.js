const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { importModule } = require('./helpers/import-esm')

const stagingModule =
  'src/client/components/sftp/privileged-file-staging.js'

function sha256 (value) {
  return createHash('sha256').update(value).digest('hex')
}

function missing (path) {
  const error = new Error(`No such file: ${path}`)
  error.code = 'SFTP_NO_SUCH_FILE'
  return error
}

function createTokenFactory () {
  let sequence = 0
  return () => (++sequence).toString(16).padStart(48, '0')
}

function createFakeSftp (options = {}) {
  const nodes = new Map()
  const calls = []
  const home = '/home/login'
  let inode = 100
  const sftp = {
    id: 'sftp-session-1',
    terminalId: 'terminal-1',
    calls,
    nodes,
    async getHomeDir () {
      calls.push(['getHomeDir'])
      return options.home || home
    },
    async realpath (remotePath) {
      calls.push(['realpath', remotePath])
      if (options.realpathMismatch && remotePath.includes('.shellpilot-privileged-transfers/')) {
        return '/different/stage'
      }
      return remotePath || home
    },
    async lstat (remotePath) {
      calls.push(['lstat', remotePath])
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
      calls.push(['list', remotePath])
      const prefix = `${remotePath}/`
      return [...nodes.keys()]
        .filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(path => ({ name: path.slice(prefix.length) }))
    },
    async mkdir (remotePath, attrs = {}) {
      calls.push(['mkdir', remotePath, attrs])
      if (nodes.has(remotePath)) {
        const error = new Error('Already exists')
        error.code = 'EEXIST'
        throw error
      }
      nodes.set(remotePath, {
        type: options.rootSymlink &&
          remotePath.includes('/.shellpilot-privileged-transfers/')
          ? 'symlink'
          : 'directory',
        mode: attrs.mode ?? 0o700,
        uid: options.localUid ?? 1000,
        gid: options.localGid ?? 1000,
        inode: ++inode
      })
      return 1
    },
    async chmod (remotePath, mode) {
      calls.push(['chmod', remotePath, mode])
      nodes.get(remotePath).mode = mode
      return 1
    },
    async createExclusiveFile (remotePath, base64, mode) {
      calls.push(['createExclusiveFile', remotePath, base64, mode])
      if (nodes.has(remotePath)) throw new Error('Target exists')
      const isChallenge = remotePath.includes('challenge-')
      nodes.set(remotePath, {
        type: options.challengeSymlink && isChallenge ? 'symlink' : 'file',
        mode,
        uid: options.localUid ?? 1000,
        gid: options.localGid ?? 1000,
        content: Buffer.from(base64, 'base64'),
        inode: ++inode
      })
      return 1
    },
    async readFile (remotePath) {
      calls.push(['readFile', remotePath])
      const node = nodes.get(remotePath)
      if (!node) throw missing(remotePath)
      return node.content.toString('utf8')
    },
    async rm (remotePath) {
      calls.push(['rm', remotePath])
      const node = nodes.get(remotePath)
      if (!node) throw missing(remotePath)
      if (node.failRemove) throw new Error(`cleanup failed: ${remotePath}`)
      nodes.delete(remotePath)
      return 1
    },
    async removeEmptyDirectory (remotePath) {
      calls.push(['removeEmptyDirectory', remotePath])
      const prefix = `${remotePath}/`
      if ([...nodes.keys()].some(path => path.startsWith(prefix))) {
        throw new Error('Directory not empty')
      }
      const node = nodes.get(remotePath)
      if (!node) throw missing(remotePath)
      nodes.delete(remotePath)
      return 1
    }
  }
  nodes.set(home, {
    type: 'directory', mode: 0o700, uid: 1000, gid: 1000, inode: 1
  })
  if (options.preexistingRoot) {
    nodes.set(`${home}/.shellpilot-privileged-transfers`, {
      type: 'directory', mode: 0o700, uid: 1000, gid: 1000, inode: 2
    })
    nodes.set(`${home}/.shellpilot-privileged-transfers/${'1'.padStart(48, '0')}`, {
      type: 'directory', mode: 0o700, uid: 1000, gid: 1000, inode: 3
    })
  }
  if (options.preexistingBaseUid !== undefined) {
    nodes.set(`${home}/.shellpilot-privileged-transfers`, {
      type: 'directory', mode: 0o700, uid: options.preexistingBaseUid, gid: 1000, inode: 2
    })
  }
  return sftp
}

function createHandshakeExecutor (sftp, overrides = {}) {
  const requests = []
  const execute = async request => {
    requests.push(request)
    if (request.operation === 'stage-handshake') {
      const root = sftp.nodes.get(request.args.rootPath)
      const response = sha256(`${request.args.challenge}:root`)
      const responsePath = `${request.args.rootPath}/${request.args.responseName}`
      sftp.nodes.set(responsePath, {
        type: overrides.responseSymlink ? 'symlink' : 'file',
        mode: 0o600,
        uid: root.uid,
        gid: root.gid,
        content: Buffer.from(overrides.responseFile || response),
        inode: 900
      })
      if (overrides.throwAfterResponse) {
        throw new Error('handshake transport failed after response')
      }
      if (overrides.rootModeAfter !== undefined) {
        root.mode = overrides.rootModeAfter
      }
      if (overrides.challengeSymlinkAfter) {
        sftp.nodes.get(`${request.args.rootPath}/${request.args.challengeName}`).type = 'symlink'
      }
      if (overrides.endpointAfter) sftp.id = overrides.endpointAfter
      return {
        exitCode: 0,
        identity: overrides.identity || { uid: '0', username: 'root' },
        kind: 'stage-handshake',
        response: overrides.response || response,
        uid: String(overrides.uid ?? root.uid),
        gid: String(overrides.gid ?? root.gid),
        mode: String(overrides.mode ?? 700),
        rootRealPath: overrides.rootRealPath || request.args.rootPath,
        rootDevice: overrides.rootDevice || '2049',
        rootInode: overrides.rootInode || '5555'
      }
    }
    if (request.operation === 'stage-cleanup') {
      const remotePath = `${request.args.rootPath}/${request.args.objectName}`
      const node = sftp.nodes.get(remotePath)
      if (node?.failProtocolCleanup) throw new Error(`protocol cleanup failed: ${remotePath}`)
      sftp.nodes.delete(remotePath)
      return { kind: 'stage-cleanup', ok: true }
    }
    throw new Error(`Unexpected operation: ${request.operation}`)
  }
  execute.requests = requests
  return execute
}

test('staging handshake binds one canonical private root and cleans it idempotently', async () => {
  const { createPrivilegedStagingSession } = await importModule(stagingModule)
  const sftp = createFakeSftp()
  const execute = createHandshakeExecutor(sftp)
  const session = await createPrivilegedStagingSession({
    sftp,
    execute,
    createToken: createTokenFactory()
  })

  assert.equal(session.root.startsWith(
    '/home/login/.shellpilot-privileged-transfers/'
  ), true)
  assert.equal(Object.isFrozen(session), true)
  assert.equal(Object.isFrozen(session.rootBinding), true)
  assert.deepEqual(session.rootBinding, {
    rootPath: session.root,
    rootRealPath: session.root,
    rootDevice: '2049',
    rootInode: '5555',
    rootUid: '1000',
    rootGid: '1000',
    rootMode: '700'
  })
  const handshake = execute.requests[0]
  assert.equal(handshake.operation, 'stage-handshake')
  assert.equal(Object.isFrozen(handshake), true)
  assert.equal(handshake.args.rootPath, session.root)

  const upload = session.allocate('upload')
  const download = session.allocate('download')
  assert.equal(Object.isFrozen(upload), true)
  assert.match(upload.objectName, /^upload-[a-f0-9]{48}$/)
  assert.match(download.objectName, /^download-[a-f0-9]{48}$/)
  assert.equal(upload.path, `${session.root}/${upload.objectName}`)
  assert.equal(session.remember(upload.path), upload.path)
  await session.cleanup(upload.path)
  const cleanup = execute.requests.find(request => (
    request.operation === 'stage-cleanup' &&
    request.args.objectName === upload.objectName
  ))
  assert.deepEqual(cleanup.args, {
    ...session.rootBinding,
    objectName: upload.objectName
  })

  assert.equal(await session.release(), true)
  assert.equal(await session.release(), true)
  assert.equal(sftp.nodes.has(session.root), false)
  assert.equal(sftp.nodes.has('/home/login/.shellpilot-privileged-transfers'), false)
  assert.equal(sftp.calls.filter(call => call[0] === 'removeEmptyDirectory' &&
    call[1] === session.root).length, 1)
})

test('staging rejects preexisting roots symlinks mismatched paths identities modes and responses', async () => {
  const { createPrivilegedStagingSession } = await importModule(stagingModule)
  const cases = [
    ['preexisting root', { sftp: { preexistingRoot: true } }, {}, /exist|存在|占用|预存/i],
    ['base owner mismatch', { sftp: { preexistingBaseUid: 2000 } }, {}, /base|uid|所有|身份/i],
    ['root symlink', { sftp: { rootSymlink: true } }, {}, /symlink|目录|符号/i],
    ['challenge symlink', { sftp: { challengeSymlink: true } }, {}, /symlink|文件|符号/i],
    ['response symlink', {}, { responseSymlink: true }, /symlink|文件|符号/i],
    ['SFTP realpath mismatch', { sftp: { realpathMismatch: true } }, {}, /realpath|路径|规范/i],
    ['root path mismatch', {}, { rootRealPath: '/different/stage' }, /路径|root/i],
    ['non-root PTY identity', {}, { identity: { uid: '1000', username: 'login' } }, /root|身份|uid/i],
    ['uid mismatch', {}, { uid: 0 }, /uid|身份/i],
    ['gid mismatch', {}, { gid: 0 }, /gid|身份/i],
    ['mode mismatch', {}, { mode: 755 }, /mode|权限/i],
    ['response mismatch', {}, { response: 'f'.repeat(64) }, /响应|response|握手/i],
    ['response file mismatch', {}, { responseFile: 'f'.repeat(64) }, /响应|response|握手/i],
    ['root mode changed after handshake', {}, { rootModeAfter: 0o755 }, /mode|权限/i],
    ['challenge replaced after handshake', {}, { challengeSymlinkAfter: true }, /challenge|symlink|文件|符号/i]
  ]
  for (const [label, setup, handshake, pattern] of cases) {
    const sftp = createFakeSftp(setup.sftp)
    const execute = createHandshakeExecutor(sftp, handshake)
    await assert.rejects(
      createPrivilegedStagingSession({
        sftp,
        execute,
        createToken: createTokenFactory()
      }),
      pattern,
      label
    )
    assert.equal(
      [...sftp.nodes.keys()].some(path => path.includes('/000000000000000000000000000000000000000000000001')),
      setup.sftp?.preexistingRoot === true,
      label
    )
  }
})

test('failed creation never cleans through a changed SFTP endpoint', async () => {
  const { createPrivilegedStagingSession } = await importModule(stagingModule)
  const sftp = createFakeSftp()
  const execute = createHandshakeExecutor(sftp, {
    endpointAfter: 'sftp-session-2',
    response: 'f'.repeat(64)
  })

  await assert.rejects(createPrivilegedStagingSession({
    sftp,
    execute,
    createToken: createTokenFactory()
  }), /响应|response|握手/i)
  assert.equal(sftp.calls.some(call => call[0] === 'rm'), false)
  assert.equal(sftp.calls.some(call => call[0] === 'removeEmptyDirectory'), false)
})

test('failed handshake cleans its known response and only its newly-created directories', async () => {
  const { createPrivilegedStagingSession } = await importModule(stagingModule)
  const sftp = createFakeSftp()
  const execute = createHandshakeExecutor(sftp, { throwAfterResponse: true })

  await assert.rejects(createPrivilegedStagingSession({
    sftp,
    execute,
    createToken: createTokenFactory()
  }), /transport failed/)
  assert.deepEqual([...sftp.nodes.keys()], ['/home/login'])
})

test('staging rejects escapes and endpoint changes without deleting foreign paths', async () => {
  const { createPrivilegedStagingSession } = await importModule(stagingModule)
  const sftp = createFakeSftp()
  const execute = createHandshakeExecutor(sftp)
  const session = await createPrivilegedStagingSession({
    sftp,
    execute,
    createToken: createTokenFactory()
  })
  const object = session.allocate('upload')
  sftp.nodes.set('/foreign/keep', {
    type: 'file', mode: 0o600, uid: 1000, gid: 1000, content: Buffer.from('keep')
  })

  assert.throws(() => session.allocate('../escape'), /direction|方向/i)
  assert.throws(() => session.remember('/foreign/keep'), /root|暂存|路径/i)
  await assert.rejects(session.cleanup(`${session.root}/../escape`), /root|暂存|路径/i)
  sftp.id = 'sftp-session-2'
  await assert.rejects(session.cleanup(object.path), /session|endpoint|会话|端点/i)
  assert.equal(sftp.nodes.get('/foreign/keep').content.toString(), 'keep')
  assert.equal(execute.requests.filter(request => request.operation === 'stage-cleanup').length, 0)
})

test('staging release continues cleanup after a partial failure and preserves the first error', async () => {
  const { createPrivilegedStagingSession } = await importModule(stagingModule)
  const sftp = createFakeSftp()
  const execute = createHandshakeExecutor(sftp)
  const session = await createPrivilegedStagingSession({
    sftp,
    execute,
    createToken: createTokenFactory()
  })
  const first = session.allocate('upload')
  const second = session.allocate('download')
  sftp.nodes.set(first.path, {
    type: 'file',
    mode: 0o600,
    uid: 1000,
    gid: 1000,
    content: Buffer.from('first'),
    failProtocolCleanup: true
  })
  sftp.nodes.set(second.path, {
    type: 'file',
    mode: 0o600,
    uid: 1000,
    gid: 1000,
    content: Buffer.from('second')
  })

  await assert.rejects(session.release(), /protocol cleanup failed/)
  assert.equal(execute.requests.some(request => (
    request.operation === 'stage-cleanup' &&
    request.args.objectName === second.objectName
  )), true)
  await assert.rejects(session.release(), /protocol cleanup failed/)
})
