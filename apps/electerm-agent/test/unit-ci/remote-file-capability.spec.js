const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { importModule } = require('./helpers/import-esm')

const capabilityModule =
  'src/client/components/sftp/remote-file-capability.js'

function sha256 (value) {
  return createHash('sha256').update(value).digest('hex')
}

function tab (overrides = {}) {
  return {
    id: 'tab-1',
    host: 'prod.example.com',
    port: 2222,
    username: 'hik',
    type: 'ssh',
    hostKeyFingerprint: 'SHA256:one',
    ...overrides
  }
}

function terminalEndpoint (overrides = {}) {
  return {
    tabId: 'tab-1',
    host: 'prod.example.com',
    port: 2222,
    username: 'hik',
    connectionUsername: 'hik',
    pid: 'tab-1',
    terminalPid: 'tab-1',
    sshTerminalPid: 4242,
    sshSessionGeneration: 'ssh-generation-1',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:one',
    ...overrides
  }
}

function missing (remotePath) {
  const error = new Error(`missing: ${remotePath}`)
  error.code = 'ENOENT'
  return error
}

function createFakeSftp (overrides = {}) {
  const home = '/home/hik'
  const nodes = new Map([[home, {
    type: 'directory',
    mode: 0o700,
    uid: 1000,
    gid: 1000
  }]])
  const sftp = {
    id: 'sftp-1',
    terminalId: 'tab-1',
    port: 41001,
    type: 'sftp',
    sshSessionGeneration: 'ssh-generation-1',
    sshTerminalPid: 4242,
    async getHomeDir () { return home },
    async realpath (remotePath) { return remotePath || home },
    async lstat (remotePath) {
      const node = nodes.get(remotePath)
      if (!node) throw missing(remotePath)
      return {
        mode: (node.type === 'directory' ? 0o040000 : 0o100000) | node.mode,
        size: node.type === 'file' ? node.content.length : 0,
        uid: node.uid,
        gid: node.gid,
        isDirectory: node.type === 'directory'
      }
    },
    async list (remotePath) {
      const prefix = `${remotePath}/`
      return [...nodes.keys()]
        .filter(candidate => candidate.startsWith(prefix) &&
          !candidate.slice(prefix.length).includes('/'))
        .map(candidate => ({ name: candidate.slice(prefix.length) }))
    },
    async mkdir (remotePath, attrs = {}) {
      if (nodes.has(remotePath)) throw new Error('Already exists')
      nodes.set(remotePath, {
        type: 'directory',
        mode: attrs.mode ?? 0o700,
        uid: 1000,
        gid: 1000
      })
      return 1
    },
    async createExclusiveFile (remotePath, base64, mode) {
      if (nodes.has(remotePath)) throw new Error('Target exists')
      nodes.set(remotePath, {
        type: 'file',
        mode,
        uid: 1000,
        gid: 1000,
        content: Buffer.from(base64, 'base64')
      })
      return 1
    },
    async readFileChunk (remotePath, options = {}) {
      const node = nodes.get(remotePath)
      if (!node) throw missing(remotePath)
      const offset = options.offset || 0
      const bytes = node.content.subarray(offset, offset + options.maxBytes)
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
      if ([...nodes.keys()].some(candidate => candidate.startsWith(`${remotePath}/`))) {
        throw new Error('Directory not empty')
      }
      if (!nodes.has(remotePath)) throw missing(remotePath)
      nodes.delete(remotePath)
      return 1
    },
    ...overrides
  }
  return { sftp, nodes }
}

