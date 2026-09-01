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
  reportBackgroundError = () => {}
} = {}) {
  const stateWrites = []
  const entry = {
    props: {
      tab: { id: 'tab-1', username: 'hik' },
      sessionOptions: {},
      config: {},
      editTab: () => {}
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
    normalizeSftpError: error => error,
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
  const typeMap = { remote: 'remote', local: 'local' }
  installClassField(entry, 'acquireRemoteFileOperation', {
    acquireRemoteFileCapability: acquire,
    refs: { get: () => ({}) },
    isCurrentSftpEntryRemoteTask: (_entry, token) => Boolean(token)
  })
  installClassField(entry, 'withRemoteFileOperation', {
    abortRemoteFileOperation,
    initializeRemoteFileGeneration,
    remoteFileOperationUnmounted
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
    .then(lifecycle => {
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
        commitSftpEntryRemoteClient: lifecycle.commitSftpEntryRemoteClient,
        destroySftpEntryClientOnce: lifecycle.destroySftpEntryClientOnce,
        deepCopy: value => structuredClone(value),
        normalizeRemotePath: value => value,
        buildRemoteDirectoryCacheKey: value => JSON.stringify(value),
        typeMap,
        uniq: values => [...new Set(values)],
        preserveSftpDraftItems: (_oldRemote, remote) => remote,
        reconcileSelectedFileIds: (_oldRemote, _remote, selected) => selected,
        recordPerformanceDuration: () => true,
        remoteFileOperationUnmounted,
        remoteFileOperationStale,
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
      runtimeIdentity: null,
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

test('ordinary remote refresh schedules no delayed compensation callback', async () => {
  const timers = []
  const reports = []
  const acquire = async () => ({
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
  const phase = await Promise.race([
    capabilityStarted.promise.then(() => 'capability-started'),
    new Promise(resolve => setTimeout(() => resolve('blocked-on-home'), 25))
  ])
  assert.equal(phase, 'capability-started')

  homeReady.resolve('/home/hik')
  await listing
  assert.deepEqual(
    calls.filter(call => call[0] === 'list'),
    [['list', 'initial-home', '/home/hik']]
  )
  assert.equal(entry.state.remotePath, '/home/hik')
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

test('acquired capability is released when the remote request lifecycle is stale', async () => {
  const writes = []
  let releaseCount = 0
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
    refs: { get: () => ({}) },
    remoteFileOperationStale,
    isCurrentSftpEntryRemoteTask: () => false,
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

test('symlink metadata failure commits no partial remote list', async () => {
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
  assert.deepEqual(entry.state.remote, original)
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
  let destroyCount = 0
  const entry = {
    id: 'sftp-tab-1',
    sftp: { destroy: async () => { destroyCount += 1 } },
    remoteFileUnmounted: false,
    remoteFileOperations: new Set([{
      release: () => rejectedRelease.promise
    }, {
      release: () => { throw new Error('synchronous release failure') }
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
  rejectedRelease.reject(new Error('asynchronous release failure'))
  await disposal
  assert.equal(destroyCount, 1)
  assert.equal(await entry.componentWillUnmount(), true)
  assert.equal(destroyCount, 1)
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
    isCurrentRemoteFileGeneration: lifecycle.isCurrentRemoteFileGeneration
  })

  const firstReload = entry.handleReloadRemoteSftp()
  const latestReload = entry.handleReloadRemoteSftp()
  await Promise.resolve()
  assert.deepEqual(calls, [
    'invalidate-identity', 'clear', 'discard', 'release',
    'invalidate-identity', 'clear', 'discard'
  ])
  releaseGate.resolve()
  await Promise.all([firstReload, latestReload])

  assert.deepEqual(calls, [
    'invalidate-identity', 'clear', 'discard', 'release',
    'invalidate-identity', 'clear', 'discard', 'released', 'destroy',
    ['state', true], 'init'
  ])
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
  assert.match(remoteList, /await this\.updateRemoteList\([^)]*backend/)
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
