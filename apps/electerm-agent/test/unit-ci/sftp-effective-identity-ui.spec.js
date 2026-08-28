const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const { pathToFileURL } = require('node:url')
const { importModule } = require('./helpers/import-esm')

const agentRoot = path.resolve(__dirname, '../..')

function readSource (relativePath) {
  return fs.readFileSync(path.resolve(agentRoot, relativePath), 'utf8')
}

const entrySource = readSource('src/client/components/sftp/sftp-entry.jsx')
const entryAst = parser.parse(entrySource, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining']
})

function topLevelFunction (name, dependencies = {}) {
  let declaration
  traverse(entryAst, {
    FunctionDeclaration (nodePath) {
      if (nodePath.node.id?.name === name) declaration = nodePath.node
    }
  })
  assert.ok(declaration, `sftp-entry.jsx must define ${name}`)
  return vm.runInNewContext(`(${generate(declaration).code})`, dependencies)
}

function installClassField (entry, name, dependencies = {}) {
  let initializer
  traverse(entryAst, {
    ClassProperty (nodePath) {
      if (nodePath.node.key?.name === name) initializer = nodePath.node.value
    }
  })
  assert.ok(initializer, `sftp-entry.jsx must define ${name}`)
  const resolveRemoteFileStatus = topLevelFunction('resolveRemoteFileStatus')
  entry[name] = vm.runInNewContext(`
    (function installClassField () {
      return (${generate(initializer).code})
    }).call(__entry)
  `, { __entry: entry, resolveRemoteFileStatus, ...dependencies })
  return entry[name]
}

function createEntryStateHarness () {
  return {
    props: { tab: { username: 'hik' } },
    state: {
      remoteFileIdentity: {
        loginUsername: 'hik',
        effectiveUid: '',
        effectiveUsername: '',
        channel: 'unknown'
      },
      remoteFileStatus: 'idle'
    },
    activeRemoteFileLeases: new Set(),
    uncertainRemoteFileLeases: new Set(),
    setState (update) {
      const patch = typeof update === 'function'
        ? update(this.state)
        : update
      if (patch) this.state = { ...this.state, ...patch }
    }
  }
}