function createTerminalStub ({
  endpoint = terminalEndpoint(),
  identity = { uid: '0', username: 'root' },
  acquireError,
  executeError,
  releaseResult = true,
  failProbeAfter = Infinity
} = {}) {
  let owner = ''
  let releaseCount = 0
  let acquireCount = 0
  let probeCount = 0
  const requests = []

  return {
    getTerminalSafetyEndpoint: () => typeof endpoint === 'function'
      ? endpoint()
      : endpoint,
    async acquireRemoteFilePtyTask (ownerId) {
      acquireCount += 1
      if (acquireError) throw acquireError
      owner = `root-file:${ownerId}`
      return Object.freeze({
        async execute (request, options = {}) {
          requests.push({ request, options })
          if (request.operation === 'probe') {
            probeCount += 1
            if (executeError || probeCount > failProbeAfter) {
              throw executeError || new Error('stale identity probe failed')
            }
            const resultIdentity = typeof identity === 'function'
              ? identity(probeCount)
              : identity
            return {
              exitCode: resultIdentity?.exitCode ?? 0,
              identity: resultIdentity?.identity || resultIdentity,
              kind: 'probe',
              capabilities: {
                sh: true,
                stat: true,
                base64: true,
                sha256: true
              }
            }
          }
          if (request.operation === 'stage-handshake') {
            const expectedResponse = sha256(`${request.args.challenge}:root`)
            const responsePath = `${request.args.rootPath}/${request.args.responseName}`
            currentSftpNodes.set(responsePath, {
              type: 'file',
              mode: 0o600,
              uid: 1000,
              gid: 1000,
              content: Buffer.from(expectedResponse)
            })
            return {
              exitCode: 0,
              identity: { uid: '0', username: 'root' },
              kind: 'stage-handshake',
              response: expectedResponse,
              uid: '1000',
              gid: '1000',
              mode: '700',
              rootRealPath: request.args.rootPath,
              rootDevice: '2049',
              rootInode: '777'
            }
          }
          if (request.operation === 'stage-cleanup') {
            currentSftpNodes.delete(
              `${request.args.rootPath}/${request.args.objectName}`
            )
            return {
              exitCode: 0,
              identity: { uid: '0', username: 'root' },
              kind: 'stage-cleanup',
              ok: true
            }
          }
          throw new Error(`unexpected request: ${request.operation}`)
        },
        async release () {
          releaseCount += 1
          if (releaseResult === true) owner = ''
          if (releaseResult instanceof Error) throw releaseResult
          return releaseResult
        }
      })
    },
    owner: () => owner,
    requests: () => requests,
    get releaseCount () { return releaseCount },
    get acquireCount () { return acquireCount }
  }
}

let currentSftpNodes

async function acquireWithHarness ({ terminalOptions, tabOptions, sftpOptions } = {}) {
  const { acquireRemoteFileCapability } = await importModule(capabilityModule)
  const fake = createFakeSftp(sftpOptions)
  currentSftpNodes = fake.nodes
  const terminal = createTerminalStub(terminalOptions)
  const identities = []
  const capability = await acquireRemoteFileCapability({
    operationId: 'file-op-1',
    tab: tab(tabOptions),
    sftp: fake.sftp,
    getTerminal: tabId => {
      assert.equal(tabId, 'tab-1')
      return terminal
    },
    onIdentity: value => identities.push(value)
  })
  return { capability, terminal, identities, ...fake }
}

async function assertUnavailable (promise, causePattern) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, 'REMOTE_FILE_IDENTITY_UNAVAILABLE')
    assert.equal(error.name, 'RemoteFileIdentityUnavailableError')
    assert.match(error.message, /无法确认当前.*文件.*身份/)
    if (causePattern) assert.match(error.cause?.message || '', causePattern)
    return true
  })
}

test('capability resolver pins root backend only to the exact SSH terminal', async () => {
  const { capability, terminal, identities } = await acquireWithHarness()

  assert.equal(capability.channel, 'pty-root')
  assert.deepEqual(capability.runtimeIdentity, {
    channel: 'pty-root',
    effectiveUid: '0',
    effectiveUsername: 'root'
  })
  assert.equal(capability.backend, capability.sftp)
  assert.equal(terminal.owner(), 'root-file:file-op-1')
  assert.deepEqual(identities, [{
    loginUsername: 'hik',
    effectiveUid: '0',
    effectiveUsername: 'root',
    channel: 'pty-root'
  }])
  assert.equal(await capability.release(), true)
  assert.equal(terminal.owner(), '')
})

test('capability resolver releases PTY and uses native SFTP after exit root', async () => {
  const { capability, terminal, sftp, identities } = await acquireWithHarness({
    terminalOptions: { identity: { uid: '1000', username: 'hik' } }
  })

  assert.equal(capability.channel, 'sftp')
  assert.equal(capability.backend, capability.sftp)
  assert.notEqual(capability.sftp, sftp)
  assert.equal(terminal.owner(), '')
  assert.equal(terminal.releaseCount, 1)
  assert.deepEqual(identities, [{
    loginUsername: 'hik',
    effectiveUid: '1000',
    effectiveUsername: 'hik',
    channel: 'sftp'
  }])
})

