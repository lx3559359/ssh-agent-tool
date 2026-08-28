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

function createEntryHarness ({ acquire, replaceTimer } = {}) {
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
      selectedFiles: new Set()
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
    buildTree: remote => new Map(remote.map(file => [file.id, file])),
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
      installClassField(entry, 'remoteList', {
        beginSftpEntryRemoteTask: lifecycle.beginSftpEntryRemoteTask,
        isCurrentSftpEntryRemoteTask: lifecycle.isCurrentSftpEntryRemoteTask,
        commitSftpEntryRemoteClient: lifecycle.commitSftpEntryRemoteClient,
        destroySftpClient: lifecycle.destroySftpClient,
        deepCopy: value => structuredClone(value),
        normalizeRemotePath: value => value,
        typeMap,
        uniq: values => [...new Set(values)],
        preserveSftpDraftItems: (_oldRemote, remote) => remote,
        reconcileSelectedFileIds: (_oldRemote, _remote, selected) => selected,
        remoteFileOperationUnmounted,
        replaceSftpEntryTimer: replaceTimer || (() => 1),
        unexpectedPacketErrorDesc: 'unexpected packet',
        sftpRetryInterval: 1
      })
      return { entry, stateWrites }
    })
}

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

test('one-second compensation refresh acquires a new backend and never captures a released backend', async () => {
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
  assert.equal(timers.length, 1)
  await timers[0]()

  assert.equal(capabilityIndex, 2)
  assert.deepEqual(calls.map(call => call[0]), [
    'list', 'readlink', 'stat', 'release',
    'list', 'readlink', 'stat', 'release'
  ])
})

test('operation acquired after unmount releases once without running work or setting state', async () => {
  const pending = deferred()
  let releaseCount = 0
  let workCount = 0
  const entry = {
    remoteFileOperations: new Set(),
    remoteFileUnmounted: false,
    acquireRemoteFileOperation: () => pending.promise
  }
  installClassField(entry, 'withRemoteFileOperation', {
    abortRemoteFileOperation,
    remoteFileOperationUnmounted
  })

  const operation = entry.withRemoteFileOperation({}, async () => {
    workCount += 1
  })
  await Promise.resolve()
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
  installClassField(entry, 'remoteList', {
    remoteFileOperationUnmounted,
    beginSftpEntryRemoteTask: () => calls.push('begin-task')
  })

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

test('unmount absorbs synchronous capability release failures and completes disposal', async () => {
  const calls = []
  const entry = {
    id: 'sftp-tab-1',
    remoteFileUnmounted: false,
    remoteFileOperations: new Set([{
      release () {
        calls.push('release')
        throw new Error('synchronous release failure')
      }
    }]),
    remoteFileOperationBackends: new Map([['operation', {}]]),
    sftpSafetyProgressHandlers: { clear: () => calls.push('clear-progress') },
    sftpSafetyAdapter: {
      discardAllPreparedProofs: () => calls.push('discard-proofs')
    },
    _sortCache: { clear: () => calls.push('clear-sort') }
  }
  installClassMethod(entry, 'componentWillUnmount', {
    refs: { remove: () => calls.push('remove-ref') },
    disposeSftpEntryClient: () => calls.push('dispose-client'),
    disposeSftpEntryScheduling: () => calls.push('dispose-scheduling')
  })

  assert.doesNotThrow(() => entry.componentWillUnmount())
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(entry.remoteFileUnmounted, true)
  assert.equal(entry.remoteFileOperations.size, 0)
  assert.equal(entry.remoteFileOperationBackends.size, 0)
  assert.deepEqual(calls, [
    'release',
    'remove-ref',
    'clear-progress',
    'discard-proofs',
    'dispose-client',
    'dispose-scheduling',
    'clear-sort'
  ])
})

test('overlapping lists release both capabilities and only the latest request commits state', async () => {
  const firstList = deferred()
  const calls = []
  let acquireCount = 0
  let leaseActive = false
  const acquire = async ({ onIdentity }) => {
    if (leaseActive) throw new Error('current terminal lease is busy')
    leaseActive = true
    const index = ++acquireCount
    const capability = createBackend(calls, `cap-${index}`, {
      list: () => index === 1
        ? firstList.promise
        : [{ name: 'new', type: 'f', size: 3 }]
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
  await Promise.resolve()
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
  const remoteListStart = entrySource.indexOf('remoteList = async')
  const remoteListEnd = entrySource.indexOf('\n  updateRemoteList = async', remoteListStart)
  const remoteList = entrySource.slice(remoteListStart, remoteListEnd)
  const filePropsStart = entrySource.indexOf('getFileProps = (file, type) =>')
  const filePropsEnd = entrySource.indexOf('\n  renderEmptyFile', filePropsStart)
  const fileProps = entrySource.slice(filePropsStart, filePropsEnd)

  assert.match(entrySource, /sftpList = async \(backend, remotePath/)
  assert.match(entrySource, /await backend\.list\(\s*remotePath/)
  assert.match(remoteList, /withRemoteFileOperation\(/)
  assert.match(remoteList, /await this\.updateRemoteList\([^)]*backend/)
  assert.match(remoteList, /remoteList\(true, remotePath/)
  assert.doesNotMatch(remoteList, /timer5[\s\S]*updateRemoteList\(/)
  assert.match(entrySource, /resolveRemoteLink = async \([^)]*backend/)
  assert.match(entrySource, /remoteDel = async \(file, backend\)/)
  assert.match(fileProps, /'readRemoteFile'/)
  assert.match(fileProps, /'createRemoteFile'/)

  assert.doesNotMatch(fileItemSource, /props\.sftp\.(?:readFile|mkdir|touch)/)
  assert.match(fileItemSource, /this\.props\.readRemoteFile\(path\)/)
  assert.match(fileItemSource, /this\.props\.createRemoteFile\(\{/)
  assert.doesNotMatch(fileItemSource, /remoteCreateNew[\s\S]{0,500}wait\(500\)/)
})
