const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const { importModule } = require('./helpers/import-esm')

const sftpRoot = path.resolve(
  __dirname,
  '../../src/client/components/sftp'
)
const entryPath = path.join(sftpRoot, 'sftp-entry.jsx')
const entrySource = fs.readFileSync(entryPath, 'utf8')
const fileItemSource = fs.readFileSync(
  path.join(sftpRoot, 'file-item.jsx'),
  'utf8'
)
const contextActionsSource = fs.readFileSync(
  path.resolve(sftpRoot, '../ai/ai-chat-context-actions.js'),
  'utf8'
)
const entryAst = parser.parse(entrySource, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining']
})

function classFieldInitializer (name) {
  let initializer
  traverse(entryAst, {
    ClassProperty (nodePath) {
      if (nodePath.node.key?.name === name) initializer = nodePath.node.value
    }
  })
  assert.ok(initializer, `sftp-entry.jsx must define ${name}`)
  return generate(initializer).code
}

function installClassField (entry, name, dependencies = {}) {
  const create = vm.runInNewContext(`
    (function installClassField () {
      return (${classFieldInitializer(name)})
    }).call(__entry)
  `, {
    ...dependencies,
    __entry: entry
  })
  entry[name] = create
  return entry[name]
}

function installClassMethod (entry, name, dependencies = {}) {
  let method
  traverse(entryAst, {
    ClassMethod (nodePath) {
      if (nodePath.node.key?.name === name) method = nodePath.node
    }
  })
  assert.ok(method, `sftp-entry.jsx must define ${name}`)
  const parameters = method.params.map(parameter => generate(parameter).code)
  entry[name] = vm.runInNewContext(
    `(function (${parameters.join(', ')}) ${generate(method.body).code})`,
    dependencies
  )
  return entry[name]
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

function abortRemoteFileOperation (signal) {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('remote file operation aborted')
}

function remoteFileOperationUnmounted () {
  const error = new Error('remote file entry unmounted')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function remoteFileOperationStale () {
  const error = new Error('remote file lifecycle changed')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function isAuthoritativeRemoteMissingError (error) {
  return error?.code === 'ENOENT' ||
    error?.code === 'SFTP_NO_SUCH_FILE' ||
    error?.code === 2
}

function initializeRemoteFileGeneration (entry) {
  if (entry.remoteFileGeneration) return entry.remoteFileGeneration
  const generation = {
    id: 1,
    accepting: entry.remoteFileUnmounted !== true,
    capabilities: entry.remoteFileOperations || new Set(),
    settlements: entry.remoteFileOperationSettlements || new Set(),
    backends: entry.remoteFileOperationBackends || new Map(),
    tail: entry.remoteFileOperationTail || Promise.resolve()
  }
  entry.remoteFileGeneration = generation
  entry.remoteFileOperations = generation.capabilities
  entry.remoteFileOperationSettlements = generation.settlements
  entry.remoteFileOperationBackends = generation.backends
  entry.remoteFileOperationTail = generation.tail
  return generation
}

function resolveRemoteFileStatus ({
  rootLeaseCount = 0,
  unavailable = false,
  releaseUncertain = false
} = {}) {
  if (releaseUncertain) return 'uncertain'
  if (rootLeaseCount > 0) return 'busy'
  return unavailable ? 'unavailable' : 'idle'
}

const rootRuntimeIdentity = Object.freeze({
  channel: 'pty-root',
  effectiveUid: '0',
  effectiveUsername: 'root'
})

function assertRemoteSnapshotCleared (entry, options = {}) {
  assert.deepEqual(Array.from(entry.state.remote, file => ({
    id: file.id,
    name: file.name
  })), [])
  assert.deepEqual(Array.from(
    entry.state.remoteFileTree || [],
    ([id, file]) => [id, file?.name]
  ), [])
  assert.deepEqual(Array.from(entry.state.selectedFiles), [])
  assert.equal(entry.state.lastClickedFile, null)
  assert.equal(entry.visibleRemoteDirectoryCacheKey, '')
  if (options.identityEpoch !== undefined) {
    assert.equal(entry.remoteFileIdentityEpoch, options.identityEpoch)
  }
  if (options.identityChannel !== undefined) {
    assert.equal(
      entry.state.remoteFileIdentity.channel,
      options.identityChannel
    )
  }
  if (options.identityStatus !== undefined) {
    assert.equal(entry.state.remoteFileStatus, options.identityStatus)
  }
}

async function installRemoteFileIdentityFields (entry) {
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  entry.props ||= { tab: { id: 'tab-1', username: 'hik' } }
  entry.state ||= {
    remoteFileIdentity: {
      loginUsername: entry.props.tab?.username || '',
      effectiveUid: '',
      effectiveUsername: '',
      channel: 'unknown'
    },
    remoteFileStatus: 'idle'
  }
  entry.remoteFileIdentityEpoch ||= 0
  entry.activeRemoteFileLeases ||= new Set()
  entry.uncertainRemoteFileLeases ||= new Set()
  lifecycle.initializeRemoteFileGeneration(entry)
  installClassField(entry, 'captureRemoteFileIdentityToken')
  installClassField(entry, 'isCurrentRemoteFileIdentityToken', {
    isCurrentRemoteFileGeneration: lifecycle.isCurrentRemoteFileGeneration
  })
  installClassField(entry, 'publishRemoteFileIdentity', {
    resolveRemoteFileStatus
  })
  installClassField(entry, 'publishRemoteFileIdentityUnavailable', {
    resolveRemoteFileStatus
  })
  return lifecycle
}

function createBackend (calls, name = 'backend', options = {}) {
  let released = false
  const assertOpen = operation => {
    assert.equal(released, false, `${name}.${operation} called after release`)
  }
  const backend = {
    async list (remotePath) {
      assertOpen('list')
      calls.push(['list', name, remotePath])
      if (options.list) return options.list(remotePath)
      return [{ name: 'link', type: 'l', size: 4 }]
    },
    async readlink (remotePath) {
      assertOpen('readlink')
      calls.push(['readlink', name, remotePath])
      return '/root/app.conf'
    },
    async realpath (remotePath) {
      assertOpen('realpath')
      calls.push(['realpath', name, remotePath])
      return remotePath
    },
    async stat (remotePath) {
      assertOpen('stat')
      calls.push(['stat', name, remotePath])
      return { type: 'f', size: 12 }
    },
    async readFile (remotePath) {
      assertOpen('readFile')
      calls.push(['readFile', name, remotePath])
      return 'enabled=true\n'
    },
    async mkdir (remotePath) {
      assertOpen('mkdir')
      calls.push(['mkdir', name, remotePath])
      return true
    },
    async touch (remotePath) {
      assertOpen('touch')
      calls.push(['touch', name, remotePath])
      return true
    }
  }
  return {
    backend,
    release: async () => {
      calls.push(['release', name])
      released = true
      return true
    }
  }
}

function createEntryHarness ({
  acquire,
  replaceTimer,
  client,
  beginProbe,
  classifyRecoveryError,
  editTab,
  reportBackgroundError = () => {},
  reportOperationError = () => {},
  recordPerformanceDuration = () => true
} = {}) {
  const stateWrites = []
  const entry = {
    props: {
      tab: { id: 'tab-1', username: 'hik' },
      sessionOptions: {},
      config: {},
      editTab: editTab || (() => {})
    },
    state: {
      remotePath: '/root',
      remote: [],
      remotePathHistory: [],
      selectedType: '',
      selectedFiles: new Set(),
      remoteFileIdentity: {
        loginUsername: 'hik',
        effectiveUid: '',
        effectiveUsername: '',
        channel: 'unknown'
      },
      remoteFileStatus: 'idle'
    },
    type: 'sftp',
    sftp: {
      list: async () => { throw new Error('raw SFTP list used') },
      getHomeDir: async () => '/home/hik'
    },
    remoteFileOperationBackends: new Map(),
    remoteFileOperationSequence: 0,
    remoteFileOperations: new Set(),
    remoteFileUnmounted: false,
    remoteFileIdentityEpoch: 0,
    activeRemoteFileLeases: new Set(),
    uncertainRemoteFileLeases: new Set(),
    remoteDirectoryCache: {
      get: () => null,
      set: () => {},
      clear: () => {}
    },
    buildTree: remote => new Map(remote.map(file => [file.id, file])),
    updateRemoteList: async remote => remote,
    isSftpVisible: () => false,
    onError: () => {},
    setState (update, callback) {
      const next = typeof update === 'function' ? update(this.state) : update
      if (next) {
        Object.assign(this.state, next)
        stateWrites.push(next)
      }
      callback?.()
    }
  }
  installClassField(entry, 'normalizeSftpError', {
    e: () => 'SFTP unavailable'
  })
  const typeMap = { remote: 'remote', local: 'local' }
  installClassField(entry, 'acquireRemoteFileOperation', {
    acquireRemoteFileCapability: acquire,
    abortRemoteFileOperation,
    refs: { get: () => ({}) },
    isCurrentSftpEntryRemoteTask: (_entry, token) => Boolean(token),
    remoteFileOperationStale
  })
  installClassField(entry, 'withRemoteFileOperation', {
    abortRemoteFileOperation,
    initializeRemoteFileGeneration,
    remoteFileOperationUnmounted,
    window: { store: { onError: reportOperationError } }
  })
  installClassField(entry, 'sftpList', {
    abortRemoteFileOperation,
    fileTypeMap: { directory: 'd', link: 'l' },
    typeMap,
    pick: (value, names) => Object.fromEntries(
      names.filter(name => Object.hasOwn(value, name))
        .map(name => [name, value[name]])
    ),
    generate: (() => {
      let id = 0
      return () => `file-${++id}`
    })()
  })
  installClassField(entry, 'readRemoteFile')
  installClassField(entry, 'createRemoteFile')
  return importModule('src/client/components/sftp/sftp-entry-lifecycle.js')
    .then(async lifecycle => {
      const remoteFileErrors = await importModule(
        'src/client/components/sftp/remote-file-errors.js'
      )
      installClassField(entry, 'captureRemoteFileIdentityToken')
      installClassField(entry, 'isCurrentRemoteFileIdentityToken', {
        isCurrentRemoteFileGeneration: lifecycle.isCurrentRemoteFileGeneration
      })
      installClassField(entry, 'invalidateRemoteFileIdentity')
      installClassField(entry, 'publishRemoteFileLeaseState', {
        resolveRemoteFileStatus
      })
      installClassField(entry, 'publishRemoteFileIdentity', {
        resolveRemoteFileStatus
      })
      installClassField(entry, 'publishRemoteFileIdentityUnavailable', {
        resolveRemoteFileStatus
      })
      entry.runSftpBackgroundTask = task => lifecycle.runSftpBackgroundTask(
        task,
        { reportError: reportBackgroundError }
      )
      installClassField(entry, 'applyCachedRemoteDirectory', {
        isCurrentRemoteFileGeneration: lifecycle.isCurrentRemoteFileGeneration,
        isCurrentSftpEntryRemoteTask: lifecycle.isCurrentSftpEntryRemoteTask,
        preserveSftpDraftItems: (_oldRemote, remote) => remote,
        reconcileSelectedFileIds: (_oldRemote, _remote, selected) => selected,
        recordPerformanceDuration,
        trackSftpEntryMetric: lifecycle.trackSftpEntryMetric,
        typeMap
      })
      installClassField(entry, 'remoteListUncoalesced', {
        Client: client || (async () => {
          throw new Error('unexpected SFTP client construction')
        }),
        beginRemoteFileCapabilityProbe: beginProbe || (() => {
          throw new Error('unexpected prepared probe')
        }),
        refs: { get: () => null },
        getProxy: () => null,
        buildSftpSafetyEndpoint: () => ({}),
        shouldRetryUnexpectedSftpPacket: () => false,
        reconnectSftpEntryRemote: lifecycle.reconnectSftpEntryRemote,
        beginSftpEntryRemoteTask: lifecycle.beginSftpEntryRemoteTask,
        isCurrentSftpEntryRemoteTask: lifecycle.isCurrentSftpEntryRemoteTask,
        isCurrentRemoteFileGeneration: lifecycle.isCurrentRemoteFileGeneration,
        initializeRemoteFileGeneration: lifecycle.initializeRemoteFileGeneration,
        beginSftpEntryRenderCommit: lifecycle.beginSftpEntryRenderCommit,
        trackSftpEntryMetric: lifecycle.trackSftpEntryMetric,
        getSftpEntryReadinessSnapshot: lifecycle.getSftpEntryReadinessSnapshot,
        commitSftpEntryRemoteClient: lifecycle.commitSftpEntryRemoteClient,
        destroySftpEntryClientOnce: lifecycle.destroySftpEntryClientOnce,
        deepCopy: value => structuredClone(value),
        normalizeRemotePath: value => value,
        buildRemoteDirectoryCacheKey: value => JSON.stringify(value),
        typeMap,
        uniq: values => [...new Set(values)],
        preserveSftpDraftItems: (_oldRemote, remote) => remote,
        reconcileSelectedFileIds: (_oldRemote, _remote, selected) => selected,
        recordPerformanceDuration,
        remoteFileOperationUnmounted,
        remoteFileOperationStale,
        classifyRemoteFileRecoveryError:
          classifyRecoveryError ||
          remoteFileErrors.classifyRemoteFileRecoveryError,
        appendRemoteFileCleanupErrors:
          remoteFileErrors.appendRemoteFileCleanupErrors,
        replaceSftpEntryTimer: replaceTimer || (() => 1),
        unexpectedPacketErrorDesc: 'unexpected packet',
        sftpRetryInterval: 1
      })
      entry.remoteList = entry.remoteListUncoalesced
      return { entry, stateWrites, lifecycle }
    })
}

test('remoteList rejects before constructing a client while its generation drains', async () => {
  let clientCalls = 0
  const { entry, lifecycle } = await createEntryHarness({
    acquire: async () => { throw new Error('unexpected capability acquire') },
    client: async () => {
      clientCalls += 1
      return null
    }
  })
  entry.sftp = null
  lifecycle.initializeRemoteFileGeneration(entry)
  const drain = lifecycle.drainRemoteFileGeneration(entry)

  await assert.rejects(
    entry.remoteList(false, '/root', undefined, { rethrow: true }),
    error => error?.name === 'AbortError'
  )
  assert.equal(clientCalls, 0)
  await drain.promise
})

test('a client resolving after generation drain is destroyed once and never committed', async () => {
  const candidateReady = deferred()
  let destroys = 0
  const candidate = {
    connect: async () => true,
    destroy: async () => { destroys += 1 }
  }
  const { entry, lifecycle } = await createEntryHarness({
    acquire: async () => { throw new Error('unexpected capability acquire') },
    client: async () => candidateReady.promise
  })
  entry.sftp = null
  lifecycle.initializeRemoteFileGeneration(entry)
  const listing = entry.remoteList(false, '/root', undefined, { rethrow: true })
  const drain = lifecycle.drainRemoteFileGeneration(entry)
  candidateReady.resolve(candidate)

  await assert.rejects(listing, error => error?.name === 'AbortError')
  await drain.promise
  assert.equal(entry.sftp, null)
  assert.equal(destroys, 1)
})

test('queued remoteList state updaters commit nothing after generation drain', async () => {
  const clientReady = deferred()
  const queued = []
  const candidate = {
    connect: async () => true,
    destroy: async () => true
  }
  const { entry, lifecycle } = await createEntryHarness({
    acquire: async () => { throw new Error('unexpected capability acquire') },
    client: async () => clientReady.promise
  })
  entry.sftp = null
  entry.setState = update => queued.push(update)
  lifecycle.initializeRemoteFileGeneration(entry)
  const listing = entry.remoteList(false, '/root', undefined, { rethrow: true })
  assert.equal(queued.length, 1)
  const drain = lifecycle.drainRemoteFileGeneration(entry)

  assert.equal(queued[0](entry.state), null)
  clientReady.resolve(candidate)
  await assert.rejects(listing, error => error?.name === 'AbortError')
  await drain.promise
})

test('old client init cannot overwrite the explicitly activated next generation', async () => {
  const oldReady = deferred()
  let call = 0
  let oldDestroys = 0
  let newDestroys = 0
  const oldClient = {
    connect: async () => true,
    destroy: async () => { oldDestroys += 1 }
  }
  const newClient = {
    connect: async () => true,
    destroy: async () => { newDestroys += 1 }
  }
  const acquire = async () => ({
    runtimeIdentity: {
      channel: 'pty-root',
      effectiveUid: '0',
      effectiveUsername: 'root'
    },
    backend: { list: async () => [] },
    release: async () => true
  })
  const { entry, lifecycle } = await createEntryHarness({
    acquire,
    client: async () => ++call === 1 ? oldReady.promise : newClient
  })
  entry.sftp = null
  lifecycle.initializeRemoteFileGeneration(entry)
  const oldListing = entry.remoteList(false, '/old', undefined, {
    rethrow: true,
    skipCompensation: true
  })
  const drain = lifecycle.drainRemoteFileGeneration(entry)
  await drain.promise
  assert.equal(lifecycle.activateRemoteFileGeneration(entry, drain.generation), true)
  const newListing = entry.remoteList(false, '/new', undefined, {
    rethrow: true,
    skipCompensation: true
  })
  oldReady.resolve(oldClient)

  await assert.rejects(oldListing, error => error?.name === 'AbortError')
  await newListing
  assert.equal(entry.sftp, newClient)
  assert.equal(oldDestroys, 1)
  assert.equal(newDestroys, 0)
})

test('root file mode routes list metadata read and create through one capability per operation', async () => {
  const calls = []
  let capabilityIndex = 0
  const acquire = async ({ operationId, onIdentity, signal }) => {
    assert.equal(signal, undefined)
    const capability = createBackend(calls, `cap-${++capabilityIndex}`)
    calls.push(['acquire', operationId])
    await onIdentity({
      loginUsername: 'hik',
      effectiveUid: '0',
      effectiveUsername: 'root',
      channel: 'pty-root'
    })
    return {
      channel: 'pty-root',
      runtimeIdentity: {
        channel: 'pty-root',
        effectiveUid: '0',
        effectiveUsername: 'root'
      },
      backend: capability.backend,
      sftp: capability.backend,
      release: capability.release
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  entry.updateRemoteList = async (remote, remotePath, backend) => {
    await backend.readlink(`${remotePath}/link`)
    await backend.stat(`${remotePath}/app.conf`)
    return remote
  }

  await entry.remoteList(false, '/root')
  assert.equal(await entry.readRemoteFile('/root/app.conf'), 'enabled=true\n')
  await entry.createRemoteFile({ path: '/root/new-dir', isDirectory: true })

  assert.deepEqual(calls.map(call => call[0]), [
    'acquire', 'list', 'readlink', 'stat', 'release',
    'acquire', 'readFile', 'release',
    'acquire', 'mkdir', 'release'
  ])
  assert.deepEqual(entry.state.remoteFileIdentity, {
    loginUsername: 'hik',
    effectiveUid: '0',
    effectiveUsername: 'root',
    channel: 'pty-root'
  })
})

test('root AI preview stays inside one bounded capability and releases last', async () => {
  const calls = []
  let released = false
  const contents = Buffer.from('privileged preview')
  const acquire = async ({ onIdentity }) => {
    await onIdentity({
      loginUsername: 'hik',
      effectiveUid: '0',
      effectiveUsername: 'root',
      channel: 'pty-root'
    })
    return {
      backend: {
        async lstat (filePath) {
          assert.equal(released, false)
          calls.push(['lstat', filePath])
          return { type: 'f', size: contents.length }
        },
        async readFileChunk (filePath, options) {
          assert.equal(released, false)
          calls.push(['readFileChunk', filePath, options.maxBytes])
          return {
            base64: contents.toString('base64'),
            bytesRead: contents.length,
            nextOffset: contents.length,
            totalBytes: contents.length,
            hasMore: false
          }
        }
      },
      release: async () => {
        calls.push(['release'])
        released = true
      }
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  const contextActions = await importModule(
    'src/client/components/ai/ai-chat-context-actions.js'
  )
  const contextReader = await importModule(
    'src/client/components/sftp/remote-file-context-reader.js'
  )
  installClassField(entry, 'readRemoteFileContext', {
    AI_FILE_PREVIEW_MAX_BYTES: contextActions.AI_FILE_PREVIEW_MAX_BYTES,
    createRemoteFileContextReader: contextReader.createRemoteFileContextReader,
    readSftpFileContext: contextActions.readSftpFileContext,
    resolve: (base, name) => `${base}/${name}`
  })

  const result = await entry.readRemoteFileContext({
    name: 'app.log',
    path: '/root',
    type: 'remote',
    size: contents.length
  })

  assert.equal(result.ok, true)
  assert.equal(result.content, 'privileged preview')
  assert.deepEqual(calls.map(call => call[0]), [
    'lstat', 'readFileChunk', 'release'
  ])
})

test('root AI binary attachment stays inside one bounded capability', async () => {
  const calls = []
  let released = false
  const contents = Buffer.from('privileged attachment')
  const acquire = async () => ({
    backend: {
      async lstat (filePath, options) {
        assert.equal(released, false)
        calls.push(['lstat', filePath, options.signal])
        return { type: 'f', size: contents.length }
      },
      async readFileChunk (filePath, options) {
        assert.equal(released, false)
        calls.push(['readFileChunk', filePath, options.signal])
        return {
          base64: contents.toString('base64'),
          nextOffset: contents.length,
          totalBytes: contents.length
        }
      }
    },
    release: async () => {
      released = true
      calls.push(['release'])
    }
  })
  const { entry } = await createEntryHarness({ acquire })
  const contextReader = await importModule(
    'src/client/components/sftp/remote-file-context-reader.js'
  )
  installClassField(entry, 'readRemoteFileAttachment', {
    REMOTE_ATTACHMENT_MAX_BYTES: contextReader.REMOTE_ATTACHMENT_MAX_BYTES,
    readRemoteFileBase64Preview: contextReader.readRemoteFileBase64Preview,
    abortRemoteFileOperation,
    resolve: (base, name) => `${base}/${name}`
  })
  const controller = new AbortController()
  const result = await entry.readRemoteFileAttachment({
    name: 'artifact.bin',
    path: '/root'
  }, { signal: controller.signal })

  assert.equal(
    Buffer.from(result.base64, 'base64').toString('utf8'),
    'privileged attachment'
  )
  assert.deepEqual(calls.map(call => call[0]), [
    'lstat', 'readFileChunk', 'release'
  ])
  assert.ok(calls.slice(0, 2).every(call => call[2] === controller.signal))
})

test('unmount waits for an active root AI preview before transport destroy', async () => {
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  const contextActions = await importModule(
    'src/client/components/ai/ai-chat-context-actions.js'
  )
  const contextReader = await importModule(
    'src/client/components/sftp/remote-file-context-reader.js'
  )
  const readGate = deferred()
  const readStarted = deferred()
  const readSettled = deferred()
  const calls = []
  let releasePromise
  const acquire = async ({ onIdentity }) => {
    await onIdentity({
      loginUsername: 'hik',
      effectiveUid: '0',
      effectiveUsername: 'root',
      channel: 'pty-root'
    })
    return {
      backend: {
        lstat: async () => ({ type: 'f', size: 4 }),
        async readFileChunk () {
          calls.push('read')
          readStarted.resolve()
          await readGate.promise
          readSettled.resolve()
          return {
            base64: Buffer.from('text').toString('base64'),
            bytesRead: 4,
            nextOffset: 4,
            totalBytes: 4,
            hasMore: false
          }
        }
      },
      release: () => {
        releasePromise ||= (async () => {
          calls.push('release')
          await readSettled.promise
          calls.push('released')
        })()
        return releasePromise
      }
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  entry.sftp.destroy = async () => calls.push('destroy')
  entry.sftpSafetyProgressHandlers = { clear: () => {} }
  entry.sftpSafetyAdapter = { discardAllPreparedProofs: () => {} }
  entry._sortCache = { clear: () => {} }
  installClassField(entry, 'readRemoteFileContext', {
    AI_FILE_PREVIEW_MAX_BYTES: contextActions.AI_FILE_PREVIEW_MAX_BYTES,
    createRemoteFileContextReader: contextReader.createRemoteFileContextReader,
    readSftpFileContext: contextActions.readSftpFileContext,
    resolve: (base, name) => `${base}/${name}`
  })
  installClassMethod(entry, 'componentWillUnmount', {
    refs: { remove: () => {} },
    drainRemoteFileGeneration: lifecycle.drainRemoteFileGeneration,
    disposeSftpEntryScheduling: () => {}
  })

  const reading = entry.readRemoteFileContext({
    name: 'app.log',
    path: '/root',
    type: 'remote',
    size: 4
  })
  await readStarted.promise
  const disposal = entry.componentWillUnmount()
  assert.deepEqual(calls, ['read', 'release'])
  readGate.resolve()
  await assert.rejects(reading, error => error.code === 'ABORT_ERR')
  await disposal
  assert.deepEqual(calls, ['read', 'release', 'released', 'destroy'])
})

test('ordinary remote refresh performs one authoritative backend read', async () => {
  const calls = []
  const timers = []
  let capabilityIndex = 0
  const acquire = async ({ onIdentity }) => {
    const capability = createBackend(calls, `cap-${++capabilityIndex}`)
    await onIdentity({
      loginUsername: 'hik',
      effectiveUid: '0',
      effectiveUsername: 'root',
      channel: 'pty-root'
    })
    return {
      channel: 'pty-root',
      runtimeIdentity: {
        channel: 'pty-root',
        effectiveUid: '0',
        effectiveUsername: 'root'
      },
      backend: capability.backend,
      sftp: capability.backend,
      release: capability.release
    }
  }
  const { entry } = await createEntryHarness({
    acquire,
    replaceTimer: (_entry, _key, callback) => {
      timers.push(callback)
      return timers.length
    }
  })
  entry.updateRemoteList = async (remote, remotePath, backend) => {
    await backend.readlink(`${remotePath}/link`)
    await backend.stat(`${remotePath}/app.conf`)
    return remote
  }

  await entry.remoteList(false, '/root')

  assert.equal(timers.length, 0)
  assert.equal(capabilityIndex, 1)
  assert.deepEqual(calls.map(call => call[0]), [
    'list', 'readlink', 'stat', 'release'
  ])
})

test('root to login refresh selects cache keys from each operation identity', async () => {
  const identities = [{
    channel: 'pty-root',
    effectiveUid: '0',
    effectiveUsername: 'root'
  }, {
    channel: 'sftp',
    effectiveUid: 'unknown',
    effectiveUsername: 'hik'
  }]
  let acquireIndex = 0
  const acquire = async ({ onIdentity }) => {
    const runtimeIdentity = identities[acquireIndex++]
    await onIdentity({
      loginUsername: 'hik',
      ...runtimeIdentity
    })
    return {
      runtimeIdentity,
      backend: {
        list: async () => [{
          name: runtimeIdentity.effectiveUsername,
          type: 'f',
          size: 1
        }]
      },
      release: async () => true
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  const cacheKeys = []
  entry.remoteDirectoryCache = {
    get: () => null,
    set: (key) => { cacheKeys.push(JSON.parse(key)) },
    clear: () => {}
  }

  await entry.remoteList(false, '/root-only')
  await entry.remoteList(false, '/root-only')

  assert.deepEqual(cacheKeys.map(key => ({
    channel: key.channel,
    effectiveUid: key.effectiveUid,
    effectiveUsername: key.effectiveUsername
  })), identities)
})

test('root to login cache miss clears privileged rows before deferred list resolves', async () => {
  const loginListStarted = deferred()
  const loginListGate = deferred()
  const identities = [{
    channel: 'pty-root',
    effectiveUid: '0',
    effectiveUsername: 'root'
  }, {
    channel: 'sftp',
    effectiveUid: 'unknown',
    effectiveUsername: 'hik'
  }]
  let acquireIndex = 0
  const acquire = async ({ onIdentity }) => {
    const runtimeIdentity = identities[acquireIndex++]
    await onIdentity({ loginUsername: 'hik', ...runtimeIdentity })
    return {
      runtimeIdentity,
      backend: {
        list: async () => {
          if (runtimeIdentity === identities[0]) {
            return [{ name: 'root-secret.conf', type: 'f', size: 1 }]
          }
          loginListStarted.resolve()
          return loginListGate.promise
        }
      },
      release: async () => true
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  const entries = new Map()
  entry.remoteDirectoryCache = {
    get: key => entries.has(key)
      ? { value: structuredClone(entries.get(key)) }
      : null,
    set: (key, value) => entries.set(key, structuredClone(value)),
    clear: () => entries.clear()
  }

  await entry.remoteList(false, '/root-only')
  const rootFile = entry.state.remote[0]
  entry.state.selectedType = 'remote'
  entry.state.selectedFiles = new Set([rootFile.id])
  entry.state.lastClickedFile = rootFile.id
  const rootVisibleKey = entry.visibleRemoteDirectoryCacheKey
  const rootPaintEpoch = entry.remoteDirectoryCachePaintEpoch

  const loginRefresh = entry.remoteList(false, '/root-only')
  await loginListStarted.promise

  assert.equal(entry.state.remoteFileIdentity.effectiveUsername, 'hik')
  assert.notEqual(rootVisibleKey, '')
  assert.ok(entry.remoteDirectoryCachePaintEpoch > rootPaintEpoch)
  assertRemoteSnapshotCleared(entry)

  loginListGate.resolve([{ name: 'home.txt', type: 'f', size: 1 }])
  await loginRefresh
  assert.deepEqual(entry.state.remote.map(file => file.name), ['home.txt'])
})

test('stale and current list calls probe and load independently', async () => {
  const firstListGate = deferred()
  const firstListStarted = deferred()
  const identities = [rootRuntimeIdentity, {
    channel: 'sftp',
    effectiveUid: '1000',
    effectiveUsername: 'hik'
  }]
  let probeCount = 0
  let listCount = 0
  const acquire = async ({ onIdentity }) => {
    const runtimeIdentity = identities[Math.min(probeCount, 1)]
    probeCount += 1
    await onIdentity({ loginUsername: 'hik', ...runtimeIdentity })
    return {
      runtimeIdentity,
      backend: {
        list: async () => {
          listCount += 1
          if (runtimeIdentity === identities[0]) {
            firstListStarted.resolve()
            await firstListGate.promise
          }
          return [{
            name: runtimeIdentity.effectiveUsername,
            type: 'f',
            size: 1
          }]
        }
      },
      release: async () => true
    }
  }
  const { entry, lifecycle } = await createEntryHarness({ acquire })
  entry.sshSessionGeneration = 'generation-1'
  entry.sshTerminalPid = '100'
  const signal = new AbortController().signal
  const oldTask = lifecycle.beginSftpEntryRemoteTask(entry)
  const oldListing = entry.remoteList(false, '/root-only', undefined, {
    lifecycleTask: oldTask,
    signal,
    rethrow: true
  })
  await firstListStarted.promise

  const currentTask = lifecycle.beginSftpEntryRemoteTask(entry)
  const currentListing = entry.remoteList(false, '/root-only', undefined, {
    lifecycleTask: currentTask,
    signal,
    rethrow: true
  })
  const samePromise = oldListing === currentListing
  firstListGate.resolve()
  const [oldResult, currentResult] = await Promise.allSettled([
    oldListing,
    currentListing
  ])

  assert.equal(samePromise, false)
  assert.equal(probeCount, 2)
  assert.equal(listCount, 2)
  assert.equal(currentResult.status, 'fulfilled')
  assert.deepEqual(entry.state.remote.map(file => file.name), ['hik'])
  assert.ok(['fulfilled', 'rejected'].includes(oldResult.status))
})

test('equivalent current list calls serialize and independently probe load and release', async () => {
  const listGate = deferred()
  const firstListStarted = deferred()
  let probeCount = 0
  let listCount = 0
  let releaseCount = 0
  const acquire = async ({ onIdentity }) => {
    const operation = ++probeCount
    await onIdentity({ loginUsername: 'hik', ...rootRuntimeIdentity })
    return {
      runtimeIdentity: rootRuntimeIdentity,
      backend: {
        list: async () => {
          listCount += 1
          if (operation === 1) {
            firstListStarted.resolve()
            await listGate.promise
          }
          return [{ name: `root-${operation}`, type: 'f', size: 1 }]
        }
      },
      release: async () => {
        releaseCount += 1
        return true
      }
    }
  }
  const { entry, lifecycle } = await createEntryHarness({ acquire })
  entry.sshSessionGeneration = 'generation-1'
  entry.sshTerminalPid = '100'
  const task = lifecycle.beginSftpEntryRemoteTask(entry)
  const signal = new AbortController().signal
  const options = { lifecycleTask: task, signal, rethrow: true }
  const first = entry.remoteList(true, '/root-only', undefined, options)
  await firstListStarted.promise
  const second = entry.remoteList(true, '/root-only', undefined, options)
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(probeCount, 1)
  assert.equal(listCount, 1)
  assert.equal(releaseCount, 0)
  listGate.resolve()
  const [firstResult, secondResult] = await Promise.all([first, second])

  assert.notEqual(first, second)
  assert.equal(probeCount, 2)
  assert.equal(listCount, 2)
  assert.equal(releaseCount, 2)
  assert.notStrictEqual(firstResult, secondResult)
  assert.deepEqual(firstResult.map(file => file.name), ['root-1'])
  assert.deepEqual(secondResult.map(file => file.name), ['root-2'])
})

test('PID-only rebind cannot recover the prior terminal cached snapshot', async () => {
  const transient = Object.assign(new Error('transport reset'), {
    code: 'ECONNRESET'
  })
  let acquisition = 0
  const acquire = async ({ onIdentity }) => {
    const attempt = ++acquisition
    await onIdentity({ loginUsername: 'hik', ...rootRuntimeIdentity })
    return {
      runtimeIdentity: rootRuntimeIdentity,
      backend: {
        list: async () => {
          if (attempt > 1) throw transient
          return [{ name: 'app.conf', type: 'f', size: 12 }]
        }
      },
      release: async () => true
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  entry.sshSessionGeneration = 'generation-1'
  entry.sshTerminalPid = '100'
  const entries = new Map()
  const lookupKeys = []
  entry.remoteDirectoryCache = {
    get: key => {
      lookupKeys.push(key)
      return entries.has(key)
        ? { value: structuredClone(entries.get(key)) }
        : null
    },
    set: (key, value) => entries.set(key, structuredClone(value)),
    clear: () => entries.clear()
  }

  await entry.remoteList(false, '/root-only')
  assert.deepEqual(entry.state.remote.map(file => file.name), ['app.conf'])
  entry.state.selectedType = 'remote'
  entry.state.selectedFiles = new Set([entry.state.remote[0].id])
  entry.state.lastClickedFile = entry.state.remote[0].id

  entry.sshTerminalPid = '200'
  await assert.rejects(
    entry.remoteList(false, '/root-only', undefined, { rethrow: true }),
    error => error === transient
  )

  assert.notEqual(lookupKeys[0], lookupKeys[1])
  assertRemoteSnapshotCleared(entry)
})

test('unknown identity clears a visible privileged directory snapshot', async () => {
  const unavailable = Object.assign(new Error('identity unavailable'), {
    code: 'REMOTE_FILE_IDENTITY_UNAVAILABLE'
  })
  const { entry } = await createEntryHarness({
    acquire: async () => { throw unavailable }
  })
  entry.state.remote = [{
    id: 'root-app-conf',
    name: 'app.conf',
    path: '/root-only',
    type: 'remote'
  }]
  entry.state.remoteFileTree = entry.buildTree(entry.state.remote)
  entry.state.selectedType = 'remote'
  entry.state.selectedFiles = new Set(['root-app-conf'])
  entry.state.lastClickedFile = 'root-app-conf'
  entry.state.remoteFileIdentity = {
    loginUsername: 'hik',
    effectiveUid: '0',
    effectiveUsername: 'root',
    channel: 'pty-root'
  }

  await assert.rejects(
    entry.remoteList(false, '/root-only', undefined, { rethrow: true }),
    error => error === unavailable
  )

  assertRemoteSnapshotCleared(entry)
  assert.equal(entry.state.remoteFileIdentity.channel, 'unknown')
  assert.equal(entry.state.remoteFileStatus, 'unavailable')
})

test('login denial after root clears stale privileged rows', async () => {
  const rootIdentity = {
    channel: 'pty-root',
    effectiveUid: '0',
    effectiveUsername: 'root'
  }
  const loginIdentity = {
    channel: 'sftp',
    effectiveUid: 'unknown',
    effectiveUsername: 'hik'
  }
  const permissionError = Object.assign(new Error('permission denied'), {
    code: 'EACCES'
  })
  let acquireIndex = 0
  const acquire = async ({ onIdentity }) => {
    const runtimeIdentity = acquireIndex++ === 0
      ? rootIdentity
      : loginIdentity
    await onIdentity({ loginUsername: 'hik', ...runtimeIdentity })
    return {
      runtimeIdentity,
      backend: {
        list: async () => {
          if (runtimeIdentity === loginIdentity) throw permissionError
          return [
            { name: 'app.conf', type: 'f', size: 12 },
            { name: 'cancel.bin', type: 'f', size: 16 }
          ]
        }
      },
      release: async () => true
    }
  }
  const { entry } = await createEntryHarness({ acquire })

  await entry.remoteList(false, '/root-only')
  assert.deepEqual(entry.state.remote.map(file => file.name), [
    'app.conf', 'cancel.bin'
  ])
  entry.state.selectedType = 'remote'
  entry.state.selectedFiles = new Set([entry.state.remote[0].id])
  entry.state.lastClickedFile = entry.state.remote[0].id

  await assert.rejects(
    entry.remoteList(false, '/root-only', undefined, { rethrow: true }),
    error => error === permissionError
  )

  assertRemoteSnapshotCleared(entry)
  assert.equal(entry.state.remoteFileIdentity.channel, 'sftp')
})

test('cached root list fails closed when its guarded operation loses identity', async () => {
  const unavailable = Object.assign(new Error('identity unavailable'), {
    code: 'REMOTE_FILE_IDENTITY_UNAVAILABLE'
  })
  let acquisition = 0
  const acquire = async ({ onIdentity }) => {
    const attempt = ++acquisition
    await onIdentity({ loginUsername: 'hik', ...rootRuntimeIdentity })
    return {
      runtimeIdentity: rootRuntimeIdentity,
      backend: {
        list: async () => {
          if (attempt > 1) throw unavailable
          return [{ name: 'app.conf', type: 'f', size: 12 }]
        }
      },
      release: async () => true
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  const entries = new Map()
  entry.remoteDirectoryCache = {
    get: key => entries.has(key)
      ? { value: structuredClone(entries.get(key)) }
      : null,
    set: (key, value) => entries.set(key, structuredClone(value)),
    clear: () => entries.clear()
  }

  await entry.remoteList(false, '/root-only')
  entry.state.selectedType = 'remote'
  entry.state.selectedFiles = new Set([entry.state.remote[0].id])
  entry.state.lastClickedFile = entry.state.remote[0].id
  await assert.rejects(
    entry.remoteList(false, '/root-only', undefined, { rethrow: true }),
    error => error === unavailable
  )

  assertRemoteSnapshotCleared(entry)
  assert.equal(entry.state.remoteFileIdentity.channel, 'unknown')
  assert.equal(entry.state.remoteFileStatus, 'unavailable')
})

test('cached root metadata fails closed on a later identity mismatch', async () => {
  const mismatch = Object.assign(new Error('runtime identity mismatch'), {
    code: 'REMOTE_FILE_IDENTITY_MISMATCH'
  })
  let acquisition = 0
  const acquire = async ({ onIdentity }) => {
    const attempt = ++acquisition
    await onIdentity({ loginUsername: 'hik', ...rootRuntimeIdentity })
    return {
      runtimeIdentity: rootRuntimeIdentity,
      backend: {
        list: async () => [{ name: 'app.conf', type: 'f', size: 12 }],
        stat: async () => {
          if (attempt > 1) throw mismatch
          return { type: 'f', size: 12 }
        }
      },
      release: async () => true
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  const entries = new Map()
  entry.remoteDirectoryCache = {
    get: key => entries.has(key)
      ? { value: structuredClone(entries.get(key)) }
      : null,
    set: (key, value) => entries.set(key, structuredClone(value)),
    clear: () => entries.clear()
  }
  entry.updateRemoteList = async (remote, remotePath, backend) => {
    await backend.stat(`${remotePath}/app.conf`)
    return remote
  }

  await entry.remoteList(false, '/root-only')
  entry.state.selectedType = 'remote'
  entry.state.selectedFiles = new Set([entry.state.remote[0].id])
  entry.state.lastClickedFile = entry.state.remote[0].id
  await assert.rejects(
    entry.remoteList(false, '/root-only', undefined, { rethrow: true }),
    error => error === mismatch
  )

  assertRemoteSnapshotCleared(entry)
  assert.equal(entry.state.remoteFileIdentity.channel, 'unknown')
  assert.equal(entry.state.remoteFileStatus, 'unavailable')
})

test('sensitive code-only failures outrank nested transient causes', async t => {
  const cases = [
    ['REMOTE_FILE_IDENTITY_UNKNOWN', true],
    ['REMOTE_FILE_IDENTITY_UNAVAILABLE', true],
    ['REMOTE_FILE_IDENTITY_MISMATCH', true],
    ['REMOTE_FILE_IDENTITY_CHANGED', true],
    ['REMOTE_FILE_IDENTITY_SWITCH', true],
    ['PERMISSION_DENIED', false],
    ['SSH_FX_PERMISSION_DENIED', false],
    ['SFTP_PERMISSION_DENIED', false],
    ['EACCES', false],
    ['EPERM', false],
    [3, false]
  ]
  for (const [code, identityFailure] of cases) {
    await t.test(String(code), async () => {
      const transientCause = Object.assign(new Error(), {
        code: 'ECONNRESET'
      })
      const sensitiveError = Object.assign(new Error(), {
        code,
        cause: transientCause
      })
      const acquire = async ({ onIdentity }) => {
        await onIdentity({ loginUsername: 'hik', ...rootRuntimeIdentity })
        return {
          runtimeIdentity: rootRuntimeIdentity,
          backend: { list: async () => { throw sensitiveError } },
          release: async () => true
        }
      }
      const { entry } = await createEntryHarness({ acquire })
      const rootFile = {
        id: 'root-app-conf',
        name: 'app.conf',
        path: '/root-only',
        type: 'remote'
      }
      entry.state.remote = [rootFile]
      entry.state.remoteFileTree = entry.buildTree(entry.state.remote)
      entry.state.selectedType = 'remote'
      entry.state.selectedFiles = new Set([rootFile.id])
      entry.state.lastClickedFile = rootFile.id
      entry.state.remoteFileIdentity = {
        loginUsername: 'hik',
        effectiveUid: '0',
        effectiveUsername: 'root',
        channel: 'pty-root'
      }
      const identityEpoch = entry.remoteFileIdentityEpoch +
        (identityFailure ? 1 : 0)
      entry.remoteDirectoryCache = {
        get: key => {
          entry.visibleRemoteDirectoryCacheKey = key
          return { value: [structuredClone(rootFile)] }
        },
        set: () => {},
        clear: () => {}
      }

      await assert.rejects(
        entry.remoteList(false, '/root-only', undefined, { rethrow: true }),
        error => error === sensitiveError
      )

      assertRemoteSnapshotCleared(entry, {
        identityEpoch,
        identityChannel: identityFailure ? 'unknown' : 'pty-root',
        identityStatus: identityFailure ? 'unavailable' : 'idle'
      })
    })
  }
})

test('unsafe failure invalidates a delayed cached paint callback', async () => {
  const transientCause = Object.assign(new Error(), {
    code: 'ECONNRESET'
  })
  const unavailable = Object.assign(new Error(), {
    code: 'REMOTE_FILE_IDENTITY_UNAVAILABLE',
    cause: transientCause
  })
  const acquire = async ({ onIdentity }) => {
    await onIdentity({ loginUsername: 'hik', ...rootRuntimeIdentity })
    return {
      runtimeIdentity: rootRuntimeIdentity,
      backend: { list: async () => { throw unavailable } },
      release: async () => true
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  const rootFile = {
    id: 'root-app-conf',
    name: 'app.conf',
    path: '/root-only',
    type: 'remote'
  }
  entry.state.remote = [rootFile]
  entry.state.remoteFileTree = entry.buildTree(entry.state.remote)
  entry.state.selectedType = 'remote'
  entry.state.selectedFiles = new Set([rootFile.id])
  entry.state.lastClickedFile = rootFile.id
  entry.state.remoteFileIdentity = {
    loginUsername: 'hik',
    effectiveUid: '0',
    effectiveUsername: 'root',
    channel: 'pty-root'
  }
  entry.remoteDirectoryCache = {
    get: key => {
      entry.visibleRemoteDirectoryCacheKey = key
      return { value: [structuredClone(rootFile)] }
    },
    set: () => {},
    clear: () => {}
  }
  const pendingStateWrites = []
  entry.setState = (update, callback) => {
    pendingStateWrites.push({ update, callback })
  }
  const identityEpoch = entry.remoteFileIdentityEpoch + 1

  await assert.rejects(
    entry.remoteList(false, '/root-only', undefined, { rethrow: true }),
    error => error === unavailable
  )

  const delayedCallbacks = []
  for (const pending of pendingStateWrites) {
    const next = typeof pending.update === 'function'
      ? pending.update(entry.state)
      : pending.update
    if (next) Object.assign(entry.state, next)
    if (pending.callback) delayedCallbacks.push(pending.callback)
  }
  for (const callback of delayedCallbacks.reverse()) callback()
  await Promise.resolve()

  assertRemoteSnapshotCleared(entry, {
    identityEpoch,
    identityChannel: 'unknown',
    identityStatus: 'unavailable'
  })
})

test('unexpected classifier failure still clears a privileged snapshot', async () => {
  const transient = Object.assign(new Error('transport reset'), {
    code: 'ECONNRESET'
  })
  const acquire = async ({ onIdentity }) => {
    await onIdentity({ loginUsername: 'hik', ...rootRuntimeIdentity })
    return {
      runtimeIdentity: rootRuntimeIdentity,
      backend: { list: async () => { throw transient } },
      release: async () => true
    }
  }
  const { entry } = await createEntryHarness({
    acquire,
    classifyRecoveryError: () => { throw new Error('classifier failed') }
  })
  const rootFile = {
    id: 'root-app-conf',
    name: 'app.conf',
    path: '/root-only',
    type: 'remote'
  }
  entry.state.remote = [rootFile]
  entry.state.remoteFileTree = entry.buildTree(entry.state.remote)
  entry.state.selectedType = 'remote'
  entry.state.selectedFiles = new Set([rootFile.id])
  entry.state.lastClickedFile = rootFile.id
  entry.visibleRemoteDirectoryCacheKey = 'root-cache-key'
  entry.remoteDirectoryCache = {
    get: key => {
      entry.visibleRemoteDirectoryCacheKey = key
      return { value: [structuredClone(rootFile)] }
    },
    set: () => {},
    clear: () => {}
  }

  await entry.remoteList(false, '/root-only')

  assertRemoteSnapshotCleared(entry)
})

test('hostile SFTP errors cannot escape normalization before snapshot clear', async t => {
  const cases = [
    ['throwing message getter', () => {
      const failure = { code: 'ECONNRESET' }
      Object.defineProperty(failure, 'message', {
        get () { throw new Error('message denied') }
      })
      return failure
    }],
    ['revoked proxy', () => {
      const revoked = Proxy.revocable(new Error('revoked failure'), {})
      revoked.revoke()
      return revoked.proxy
    }]
  ]

  for (const [name, createFailure] of cases) {
    await t.test(name, async () => {
      const failure = createFailure()
      const acquire = async ({ onIdentity }) => {
        await onIdentity({ loginUsername: 'hik', ...rootRuntimeIdentity })
        return {
          runtimeIdentity: rootRuntimeIdentity,
          backend: { list: async () => { throw failure } },
          release: async () => true
        }
      }
      const { entry } = await createEntryHarness({ acquire })
      const rootFile = {
        id: 'root-app-conf',
        name: 'app.conf',
        path: '/root-only',
        type: 'remote'
      }
      entry.state.remote = [rootFile]
      entry.state.remoteFileTree = entry.buildTree(entry.state.remote)
      entry.state.selectedType = 'remote'
      entry.state.selectedFiles = new Set([rootFile.id])
      entry.state.lastClickedFile = rootFile.id
      entry.state.remoteFileIdentity = {
        loginUsername: 'hik',
        effectiveUid: '0',
        effectiveUsername: 'root',
        channel: 'pty-root'
      }
      entry.visibleRemoteDirectoryCacheKey = 'root-cache-key'
      const identityEpoch = entry.remoteFileIdentityEpoch + 1

      await entry.remoteList(false, '/root-only')

      assertRemoteSnapshotCleared(entry, {
        identityEpoch,
        identityChannel: 'unknown',
        identityStatus: 'unavailable'
      })
    })
  }
})

test('candidate failure secondary errors clear privileged state before escape', async t => {
  const cases = [
    ['candidate cleanup rejection', true, false],
    ['editTab rejection', false, true]
  ]

  for (const [name, cleanupRejects, editTabRejects] of cases) {
    await t.test(name, async () => {
      const primary = Object.assign(new Error('native connect failed'), {
        code: 'ECONNRESET'
      })
      const secondary = Object.assign(new Error(`${name} failed`), {
        code: cleanupRejects ? 'TEARDOWN_TIMEOUT' : 'EEDITTAB',
        uncertain: cleanupRejects
      })
      const candidate = {
        sshSessionGeneration: 'generation-1',
        sshTerminalPid: 4242,
        connect: async () => { throw primary },
        destroy: async () => {
          if (cleanupRejects) throw secondary
          return true
        }
      }
      const { entry } = await createEntryHarness({
        client: async () => candidate,
        editTab: () => {
          if (editTabRejects) throw secondary
        },
        acquire: async () => { throw new Error('unexpected acquire') }
      })
      const rootFile = {
        id: 'root-app-conf',
        name: 'app.conf',
        path: '/root-only',
        type: 'remote'
      }
      entry.sftp = null
      entry.state.remote = [rootFile]
      entry.state.remoteFileTree = entry.buildTree(entry.state.remote)
      entry.state.selectedType = 'remote'
      entry.state.selectedFiles = new Set([rootFile.id])
      entry.state.lastClickedFile = rootFile.id
      entry.state.remoteFileIdentity = {
        loginUsername: 'hik',
        effectiveUid: '0',
        effectiveUsername: 'root',
        channel: 'pty-root'
      }
      entry.visibleRemoteDirectoryCacheKey = 'root-cache-key'
      const identityEpoch = entry.remoteFileIdentityEpoch + 1

      await assert.rejects(
        entry.remoteList(false, '/root-only', undefined, { rethrow: true }),
        error => {
          assert.equal(error, primary)
          assert.equal(Array.isArray(error.cleanupErrors), true)
          assert.equal(error.cleanupErrors.length, 1)
          assert.equal(error.cleanupErrors[0], secondary)
          return true
        }
      )

      assertRemoteSnapshotCleared(entry, {
        identityEpoch,
        identityChannel: 'unknown',
        identityStatus: 'unavailable'
      })
    })
  }
})

test('cleanup attachment bounds hostile existing iterables before escape', async t => {
  const cases = [
    ['4096 cleanup errors', () => ({
      source: new Array(4096).fill(new Error('old cleanup')),
      iteratorCalls: []
    })],
    ['infinite cleanup iterator', () => {
      const iteratorCalls = []
      const source = []
      Object.defineProperty(source, Symbol.iterator, {
        value: () => {
          const counter = { count: 0 }
          iteratorCalls.push(counter)
          return {
            next: () => {
              counter.count += 1
              if (counter.count > 256) {
                throw new Error('cleanup iteration was not bounded')
              }
              return { done: false, value: new Error('old cleanup') }
            }
          }
        }
      })
      return { source, iteratorCalls }
    }]
  ]

  for (const [name, createExisting] of cases) {
    await t.test(name, async () => {
      const { source, iteratorCalls } = createExisting()
      const primary = Object.assign(new Error('native connect failed'), {
        code: 'ECONNRESET',
        cleanupErrors: source
      })
      const secondary = Object.assign(new Error('candidate teardown failed'), {
        code: 'TEARDOWN_TIMEOUT',
        uncertain: true
      })
      const candidate = {
        sshSessionGeneration: 'generation-1',
        sshTerminalPid: 4242,
        connect: async () => { throw primary },
        destroy: async () => { throw secondary }
      }
      const { entry } = await createEntryHarness({
        client: async () => candidate,
        acquire: async () => { throw new Error('unexpected acquire') }
      })
      const rootFile = {
        id: 'root-app-conf',
        name: 'app.conf',
        path: '/root-only',
        type: 'remote'
      }
      entry.sftp = null
      entry.state.remote = [rootFile]
      entry.state.remoteFileTree = entry.buildTree(entry.state.remote)
      entry.state.selectedFiles = new Set([rootFile.id])
      entry.state.lastClickedFile = rootFile.id
      entry.state.remoteFileIdentity = {
        loginUsername: 'hik',
        effectiveUid: '0',
        effectiveUsername: 'root',
        channel: 'pty-root'
      }
      entry.visibleRemoteDirectoryCacheKey = 'root-cache-key'
      const identityEpoch = entry.remoteFileIdentityEpoch + 1

      await assert.rejects(
        entry.remoteList(false, '/root-only', undefined, { rethrow: true }),
        error => error === primary
      )

      assertRemoteSnapshotCleared(entry, {
        identityEpoch,
        identityChannel: 'unknown',
        identityStatus: 'unavailable'
      })
      assert.ok(primary.cleanupErrors.length <= 32)
      assert.equal(
        Array.from(primary.cleanupErrors).includes(secondary),
        true
      )
      assert.equal(
        Array.from(primary.cleanupErrors).some(error => (
          error?.code === 'REMOTE_FILE_CLEANUP_ERRORS_TRUNCATED'
        )),
        true
      )
      for (const calls of iteratorCalls) assert.ok(calls.count <= 128)
      if (iteratorCalls.length > 1) {
        assert.ok(iteratorCalls[iteratorCalls.length - 1].count <= 32)
      }
    })
  }
})

test('normal SFTP error display and code remain unchanged', async () => {
  const { entry } = await createEntryHarness()
  const failure = Object.assign(new Error(' permission denied '), {
    code: 'EACCES'
  })

  const normalized = entry.normalizeSftpError(failure)

  assert.equal(normalized.message, ' permission denied ')
  assert.equal(normalized.code, 'EACCES')
})

test('deep and structured sensitive failures never recover a visible cache', async t => {
  const deepCause = (() => {
    let nested = Object.assign(new Error(), {
      code: 'REMOTE_FILE_IDENTITY_UNKNOWN'
    })
    for (let index = 0; index < 8; index += 1) {
      nested = Object.assign(new Error(), { cause: nested })
    }
    return Object.assign(new Error(), {
      code: 'ECONNRESET',
      cause: nested
    })
  })()
  const reversedDeep = (() => {
    let nested = Object.assign(new Error(), { code: 'ECONNRESET' })
    for (let index = 0; index < 9; index += 1) {
      nested = Object.assign(new Error(), { cause: nested })
    }
    return Object.assign(new Error(), {
      code: 'REMOTE_FILE_IDENTITY_CHANGED',
      cause: nested
    })
  })()
  const cyclic = Object.assign(new Error(), { code: 'ECONNRESET' })
  const cyclicCause = new Error()
  cyclic.cause = cyclicCause
  cyclicCause.cause = cyclic
  cyclicCause.cleanupError = Object.assign(new Error(), {
    code: 'SSH_FX_PERMISSION_DENIED'
  })
  const releaseIdentity = Object.assign(new Error(), {
    code: 'ECONNRESET',
    releaseError: Object.assign(new Error(), {
      code: 'REMOTE_FILE_IDENTITY_MISMATCH'
    })
  })
  const releasePermission = Object.assign(new Error(), {
    code: 'ECONNRESET',
    releaseError: Object.assign(new Error(), {
      code: 'PERMISSION_DENIED'
    })
  })
  const releaseUncertain = Object.assign(new Error(), {
    code: 'ECONNRESET',
    releaseError: Object.assign(new Error(), { code: 'ECONNRESET' })
  })
  const cleanupUncertain = Object.assign(new Error(), {
    code: 'ECONNRESET',
    cleanupAttempted: true,
    cleanupSucceeded: false
  })
  const traversalOverflow = (() => {
    let nested = new Error()
    for (let index = 0; index < 80; index += 1) {
      nested = Object.assign(new Error(), { cause: nested })
    }
    nested.code = 'ECONNRESET'
    return nested
  })()
  const cases = [
    ['depth-nine identity', deepCause, true],
    ['reversed deep identity', reversedDeep, true],
    ['cyclic cleanup permission', cyclic, true],
    ['release identity', releaseIdentity, true],
    ['release permission', releasePermission, true],
    ['release uncertainty', releaseUncertain, true],
    ['cleanup uncertainty', cleanupUncertain, true],
    ['traversal overflow', traversalOverflow, true]
  ]

  for (const [name, failure, invalidatesIdentity] of cases) {
    await t.test(name, async () => {
      const acquire = async ({ onIdentity }) => {
        await onIdentity({ loginUsername: 'hik', ...rootRuntimeIdentity })
        return {
          runtimeIdentity: rootRuntimeIdentity,
          backend: { list: async () => { throw failure } },
          release: async () => true
        }
      }
      const { entry } = await createEntryHarness({ acquire })
      const rootFile = {
        id: 'root-app-conf',
        name: 'app.conf',
        path: '/root-only',
        type: 'remote'
      }
      entry.state.remote = [rootFile]
      entry.state.remoteFileTree = entry.buildTree(entry.state.remote)
      entry.state.selectedType = 'remote'
      entry.state.selectedFiles = new Set([rootFile.id])
      entry.state.lastClickedFile = rootFile.id
      entry.state.remoteFileIdentity = {
        loginUsername: 'hik',
        effectiveUid: '0',
        effectiveUsername: 'root',
        channel: 'pty-root'
      }
      const identityEpoch = entry.remoteFileIdentityEpoch +
        (invalidatesIdentity ? 1 : 0)
      entry.remoteDirectoryCache = {
        get: key => {
          entry.visibleRemoteDirectoryCacheKey = key
          return { value: [structuredClone(rootFile)] }
        },
        set: () => {},
        clear: () => {}
      }

      await assert.rejects(
        entry.remoteList(false, '/root-only', undefined, { rethrow: true }),
        error => error === failure
      )

      assertRemoteSnapshotCleared(entry, {
        identityEpoch,
        identityChannel: invalidatesIdentity ? 'unknown' : 'pty-root',
        identityStatus: invalidatesIdentity ? 'unavailable' : 'idle'
      })
    })
  }
})

test('same identity refresh can recover from its own cached snapshot', async () => {
  const runtimeIdentity = {
    channel: 'pty-root',
    effectiveUid: '0',
    effectiveUsername: 'root'
  }
  const refreshError = Object.assign(new Error('temporary transport failure'), {
    code: 'ECONNRESET'
  })
  let acquisition = 0
  const acquire = async ({ onIdentity }) => {
    const attempt = ++acquisition
    await onIdentity({ loginUsername: 'hik', ...runtimeIdentity })
    return {
      runtimeIdentity,
      backend: {
        list: async () => {
          if (attempt > 1) throw refreshError
          return [{ name: 'app.conf', type: 'f', size: 12 }]
        }
      },
      release: async () => true
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  const entries = new Map()
  entry.remoteDirectoryCache = {
    get: key => entries.has(key)
      ? { value: structuredClone(entries.get(key)) }
      : null,
    set: (key, value) => entries.set(key, structuredClone(value)),
    clear: () => entries.clear()
  }

  await entry.remoteList(false, '/root-only')
  await assert.rejects(
    entry.remoteList(false, '/root-only', undefined, { rethrow: true }),
    error => error === refreshError
  )

  assert.deepEqual(entry.state.remote.map(file => file.name), ['app.conf'])
  assert.equal(entry.state.remoteRefreshState, 'stale-error')
})

test('ordinary remote refresh schedules no delayed compensation callback', async () => {
  const timers = []
  const reports = []
  const acquire = async () => ({
    runtimeIdentity: rootRuntimeIdentity,
    backend: { list: async () => [] },
    release: async () => true
  })
  const { entry } = await createEntryHarness({
    acquire,
    replaceTimer: (_entry, _key, callback) => {
      timers.push(callback)
      return timers.length
    },
    reportBackgroundError: error => reports.push(error)
  })
  entry.updateRemoteList = async remote => remote
  await entry.remoteList(false, '/root')
  assert.equal(timers.length, 0)
  assert.deepEqual(reports, [])
})

test('remote list waits for committed paint and metric acceptance', async () => {
  const committed = deferred()
  const metricsAccepted = deferred()
  const metricNames = []
  const acquire = async () => ({
    runtimeIdentity: rootRuntimeIdentity,
    backend: { list: async () => [] },
    release: async () => true
  })
  const { entry, lifecycle } = await createEntryHarness({
    acquire,
    recordPerformanceDuration: name => {
      metricNames.push(name)
      return metricsAccepted.promise
    }
  })
  entry.updateRemoteList = async remote => remote
  entry.props.editTab = (_id, update) => Object.assign(entry.props.tab, update)
  let commitCallback
  entry.setState = (update, callback) => {
    const next = typeof update === 'function' ? update(entry.state) : update
    if (next) Object.assign(entry.state, next)
    if (next?.inited) {
      commitCallback = callback
      committed.resolve()
      return
    }
    callback?.()
  }
  let listingSettled = false
  const listing = entry.remoteList(false, '/root').finally(() => {
    listingSettled = true
  })

  await committed.promise
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(entry.state.inited, true)
  assert.equal(listingSettled, false)
  assert.deepEqual(
    lifecycle.getSftpEntryReadinessSnapshot(entry),
    {
      explicitOpenPending: false,
      sessionBindingPending: false,
      backgroundTaskCount: 0,
      renderCommitCount: 1,
      metricTaskCount: 0,
      requestEpoch: 1,
      visibleRemoteCommitted: false,
      firstReadyCommitted: false,
      fullySettled: false
    }
  )

  commitCallback()
  await Promise.resolve()
  assert.deepEqual(metricNames, [
    'sftp_refresh_ms',
    'first_sftp_ready_ms'
  ])
  assert.equal(listingSettled, false)
  const accepting = lifecycle.getSftpEntryReadinessSnapshot(entry)
  assert.equal(accepting.renderCommitCount, 1)
  assert.equal(accepting.metricTaskCount, 2)
  assert.equal(accepting.fullySettled, false)

  metricsAccepted.resolve(true)
  await listing
  assert.deepEqual(
    lifecycle.getSftpEntryReadinessSnapshot(entry),
    {
      explicitOpenPending: false,
      sessionBindingPending: false,
      backgroundTaskCount: 0,
      renderCommitCount: 0,
      metricTaskCount: 0,
      requestEpoch: 1,
      visibleRemoteCommitted: true,
      firstReadyCommitted: true,
      fullySettled: true
    }
  )
})

test('authoritative SSH list paints before capability release while readiness stays pending', async () => {
  const listStarted = deferred()
  const listFinished = deferred()
  const releaseStarted = deferred()
  const releaseFinished = deferred()
  const metricNames = []
  const acquire = async () => ({
    runtimeIdentity: rootRuntimeIdentity,
    backend: {
      async list () {
        listStarted.resolve()
        await listFinished.promise
        return [{ name: 'authoritative', type: '-', size: 0 }]
      }
    },
    async release () {
      releaseStarted.resolve()
      await releaseFinished.promise
      return true
    }
  })
  const { entry, lifecycle } = await createEntryHarness({
    acquire,
    recordPerformanceDuration: name => {
      metricNames.push(name)
      return true
    }
  })
  entry.updateRemoteList = async remote => remote
  let listingSettled = false
  const listing = entry.remoteList(false, '/root', undefined, {
    rethrow: true
  }).finally(() => { listingSettled = true })

  await listStarted.promise
  assert.equal(entry.state.inited, undefined)
  assert.deepEqual(metricNames, [])
  listFinished.resolve(true)
  await releaseStarted.promise
  assert.equal(entry.state.inited, true)
  assert.deepEqual(entry.state.remote.map(file => file.name), [
    'authoritative'
  ])
  assert.deepEqual(metricNames, [
    'sftp_refresh_ms',
    'first_sftp_ready_ms'
  ])
  assert.equal(listingSettled, false)
  assert.equal(
    lifecycle.getSftpEntryReadinessSnapshot(entry).fullySettled,
    false
  )

  releaseFinished.resolve(true)
  await listing
  assert.equal(
    lifecycle.getSftpEntryReadinessSnapshot(entry).fullySettled,
    true
  )
})

test('post-paint release failure stays observable and blocks settled readiness', async () => {
  const releaseError = new Error('visible list release failed')
  const reports = []
  const acquire = async ({ onLeaseState }) => {
    onLeaseState({
      state: 'acquired',
      operationId: 'visible-list'
    })
    return {
      runtimeIdentity: rootRuntimeIdentity,
      backend: { list: async () => [] },
      async release () {
        onLeaseState({
          state: 'release-failed',
          operationId: 'visible-list',
          error: releaseError
        })
        throw releaseError
      }
    }
  }
  const harness = await createEntryHarness({
    acquire,
    reportOperationError: error => reports.push(error)
  })
  const { entry } = harness
  entry.updateRemoteList = async remote => remote

  await assert.doesNotReject(entry.remoteList(false, '/root', undefined, {
    rethrow: true
  }))
  assert.equal(entry.state.inited, true)
  assert.deepEqual(reports, [releaseError])
  assert.equal(entry.state.remoteRefreshError, '')
  assert.equal(entry.state.remoteFileStatus, 'uncertain')
  assert.deepEqual([...entry.uncertainRemoteFileLeases], ['visible-list'])
  assert.equal(
    harness.lifecycle.getSftpEntryReadinessSnapshot(entry).fullySettled,
    false
  )
})

test('rejected performance acceptance never fails an SFTP list', async () => {
  const metricFailure = new Error('metrics unavailable')
  const acquire = async () => ({
    runtimeIdentity: rootRuntimeIdentity,
    backend: { list: async () => [] },
    release: async () => true
  })
  const { entry } = await createEntryHarness({
    acquire,
    recordPerformanceDuration: () => Promise.reject(metricFailure)
  })
  entry.updateRemoteList = async remote => remote

  await assert.doesNotReject(entry.remoteList(false, '/root'))
  assert.equal(entry.state.inited, true)
  assert.equal(entry.state.remoteLoading, false)
  assert.equal(entry.firstSftpReadyRecorded, true)
})

test('remote owner initialization waits for its render commit', async () => {
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  const committed = deferred()
  const entry = {
    props: { pid: 42 },
    state: {},
    setState (update, callback) {
      const next = typeof update === 'function'
        ? update(this.state)
        : update
      if (next) Object.assign(this.state, next)
      committed.resolve(callback)
    }
  }
  installClassField(entry, 'remoteListOwner', {
    beginSftpEntryRenderCommit: lifecycle.beginSftpEntryRenderCommit,
    isCurrentSftpEntryRemoteTask: () => true,
    owner: {
      remoteListUsers: async () => ({ root: 0 }),
      remoteListGroups: async () => ({ root: 0 })
    }
  })
  let ownerSettled = false
  const owners = entry.remoteListOwner({ requestEpoch: 1 }).finally(() => {
    ownerSettled = true
  })

  const callback = await committed.promise
  await Promise.resolve()
  assert.equal(ownerSettled, false)
  callback()
  await owners
  assert.deepEqual(entry.state.remoteUidTree, { root: 0 })
  assert.deepEqual(entry.state.remoteGidTree, { root: 0 })
})

test('remote owner user and group RPCs overlap before either settles', async () => {
  const usersFinished = deferred()
  const groupsFinished = deferred()
  const calls = []
  const entry = {
    props: { pid: 42 },
    state: {},
    setState (update, callback) {
      const next = typeof update === 'function'
        ? update(this.state)
        : update
      if (next) Object.assign(this.state, next)
      callback?.()
    }
  }
  installClassField(entry, 'remoteListOwner', {
    beginSftpEntryRenderCommit: () => ({
      promise: Promise.resolve(true),
      settle: () => true
    }),
    isCurrentSftpEntryRemoteTask: () => true,
    owner: {
      remoteListUsers: async () => {
        calls.push('users')
        await usersFinished.promise
        return { root: 0 }
      },
      remoteListGroups: async () => {
        calls.push('groups')
        await groupsFinished.promise
        return { root: 0 }
      }
    }
  })
  const owners = entry.remoteListOwner({ requestEpoch: 1 })
  await Promise.resolve()
  await Promise.resolve()
  let overlapError
  try {
    assert.deepEqual(calls, ['users', 'groups'])
  } catch (error) {
    overlapError = error
  } finally {
    usersFinished.resolve()
    groupsFinished.resolve()
  }
  await owners
  if (overlapError) throw overlapError
  assert.deepEqual(entry.state.remoteUidTree, { root: 0 })
  assert.deepEqual(entry.state.remoteGidTree, { root: 0 })
})

test('remote initialization tracks owner RPC before it starts', async () => {
  const ownerStarted = deferred()
  const ownerFinished = deferred()
  const { entry, lifecycle } = await createEntryHarness({
    acquire: async () => ({
      backend: { list: async () => [] },
      release: async () => true
    })
  })
  entry.remoteList = async () => true
  entry.remoteListOwner = async () => {
    ownerStarted.resolve()
    await ownerFinished.promise
    return true
  }
  installClassField(entry, 'initRemoteAll', {
    beginSftpEntryRemoteTask: lifecycle.beginSftpEntryRemoteTask,
    isCurrentSftpEntryRemoteTask: lifecycle.isCurrentSftpEntryRemoteTask,
    trackSftpEntryBackgroundTask: lifecycle.trackSftpEntryBackgroundTask
  })

  const initialization = entry.initRemoteAll()
  await ownerStarted.promise
  assert.equal(
    lifecycle.getSftpEntryReadinessSnapshot(entry).backgroundTaskCount,
    1
  )

  ownerFinished.resolve()
  await initialization
  assert.equal(
    lifecycle.getSftpEntryReadinessSnapshot(entry).backgroundTaskCount,
    0
  )
})

test('initial SSH home lookup overlaps remote capability acquisition', async () => {
  const homeReady = deferred()
  const capabilityStarted = deferred()
  const calls = []
  const capability = createBackend(calls, 'initial-home')
  const acquire = async () => {
    capabilityStarted.resolve()
    return {
      backend: capability.backend,
      runtimeIdentity: {
        channel: 'sftp',
        effectiveUid: 'unknown',
        effectiveUsername: 'hik'
      },
      release: capability.release
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  entry.state.remotePath = ''
  entry.getPwd = () => homeReady.promise
  entry.updateRemoteList = async remote => remote

  const listing = entry.remoteList(false, undefined, undefined, {
    rethrow: true
  })
  await capabilityStarted.promise

  homeReady.resolve('/home/hik')
  await listing
  assert.deepEqual(
    calls.filter(call => call[0] === 'list'),
    [['list', 'initial-home', '/home/hik']]
  )
  assert.equal(entry.state.remotePath, '/home/hik')
})

test('real entry bind chain keeps hidden SSH login lazy and initial full SFTP eager', async () => {
  const calls = []
  let clientCount = 0
  let preparedProbeCount = 0
  let acquireCount = 0
  const backend = createBackend(calls, 'bind-list')
  const acquire = async ({ onIdentity }) => {
    acquireCount += 1
    await onIdentity({
      loginUsername: 'hik',
      effectiveUid: '1000',
      effectiveUsername: 'hik',
      channel: 'sftp'
    })
    return {
      backend: backend.backend,
      runtimeIdentity: {
        channel: 'sftp',
        effectiveUid: '1000',
        effectiveUsername: 'hik'
      },
      release: backend.release
    }
  }
  const { entry, lifecycle } = await createEntryHarness({
    acquire,
    client: async () => {
      clientCount += 1
      return {
        sshSessionGeneration: `candidate-${clientCount}`,
        sshTerminalPid: 4242,
        connect: async () => true,
        destroy: async () => true
      }
    },
    beginProbe: () => {
      preparedProbeCount += 1
      throw new Error('hidden bind started a prepared probe')
    }
  })
  const reports = []
  const localCalls = []
  entry.props.tab = {
    ...entry.props.tab,
    host: 'fixture.invalid',
    type: 'ssh'
  }
  entry.props.isFtp = false
  entry.props.enableSftp = false
  entry.localListOwner = () => localCalls.push('owner')
  entry.localList = () => localCalls.push('list')
  entry.remoteListOwner = async () => calls.push(['remote-owner'])
  entry.updateRemoteList = async remote => remote
  installClassField(entry, 'initData', {
    bindSftpEntryRemoteSession: lifecycle.bindSftpEntryRemoteSession,
    window: { store: { onError: error => reports.push(error) } }
  })
  installClassField(entry, 'shouldRenderRemote', {
    terminalSerialType: 'serial'
  })
  installClassField(entry, 'shouldInitializeRemoteOnBind')
  installClassField(entry, 'initRemoteAll', {
    beginSftpEntryRemoteTask: lifecycle.beginSftpEntryRemoteTask,
    isCurrentSftpEntryRemoteTask: lifecycle.isCurrentSftpEntryRemoteTask
  })
  installClassField(entry, 'initLocalAll')

  await entry.initData('tab-1', 41001, 'generation-login', '1001')

  assert.equal(clientCount, 0)
  assert.equal(preparedProbeCount, 0)
  assert.equal(acquireCount, 0)
  assert.deepEqual(localCalls, ['owner', 'list'])
  assert.deepEqual(reports, [])

  entry.props.enableSftp = true
  await entry.initData('tab-1', 41002, 'generation-full', '1002')

  assert.equal(clientCount, 1)
  assert.equal(preparedProbeCount, 0)
  assert.equal(acquireCount, 1)
  assert.deepEqual(localCalls, ['owner', 'list', 'owner', 'list'])
  assert.deepEqual(reports, [])
})

test('explicit first open overlaps one prepared probe with native connect', async () => {
  const connectGate = deferred()
  const connectStarted = deferred()
  const probeStarted = deferred()
  const calls = []
  const backend = createBackend(calls, 'prepared-list')
  let beginCount = 0
  let acquireCount = 0
  let consumeCount = 0
  let preparedReleaseCount = 0
  const prepared = Object.freeze({
    consume: async () => {
      consumeCount += 1
      return {
        backend: backend.backend,
        runtimeIdentity: {
          channel: 'pty-root',
          effectiveUid: '0',
          effectiveUsername: 'root'
        },
        release: backend.release
      }
    },
    abort: async () => { preparedReleaseCount += 1 },
    release: async () => { preparedReleaseCount += 1 }
  })
  const candidate = {
    sshSessionGeneration: 'generation-1',
    sshTerminalPid: 4242,
    async connect () {
      connectStarted.resolve()
      await connectGate.promise
      return true
    },
    async destroy () { calls.push(['destroy-candidate']) }
  }
  const { entry } = await createEntryHarness({
    client: async () => candidate,
    beginProbe: options => {
      beginCount += 1
      assert.equal(Object.hasOwn(options, 'sftp'), false)
      probeStarted.resolve()
      return prepared
    },
    acquire: async options => {
      acquireCount += 1
      throw new Error(`unexpected normal acquire: ${options.operationId}`)
    }
  })
  entry.sftp = null
  entry.updateRemoteList = async remote => remote

  const listing = entry.remoteList(false, '/root', undefined, {
    explicitOpen: true,
    rethrow: true
  })
  await connectStarted.promise
  let overlapError
  try {
    assert.equal(beginCount, 1)
    await probeStarted.promise
    assert.equal(consumeCount, 0)
    assert.equal(acquireCount, 0)
  } catch (error) {
    overlapError = error
  } finally {
    connectGate.resolve()
  }
  await listing
  if (overlapError) throw overlapError

  assert.equal(beginCount, 1)
  assert.equal(acquireCount, 0)
  assert.equal(consumeCount, 1)
  assert.equal(preparedReleaseCount, 0)
  assert.deepEqual(
    calls.filter(call => call[0] === 'list'),
    [['list', 'prepared-list', '/root']]
  )
})

test('explicit probe release settles before failed candidate destroy', async () => {
  const releaseGate = deferred()
  const abortStarted = deferred()
  const probeStarted = deferred()
  const connectError = new Error('native connect failed')
  const calls = []
  let releasePromise
  let releaseCount = 0
  const release = () => {
    if (releasePromise) return releasePromise
    releaseCount += 1
    calls.push('abort-start')
    abortStarted.resolve()
    releasePromise = releaseGate.promise.then(() => {
      calls.push('abort-end')
      return true
    })
    return releasePromise
  }
  const prepared = Object.freeze({
    consume: async () => { throw new Error('unexpected consume') },
    abort: release,
    release
  })
  const candidate = {
    sshSessionGeneration: 'generation-1',
    sshTerminalPid: 4242,
    async connect () { throw connectError },
    async destroy () {
      calls.push('destroy')
      return true
    }
  }
  const { entry } = await createEntryHarness({
    client: async () => candidate,
    beginProbe: () => {
      probeStarted.resolve()
      return prepared
    },
    acquire: async () => { throw new Error('unexpected acquire') }
  })
  entry.sftp = null

  const listing = entry.remoteList(false, '/root', undefined, {
    explicitOpen: true,
    rethrow: true
  })
  await probeStarted.promise
  await abortStarted.promise
  assert.deepEqual(calls, ['abort-start'])
  releaseGate.resolve()
  await assert.rejects(listing, error => error === connectError)
  assert.equal(releaseCount, 1)
  assert.deepEqual(calls, ['abort-start', 'abort-end', 'destroy'])
})

test('native connect failure keeps uncertain prepared abort sticky', async () => {
  const connectError = Object.assign(new Error('native connect failed'), {
    code: 'ECONNRESET'
  })
  const abortError = Object.assign(new Error('prepared abort timed out'), {
    code: 'TEARDOWN_TIMEOUT',
    uncertain: true
  })
  let clientCount = 0
  let probeCount = 0
  let abortCount = 0
  let destroyCount = 0
  let abortPromise
  const release = () => {
    abortCount += 1
    abortPromise ||= Promise.reject(abortError)
    return abortPromise
  }
  const prepared = Object.freeze({
    consume: async () => { throw new Error('unexpected consume') },
    abort: release,
    release
  })
  const candidate = {
    sshSessionGeneration: 'generation-1',
    sshTerminalPid: 4242,
    async connect () { throw connectError },
    async destroy () {
      destroyCount += 1
      return true
    }
  }
  const { entry, lifecycle } = await createEntryHarness({
    client: async () => {
      clientCount += 1
      return candidate
    },
    beginProbe: () => {
      probeCount += 1
      return prepared
    },
    acquire: async () => { throw new Error('unexpected acquire') }
  })
  entry.sftp = null
  const rootFile = {
    id: 'root-app-conf',
    name: 'app.conf',
    path: '/root',
    type: 'remote'
  }
  entry.state.remote = [rootFile]
  entry.state.remoteFileTree = entry.buildTree(entry.state.remote)
  entry.state.selectedType = 'remote'
  entry.state.selectedFiles = new Set([rootFile.id])
  entry.state.lastClickedFile = rootFile.id
  entry.state.remoteFileIdentity = {
    loginUsername: 'hik',
    effectiveUid: '0',
    effectiveUsername: 'root',
    channel: 'pty-root'
  }
  entry.visibleRemoteDirectoryCacheKey = 'root-cache-key'
  const identityEpoch = entry.remoteFileIdentityEpoch + 1
  entry.initRemoteAll = () => entry.remoteList(
    false,
    '/root',
    undefined,
    { explicitOpen: true, rethrow: true }
  )

  await assert.rejects(
    entry.remoteList(false, '/root', undefined, {
      explicitOpen: true,
      rethrow: true
    }),
    error => {
      assert.equal(error, connectError)
      assert.equal(error.cleanupErrors.length, 1)
      assert.equal(error.cleanupErrors[0], abortError)
      return true
    }
  )
  assertRemoteSnapshotCleared(entry, {
    identityEpoch,
    identityChannel: 'unknown',
    identityStatus: 'unavailable'
  })
  let stickyError
  await assert.rejects(lifecycle.reconnectSftpEntryRemote(entry), error => {
    stickyError = error
    assert.equal(error instanceof AggregateError, true)
    assert.deepEqual(error.errors, [abortError])
    return true
  })
  await assert.rejects(
    lifecycle.reconnectSftpEntryRemote(entry),
    error => error === stickyError
  )
  assert.equal(clientCount, 1)
  assert.equal(probeCount, 1)
  assert.equal(abortCount, 2)
  assert.equal(destroyCount, 1)
  assert.equal(entry.remoteFileGeneration.accepting, false)
})

test('prepared cleanup uncertainty invalidates identity on early branches', async t => {
  for (const branch of ['falsy connect', 'superseded probe']) {
    await t.test(branch, async () => {
      const abortError = Object.assign(new Error('prepared abort uncertain'), {
        code: 'TEARDOWN_TIMEOUT',
        uncertain: true
      })
      const prepared = Object.freeze({
        consume: async () => { throw new Error('unexpected consume') },
        abort: async () => { throw abortError },
        release: async () => { throw abortError }
      })
      const candidate = {
        sshSessionGeneration: 'generation-1',
        sshTerminalPid: 4242,
        connect: async () => branch === 'falsy connect' ? undefined : true,
        destroy: async () => true
      }
      const { entry } = await createEntryHarness({
        client: async () => candidate,
        beginProbe: () => prepared,
        acquire: async () => { throw new Error('unexpected acquire') }
      })
      entry.sftp = null
      if (branch === 'superseded probe') {
        entry.preparedRemoteFileCapabilityProbe = {
          generation: {},
          handle: prepared
        }
      }
      const rootFile = {
        id: 'root-app-conf',
        name: 'app.conf',
        path: '/root',
        type: 'remote'
      }
      entry.state.remote = [rootFile]
      entry.state.remoteFileTree = entry.buildTree(entry.state.remote)
      entry.state.selectedFiles = new Set([rootFile.id])
      entry.state.lastClickedFile = rootFile.id
      entry.state.remoteFileIdentity = {
        loginUsername: 'hik',
        effectiveUid: '0',
        effectiveUsername: 'root',
        channel: 'pty-root'
      }
      entry.visibleRemoteDirectoryCacheKey = 'root-cache-key'
      const identityEpoch = entry.remoteFileIdentityEpoch + 1

      const listing = entry.remoteList(false, '/root', undefined, {
        explicitOpen: true,
        rethrow: branch === 'superseded probe'
      })
      if (branch === 'superseded probe') {
        await assert.rejects(listing, error => error === abortError)
      } else {
        await assert.rejects(listing, error => error === abortError)
      }
      assert.equal(
        abortError.cleanupErrors?.includes(abortError) === true,
        false
      )

      assertRemoteSnapshotCleared(entry, {
        identityEpoch,
        identityChannel: 'unknown',
        identityStatus: 'unavailable'
      })
    })
  }
})

test('successful early cleanup still clears privileged state and invalidates identity', async t => {
  const cases = [
    ['falsy client', {
      client: async () => null
    }],
    ['prepared plus falsy connect', {
      explicitOpen: true,
      client: async () => ({
        connect: async () => undefined,
        destroy: async () => true
      }),
      beginProbe: () => ({
        abort: async () => true,
        release: async () => true
      })
    }],
    ['superseded task after connect', {
      supersedeAfterConnect: true
    }]
  ]

  for (const [name, setup] of cases) {
    await t.test(name, async () => {
      const context = {}
      const client = setup.supersedeAfterConnect
        ? async () => ({
          connect: async () => {
            context.lifecycle.beginSftpEntryRemoteTask(context.entry)
            return true
          },
          destroy: async () => true
        })
        : setup.client
      const harness = await createEntryHarness({
        client,
        beginProbe: setup.beginProbe,
        acquire: async () => { throw new Error('unexpected acquire') }
      })
      const { entry, lifecycle } = harness
      context.entry = entry
      context.lifecycle = lifecycle
      entry.sftp = null
      const rootFile = {
        id: 'root-app-conf',
        name: 'app.conf',
        path: '/root',
        type: 'remote'
      }
      entry.state.remote = [rootFile]
      entry.state.remoteFileTree = entry.buildTree(entry.state.remote)
      entry.state.selectedFiles = new Set([rootFile.id])
      entry.state.lastClickedFile = rootFile.id
      entry.state.remoteFileIdentity = {
        loginUsername: 'hik',
        effectiveUid: '0',
        effectiveUsername: 'root',
        channel: 'pty-root'
      }
      entry.visibleRemoteDirectoryCacheKey = 'root-cache-key'
      const identityEpoch = entry.remoteFileIdentityEpoch + 1

      await entry.remoteList(false, '/root', undefined, {
        explicitOpen: setup.explicitOpen === true
      })

      assertRemoteSnapshotCleared(entry, {
        identityEpoch,
        identityChannel: 'unknown',
        identityStatus: 'unavailable'
      })
    })
  }
})

test('stale lifecycle error remains primary when candidate teardown fails', async () => {
  const cleanupError = Object.assign(new Error('candidate teardown uncertain'), {
    code: 'TEARDOWN_TIMEOUT',
    uncertain: true
  })
  let drain
  const context = {}
  const candidate = {
    connect: async () => {
      drain = context.lifecycle.drainRemoteFileGeneration(context.entry)
      return true
    },
    destroy: async () => { throw cleanupError }
  }
  const harness = await createEntryHarness({
    client: async () => candidate,
    acquire: async () => { throw new Error('unexpected acquire') }
  })
  const { entry, lifecycle } = harness
  context.entry = entry
  context.lifecycle = lifecycle
  entry.sftp = null

  await assert.rejects(
    entry.remoteList(false, '/root', undefined, { rethrow: true }),
    error => {
      assert.notEqual(error, cleanupError)
      assert.equal(error?.name, 'AbortError')
      assert.equal(error.cleanupErrors?.includes(cleanupError), true)
      return true
    }
  )
  await drain.promise
})

test('stale task remains primary when candidate teardown rejects', async () => {
  const cleanupError = Object.assign(new Error('candidate teardown uncertain'), {
    code: 'TEARDOWN_TIMEOUT',
    uncertain: true
  })
  const candidate = {
    sshSessionGeneration: 'generation-1',
    sshTerminalPid: 4242,
    connect: async () => {
      lifecycle.beginSftpEntryRemoteTask(entry)
      return true
    },
    destroy: async () => { throw cleanupError }
  }
  const { entry, lifecycle } = await createEntryHarness({
    client: async () => candidate,
    acquire: async () => { throw new Error('unexpected acquire') }
  })
  const rootFile = {
    id: 'root-app-conf',
    name: 'app.conf',
    path: '/root',
    type: 'remote'
  }
  entry.sftp = null
  entry.state.remote = [rootFile]
  entry.state.remoteFileTree = entry.buildTree(entry.state.remote)
  entry.state.selectedFiles = new Set([rootFile.id])
  entry.state.lastClickedFile = rootFile.id
  entry.state.remoteFileIdentity = {
    loginUsername: 'hik',
    effectiveUid: '0',
    effectiveUsername: 'root',
    channel: 'pty-root'
  }
  entry.visibleRemoteDirectoryCacheKey = 'root-cache-key'
  const identityEpoch = entry.remoteFileIdentityEpoch + 1

  await assert.rejects(
    entry.remoteList(false, '/root', undefined, { rethrow: true }),
    error => {
      assert.notEqual(error, cleanupError)
      assert.equal(error?.name, 'AbortError')
      assert.equal(error.cleanupErrors?.includes(cleanupError), true)
      return true
    }
  )

  assertRemoteSnapshotCleared(entry, {
    identityEpoch,
    identityChannel: 'unknown',
    identityStatus: 'unavailable'
  })
})

test('frozen candidate primary escapes in a bounded cleanup wrapper', async () => {
  const primary = Object.freeze(Object.assign(
    new Error('frozen candidate connect failed'),
    { code: 'ECONNRESET' }
  ))
  const secondary = Object.assign(
    new Error('candidate teardown uncertain'),
    { code: 'TEARDOWN_TIMEOUT', uncertain: true }
  )
  const candidate = {
    connect: async () => { throw primary },
    destroy: async () => { throw secondary }
  }
  const { entry } = await createEntryHarness({
    client: async () => candidate,
    acquire: async () => { throw new Error('unexpected acquire') }
  })
  entry.sftp = null

  await assert.rejects(
    entry.remoteList(false, '/root', undefined, { rethrow: true }),
    error => {
      assert.notEqual(error, primary)
      assert.equal(error.cause, primary)
      assert.equal(error.primaryCause, primary)
      assert.deepEqual(Array.from(error.cleanupErrors), [secondary])
      assert.equal(error.cleanupErrors.includes(primary), false)
      assert.equal(error.cleanupErrors.includes(error), false)
      assert.ok(error.cleanupErrors.length <= 32)
      return true
    }
  )
})

test('generation drain and stale remoteList share one prepared release before destroy', async () => {
  const connectGate = deferred()
  const connectStarted = deferred()
  const releaseGate = deferred()
  const calls = []
  let releasePromise
  let releaseCount = 0
  const release = () => {
    if (releasePromise) return releasePromise
    releaseCount += 1
    calls.push('abort-start')
    releasePromise = releaseGate.promise.then(() => {
      calls.push('abort-end')
      return true
    })
    return releasePromise
  }
  const prepared = Object.freeze({
    consume: async () => { throw new Error('unexpected consume') },
    abort: release,
    release
  })
  const candidate = {
    sshSessionGeneration: 'generation-1',
    sshTerminalPid: 4242,
    async connect () {
      connectStarted.resolve()
      await connectGate.promise
      return true
    },
    async destroy () {
      calls.push('destroy')
      return true
    }
  }
  const { entry, lifecycle } = await createEntryHarness({
    client: async () => candidate,
    beginProbe: () => prepared,
    acquire: async () => { throw new Error('unexpected acquire') }
  })
  entry.sftp = null

  const listing = entry.remoteList(false, '/root', undefined, {
    explicitOpen: true,
    rethrow: true
  })
  await connectStarted.promise
  const drain = lifecycle.drainRemoteFileGeneration(entry)
  await Promise.resolve()
  assert.deepEqual(calls, ['abort-start'])
  releaseGate.resolve()
  await drain.promise
  assert.deepEqual(calls, ['abort-start', 'abort-end'])

  connectGate.resolve()
  await assert.rejects(listing, error => error?.name === 'AbortError')
  assert.equal(releaseCount, 1)
  assert.deepEqual(calls, ['abort-start', 'abort-end', 'destroy'])
})

test('operation acquired after unmount releases once without running work or setting state', async () => {
  const pending = deferred()
  const acquireStarted = deferred()
  let releaseCount = 0
  let workCount = 0
  const entry = {
    remoteFileOperations: new Set(),
    remoteFileUnmounted: false,
    acquireRemoteFileOperation: () => {
      acquireStarted.resolve()
      return pending.promise
    }
  }
  installClassField(entry, 'withRemoteFileOperation', {
    abortRemoteFileOperation,
    initializeRemoteFileGeneration,
    remoteFileOperationUnmounted
  })

  const operation = entry.withRemoteFileOperation({}, async () => {
    workCount += 1
  })
  await acquireStarted.promise
  entry.remoteFileUnmounted = true
  pending.resolve({
    backend: {},
    release: async () => { releaseCount += 1 }
  })

  await assert.rejects(operation, error => (
    error.name === 'AbortError' && error.code === 'ABORT_ERR'
  ))
  assert.equal(workCount, 0)
  assert.equal(releaseCount, 1)
  assert.equal(entry.remoteFileOperations.size, 0)
})

test('operation finishing after unmount rejects instead of triggering a refresh chain', async () => {
  const pendingWork = deferred()
  const workStarted = deferred()
  let releaseCount = 0
  const entry = {
    remoteFileOperations: new Set(),
    remoteFileUnmounted: false,
    acquireRemoteFileOperation: async () => ({
      backend: {},
      release: async () => { releaseCount += 1 }
    })
  }
  installClassField(entry, 'withRemoteFileOperation', {
    abortRemoteFileOperation,
    initializeRemoteFileGeneration,
    remoteFileOperationUnmounted
  })

  const operation = entry.withRemoteFileOperation({}, () => {
    workStarted.resolve()
    return pendingWork.promise
  })
  await workStarted.promise
  entry.remoteFileUnmounted = true
  pendingWork.resolve(true)

  await assert.rejects(operation, error => (
    error.name === 'AbortError' && error.code === 'ABORT_ERR'
  ))
  assert.equal(releaseCount, 1)
  assert.equal(entry.remoteFileOperations.size, 0)
})

test('remote list rejects after unmount without starting lifecycle or setting state', async () => {
  const calls = []
  const entry = {
    remoteFileUnmounted: true,
    setState: () => calls.push('set-state')
  }
  installClassField(entry, 'remoteListUncoalesced', {
    remoteFileOperationUnmounted,
    beginSftpEntryRemoteTask: () => calls.push('begin-task')
  })
  entry.remoteList = entry.remoteListUncoalesced

  await assert.rejects(entry.remoteList(false, '/root'), error => (
    error.name === 'AbortError' && error.code === 'ABORT_ERR'
  ))
  assert.deepEqual(calls, [])
})

test('operation failure remains primary when release also fails', async () => {
  const workError = new Error('list failed')
  const releaseError = new Error('release failed')
  const entry = {
    remoteFileOperations: new Set(),
    remoteFileUnmounted: false,
    acquireRemoteFileOperation: async () => ({
      backend: {},
      release: async () => { throw releaseError }
    })
  }
  installClassField(entry, 'withRemoteFileOperation', {
    abortRemoteFileOperation,
    initializeRemoteFileGeneration,
    remoteFileOperationUnmounted
  })

  await assert.rejects(
    entry.withRemoteFileOperation({}, async () => { throw workError }),
    error => {
      assert.equal(error, workError)
      assert.equal(error.releaseError, releaseError)
      return true
    }
  )
  assert.equal(entry.remoteFileOperations.size, 0)
})

test('frozen operation failure wraps an uncertain release failure', async () => {
  const remoteFileErrors = await importModule(
    'src/client/components/sftp/remote-file-errors.js'
  )
  const workError = Object.freeze(Object.assign(
    new Error('frozen list failure'),
    { code: 'ECONNRESET' }
  ))
  const releaseError = Object.assign(
    new Error('release settlement uncertain'),
    { code: 'TEARDOWN_TIMEOUT', uncertain: true }
  )
  const entry = {
    remoteFileOperations: new Set(),
    remoteFileUnmounted: false,
    acquireRemoteFileOperation: async () => ({
      backend: {},
      release: async () => { throw releaseError }
    })
  }
  installClassField(entry, 'withRemoteFileOperation', {
    abortRemoteFileOperation,
    initializeRemoteFileGeneration,
    remoteFileOperationUnmounted,
    appendRemoteFileCleanupErrors:
      remoteFileErrors.appendRemoteFileCleanupErrors
  })

  await assert.rejects(
    entry.withRemoteFileOperation({}, async () => { throw workError }),
    error => {
      assert.notEqual(error, workError)
      assert.equal(error.cause, workError)
      assert.equal(error.primaryCause, workError)
      assert.deepEqual(Array.from(error.cleanupErrors), [releaseError])
      const classification = remoteFileErrors
        .classifyRemoteFileRecoveryError(error)
      assert.equal(classification.settlementUncertain, true)
      assert.equal(classification.failClosed, true)
      return true
    }
  )
  assert.equal(entry.remoteFileOperations.size, 0)
})

test('frozen transfer acquisition failure wraps uncertain release cleanup', async () => {
  const remoteFileErrors = await importModule(
    'src/client/components/sftp/remote-file-errors.js'
  )
  const primary = Object.freeze(Object.assign(
    new Error('frozen transfer facade failure'),
    { code: 'ECONNRESET' }
  ))
  const secondary = Object.assign(
    new Error('transfer capability release uncertain'),
    { code: 'TEARDOWN_TIMEOUT', uncertain: true }
  )
  const entry = {
    remoteFileOperations: new Set(),
    remoteFileOperationSettlements: new Set(),
    remoteFileUnmounted: false,
    acquireRemoteFileOperation: async () => ({
      release: async () => { throw secondary }
    })
  }
  installClassField(entry, 'acquireTransferFileCapability', {
    abortRemoteFileOperation,
    initializeRemoteFileGeneration,
    isCurrentRemoteFileGeneration: (target, generation) => (
      target.remoteFileGeneration === generation
    ),
    remoteFileOperationStale,
    remoteFileOperationUnmounted,
    createRemoteFileTransferCapability: () => { throw primary },
    appendRemoteFileCleanupErrors:
      remoteFileErrors.appendRemoteFileCleanupErrors
  })

  await assert.rejects(
    entry.acquireTransferFileCapability({ transferId: 'frozen-primary' }),
    error => {
      assert.equal(
        error.message,
        'Remote file operation failed and cleanup did not settle'
      )
      assert.equal(error.name, 'RemoteFileCleanupError')
      assert.notEqual(error, primary)
      assert.equal(error.cause, primary)
      assert.equal(error.primaryCause, primary)
      assert.deepEqual(Array.from(error.cleanupErrors), [secondary])
      const classification = remoteFileErrors
        .classifyRemoteFileRecoveryError(error)
      assert.equal(classification.settlementUncertain, true)
      assert.equal(classification.failClosed, true)
      return true
    }
  )
  assert.equal(entry.remoteFileOperations.size, 0)
  assert.equal(entry.remoteFileOperationSettlements.size, 0)
})

test('identity is not published when capability final validation fails', async () => {
  const writes = []
  const entry = {
    props: { tab: { id: 'tab-1', username: 'hik' } },
    sftp: {},
    sftpLifecycleEpoch: 3,
    sshSessionGeneration: 'generation-1',
    sshTerminalPid: '4242',
    remoteFileOperationSequence: 0,
    remoteFileUnmounted: false,
    setState: update => writes.push(update)
  }
  await installRemoteFileIdentityFields(entry)
  installClassField(entry, 'acquireRemoteFileOperation', {
    abortRemoteFileOperation,
    refs: { get: () => ({}) },
    isCurrentSftpEntryRemoteTask: () => true,
    acquireRemoteFileCapability: async ({ onIdentity }) => {
      await onIdentity({
        loginUsername: 'hik',
        effectiveUid: '0',
        effectiveUsername: 'root',
        channel: 'pty-root'
      })
      throw new Error('generation changed after identity probe')
    }
  })

  await assert.rejects(
    entry.acquireRemoteFileOperation({ id: 'stale-identity' }),
    /generation changed/
  )
  assert.deepEqual(writes, [])
})

test('terminal identity probes are serialized across remote file acquisitions', async () => {
  const firstProbe = deferred()
  const releaseFirstProbe = deferred()
  const events = []
  let probe = 0
  const { entry, lifecycle } = await createEntryHarness({
    acquire: async ({ onIdentity }) => {
      probe += 1
      const current = probe
      events.push(`start:${current}`)
      if (current === 1) {
        firstProbe.resolve()
        await releaseFirstProbe.promise
      }
      await onIdentity({
        loginUsername: 'hik',
        effectiveUid: '1000',
        effectiveUsername: 'hik',
        channel: 'sftp'
      })
      events.push(`end:${current}`)
      return {
        backend: {},
        release: async () => true
      }
    }
  })
  lifecycle.initializeRemoteFileGeneration(entry)

  const first = entry.acquireRemoteFileOperation({ id: 'first' })
  await firstProbe.promise
  const second = entry.acquireRemoteFileOperation({ id: 'second' })
  await Promise.resolve()
  assert.deepEqual(events, ['start:1'])

  releaseFirstProbe.resolve()
  const capabilities = await Promise.all([first, second])
  assert.deepEqual(events, ['start:1', 'end:1', 'start:2', 'end:2'])
  await Promise.all(capabilities.map(capability => capability.release()))
})

test('root PTY FIFO survives UI observer failures until the lease releases', async () => {
  const events = []
  let activeLease = false
  let probe = 0
  const { entry, lifecycle } = await createEntryHarness({
    acquire: async ({ onIdentity, onLeaseState }) => {
      const observeLease = async event => {
        try {
          await onLeaseState?.(event)
        } catch {
          // Production lease observation deliberately isolates UI failures.
        }
      }
      probe += 1
      const current = probe
      events.push(`start:${current}`)
      if (activeLease) throw new Error('current terminal task is busy')
      activeLease = true
      await observeLease({ state: 'acquired', operationId: `root-${current}` })
      await onIdentity({
        loginUsername: 'hik',
        effectiveUid: '0',
        effectiveUsername: 'root',
        channel: 'pty-root'
      })
      let releasePromise
      return {
        channel: 'pty-root',
        backend: {},
        release: () => {
          if (releasePromise) return releasePromise
          releasePromise = (async () => {
            activeLease = false
            events.push(`release:${current}`)
            await observeLease({
              state: 'released',
              operationId: `root-${current}`
            })
            return true
          })()
          return releasePromise
        }
      }
    }
  })
  entry.publishRemoteFileLeaseState = () => {
    throw new Error('UI lease observer failed')
  }
  lifecycle.initializeRemoteFileGeneration(entry)

  const first = await entry.acquireRemoteFileOperation({ id: 'first-root' })
  const secondResult = entry.acquireRemoteFileOperation({ id: 'second-root' })
    .then(value => ({ status: 'fulfilled', value }), reason => ({
      status: 'rejected',
      reason
    }))
  await Promise.resolve()
  assert.deepEqual(events, ['start:1'])

  await first.release()
  const second = await secondResult
  assert.equal(second.status, 'fulfilled')
  assert.deepEqual(events, ['start:1', 'release:1', 'start:2'])
  await second.value.release()
})

test('aborted acquisition reports promptly without allowing successors to overtake', async () => {
  const firstProbe = deferred()
  const releaseFirstProbe = deferred()
  const controller = new AbortController()
  let acquireCount = 0
  const { entry, lifecycle } = await createEntryHarness({
    acquire: async () => {
      acquireCount += 1
      if (acquireCount === 1) {
        firstProbe.resolve()
        await releaseFirstProbe.promise
      }
      return {
        backend: {},
        release: async () => true
      }
    }
  })
  lifecycle.initializeRemoteFileGeneration(entry)

  const first = entry.acquireRemoteFileOperation({ id: 'first' })
  await firstProbe.promise
  const second = entry.acquireRemoteFileOperation({
    id: 'second',
    signal: controller.signal
  }).then(() => 'fulfilled', error => error?.code || error?.name)
  controller.abort(Object.assign(new Error('aborted'), {
    name: 'AbortError',
    code: 'ABORT_ERR'
  }))
  const promptOutcome = await Promise.race([
    second,
    new Promise(resolve => setTimeout(() => resolve('timeout'), 100))
  ])
  const third = entry.acquireRemoteFileOperation({ id: 'third' })
  await Promise.resolve()
  assert.equal(acquireCount, 1)

  releaseFirstProbe.resolve()
  const firstCapability = await first
  await firstCapability.release()
  await second
  const thirdCapability = await third
  assert.equal(promptOutcome, 'ABORT_ERR')
  assert.equal(acquireCount, 2)
  await thirdCapability.release()
})

test('failed terminal identity probe releases the next remote file acquisition', async () => {
  const firstProbe = deferred()
  const releaseFirstProbe = deferred()
  const events = []
  let probe = 0
  const { entry, lifecycle } = await createEntryHarness({
    acquire: async ({ onIdentity }) => {
      probe += 1
      const current = probe
      events.push(`start:${current}`)
      if (current === 1) {
        firstProbe.resolve()
        await releaseFirstProbe.promise
        events.push('fail:1')
        throw new Error('probe failed')
      }
      await onIdentity({
        loginUsername: 'hik',
        effectiveUid: '1000',
        effectiveUsername: 'hik',
        channel: 'sftp'
      })
      events.push('end:2')
      return {
        backend: {},
        release: async () => true
      }
    }
  })
  lifecycle.initializeRemoteFileGeneration(entry)

  const first = entry.acquireRemoteFileOperation({ id: 'first' })
  await firstProbe.promise
  const second = entry.acquireRemoteFileOperation({ id: 'second' })
  const results = Promise.allSettled([first, second])
  await Promise.resolve()
  assert.deepEqual(events, ['start:1'])

  releaseFirstProbe.resolve()
  const [firstResult, secondResult] = await results
  assert.equal(firstResult.status, 'rejected')
  assert.match(firstResult.reason.message, /probe failed/)
  assert.equal(secondResult.status, 'fulfilled')
  assert.deepEqual(events, ['start:1', 'fail:1', 'start:2', 'end:2'])
  await secondResult.value.release()
})

test('acquired capability is released when the remote request lifecycle is stale', async () => {
  const writes = []
  let releaseCount = 0
  let lifecycleChecks = 0
  const sftp = {}
  const entry = {
    props: { tab: { id: 'tab-1', username: 'hik' } },
    sftp,
    sftpLifecycleEpoch: 3,
    sshSessionGeneration: 'generation-1',
    sshTerminalPid: '4242',
    remoteFileOperationSequence: 0,
    remoteFileUnmounted: false,
    setState: update => writes.push(update)
  }
  await installRemoteFileIdentityFields(entry)
  installClassField(entry, 'acquireRemoteFileOperation', {
    abortRemoteFileOperation,
    refs: { get: () => ({}) },
    remoteFileOperationStale,
    isCurrentSftpEntryRemoteTask: () => ++lifecycleChecks === 1,
    acquireRemoteFileCapability: async ({ onIdentity }) => {
      await onIdentity({
        loginUsername: 'hik',
        effectiveUid: '0',
        effectiveUsername: 'root',
        channel: 'pty-root'
      })
      return {
        backend: {},
        release: async () => { releaseCount += 1 }
      }
    }
  })

  await assert.rejects(entry.acquireRemoteFileOperation({
    id: 'stale-list',
    lifecycleTask: { requestEpoch: 1 }
  }), error => error.name === 'AbortError' && error.code === 'ABORT_ERR')
  assert.equal(releaseCount, 1)
  assert.deepEqual(writes, [])
})

test('an aborted queued operation never acquires a terminal capability', async () => {
  const activeWork = deferred()
  const controller = new AbortController()
  let acquireCount = 0
  const entry = {
    remoteFileOperations: new Set(),
    remoteFileUnmounted: false,
    acquireRemoteFileOperation: async () => {
      acquireCount += 1
      return {
        backend: {},
        release: async () => true
      }
    }
  }
  installClassField(entry, 'withRemoteFileOperation', {
    abortRemoteFileOperation,
    initializeRemoteFileGeneration,
    remoteFileOperationUnmounted
  })

  const first = entry.withRemoteFileOperation({}, () => activeWork.promise)
  await Promise.resolve()
  const abortCause = new Error('cancel queued refresh')
  controller.abort(abortCause)
  const second = entry.withRemoteFileOperation(
    { signal: controller.signal },
    async () => true
  )
  activeWork.resolve(true)

  assert.equal(await first, true)
  await assert.rejects(second, error => error === abortCause)
  assert.equal(acquireCount, 1)
})

test('remote list forwards AbortSignal to backend list before releasing capability', async () => {
  const controller = new AbortController()
  const calls = []
  const acquire = async ({ onIdentity }) => {
    await onIdentity({
      loginUsername: 'hik',
      effectiveUid: '0',
      effectiveUsername: 'root',
      channel: 'pty-root'
    })
    return {
      backend: {
        async list (remotePath, options) {
          calls.push(['list', remotePath, options?.signal])
          return []
        }
      },
      runtimeIdentity: rootRuntimeIdentity,
      release: async () => { calls.push(['release']) }
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  entry.updateRemoteList = async remote => remote

  await entry.remoteList(false, '/root', undefined, {
    signal: controller.signal
  })

  assert.deepEqual(calls, [
    ['list', '/root', controller.signal],
    ['release']
  ])
})

test('remote link metadata forwards AbortSignal to stat', async () => {
  const controller = new AbortController()
  const calls = []
  const entry = {}
  installClassField(entry, 'resolveRemoteLink', {
    abortRemoteFileOperation,
    isAbsPath: value => value.startsWith('/'),
    isAuthoritativeRemoteMissingError,
    isCurrentSftpEntryRemoteTask: () => true,
    isRemoteDirectory: stat => stat.isDirectory,
    resolve: (base, name) => `${base}/${name}`
  })

  const resolved = await entry.resolveRemoteLink({
    name: 'link',
    isSymbol: true
  }, '/root', {
    async readlink (remotePath) {
      calls.push(['readlink', remotePath])
      return '/root/target'
    },
    async stat (remotePath, options) {
      calls.push(['stat', remotePath, options?.signal])
      return { isDirectory: true }
    }
  }, undefined, controller.signal)

  assert.equal(resolved.isDirectory, true)
  assert.deepEqual(calls, [
    ['readlink', '/root/link'],
    ['stat', '/root/target', controller.signal]
  ])
})

test('remote link abort after readlink never starts stat', async () => {
  const pendingReadlink = deferred()
  const controller = new AbortController()
  let statCount = 0
  const entry = {}
  installClassField(entry, 'resolveRemoteLink', {
    abortRemoteFileOperation,
    isAbsPath: value => value.startsWith('/'),
    isAuthoritativeRemoteMissingError,
    isCurrentSftpEntryRemoteTask: () => true,
    isRemoteDirectory: stat => stat.isDirectory,
    resolve: (base, name) => `${base}/${name}`
  })
  const operation = entry.resolveRemoteLink({
    name: 'link',
    isSymbol: true
  }, '/root', {
    readlink: () => pendingReadlink.promise,
    stat: async () => { statCount += 1 }
  }, undefined, controller.signal)
  const abortCause = new Error('cancel metadata lookup')
  controller.abort(abortCause)
  pendingReadlink.resolve('/root/target')

  await assert.rejects(operation, error => error === abortCause)
  assert.equal(statCount, 0)
})

test('remote links swallow only authoritative missing errors', async () => {
  const entry = {}
  installClassField(entry, 'resolveRemoteLink', {
    abortRemoteFileOperation,
    isAbsPath: value => value.startsWith('/'),
    isAuthoritativeRemoteMissingError,
    isCurrentSftpEntryRemoteTask: () => true,
    isRemoteDirectory: stat => stat.isDirectory,
    resolve: (base, name) => `${base}/${name}`
  })
  for (const code of ['ENOENT', 'SFTP_NO_SUCH_FILE', 2]) {
    const error = Object.assign(new Error('missing'), { code })
    assert.equal(await entry.resolveRemoteLink({
      name: 'link',
      isSymbol: true
    }, '/root', {
      readlink: async () => { throw error }
    }), null)
  }
  const statMissing = Object.assign(new Error('missing target'), {
    code: 'ENOENT'
  })
  assert.equal(await entry.resolveRemoteLink({
    name: 'link',
    isSymbol: true
  }, '/root', {
    readlink: async () => '/root/missing',
    stat: async () => { throw statMissing }
  }), null)
  assert.equal(await entry.resolveRemoteLink({
    name: 'relative-link',
    isSymbol: true
  }, '/root', {
    readlink: async () => 'missing',
    realpath: async () => { throw statMissing }
  }), null)
})

test('remote links rethrow abort capability transport protocol and permission errors', async () => {
  const entry = {}
  installClassField(entry, 'resolveRemoteLink', {
    abortRemoteFileOperation,
    isAbsPath: value => value.startsWith('/'),
    isAuthoritativeRemoteMissingError,
    isCurrentSftpEntryRemoteTask: () => true,
    isRemoteDirectory: stat => stat.isDirectory,
    resolve: (base, name) => `${base}/${name}`
  })
  const errors = [
    Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' }),
    Object.assign(new Error('identity unavailable'), {
      code: 'REMOTE_FILE_IDENTITY_UNAVAILABLE'
    }),
    Object.assign(new Error('capability released'), {
      code: 'REMOTE_FILE_CAPABILITY_RELEASED'
    }),
    Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    Object.assign(new Error('disconnected'), { code: 'ECONNRESET' }),
    Object.assign(new Error('protocol failure'), { code: 'EPROTO' })
  ]
  for (const error of errors) {
    await assert.rejects(entry.resolveRemoteLink({
      name: 'link',
      isSymbol: true
    }, '/root', {
      readlink: async () => { throw error }
    }), candidate => candidate === error)
    await assert.rejects(entry.resolveRemoteLink({
      name: 'link',
      isSymbol: true
    }, '/root', {
      readlink: async () => '/root/target',
      stat: async () => { throw error }
    }), candidate => candidate === error)
    await assert.rejects(entry.resolveRemoteLink({
      name: 'relative-link',
      isSymbol: true
    }, '/root', {
      readlink: async () => 'target',
      realpath: async () => { throw error }
    }), candidate => candidate === error)
  }
})

test('symlink metadata denial commits no partial or stale remote list', async () => {
  const permissionError = Object.assign(new Error('permission denied'), {
    code: 'EACCES'
  })
  const calls = []
  const acquire = async ({ onIdentity }) => {
    await onIdentity({
      loginUsername: 'hik',
      effectiveUid: '0',
      effectiveUsername: 'root',
      channel: 'pty-root'
    })
    return {
      backend: {
        list: async () => [
          { name: 'plain', type: 'f', size: 1 },
          { name: 'link', type: 'l', size: 1 }
        ],
        readlink: async () => '/root/target',
        stat: async () => { throw permissionError }
      },
      runtimeIdentity: rootRuntimeIdentity,
      release: async () => calls.push('release')
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  const original = [{ id: 'original', name: 'original' }]
  entry.state.remote = original
  installClassField(entry, 'resolveRemoteLink', {
    abortRemoteFileOperation,
    isAbsPath: value => value.startsWith('/'),
    isAuthoritativeRemoteMissingError,
    isCurrentSftpEntryRemoteTask: () => true,
    isRemoteDirectory: stat => stat.isDirectory,
    resolve: (base, name) => `${base}/${name}`
  })
  installClassField(entry, 'updateRemoteList', {
    abortRemoteFileOperation,
    isCurrentSftpEntryRemoteTask: () => true
  })

  await assert.rejects(
    entry.remoteList(false, '/root', undefined, { rethrow: true }),
    error => error === permissionError
  )
  assert.deepEqual(Array.from(entry.state.remote, file => ({
    id: file.id,
    name: file.name
  })), [])
  assert.deepEqual(calls, ['release'])
})

test('unmount waits for an in-flight acquire to release before transport destroy', async () => {
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  const pendingAcquire = deferred()
  const acquireStarted = deferred()
  const calls = []
  const client = {
    async cleanupStage () { calls.push('cleanup-stage') },
    async destroy () { calls.push('destroy-client') }
  }
  const entry = {
    id: 'sftp-tab-1',
    sftp: client,
    remoteFileUnmounted: false,
    remoteFileOperations: new Set(),
    remoteFileOperationBackends: new Map(),
    sftpSafetyProgressHandlers: { clear: () => {} },
    sftpSafetyAdapter: { discardAllPreparedProofs: () => {} },
    _sortCache: { clear: () => {} },
    acquireRemoteFileOperation: () => {
      acquireStarted.resolve()
      return pendingAcquire.promise
    }
  }
  installClassField(entry, 'withRemoteFileOperation', {
    abortRemoteFileOperation,
    initializeRemoteFileGeneration,
    remoteFileOperationUnmounted
  })
  installClassMethod(entry, 'componentWillUnmount', {
    refs: { remove: () => {} },
    drainRemoteFileGeneration: lifecycle.drainRemoteFileGeneration,
    disposeSftpEntryScheduling: () => {}
  })

  const operation = entry.withRemoteFileOperation({}, async () => true)
  await acquireStarted.promise
  const disposal = entry.componentWillUnmount()
  assert.deepEqual(calls, [])
  pendingAcquire.resolve({
    backend: {},
    release: async () => client.cleanupStage()
  })

  await assert.rejects(operation, error => error.code === 'ABORT_ERR')
  await disposal
  assert.deepEqual(calls, ['cleanup-stage', 'destroy-client'])
})

test('unmount owns the captured remoteList transport and destroys it once', async () => {
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  const listGate = deferred()
  const listStarted = deferred()
  const calls = []
  let releasePromise
  const acquire = async ({ onIdentity }) => {
    await onIdentity({
      loginUsername: 'hik',
      effectiveUid: '0',
      effectiveUsername: 'root',
      channel: 'pty-root'
    })
    return {
      backend: {
        async list () {
          calls.push('list')
          listStarted.resolve()
          await listGate.promise
          return []
        }
      },
      runtimeIdentity: rootRuntimeIdentity,
      release: () => {
        releasePromise ||= (async () => {
          await listGate.promise
          calls.push('cleanup-stage')
          return true
        })()
        return releasePromise
      }
    }
  }
  const { entry, stateWrites } = await createEntryHarness({ acquire })
  entry.sftp.destroy = async () => { calls.push('destroy-client') }
  entry.sftpSafetyProgressHandlers = { clear: () => {} }
  entry.sftpSafetyAdapter = { discardAllPreparedProofs: () => {} }
  entry._sortCache = { clear: () => {} }
  entry.updateRemoteList = async remote => remote
  installClassMethod(entry, 'componentWillUnmount', {
    refs: { remove: () => {} },
    drainRemoteFileGeneration: lifecycle.drainRemoteFileGeneration,
    disposeSftpEntryScheduling: () => {}
  })

  const listing = entry.remoteList(false, '/root')
  await listStarted.promise
  const writesAtUnmount = stateWrites.length
  const disposal = entry.componentWillUnmount()
  assert.equal(calls.includes('destroy-client'), false)
  listGate.resolve()

  await assert.rejects(listing, error => error.code === 'ABORT_ERR')
  await disposal
  assert.deepEqual(calls, ['list', 'cleanup-stage', 'destroy-client'])
  assert.equal(stateWrites.length, writesAtUnmount)
})

test('unmount waits for capability cleanup before destroying the detached transport', async () => {
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  const releaseGate = deferred()
  const calls = []
  const immediateCalls = []
  let destroyed = false
  const client = {
    async cleanupStage () {
      assert.equal(destroyed, false)
      calls.push('cleanup-stage')
    },
    async destroy () {
      destroyed = true
      calls.push('destroy-client')
    }
  }
  const entry = {
    id: 'sftp-tab-1',
    sftp: client,
    sftpLifecycleEpoch: 4,
    remoteFileUnmounted: false,
    remoteFileOperations: new Set([{
      async release () {
        calls.push('release')
        await client.cleanupStage()
        await releaseGate.promise
        calls.push('release-finished')
      }
    }]),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map([['operation', {}]]),
    sftpSafetyProgressHandlers: {
      clear: () => immediateCalls.push('clear-progress')
    },
    sftpSafetyAdapter: {
      discardAllPreparedProofs: () => immediateCalls.push('discard-proofs')
    },
    _sortCache: { clear: () => immediateCalls.push('clear-sort') }
  }
  installClassMethod(entry, 'componentWillUnmount', {
    refs: { remove: () => immediateCalls.push('remove-ref') },
    drainRemoteFileGeneration: lifecycle.drainRemoteFileGeneration,
    disposeSftpEntryScheduling: () => {
      immediateCalls.push('dispose-scheduling')
    }
  })

  const disposal = entry.componentWillUnmount()

  assert.equal(entry.remoteFileUnmounted, true)
  assert.equal(entry.sftp, null)
  assert.equal(entry.sftpLifecycleEpoch, 5)
  assert.equal(entry.remoteFileOperations.size, 0)
  assert.equal(entry.remoteFileOperationBackends.size, 0)
  assert.equal(calls.includes('destroy-client'), false)
  assert.deepEqual(immediateCalls, [
    'remove-ref',
    'clear-progress',
    'discard-proofs',
    'dispose-scheduling',
    'clear-sort'
  ])
  assert.equal(entry.componentWillUnmount(), disposal)
  assert.equal(immediateCalls.length, 5)
  await Promise.resolve()
  assert.deepEqual(calls, ['release', 'cleanup-stage'])

  releaseGate.resolve()
  await disposal
  assert.deepEqual(calls, [
    'release', 'cleanup-stage', 'release-finished', 'destroy-client'
  ])
})

test('unmount keeps the endpoint attached until transfer safety terminal settlement', async () => {
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  const safetyGate = deferred()
  const calls = []
  const client = {
    async destroy () { calls.push('destroy-client') }
  }
  const entry = {
    id: 'sftp-tab-root',
    sftp: client,
    remoteFileUnmounted: false,
    remoteFileOperations: new Set(),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    remoteFileGeneration: {
      id: 1,
      accepting: false,
      capabilities: new Set(),
      settlements: new Set(),
      backends: new Map(),
      tail: Promise.resolve()
    },
    quiesceActiveTransfers: () => {
      calls.push('settle-transfer-safety')
      return safetyGate.promise
    },
    clearTransferSafetySessionPins: () => calls.push('clear-pins'),
    sftpSafetyProgressHandlers: { clear: () => {} },
    sftpSafetyAdapter: { discardAllPreparedProofs: () => {} },
    _sortCache: { clear: () => {} }
  }
  installClassMethod(entry, 'componentWillUnmount', {
    refs: { remove: () => {} },
    drainRemoteFileGeneration: lifecycle.drainRemoteFileGeneration,
    disposeSftpEntryScheduling: () => {}
  })

  const disposal = entry.componentWillUnmount()
  assert.equal(entry.sftp, client)
  assert.deepEqual(calls, ['settle-transfer-safety'])

  safetyGate.resolve()
  await disposal
  assert.equal(entry.sftp, null)
  assert.deepEqual(calls, [
    'settle-transfer-safety',
    'destroy-client',
    'clear-pins'
  ])
})

test('unmount destroys the detached transport after rejected and synchronous releases', async () => {
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  const rejectedRelease = deferred()
  const asynchronousError = new Error('asynchronous release failure')
  const synchronousError = new Error('synchronous release failure')
  let destroyCount = 0
  const entry = {
    id: 'sftp-tab-1',
    sftp: { destroy: async () => { destroyCount += 1 } },
    remoteFileUnmounted: false,
    remoteFileOperations: new Set([{
      release: () => rejectedRelease.promise
    }, {
      release: () => { throw synchronousError }
    }]),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    sftpSafetyProgressHandlers: { clear: () => {} },
    sftpSafetyAdapter: { discardAllPreparedProofs: () => {} },
    _sortCache: { clear: () => {} }
  }
  installClassMethod(entry, 'componentWillUnmount', {
    refs: { remove: () => {} },
    drainRemoteFileGeneration: lifecycle.drainRemoteFileGeneration,
    disposeSftpEntryScheduling: () => {}
  })

  const disposal = entry.componentWillUnmount()
  assert.equal(destroyCount, 0)
  rejectedRelease.reject(asynchronousError)
  let observedError
  await assert.rejects(disposal, error => {
    observedError = error
    assert.equal(error instanceof AggregateError, true)
    assert.deepEqual(error.errors, [asynchronousError, synchronousError])
    return true
  })
  assert.equal(destroyCount, 1)
  assert.equal(entry.componentWillUnmount(), disposal)
  await assert.rejects(
    entry.componentWillUnmount(),
    error => error === observedError
  )
  assert.equal(destroyCount, 1)
})

test('React-style unmount observes and reports disposal rejection', async () => {
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  const rejectedRelease = deferred()
  const releaseError = new Error('unmount release failed')
  const reports = []
  const unhandled = []
  let destroyCount = 0
  const entry = {
    id: 'sftp-tab-1',
    sftp: { destroy: async () => { destroyCount += 1 } },
    remoteFileUnmounted: false,
    remoteFileOperations: new Set([{
      release: () => rejectedRelease.promise
    }]),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    sftpSafetyProgressHandlers: { clear: () => {} },
    sftpSafetyAdapter: { discardAllPreparedProofs: () => {} },
    _sortCache: { clear: () => {} },
    runSftpBackgroundTask: task => lifecycle.runSftpBackgroundTask(task, {
      reportError: error => reports.push(error)
    })
  }
  installClassMethod(entry, 'componentWillUnmount', {
    refs: { remove: () => {} },
    drainRemoteFileGeneration: lifecycle.drainRemoteFileGeneration,
    disposeSftpEntryScheduling: () => {}
  })
  const onUnhandled = error => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)

  try {
    const disposal = entry.componentWillUnmount()
    rejectedRelease.reject(releaseError)
    await new Promise(resolve => setImmediate(resolve))

    assert.deepEqual(unhandled, [])
    assert.equal(reports.length, 1)
    await assert.rejects(disposal, error => {
      assert.equal(error, reports[0])
      assert.equal(error instanceof AggregateError, true)
      assert.deepEqual(error.errors, [releaseError])
      return true
    })
    assert.equal(destroyCount, 1)
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
  }
})

test('overlapping reloads drain the old generation and only latest initializes', async () => {
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  const releaseGate = deferred()
  const calls = []
  const entry = {
    sftp: { destroy: async () => calls.push('destroy') },
    remoteFileUnmounted: false,
    invalidateRemoteFileIdentity: () => calls.push('invalidate-identity'),
    remoteFileOperations: new Set([{
      async release () {
        calls.push('release')
        await releaseGate.promise
        calls.push('released')
      }
    }]),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    sftpSafetyProgressHandlers: { clear: () => calls.push('clear') },
    sftpSafetyAdapter: {
      discardAllPreparedProofs: () => calls.push('discard')
    },
    setState (update, callback) {
      calls.push(['state', update.remoteLoading])
      callback?.()
    },
    initRemoteAll: () => calls.push('init'),
    runSftpBackgroundTask: task => lifecycle.runSftpBackgroundTask(task, {
      reportError: error => calls.push(['error', error.message])
    })
  }
  installClassField(entry, 'handleReloadRemoteSftp', {
    activateRemoteFileGeneration: lifecycle.activateRemoteFileGeneration,
    drainRemoteFileGeneration: lifecycle.drainRemoteFileGeneration,
    invalidateSftpEntryRemoteSnapshot:
      lifecycle.invalidateSftpEntryRemoteSnapshot,
    isCurrentRemoteFileGeneration: lifecycle.isCurrentRemoteFileGeneration
  })

  const firstReload = entry.handleReloadRemoteSftp()
  const latestReload = entry.handleReloadRemoteSftp()
  await Promise.resolve()
  assert.deepEqual(calls, [
    ['state', true], 'invalidate-identity', 'clear', 'discard', 'release',
    ['state', true], 'invalidate-identity', 'clear', 'discard'
  ])
  releaseGate.resolve()
  await Promise.all([firstReload, latestReload])

  assert.deepEqual(calls, [
    ['state', true], 'invalidate-identity', 'clear', 'discard', 'release',
    ['state', true], 'invalidate-identity', 'clear', 'discard',
    'released', 'destroy',
    ['state', true], 'init'
  ])
})

test('reload clears the visible snapshot before a slow drain settles', async () => {
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  const releaseGate = deferred()
  const staleFile = {
    id: 'root-app-conf',
    name: 'app.conf',
    path: '/root-only',
    type: 'remote'
  }
  const entry = {
    sftp: null,
    remoteFileUnmounted: false,
    visibleRemoteDirectoryCacheKey: 'root-cache-key',
    remoteDirectoryCachePaintEpoch: 7,
    state: {
      remote: [staleFile],
      remoteFileTree: new Map([[staleFile.id, staleFile]]),
      selectedFiles: new Set([staleFile.id]),
      lastClickedFile: staleFile.id
    },
    remoteDirectoryCache: { clear: () => {} },
    invalidateRemoteFileIdentity: () => {},
    remoteFileOperations: new Set([{
      async release () { await releaseGate.promise }
    }]),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    sftpSafetyProgressHandlers: { clear: () => {} },
    sftpSafetyAdapter: { discardAllPreparedProofs: () => {} },
    setState (update, callback) {
      const next = typeof update === 'function' ? update(this.state) : update
      if (next) Object.assign(this.state, next)
      callback?.()
    },
    initRemoteAll: () => {},
    runSftpBackgroundTask: task => lifecycle.runSftpBackgroundTask(task)
  }
  installClassField(entry, 'handleReloadRemoteSftp', {
    activateRemoteFileGeneration: lifecycle.activateRemoteFileGeneration,
    drainRemoteFileGeneration: lifecycle.drainRemoteFileGeneration,
    invalidateSftpEntryRemoteSnapshot:
      lifecycle.invalidateSftpEntryRemoteSnapshot,
    isCurrentRemoteFileGeneration: lifecycle.isCurrentRemoteFileGeneration
  })

  const reload = entry.handleReloadRemoteSftp()
  await Promise.resolve()

  assertRemoteSnapshotCleared(entry)
  assert.equal(entry.remoteDirectoryCachePaintEpoch, 8)

  releaseGate.resolve()
  await reload
})

test('reload callback observes rejected initialization without an unhandled promise', async () => {
  const lifecycle = await importModule(
    'src/client/components/sftp/sftp-entry-lifecycle.js'
  )
  const failure = new Error('reload failed')
  const reports = []
  const entry = {
    sftp: null,
    remoteFileUnmounted: false,
    invalidateRemoteFileIdentity: () => {},
    remoteFileOperations: new Set(),
    remoteFileOperationSettlements: new Set(),
    remoteFileOperationBackends: new Map(),
    sftpSafetyProgressHandlers: { clear: () => {} },
    sftpSafetyAdapter: { discardAllPreparedProofs: () => {} },
    setState (_update, callback) { callback?.() },
    initRemoteAll: () => Promise.reject(failure),
    runSftpBackgroundTask: task => lifecycle.runSftpBackgroundTask(task, {
      reportError: error => reports.push(error)
    })
  }
  installClassField(entry, 'handleReloadRemoteSftp', {
    activateRemoteFileGeneration: lifecycle.activateRemoteFileGeneration,
    drainRemoteFileGeneration: lifecycle.drainRemoteFileGeneration,
    invalidateSftpEntryRemoteSnapshot:
      lifecycle.invalidateSftpEntryRemoteSnapshot,
    isCurrentRemoteFileGeneration: lifecycle.isCurrentRemoteFileGeneration
  })

  await entry.handleReloadRemoteSftp()
  await Promise.resolve()
  assert.deepEqual(reports, [failure])
})

test('overlapping lists release both capabilities and only the latest request commits state', async () => {
  const firstList = deferred()
  const firstListStarted = deferred()
  const calls = []
  let acquireCount = 0
  let leaseActive = false
  const acquire = async ({ onIdentity }) => {
    if (leaseActive) throw new Error('current terminal lease is busy')
    leaseActive = true
    const index = ++acquireCount
    const capability = createBackend(calls, `cap-${index}`, {
      list: () => {
        if (index === 1) {
          firstListStarted.resolve()
          return firstList.promise
        }
        return [{ name: 'new', type: 'f', size: 3 }]
      }
    })
    await onIdentity({
      loginUsername: 'hik',
      effectiveUid: '0',
      effectiveUsername: 'root',
      channel: 'pty-root'
    })
    return {
      backend: capability.backend,
      runtimeIdentity: rootRuntimeIdentity,
      release: async () => {
        await capability.release()
        leaseActive = false
        return true
      }
    }
  }
  const { entry } = await createEntryHarness({ acquire })
  entry.updateRemoteList = async remote => remote

  const oldRequest = entry.remoteList(false, '/root/old')
  await firstListStarted.promise
  const newRequest = entry.remoteList(false, '/root/new')
  await Promise.resolve()
  assert.equal(acquireCount, 1)
  firstList.resolve([{ name: 'old', type: 'f', size: 3 }])
  await oldRequest
  await newRequest

  assert.equal(entry.state.remote[0].name, 'new')
  assert.equal(calls.filter(call => call[0] === 'release').length, 2)
  assert.equal(entry.remoteFileOperations.size, 0)
})

test('routing source exposes only fixed backend operations to file items', () => {
  const remoteListStart = entrySource.indexOf('remoteListUncoalesced = async')
  const remoteListEnd = entrySource.indexOf('\n  updateRemoteList = async', remoteListStart)
  const remoteList = entrySource.slice(remoteListStart, remoteListEnd)
  const filePropsStart = entrySource.indexOf('getFileProps = (file, type) =>')
  const filePropsEnd = entrySource.indexOf('\n  renderEmptyFile', filePropsStart)
  const fileProps = entrySource.slice(filePropsStart, filePropsEnd)
  const askAiStart = fileItemSource.indexOf('askAiAboutFile = async')
  const askAiEnd = fileItemSource.indexOf(
    '\n  transferOrEnterDirectory = async',
    askAiStart
  )
  const askAi = fileItemSource.slice(askAiStart, askAiEnd)

  assert.match(entrySource, /sftpList = async \(backend, remotePath/)
  assert.match(entrySource, /await backend\.list\(\s*remotePath/)
  assert.match(remoteList, /withRemoteFileOperation\(/)
  assert.match(
    remoteList,
    /(?:await|return) this\.updateRemoteList\([\s\S]{0,100}backend/
  )
  assert.doesNotMatch(remoteList, /replaceSftpEntryTimer\(this, 'timer5'/)
  assert.match(entrySource, /resolveRemoteLink = async \([^)]*backend/)
  assert.match(entrySource, /remoteDel = async \(file, backend\)/)
  assert.match(fileProps, /'readRemoteFile'/)
  assert.match(fileProps, /'createRemoteFile'/)
  assert.match(fileProps, /'readRemoteFileContext'/)
  assert.match(askAi, /this\.props\.readRemoteFileContext/)
  assert.doesNotMatch(askAi, /this\.props\.sftp/)
  assert.doesNotMatch(contextActionsSource, /sftpRef\?\.sftp/)

  assert.doesNotMatch(fileItemSource, /props\.sftp\.(?:readFile|mkdir|touch)/)
  assert.match(fileItemSource, /const readRemoteFile = this\.props\.readRemoteFile/)
  assert.match(
    fileItemSource,
    /readText: path => type === typeMap\.remote[\s\S]{0,100}readRemoteFile\(path\)/
  )
  assert.match(fileItemSource, /this\.props\.createRemoteFile\(\{/)
  assert.doesNotMatch(fileItemSource, /remoteCreateNew[\s\S]{0,500}wait\(500\)/)
})