test('capability resolver rejects every SSH endpoint identity mismatch before leasing', async t => {
  const { acquireRemoteFileCapability } = await importModule(capabilityModule)
  const cases = [
    ['host', { host: 'other.example.com' }],
    ['port', { port: 22 }],
    ['username', { connectionUsername: 'root' }],
    ['tabId', { tabId: 'tab-other' }],
    ['PID', { pid: 'tab-other', terminalPid: 'tab-other' }],
    ['SSH PID', { sshTerminalPid: 4343 }],
    ['generation', { sshSessionGeneration: 'ssh-generation-2' }],
    ['fingerprint', { hostKeyFingerprint: 'SHA256:two' }]
  ]

  for (const [label, changed] of cases) {
    await t.test(label, async () => {
      const fake = createFakeSftp()
      const terminal = createTerminalStub({
        endpoint: terminalEndpoint(changed)
      })
      await assertUnavailable(acquireRemoteFileCapability({
        operationId: `mismatch-${label}`,
        tab: tab(),
        sftp: fake.sftp,
        getTerminal: () => terminal
      }), /端点|endpoint|主机|端口|用户|标签|进程|PID|generation|指纹/i)
      assert.equal(terminal.acquireCount, 0)
    })
  }
})

test('a zero terminal port is invalid instead of aliasing the SSH default', async () => {
  await assertUnavailable(acquireWithHarness({
    tabOptions: { port: 22 },
    terminalOptions: {
      endpoint: terminalEndpoint({ port: 0 })
    }
  }), /端口/i)
})

test('busy password TUI and tracking failures share one stable unavailable code', async t => {
  const cases = [
    ['busy', { acquireError: new Error('当前终端已有运维任务正在执行') }],
    ['password', { acquireError: new Error('当前终端正在等待密码') }],
    ['TUI', { acquireError: new Error('当前交互程序无法执行受控 PTY 运维任务') }],
    ['tracking', { executeError: new Error('无法建立 PTY 运维命令追踪') }]
  ]
  for (const [label, terminalOptions] of cases) {
    await t.test(label, async () => {
      await assertUnavailable(acquireWithHarness({ terminalOptions }),
        /运维任务|密码|交互程序|追踪/)
    })
  }
})

test('invalid probe identity and every lease failure fail closed', async t => {
  const cases = [
    ['missing identity', { identity: null }],
    ['blank uid', { identity: { uid: '', username: 'hik' } }],
    ['blank username', { identity: { uid: '0', username: '' } }],
    ['nonzero probe', {
      identity: { exitCode: 1, identity: { uid: '1000', username: 'hik' } }
    }],
    ['acquire failure', { acquireError: new Error('lease acquisition failed') }],
    ['release failure', {
      identity: { uid: '1000', username: 'hik' },
      releaseResult: false
    }]
  ]
  for (const [label, terminalOptions] of cases) {
    await t.test(label, async () => {
      await assertUnavailable(acquireWithHarness({ terminalOptions }),
        /身份|UID|用户名|identity|probe|lease|租约|释放/i)
    })
  }
})

test('root backend initialization failure transfers and releases the lease exactly once', async () => {
  const { acquireRemoteFileCapability } = await importModule(capabilityModule)
  const fake = createFakeSftp({ getHomeDir: undefined })
  currentSftpNodes = fake.nodes
  const terminal = createTerminalStub()
  const identities = []

  await assertUnavailable(acquireRemoteFileCapability({
    operationId: 'root-backend-init-failure',
    tab: tab(),
    sftp: fake.sftp,
    getTerminal: () => terminal,
    onIdentity: value => identities.push(value)
  }), /SFTP|暂存区|合同/i)

  assert.equal(terminal.releaseCount, 1)
  assert.equal(terminal.owner(), '')
  assert.deepEqual(identities, [])
})

test('non-root release failure publishes no unavailable capability identity', async () => {
  const { acquireRemoteFileCapability } = await importModule(capabilityModule)
  const fake = createFakeSftp()
  const terminal = createTerminalStub({
    identity: { uid: '1000', username: 'hik' },
    releaseResult: false
  })
  const identities = []

  await assertUnavailable(acquireRemoteFileCapability({
    operationId: 'native-release-failure',
    tab: tab(),
    sftp: fake.sftp,
    getTerminal: () => terminal,
    onIdentity: value => identities.push(value)
  }), /释放|租约/i)

  assert.equal(terminal.releaseCount, 1)
  assert.deepEqual(identities, [])
})

test('a failed current probe never falls back to a previously observed root identity', async () => {
  const first = await acquireWithHarness({
    terminalOptions: { failProbeAfter: 1 }
  })
  assert.equal(first.capability.channel, 'pty-root')
  await first.capability.release()

  currentSftpNodes = first.nodes
  await assertUnavailable((await importModule(capabilityModule))
    .acquireRemoteFileCapability({
      operationId: 'file-op-stale',
      tab: tab(),
      sftp: first.sftp,
      getTerminal: () => first.terminal
    }), /stale identity probe failed/)
  assert.equal(first.terminal.owner(), '')
})

