const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { importModule } = require('./helpers/import-esm')

const capabilityModule =
  'src/client/components/sftp/remote-file-capability.js'
const productionRemoteFileMethods = Object.freeze([
  'list',
  'lstat',
  'stat',
  'readlink',
  'realpath',
  'readFile',
  'readFileChunk',
  'writeFile',
  'mkdir',
  'touch',
  'rename',
  'rm',
  'rmdir',
  'chmod',
  'chown',
  'copyEntry',
  'removeEntry',
  'cp',
  'mv',
  'describeRecoveryEntry',
  'describeResumeEntry'
])

function sha256 (value) {
  return createHash('sha256').update(value).digest('hex')
}

function deferred () {
  let resolveDeferred
  let rejectDeferred
  const promise = new Promise((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })
  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred
  }
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
  executeRequest,
  releaseResult = true,
  failProbeAfter = Infinity,
  probeGate,
  onProbeStart
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
            onProbeStart?.()
            if (probeGate) await probeGate.promise
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
          if (executeRequest) return executeRequest(request, options)
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

async function acquireWithHarness ({
  terminalOptions,
  tabOptions,
  sftpOptions,
  mutateSftp
} = {}) {
  const { acquireRemoteFileCapability } = await importModule(capabilityModule)
  const fake = createFakeSftp(sftpOptions)
  mutateSftp?.(fake.sftp)
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

test('lease state is acquired before delayed probe resolves and released with root capability', async () => {
  const { acquireRemoteFileCapability } = await importModule(capabilityModule)
  const fake = createFakeSftp()
  currentSftpNodes = fake.nodes
  const probeGate = deferred()
  const probeStarted = deferred()
  const events = []
  const terminal = createTerminalStub({
    probeGate,
    onProbeStart: () => probeStarted.resolve()
  })
  let capabilityResolved = false
  const acquiring = acquireRemoteFileCapability({
    operationId: 'delayed-root-probe',
    tab: tab(),
    sftp: fake.sftp,
    getTerminal: () => terminal,
    onLeaseState: event => events.push(event)
  }).then(capability => {
    capabilityResolved = true
    return capability
  })

  await probeStarted.promise
  assert.equal(capabilityResolved, false)
  assert.deepEqual(events.map(event => event.state), ['acquired'])

  probeGate.resolve()
  const capability = await acquiring
  assert.equal(capability.channel, 'pty-root')
  assert.deepEqual(events.map(event => event.state), ['acquired'])
  await capability.release()
  assert.deepEqual(events.map(event => event.state), ['acquired', 'released'])
  assert.equal(events[1].error, undefined)
  await capability.release()
  assert.deepEqual(events.map(event => event.state), ['acquired', 'released'])
  assert.equal(terminal.releaseCount, 1)
})

test('native and failed acquisitions settle the observed lease exactly once', async t => {
  const { acquireRemoteFileCapability } = await importModule(capabilityModule)

  await t.test('native SFTP', async () => {
    const fake = createFakeSftp()
    currentSftpNodes = fake.nodes
    const terminal = createTerminalStub({
      identity: { uid: '1000', username: 'hik' }
    })
    const events = []
    const capability = await acquireRemoteFileCapability({
      operationId: 'native-observed-lease',
      tab: tab(),
      sftp: fake.sftp,
      getTerminal: () => terminal,
      onLeaseState: event => events.push(event)
    })

    assert.equal(capability.channel, 'sftp')
    assert.deepEqual(events.map(event => event.state), ['acquired', 'released'])
    await capability.release()
    assert.deepEqual(events.map(event => event.state), ['acquired', 'released'])
  })

  await t.test('probe failure and throwing UI hook', async () => {
    const fake = createFakeSftp()
    currentSftpNodes = fake.nodes
    const terminal = createTerminalStub({
      executeError: new Error('probe failed')
    })
    const events = []
    await assertUnavailable(acquireRemoteFileCapability({
      operationId: 'failed-observed-lease',
      tab: tab(),
      sftp: fake.sftp,
      getTerminal: () => terminal,
      onLeaseState: event => {
        events.push(event)
        throw new Error('UI hook failed')
      }
    }), /probe failed/)

    assert.deepEqual(events.map(event => event.state), ['acquired', 'released'])
    assert.equal(terminal.releaseCount, 1)
  })

  await t.test('root release failure', async () => {
    const fake = createFakeSftp()
    currentSftpNodes = fake.nodes
    const terminal = createTerminalStub({ releaseResult: false })
    const events = []
    const capability = await acquireRemoteFileCapability({
      operationId: 'failed-root-release-observed-lease',
      tab: tab(),
      sftp: fake.sftp,
      getTerminal: () => terminal,
      onLeaseState: event => events.push(event)
    })

    await assert.rejects(capability.release(), /释放|租约/i)
    await assert.rejects(capability.release(), /释放|租约/i)
    assert.deepEqual(events.map(event => event.state), ['acquired', 'released'])
    assert.match(events[1].error?.message || '', /释放|租约/i)
    assert.equal(terminal.releaseCount, 1)
  })
})

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

test('post-construction publication failure releases root capability exactly once', async () => {
  const { acquireRemoteFileCapability } = await importModule(capabilityModule)
  const fake = createFakeSftp()
  currentSftpNodes = fake.nodes
  const terminal = createTerminalStub()

  await assertUnavailable(acquireRemoteFileCapability({
    operationId: 'root-publication-failure',
    tab: tab(),
    sftp: fake.sftp,
    getTerminal: () => terminal,
    onIdentity: () => { throw new Error('identity publication failed') }
  }), /publication/i)

  assert.equal(terminal.releaseCount, 1)
  assert.equal(terminal.owner(), '')
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
  const privateSymbol = Symbol('stale private transport')
  const harness = await acquireWithHarness({
    terminalOptions: {
      identity: { uid: '1000', username: 'hik' },
      endpoint: () => terminalEndpoint({ sshSessionGeneration: generation })
    },
    sftpOptions: {
      ws: { send () { throw new Error('stale raw ws used') } },
      staging: { release () { throw new Error('stale staging used') } },
      [privateSymbol]: () => { throw new Error('stale symbol used') }
    }
  })
  generation = 'ssh-generation-2'

  await assertUnavailable(
    harness.capability.sftp.list('/home/hik'),
    /generation|endpoint|会话|连接/i
  )
  await assertCapabilityReleased(
    harness.capability.sftp.mkdir('/home/hik/after-stale')
  )
  assertOpaqueFileFacade(harness.capability.sftp, privateSymbol)
  assert.equal(harness.capability.staging, undefined)
  assert.equal(await harness.capability.release(), true)
})

function assertCapabilityReleased (promise) {
  return assert.rejects(promise, error => {
    assert.equal(error.code, 'REMOTE_FILE_CAPABILITY_RELEASED')
    assert.equal(error.name, 'RemoteFileCapabilityReleasedError')
    assert.match(error.message, /释放|关闭|released/i)
    return true
  })
}

test('native and root capabilities reject every new operation after release', async t => {
  for (const [label, terminalOptions] of [
    ['native', { identity: { uid: '1000', username: 'hik' } }],
    ['root', {}]
  ]) {
    await t.test(label, async () => {
      const harness = await acquireWithHarness({
        terminalOptions,
        sftpOptions: { ws: { send () { throw new Error('raw ws used') } } }
      })
      const capturedList = harness.capability.sftp.list
      await harness.capability.release()

      await assertCapabilityReleased(
        harness.capability.backend.mkdir('/home/hik/after-release')
      )
      await assertCapabilityReleased(
        harness.capability.sftp.list('/home/hik')
      )
      await assertCapabilityReleased(capturedList('/home/hik'))
      if (label === 'native') {
        await assertCapabilityReleased(
          harness.capability.sftp.readFileChunk('/home/hik/file')
        )
        assert.equal(harness.capability.sftp.ws, undefined)
        assert.equal(harness.capability.sftp.createExclusiveFile, undefined)
        assert.equal(harness.capability.sftp.removeEmptyDirectory, undefined)
      }
    })
  }
})

test('capability facade exposes only production methods and maps self returns', async () => {
  const harness = await acquireWithHarness({
    terminalOptions: { identity: { uid: '1000', username: 'hik' } },
    sftpOptions: {
      list () {
        return this
      }
    }
  })

  assert.equal(harness.capability.backend, harness.capability.sftp)
  assert.notEqual(harness.capability.backend, harness.sftp)
  assert.equal(harness.capability.backend.id, undefined)
  assert.equal(
    await harness.capability.backend.list('/home/hik'),
    harness.capability.backend
  )
  await harness.capability.release()
})

function assertOpaqueFileFacade (facade, privateSymbol) {
  assert.equal(Object.getPrototypeOf(facade), null)
  assert.deepEqual(Object.getOwnPropertySymbols(facade), [])
  for (const property of [
    'ws',
    'staging',
    'lease',
    'controller',
    'constructor',
    '__proto__',
    'valueOf',
    'toJSON',
    'openReadStream',
    'createExclusiveFile',
    'removeEmptyDirectory'
  ]) {
    assert.equal(facade[property], undefined, property)
  }
  assert.equal(facade[privateSymbol], undefined)
  assert.equal(facade[Symbol.iterator], undefined)
}

test('native facade allowlists production methods and hides transport internals', async () => {
  const privateSymbol = Symbol('private sftp transport')
  const methodOverrides = Object.fromEntries(
    productionRemoteFileMethods.map(name => [name, async () => name])
  )
  const harness = await acquireWithHarness({
    terminalOptions: { identity: { uid: '1000', username: 'hik' } },
    sftpOptions: {
      ...methodOverrides,
      ws: { send () { throw new Error('raw ws used') } },
      staging: { release () { throw new Error('raw staging used') } },
      lease: { release () { throw new Error('raw lease used') } },
      controller: { execute () { throw new Error('raw controller used') } },
      openReadStream () { return this },
      toJSON () { return this },
      valueOf () { return this },
      constructor: function PrivateSftpConstructor () {},
      ['__proto__']: { raw: true },
      [privateSymbol]: () => { throw new Error('raw symbol used') },
      [Symbol.iterator]: function * rawIterator () { yield this }
    }
  })

  assert.deepEqual(
    Object.keys(harness.capability.backend).sort(),
    [...productionRemoteFileMethods].sort()
  )
  assert.deepEqual(Object.keys(harness.capability).sort(), [
    'backend',
    'channel',
    'release',
    'runtimeIdentity',
    'sftp'
  ])
  for (const method of productionRemoteFileMethods) {
    assert.equal(typeof harness.capability.backend[method], 'function', method)
  }
  assertOpaqueFileFacade(harness.capability.backend, privateSymbol)
  await harness.capability.release()
  assertOpaqueFileFacade(harness.capability.backend, privateSymbol)
})

test('facade never promotes an allowed method name from the raw prototype', async () => {
  const harness = await acquireWithHarness({
    terminalOptions: { identity: { uid: '1000', username: 'hik' } },
    mutateSftp: sftp => Object.setPrototypeOf(sftp, {
      upload () { return this }
    })
  })

  assert.equal(harness.capability.backend.upload, undefined)
  assert.equal(Object.getPrototypeOf(harness.capability.backend), null)
  await harness.capability.release()
})

test('Task4 native capability never exposes raw transfer handles', async () => {
  let uploadCalls = 0
  let downloadCalls = 0
  const rawHandle = Object.freeze({
    pause () {},
    resume () {},
    cancel () {},
    destroy () {}
  })
  const harness = await acquireWithHarness({
    terminalOptions: { identity: { uid: '1000', username: 'hik' } },
    sftpOptions: {
      async upload () {
        uploadCalls += 1
        return rawHandle
      },
      async download () {
        downloadCalls += 1
        return rawHandle
      }
    }
  })

  assert.equal(harness.capability.backend.upload, undefined)
  assert.equal(harness.capability.backend.download, undefined)
  assert.equal(Reflect.ownKeys(harness.capability.backend).includes('upload'), false)
  assert.equal(Reflect.ownKeys(harness.capability.backend).includes('download'), false)
  assert.equal(await harness.capability.backend.upload?.({}), undefined)
  assert.equal(await harness.capability.backend.download?.({}), undefined)
  assert.equal(uploadCalls, 0)
  assert.equal(downloadCalls, 0)
  await harness.capability.release()
  assert.equal(uploadCalls, 0)
  assert.equal(downloadCalls, 0)
})

test('Task7 derives an opaque transfer session without reopening the Task4 facade', async () => {
  const { createRemoteFileTransferCapability } = await importModule(
    capabilityModule
  )
  let uploadOptions
  let releaseOuterEnd
  const outerEndGate = new Promise(resolve => { releaseOuterEnd = resolve })
  const rawHandle = {
    pause () { throw new Error('pause should be blocked while closing') },
    resume () { throw new Error('resume should be blocked while closing') },
    cancel () { throw new Error('completed transfer should not be cancelled') },
    interrupt () { throw new Error('completed transfer should not be interrupted') },
    destroy () { throw new Error('completed transfer should not be destroyed') }
  }
  const harness = await acquireWithHarness({
    terminalOptions: { identity: { uid: '1000', username: 'hik' } },
    sftpOptions: {
      async upload (options) {
        uploadOptions = options
        return rawHandle
      },
      async download () {
        throw new Error('download should not run')
      }
    }
  })

  const transfer = createRemoteFileTransferCapability(harness.capability)
  assert.equal(harness.capability.backend.upload, undefined)
  assert.equal(Object.getPrototypeOf(transfer), null)
  assert.equal(Object.getPrototypeOf(transfer.backend), null)
  assert.equal(Object.isFrozen(transfer), true)
  assert.equal(Object.isFrozen(transfer.backend), true)
  assert.deepEqual(Object.getOwnPropertySymbols(transfer), [])
  assert.deepEqual(Object.getOwnPropertySymbols(transfer.backend), [])
  assert.equal(transfer.backend, transfer.sftp)
  assert.equal(typeof transfer.backend.upload, 'function')
  assert.equal(typeof transfer.backend.download, 'function')
  assert.equal(transfer.backend.ws, undefined)

  const events = []
  const handle = await transfer.backend.upload({
    remotePath: '/home/hik/app.conf',
    localPath: 'C:\\tmp\\app.conf',
    onEnd: async () => {
      events.push('outer-end-start')
      await outerEndGate
      events.push('outer-end-finished')
    }
  })
  assert.equal(Object.getPrototypeOf(handle), null)
  assert.equal(Object.isFrozen(handle), true)
  assert.deepEqual(Object.keys(handle).sort(), [
    'cancel', 'destroy', 'interrupt', 'pause', 'resume'
  ])
  assert.deepEqual(Object.getOwnPropertySymbols(handle), [])
  assert.equal(handle.raw, undefined)

  const outerEnd = uploadOptions.onEnd({ transferred: 7 })
  await new Promise(resolve => setImmediate(resolve))
  const releasing = transfer.release()
  let released = false
  releasing.then(() => { released = true })
  await Promise.resolve()
  assert.equal(released, false)
  assert.equal(harness.terminal.releaseCount, 1)
  await assert.rejects(handle.pause(), error => {
    assert.equal(error.code, 'REMOTE_FILE_CAPABILITY_RELEASED')
    return true
  })

  releaseOuterEnd()
  await outerEnd
  assert.equal(await releasing, true)
  assert.deepEqual(events, ['outer-end-start', 'outer-end-finished'])
})

test('Task7 release cancels and joins an active transfer before releasing once', async () => {
  const { createRemoteFileTransferCapability } = await importModule(
    capabilityModule
  )
  let releaseCancel
  const cancelGate = new Promise(resolve => { releaseCancel = resolve })
  let cancelCount = 0
  const harness = await acquireWithHarness({
    terminalOptions: { identity: { uid: '1000', username: 'hik' } },
    sftpOptions: {
      async upload () {
        return {
          pause () {},
          resume () {},
          async cancel () {
            cancelCount += 1
            await cancelGate
          },
          interrupt () {},
          destroy () {}
        }
      }
    }
  })
  const transfer = createRemoteFileTransferCapability(harness.capability)
  await transfer.backend.upload({
    remotePath: '/home/hik/app.conf',
    localPath: 'C:\\tmp\\app.conf'
  })

  const first = transfer.release()
  const second = transfer.release()
  assert.equal(first, second)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(cancelCount, 1)
  assert.equal(harness.terminal.releaseCount, 1)
  releaseCancel()
  assert.equal(await first, true)
  assert.equal(harness.terminal.releaseCount, 1)
})

test('Task7 transfer controls fail closed and cancel on SSH generation change', async () => {
  const { createRemoteFileTransferCapability } = await importModule(
    capabilityModule
  )
  let generation = 'ssh-generation-1'
  let cancelCount = 0
  const harness = await acquireWithHarness({
    terminalOptions: {
      identity: { uid: '1000', username: 'hik' },
      endpoint: () => terminalEndpoint({
        sshSessionGeneration: generation
      })
    },
    sftpOptions: {
      async download () {
        return {
          pause () {},
          resume () {},
          cancel () { cancelCount += 1 },
          interrupt () {},
          destroy () {}
        }
      }
    }
  })
  const transfer = createRemoteFileTransferCapability(harness.capability)
  const handle = await transfer.backend.download({
    remotePath: '/home/hik/app.conf',
    localPath: 'C:\\tmp\\app.conf'
  })

  generation = 'ssh-generation-2'
  await assert.rejects(handle.pause(), error => {
    assert.equal(error.code, 'REMOTE_FILE_IDENTITY_UNAVAILABLE')
    return true
  })
  assert.equal(cancelCount, 1)
  assert.equal(await transfer.release(), true)
  assert.equal(harness.terminal.releaseCount, 1)
})

test('Task7 stale generation before transfer start releases without self-wait', async () => {
  const { createRemoteFileTransferCapability } = await importModule(
    capabilityModule
  )
  let generation = 'ssh-generation-1'
  let downloadCount = 0
  const harness = await acquireWithHarness({
    terminalOptions: {
      identity: { uid: '1000', username: 'hik' },
      endpoint: () => terminalEndpoint({
        sshSessionGeneration: generation
      })
    },
    sftpOptions: {
      async download () {
        downloadCount += 1
        throw new Error('stale transfer must not start')
      }
    }
  })
  const transfer = createRemoteFileTransferCapability(harness.capability)
  generation = 'ssh-generation-2'

  const stale = transfer.backend.download({
    remotePath: '/home/hik/app.conf',
    localPath: 'C:\\tmp\\app.conf'
  })
  const result = await Promise.race([
    stale.then(
      value => ({ value }),
      error => ({ error })
    ),
    new Promise(resolve => setTimeout(
      () => resolve({ timeout: true }),
      250
    ))
  ])

  assert.equal(result.timeout, undefined, 'stale guard must not self-wait')
  assert.equal(result.error?.code, 'REMOTE_FILE_IDENTITY_UNAVAILABLE')
  assert.equal(downloadCount, 0)
  assert.equal(await transfer.release(), true)
  assert.equal(harness.terminal.releaseCount, 1)
})

test('Task7 transfer combines caller abort with capability cancellation', async () => {
  const { createRemoteFileTransferCapability } = await importModule(
    capabilityModule
  )
  let uploadCount = 0
  let cancelCount = 0
  const harness = await acquireWithHarness({
    terminalOptions: { identity: { uid: '1000', username: 'hik' } },
    sftpOptions: {
      async upload () {
        uploadCount += 1
        return {
          pause () {},
          resume () {},
          cancel () { cancelCount += 1 },
          interrupt () {},
          destroy () {}
        }
      }
    }
  })
  const transfer = createRemoteFileTransferCapability(harness.capability)
  const alreadyAborted = new AbortController()
  const abortReason = new Error('caller cancelled before start')
  alreadyAborted.abort(abortReason)

  await assert.rejects(transfer.backend.upload({
    signal: alreadyAborted.signal,
    remotePath: '/home/hik/not-started.bin',
    localPath: 'C:\\tmp\\not-started.bin'
  }), error => error === abortReason)
  assert.equal(uploadCount, 0)

  const activeController = new AbortController()
  await transfer.backend.upload({
    signal: activeController.signal,
    remotePath: '/home/hik/active.bin',
    localPath: 'C:\\tmp\\active.bin'
  })
  activeController.abort(new Error('caller cancelled active transfer'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(uploadCount, 1)
  assert.equal(cancelCount, 1)
  assert.equal(await transfer.release(), true)
})

test('Task7 terminal control claims before native acknowledgement and suppresses natural end', async () => {
  const { createRemoteFileTransferCapability } = await importModule(
    capabilityModule
  )
  let uploadOptions
  let releaseCancel
  const cancelGate = new Promise(resolve => { releaseCancel = resolve })
  let cancelCount = 0
  let endCount = 0
  const harness = await acquireWithHarness({
    terminalOptions: { identity: { uid: '1000', username: 'hik' } },
    sftpOptions: {
      async upload (options) {
        uploadOptions = options
        return {
          pause () {},
          resume () {},
          async cancel () {
            cancelCount += 1
            await cancelGate
          },
          interrupt () {},
          destroy () {}
        }
      }
    }
  })
  const transfer = createRemoteFileTransferCapability(harness.capability)
  const handle = await transfer.backend.upload({
    remotePath: '/home/hik/race.bin',
    localPath: 'C:\\tmp\\race.bin',
    onEnd: () => { endCount += 1 }
  })

  const cancelling = handle.cancel()
  const naturalEnd = uploadOptions.onEnd({ transferred: 1 })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(cancelCount, 1)
  assert.equal(endCount, 0)
  releaseCancel()
  assert.equal(await cancelling, true)
  assert.equal(await naturalEnd, true)
  assert.equal(await transfer.release(), true)
})

test('root capability hides staging and exposes only the current backend contract', async () => {
  const harness = await acquireWithHarness()
  const rootMethods = [...productionRemoteFileMethods]

  assert.equal(Object.getPrototypeOf(harness.capability), null)
  assert.equal(harness.capability.staging, undefined)
  assert.equal(harness.capability.constructor, undefined)
  assert.equal(Reflect.get(harness.capability, '__proto__'), undefined)
  assert.equal(harness.capability.valueOf, undefined)
  assert.deepEqual(Object.getOwnPropertySymbols(harness.capability), [])
  assert.deepEqual(
    Object.keys(harness.capability.backend).sort(),
    rootMethods.sort()
  )
  assert.deepEqual(Object.keys(harness.capability).sort(), [
    'backend',
    'capabilities',
    'channel',
    'release',
    'runtimeIdentity',
    'sftp'
  ])
  assertOpaqueFileFacade(harness.capability.backend, Symbol('absent'))
  await harness.capability.release()
  assert.equal(harness.terminal.releaseCount, 1)
})

test('concurrent capability release shares one promise and releases root lease once', async () => {
  const harness = await acquireWithHarness()

  const first = harness.capability.release()
  const second = harness.capability.release()

  assert.equal(first, second)
  assert.equal(await first, true)
  assert.equal(harness.terminal.releaseCount, 1)
})

test('release waits for active operations and rejects operations started while closing', async () => {
  let resolveRealpath
  let markRealpathStarted
  const realpathStarted = new Promise(resolve => { markRealpathStarted = resolve })
  const harness = await acquireWithHarness({
    terminalOptions: {
      executeRequest: request => {
        if (request.operation !== 'realpath') {
          throw new Error(`unexpected deferred request: ${request.operation}`)
        }
        markRealpathStarted()
        return new Promise(resolve => { resolveRealpath = resolve })
      }
    }
  })
  const active = harness.capability.backend.realpath('/home/hik')
  await realpathStarted

  const release = harness.capability.release()
  assert.equal(harness.terminal.releaseCount, 0)
  await assertCapabilityReleased(harness.capability.backend.list('/home/hik'))
  assert.equal(harness.terminal.releaseCount, 0)

  resolveRealpath({
    exitCode: 0,
    identity: { uid: '0', username: 'root' },
    kind: 'realpath',
    text: '/home/hik'
  })
  assert.equal(await active, '/home/hik')
  assert.equal(await release, true)
  assert.equal(harness.terminal.releaseCount, 1)
})

test('release preserves the first active operation error while still closing', async () => {
  let rejectList
  let markListStarted
  const listStarted = new Promise(resolve => { markListStarted = resolve })
  const operationFailure = new Error('active list failed first')
  const harness = await acquireWithHarness({
    terminalOptions: { identity: { uid: '1000', username: 'hik' } },
    sftpOptions: {
      list () {
        markListStarted()
        return new Promise((resolve, reject) => { rejectList = reject })
      }
    }
  })
  const active = harness.capability.backend.list('/home/hik')
  await listStarted
  const release = harness.capability.release()
  const activeRejection = assert.rejects(
    active,
    error => error === operationFailure
  )

  rejectList(operationFailure)
  await activeRejection
  assert.equal(await release, true)
  await assertCapabilityReleased(harness.capability.backend.list('/home/hik'))
})

test('release gate wins over a later stale generation and preserves release failure', async () => {
  let generation = 'ssh-generation-1'
  const releaseFailure = new Error('inner release failed first')
  const harness = await acquireWithHarness({
    terminalOptions: {
      endpoint: () => terminalEndpoint({ sshSessionGeneration: generation }),
      releaseResult: releaseFailure
    }
  })
  const firstRelease = harness.capability.release()
  generation = 'ssh-generation-2'

  await assert.rejects(firstRelease, error => error === releaseFailure)
  assert.equal(harness.capability.release(), firstRelease)
  await assertCapabilityReleased(harness.capability.backend.list('/home/hik'))
  assert.equal(harness.terminal.releaseCount, 1)
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