function formatTemplate (translate, key, variables) {
  return Object.entries(variables || {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    translate(key)
  )
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

function createAsyncEntryHarness () {
  const entry = createEntryStateHarness()
  entry.props.tab = { id: 'tab-1', username: 'hik' }
  entry.sftp = { id: 'sftp-1' }
  entry.sftpLifecycleEpoch = 1
  entry.sshSessionGeneration = 'generation-1'
  entry.sshTerminalPid = '4242'
  entry.remoteFileOperationSequence = 0
  entry.remoteFileUnmounted = false
  entry.remoteFileIdentityEpoch = 0
  entry.activeRemoteFileLeases = new Set()
  entry.uncertainRemoteFileLeases = new Set()
  entry.remoteFileGeneration = {
    accepting: true,
    capabilities: new Set(),
    settlements: new Set(),
    backends: new Map(),
    tail: Promise.resolve()
  }
  return entry
}

function installRemoteFileIdentityLifecycle (entry) {
  installClassField(entry, 'captureRemoteFileIdentityToken')
  installClassField(entry, 'isCurrentRemoteFileIdentityToken', {
    isCurrentRemoteFileGeneration: (current, generation) => (
      current.remoteFileGeneration === generation
    )
  })
  installClassField(entry, 'invalidateRemoteFileIdentity')
  return entry.captureRemoteFileIdentityToken()
}

test('remote panel shows login and effective file identities without rewriting the tab', () => {
  assert.match(entrySource, /remoteFileIdentity/)
  assert.match(entrySource, /shellpilotSftpLoginIdentity/)
  assert.match(entrySource, /shellpilotSftpEffectiveFileIdentity/)
  assert.match(entrySource, /sftp-panel-identities/)
  assert.doesNotMatch(entrySource, /tab\.username\s*=\s*.*effective/)
})

test('effective identity formatting covers native SFTP, current root terminal, and unknown', () => {
  const copy = {
    shellpilotSftpEffectiveFileIdentity: 'File operations: {username} ({channel})',
    shellpilotSftpEffectiveFileIdentityUnknown: 'File operations: Unknown',
    shellpilotSftpCurrentTerminal: 'current terminal',
    shellpilotSftpNativeChannel: 'SFTP'
  }
  const formatEffectiveFileIdentity = topLevelFunction(
    'formatEffectiveFileIdentity',
    { formatShellPilotTranslation: formatTemplate }
  )
  const translate = key => copy[key] || key

  assert.equal(formatEffectiveFileIdentity({
    effectiveUsername: 'hik',
    channel: 'sftp'
  }, translate), 'File operations: hik (SFTP)')
  assert.equal(formatEffectiveFileIdentity({
    effectiveUsername: 'root',
    channel: 'pty-root'
  }, translate), 'File operations: root (current terminal)')
  assert.equal(formatEffectiveFileIdentity({
    effectiveUsername: '',
    channel: 'unknown'
  }, translate), 'File operations: Unknown')
})

test('remote file status is derived from live leases and acquisition availability', () => {
  const resolveRemoteFileStatus = topLevelFunction('resolveRemoteFileStatus')

  assert.equal(resolveRemoteFileStatus(), 'idle')
  assert.equal(resolveRemoteFileStatus({ rootLeaseCount: 1 }), 'busy')
  assert.equal(resolveRemoteFileStatus({ unavailable: true }), 'unavailable')
  assert.equal(resolveRemoteFileStatus({
    rootLeaseCount: 1,
    releaseUncertain: true
  }), 'uncertain')
  assert.equal(resolveRemoteFileStatus({
    rootLeaseCount: 1,
    unavailable: true
  }), 'busy')
})

test('entry becomes busy from the real async lease callback before identity resolves', async () => {
  const entry = createAsyncEntryHarness()
  const probeGate = deferred()
  const leaseObserved = deferred()
  let leaseCallback
  const acquireRemoteFileCapability = async options => {
    leaseCallback = options.onLeaseState
    options.onLeaseState({ state: 'acquired', operationId: options.operationId })
    leaseObserved.resolve()
    await probeGate.promise
    options.onIdentity({
      loginUsername: 'hik',
      effectiveUid: '0',
      effectiveUsername: 'root',
      channel: 'pty-root'
    })
    return {
      channel: 'pty-root',
      backend: {},
      async release () {
        options.onLeaseState({
          state: 'released',
          operationId: options.operationId
        })
        return true
      }
    }
  }
  installRemoteFileIdentityLifecycle(entry)
  installClassField(entry, 'publishRemoteFileLeaseState')
  installClassField(entry, 'publishRemoteFileIdentity')
  installClassField(entry, 'publishRemoteFileIdentityUnavailable')
  installClassField(entry, 'acquireRemoteFileOperation', {
    acquireRemoteFileCapability,
    refs: { get: () => ({}) },
    isCurrentSftpEntryRemoteTask: () => true,
    remoteFileOperationStale: () => Object.assign(
      new Error('stale'),
      { name: 'AbortError', code: 'ABORT_ERR' }
    )
  })

  let resolved = false
  const acquiring = entry.acquireRemoteFileOperation({ id: 'delayed-ui' })
    .then(capability => {
      resolved = true
      return capability
    })
  await leaseObserved.promise
  assert.equal(resolved, false)
  assert.equal(entry.state.remoteFileStatus, 'busy')
  assert.equal(entry.state.remoteFileIdentity.channel, 'unknown')

  probeGate.resolve()
  const capability = await acquiring
  assert.equal(entry.state.remoteFileIdentity.channel, 'pty-root')
  assert.equal(entry.state.remoteFileStatus, 'busy')
  await capability.release()
  assert.equal(entry.state.remoteFileStatus, 'idle')
  assert.equal(typeof leaseCallback, 'function')
})

test('entry receives the production lease callback before a delayed native probe resolves', async () => {
  const entry = createAsyncEntryHarness()
  entry.props.tab = {
    id: 'tab-1',
    host: 'prod.example.com',
    port: 22,
    username: 'hik',
    type: 'ssh',
    hostKeyFingerprint: 'SHA256:one'
  }
  entry.sftp = {
    id: 'sftp-1',
    terminalId: 'tab-1',
    port: 41001,
    type: 'sftp',
    sshSessionGeneration: 'generation-1',
    sshTerminalPid: 4242
  }
  const probeGate = deferred()
  const probeStarted = deferred()
  let releaseCount = 0
  const endpoint = {
    tabId: 'tab-1',
    host: 'prod.example.com',
    port: 22,
    username: 'hik',
    connectionUsername: 'hik',
    pid: 'tab-1',
    terminalPid: 'tab-1',
    sshTerminalPid: 4242,
    sshSessionGeneration: 'generation-1',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:one'
  }
  const terminal = {
    getTerminalSafetyEndpoint: () => endpoint,
    async acquireRemoteFilePtyTask () {
      return Object.freeze({
        async execute (request) {
          assert.equal(request.operation, 'probe')
          probeStarted.resolve()
          await probeGate.promise
          return {
            exitCode: 0,
            kind: 'probe',
            identity: { uid: '1000', username: 'hik' },
            capabilities: {
              sh: true,
              stat: true,
              base64: true,
              sha256: true
            }
          }
        },
        async release () {
          releaseCount += 1
          return true
        }
      })
    }
  }
  const { acquireRemoteFileCapability } = await importModule(
    'src/client/components/sftp/remote-file-capability.js'
  )
  installRemoteFileIdentityLifecycle(entry)
  installClassField(entry, 'publishRemoteFileLeaseState')
  installClassField(entry, 'publishRemoteFileIdentity')
  installClassField(entry, 'publishRemoteFileIdentityUnavailable')
  installClassField(entry, 'acquireRemoteFileOperation', {
    acquireRemoteFileCapability,
    refs: { get: () => terminal },
    isCurrentSftpEntryRemoteTask: () => true,
    remoteFileOperationStale: () => new Error('stale')
  })

  let resolved = false
  const acquiring = entry.acquireRemoteFileOperation({ id: 'native-delayed-ui' })
    .then(capability => {
      resolved = true
      return capability
    })
  await probeStarted.promise
  assert.equal(resolved, false)
  assert.equal(entry.state.remoteFileStatus, 'busy')
  assert.equal(entry.state.remoteFileIdentity.channel, 'unknown')

  probeGate.resolve()
  const capability = await acquiring
  assert.equal(releaseCount, 1)
  assert.equal(entry.state.remoteFileStatus, 'idle')
  assert.equal(entry.state.remoteFileIdentity.channel, 'sftp')
  assert.equal(await capability.release(), true)
  assert.equal(releaseCount, 1)
})

test('transfer session keeps lease busy until its real async release settles', async () => {
  const entry = createAsyncEntryHarness()
  const releaseGate = deferred()
  const identityToken = installRemoteFileIdentityLifecycle(entry)
  const capability = {
    channel: 'pty-root',
    runtimeIdentity: {
      channel: 'pty-root',
      effectiveUid: '0',
      effectiveUsername: 'root'
    },
    backend: {},
    async release () {
      await releaseGate.promise
      entry.publishRemoteFileLeaseState({
        state: 'released',
        operationId: 'transfer:transfer-1'
      }, identityToken)
      return true
    }
  }
  installClassField(entry, 'publishRemoteFileLeaseState')
  entry.publishRemoteFileLeaseState({
    state: 'acquired',
    operationId: 'transfer:transfer-1'
  }, identityToken)
  entry.acquireRemoteFileOperation = async () => capability
  installClassField(entry, 'acquireTransferFileCapability', {
    initializeRemoteFileGeneration: current => current.remoteFileGeneration,
    remoteFileOperationStale: () => new Error('stale'),
    abortRemoteFileOperation: () => {},
    isCurrentRemoteFileGeneration: () => true,
    createRemoteFileTransferCapability: value => value,
    remoteFileOperationUnmounted: () => new Error('unmounted')
  })

  const session = await entry.acquireTransferFileCapability({
    transferId: 'transfer-1'
  })
  assert.equal(entry.state.remoteFileStatus, 'busy')
  const releasing = session.release()
  await Promise.resolve()
  assert.equal(entry.state.remoteFileStatus, 'busy')
  releaseGate.resolve()
  assert.equal(await releasing, true)
  assert.equal(entry.state.remoteFileStatus, 'idle')
})

test('stale acquisition release failure keeps stale primary and lease uncertainty', async () => {
  const entry = createAsyncEntryHarness()
  const releaseFailure = new Error('release failed')
  const staleFailure = Object.assign(new Error('stale lifecycle'), {
    name: 'AbortError',
    code: 'ABORT_ERR'
  })
  const acquireRemoteFileCapability = async options => {
    options.onLeaseState({ state: 'acquired', operationId: options.operationId })
    options.onIdentity({
      loginUsername: 'hik',
      effectiveUid: '0',
      effectiveUsername: 'root',
      channel: 'pty-root'
    })
    return {
      async release () {
        options.onLeaseState({
          state: 'release-failed',
          operationId: options.operationId,
          error: releaseFailure
        })
        throw releaseFailure
      }
    }
  }
  installRemoteFileIdentityLifecycle(entry)
  installClassField(entry, 'publishRemoteFileLeaseState')
  installClassField(entry, 'publishRemoteFileIdentity')
  installClassField(entry, 'publishRemoteFileIdentityUnavailable')
  installClassField(entry, 'acquireRemoteFileOperation', {
    acquireRemoteFileCapability,
    refs: { get: () => ({}) },
    isCurrentSftpEntryRemoteTask: () => false,
    remoteFileOperationStale: () => staleFailure
  })

  await assert.rejects(entry.acquireRemoteFileOperation({
    id: 'stale-release-failure',
    lifecycleTask: {}
  }), error => {
    assert.equal(error, staleFailure)
    assert.equal(error.releaseError, releaseFailure)
    return true
  })
  assert.equal(entry.state.remoteFileStatus, 'uncertain')
  assert.equal(entry.state.remoteFileIdentity.channel, 'unknown')
  assert.equal(entry.activeRemoteFileLeases.size, 1)
})

test('generation drain immediately invalidates identity and rejects old probe events', async () => {
  const entry = createAsyncEntryHarness()
  const acquisitionGate = deferred()
  const leaseObserved = deferred()
  const releaseFailure = new Error('old lease release failed')
  const acquireRemoteFileCapability = async options => {
    options.onLeaseState({ state: 'acquired', operationId: options.operationId })
    leaseObserved.resolve()
    await acquisitionGate.promise
    options.onIdentity({
      loginUsername: 'hik',
      effectiveUid: '0',
      effectiveUsername: 'root',
      channel: 'pty-root'
    })
    return {
      async release () {
        options.onLeaseState({
          state: 'release-failed',
          operationId: options.operationId,
          error: releaseFailure
        })
        throw releaseFailure
      }
    }
  }
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  installClassField(entry, 'captureRemoteFileIdentityToken')
  installClassField(entry, 'isCurrentRemoteFileIdentityToken', {
    isCurrentRemoteFileGeneration: lifecycle.isCurrentRemoteFileGeneration
  })
  installClassField(entry, 'invalidateRemoteFileIdentity')
  installClassField(entry, 'publishRemoteFileLeaseState')
  installClassField(entry, 'publishRemoteFileIdentity')
  installClassField(entry, 'publishRemoteFileIdentityUnavailable')
  installClassField(entry, 'acquireRemoteFileOperation', {
    acquireRemoteFileCapability,
    refs: { get: () => ({}) },
    initializeRemoteFileGeneration: lifecycle.initializeRemoteFileGeneration,
    isCurrentRemoteFileGeneration: lifecycle.isCurrentRemoteFileGeneration,
    isCurrentSftpEntryRemoteTask: () => true,
    remoteFileOperationStale: () => Object.assign(
      new Error('stale generation'),
      { name: 'AbortError', code: 'ABORT_ERR' }
    )
  })

  const acquiring = entry.acquireRemoteFileOperation({ id: 'old-probe' })
  await leaseObserved.promise
  assert.equal(entry.state.remoteFileStatus, 'busy')
  const drain = lifecycle.drainRemoteFileGeneration(entry)
  assert.equal(entry.state.remoteFileStatus, 'idle')
  assert.equal(entry.state.remoteFileIdentity.channel, 'unknown')
  assert.equal(entry.activeRemoteFileLeases.size, 0)
  await drain.promise

  acquisitionGate.resolve()
  await assert.rejects(acquiring, error => {
    assert.equal(error.code, 'ABORT_ERR')
    assert.equal(error.releaseError, releaseFailure)
    return true
  })
  assert.equal(entry.state.remoteFileStatus, 'idle')
  assert.equal(entry.state.remoteFileIdentity.channel, 'unknown')
  assert.equal(entry.activeRemoteFileLeases.size, 0)
})

test('committed mutation release failure keeps the active lease and warns against retry', async () => {
  const entry = createAsyncEntryHarness()
  const releaseFailure = new Error('terminal release uncertain')
  const reports = []
  entry.remoteFileGeneration = {
    accepting: true,
    capabilities: new Set(),
    settlements: new Set(),
    tail: Promise.resolve()
  }
  installClassField(entry, 'captureRemoteFileIdentityToken')
  installClassField(entry, 'isCurrentRemoteFileIdentityToken', {
    isCurrentRemoteFileGeneration: (current, generation) => (
      current.remoteFileGeneration === generation
    )
  })
  installClassField(entry, 'publishRemoteFileLeaseState')
  const identityToken = entry.captureRemoteFileIdentityToken()
  entry.publishRemoteFileLeaseState({
    state: 'acquired',
    operationId: 'mutation-release-failure'
  }, identityToken)
  entry.acquireRemoteFileOperation = async () => ({
    backend: {},
    async release () {
      entry.publishRemoteFileLeaseState({
        state: 'release-failed',
        operationId: 'mutation-release-failure',
        error: releaseFailure
      }, identityToken)
      throw releaseFailure
    }
  })
  installClassField(entry, 'withRemoteFileOperation', {
    initializeRemoteFileGeneration: current => current.remoteFileGeneration,
    remoteFileOperationStale: () => new Error('stale'),
    remoteFileOperationUnmounted: () => new Error('unmounted'),
    abortRemoteFileOperation: () => {},
    window: { store: { onError: error => reports.push(error) } }
  })

  const result = await entry.withRemoteFileOperation(
    { id: 'mutation-release-failure' },
    async (backend, capability, mutation) => {
      mutation.commit()
      return 'committed'
    }
  )

  assert.equal(result, 'committed')
  assert.deepEqual(reports, [releaseFailure])
  assert.equal(entry.state.remoteFileStatus, 'uncertain')
  assert.equal(entry.activeRemoteFileLeases.size, 1)
  assert.equal(entry.state.remoteFileIdentity.channel, 'unknown')
})

test('FTP panel is excluded from SSH effective identity rendering', () => {
  const shouldRenderSshFileIdentity = topLevelFunction(
    'shouldRenderSshFileIdentity'
  )

  assert.equal(shouldRenderSshFileIdentity({ isFtp: true }, 'ftp'), false)
  assert.equal(shouldRenderSshFileIdentity({ isFtp: false }, 'sftp'), true)
  assert.match(
    entrySource,
    /shouldRenderSshFileIdentity\(\s*this\.props,\s*this\.type\s*\)/
  )
})

test('failed acquisition publishes an unknown unavailable state without sending work', () => {
  const entry = createEntryStateHarness()
  entry.remoteFileIdentityEpoch = 0
  entry.remoteFileGeneration = { accepting: true }
  const identityToken = installRemoteFileIdentityLifecycle(entry)
  installClassField(entry, 'publishRemoteFileIdentityUnavailable')
  entry.publishRemoteFileIdentityUnavailable(identityToken)

  assert.deepEqual({ ...entry.state.remoteFileIdentity }, {
    loginUsername: 'hik',
    effectiveUid: '',
    effectiveUsername: '',
    channel: 'unknown'
  })
  assert.equal(entry.state.remoteFileStatus, 'unavailable')

  const start = entrySource.indexOf('acquireRemoteFileOperation = async')
  const end = entrySource.indexOf('\n  reserveTransferFileSession', start)
  const acquireSource = entrySource.slice(start, end)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(acquireSource, /REMOTE_FILE_IDENTITY_UNAVAILABLE/)
  assert.match(acquireSource, /publishRemoteFileIdentityUnavailable/)
})

test('busy unavailable and uncertain notices are live regions beside the transfer progress dock', () => {
  assert.match(entrySource, /remoteFileStatus === 'busy'/)
  assert.match(entrySource, /shellpilotSftpRootLeaseBusy/)
  assert.match(entrySource, /remoteFileStatus === 'unavailable'/)
  assert.match(entrySource, /shellpilotSftpIdentityUnavailable/)
  assert.match(entrySource, /remoteFileStatus === 'uncertain'/)
  assert.match(entrySource, /shellpilotSftpReleaseUncertain/)
  assert.match(entrySource, /aria-live='polite'/)
  assert.match(entrySource, /SftpTransferProgressDock/)
  assert.match(entrySource, /sftp-file-identity-marker/)
})

test('identity UI copy is bilingual and documents terminal locking', async () => {
  const i18nPath = path.resolve(
    agentRoot,
    'src/client/common/shellpilot-i18n-overrides.js'
  )
  const { getShellPilotTranslation } = await import(pathToFileURL(i18nPath).href)
  const expected = {
    shellpilotSftpLoginIdentity: ['SSH \u767b\u5f55\uff1a{username}', 'SSH login: {username}'],
    shellpilotSftpEffectiveFileIdentity: [
      '\u6587\u4ef6\u64cd\u4f5c\uff1a{username}\uff08{channel}\uff09',
      'File operations: {username} ({channel})'
    ],
    shellpilotSftpEffectiveFileIdentityUnknown: [
      '\u6587\u4ef6\u64cd\u4f5c\uff1a\u672a\u77e5',
      'File operations: Unknown'
    ],
    shellpilotSftpCurrentTerminal: ['\u5f53\u524d\u7ec8\u7aef', 'current terminal'],
    shellpilotSftpNativeChannel: ['SFTP', 'SFTP'],
    shellpilotSftpRootLeaseBusy: [
      '\u8fdc\u7a0b\u6587\u4ef6\u64cd\u4f5c\u6b63\u5728\u4f7f\u7528\u5f53\u524d\u7ec8\u7aef\uff1b\u5b8c\u6210\u6216\u53d6\u6d88\u524d\u7ec8\u7aef\u8f93\u5165\u5df2\u9501\u5b9a\u3002',
      'Remote file operations are using the current terminal; terminal input is locked until completion or cancellation.'
    ],
    shellpilotSftpIdentityUnavailable: [
      '\u65e0\u6cd5\u786e\u8ba4\u5f53\u524d Shell \u8eab\u4efd\uff0c\u8fdc\u7a0b\u6587\u4ef6\u64cd\u4f5c\u5c1a\u672a\u53d1\u9001\u3002',
      'The current Shell identity could not be confirmed; the remote file operation was not sent.'
    ],
    shellpilotSftpReleaseUncertain: [
      '\u64cd\u4f5c\u53ef\u80fd\u5df2\u6267\u884c\uff0c\u7ec8\u7aef\u91ca\u653e\u72b6\u6001\u672a\u77e5\u3002\u8bf7\u6838\u5bf9\u6216\u91cd\u8fde\uff0c\u4e0d\u8981\u76f2\u76ee\u91cd\u8bd5\u3002',
      'The operation may have executed and terminal release status is unknown. Verify or reconnect; do not retry blindly.'
    ]
  }

  for (const [key, [chinese, english]] of Object.entries(expected)) {
    assert.equal(getShellPilotTranslation(key, 'zh_cn'), chinese)
    assert.equal(getShellPilotTranslation(key, 'en_us'), english)
  }
})

test('guide explains effective root routing and removes the obsolete absolute claim', () => {
  const guide = readSource('docs/USER_GUIDE_ZH.md')
  assert.doesNotMatch(guide, /终端内?里?的? `?su`?(?: 或|\/)? `?sudo`?[^。]*不会改变(?:该身份|文件操作)/)
  assert.match(guide, /原生 SFTP[^。]*登录身份[^。]*不会改变/)
  assert.match(guide, /UID 0/)
  assert.match(guide, /受控终端/)
  assert.match(guide, /私有 SFTP 暂存区/)
  assert.match(guide, /终端[^。]*(?:忙|占用)/)
  assert.match(guide, /chroot/)
  assert.match(guide, /基础命令/)
  assert.match(guide, /退出 root/)
  assert.match(guide, /终端释放状态未知[^。]*核对或重连[^。]*不要盲目重试/)
})