test('generation change during identity probe releases the lease and fails closed', async () => {
  const { acquireRemoteFileCapability } = await importModule(capabilityModule)
  const fake = createFakeSftp()
  currentSftpNodes = fake.nodes
  let generation = 'ssh-generation-1'
  const terminal = createTerminalStub({
    endpoint: () => terminalEndpoint({ sshSessionGeneration: generation }),
    identity: () => {
      generation = 'ssh-generation-2'
      return { uid: '0', username: 'root' }
    }
  })

  await assertUnavailable(acquireRemoteFileCapability({
    operationId: 'generation-race',
    tab: tab(),
    sftp: fake.sftp,
    getTerminal: () => terminal
  }), /generation|endpoint|会话|连接/i)
  assert.equal(terminal.releaseCount, 1)
  assert.equal(terminal.owner(), '')
})

test('stale capability rejects file operations after SSH reconnect', async () => {
  let generation = 'ssh-generation-1'
  const harness = await acquireWithHarness({
    terminalOptions: {
      identity: { uid: '1000', username: 'hik' },
      endpoint: () => terminalEndpoint({ sshSessionGeneration: generation })
    }
  })
  generation = 'ssh-generation-2'

  await assertUnavailable(
    harness.capability.sftp.list('/home/hik'),
    /generation|endpoint|会话|连接/i
  )
  assert.equal(await harness.capability.release(), true)
})

test('safety transaction identity persists and strictly compares SSH generation', async () => {
  const {
    assertSameSessionEndpoint,
    projectEndpoint
  } = await importModule(
    'src/client/common/safety-transactions/endpoint-guard.js'
  )
  const { normalizeOperation } = await importModule(
    'src/client/common/safety-transactions/models.js'
  )
  const sshEndpoint = terminalEndpoint()
  assert.deepEqual(projectEndpoint(sshEndpoint), {
    host: 'prod.example.com',
    port: 2222,
    username: 'hik',
    tabId: 'tab-1',
    pid: 'tab-1',
    terminalPid: 'tab-1',
    sshTerminalPid: 4242,
    sshSessionGeneration: 'ssh-generation-1',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:one'
  })
  assert.throws(
    () => projectEndpoint({ ...sshEndpoint, sshSessionGeneration: '' }),
    error => error.code === 'INCOMPLETE_SSH_SESSION_IDENTITY'
  )

  const sftpEndpoint = {
    ...sshEndpoint,
    pid: 'sftp:tab-1:sftp-session-1',
    terminalPid: 'sftp-session-1',
    sshSessionGeneration: 'ssh-generation-1',
    sessionType: 'sftp'
  }
  const operation = normalizeOperation({
    id: 'sftp-endpoint-persistence',
    source: 'sftp',
    endpoint: sftpEndpoint
  })
  assert.equal(operation.endpoint.sshSessionGeneration, 'ssh-generation-1')
  assert.equal(operation.endpoint.sshTerminalPid, 4242)
  assert.equal(operation.endpoint.hostKeyFingerprint, 'SHA256:one')
  assert.doesNotThrow(() => assertSameSessionEndpoint(
    operation.endpoint,
    { ...sftpEndpoint }
  ))
  assert.throws(() => assertSameSessionEndpoint(
    operation.endpoint,
    { ...sftpEndpoint, sshSessionGeneration: 'ssh-generation-2' }
  ), /会话端点不一致/)
  assert.throws(() => assertSameSessionEndpoint(
    operation.endpoint,
    { ...sftpEndpoint, sshTerminalPid: 4343 }
  ), /会话端点不一致/)
  assert.throws(() => assertSameSessionEndpoint(
    {
      ...operation.endpoint,
      sshSessionGeneration: undefined
    },
    sftpEndpoint
  ), /会话端点不一致/)
  assert.throws(() => assertSameSessionEndpoint(
    { ...operation.endpoint, sshTerminalPid: undefined },
    sftpEndpoint
  ), /会话端点不一致/)
  const bothMissingGeneration = {
    ...operation.endpoint,
    sshSessionGeneration: undefined
  }
  assert.throws(() => assertSameSessionEndpoint(
    bothMissingGeneration,
    { ...bothMissingGeneration }
  ), /会话端点不一致/)
  const bothMissingTerminalPid = {
    ...operation.endpoint,
    sshTerminalPid: undefined
  }
  assert.throws(() => assertSameSessionEndpoint(
    bothMissingTerminalPid,
    { ...bothMissingTerminalPid }
  ), /会话端点不一致/)
  assert.throws(() => assertSameSessionEndpoint(
    operation.endpoint,
    { ...sftpEndpoint, hostKeyFingerprint: 'SHA256:two' }
  ), /会话端点不一致/)
})
