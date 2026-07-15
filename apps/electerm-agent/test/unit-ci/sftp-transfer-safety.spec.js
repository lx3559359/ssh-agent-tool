const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const transactionRoot = path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions'
)
const transferSafetyUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/file-transfer/file-transfer-safety.js'
)).href

function importTransactionModule (name) {
  return import(pathToFileURL(path.join(transactionRoot, name)).href)
}

function endpoint () {
  return {
    host: 'target.example.com',
    port: 22,
    username: 'root',
    tabId: 'target-tab',
    pid: 'sftp:target-tab:terminal-1',
    terminalPid: 'terminal-1',
    sessionType: 'sftp'
  }
}

function transferEffect (action, overrides = {}) {
  const paths = action === 'upload'
    ? { target: '/srv/app/release.tgz' }
    : {
        source: '/srv/app/current',
        target: '/srv/app/releases/current'
      }
  return {
    adapter: 'sftp',
    action,
    paths,
    resources: Object.values(paths).map(resourcePath => ({
      path: resourcePath,
      type: action === 'upload' ? 'file' : 'directory'
    })),
    type: action === 'upload' ? 'file' : 'directory',
    expected: action === 'upload'
      ? { size: 4096, type: 'file' }
      : { type: 'directory' },
    transfer: {
      identity: 'transfer-item-7',
      batchId: 'batch-3',
      ...(action === 'upload' ? { sourceIdentity: 'source-item-7' } : {}),
      direction: action === 'upload'
        ? 'local-to-remote'
        : 'same-endpoint'
    },
    ...overrides
  }
}

function clone (value) {
  return structuredClone(value)
}

function transferFileDescriptor (digest = 'a'.repeat(64), size = 7) {
  return {
    type: 'file',
    size,
    mode: 0o644,
    uid: 1000,
    gid: 1000,
    digest,
    digestAlgorithm: 'SHELLPILOT-SHA-256-CHAIN-V1'
  }
}

function descriptorSftp ({ size = 7, directory = false, methods = {} } = {}) {
  return {
    async lstat () {
      return directory
        ? { mode: 0o040755, uid: 1000, gid: 1000, size: 0, isDirectory: true }
        : { mode: 0o100644, uid: 1000, gid: 1000, size }
    },
    async list () {
      return []
    },
    async readFileChunk (filePath, { offset, maxBytes }) {
      const bytesRead = Math.min(maxBytes, size - offset)
      return {
        offset,
        nextOffset: offset + bytesRead,
        totalBytes: size,
        bytesRead,
        hasMore: offset + bytesRead < size,
        base64: Buffer.alloc(bytesRead, 0x61).toString('base64')
      }
    },
    ...methods
  }
}

function createMemoryStore () {
  const records = new Map()
  return {
    async save (value) {
      records.set(value.id, clone(value))
      return clone(value)
    },
    async get (id) {
      return clone(records.get(id))
    },
    async patch (id, value) {
      const current = records.get(id)
      if (!current) throw new Error(`missing record: ${id}`)
      const next = { ...current, ...clone(value) }
      records.set(id, next)
      return clone(next)
    },
    async guardedPatch (id, predicate, value) {
      const current = clone(records.get(id))
      if (await predicate(current) !== true) {
        const error = new Error('integrity atomic update rejected')
        error.code = 'SAFETY_OPERATION_INTEGRITY'
        throw error
      }
      const resolved = typeof value === 'function'
        ? await value(clone(current))
        : value
      return this.patch(id, resolved)
    }
  }
}

async function createExternalTransferRunner (options = {}) {
  const { buildSideEffectSafetyRequest } = await importTransactionModule(
    'side-effect-model.js'
  )
  const { createTransactionRunner } = await importTransactionModule(
    'transaction-runner.js'
  )
  const store = createMemoryStore()
  const calls = []
  const adapter = {
    supports: operation => operation.effect?.adapter === 'sftp',
    async prepare (operation) {
      calls.push('prepare')
      const operationDir = `/srv/app/.shellpilot-transactions/${operation.id}`
      return {
        manifestComplete: true,
        plan: {
          adapter: 'sftp',
          action: operation.effect.action,
          operationDir,
          manifestPath: `${operationDir}/manifest.json`,
          resources: [{
            slot: 'target',
            path: operation.effect.paths.target,
            snapshotPath: `${operationDir}/target`,
            restoreTempPath: `${operationDir}/target.restore-temp`,
            displacedPath: `${operationDir}/target.displaced`,
            original: { absent: true }
          }]
        },
        artifacts: {
          manifest: `${operationDir}/manifest.json`,
          target: `${operationDir}/target`
        }
      }
    },
    async beforeExecute () {
      calls.push('beforeExecute')
      throw new Error('external transfer must not run adapter mutation')
    },
    async beforeExternalExecute () {
      calls.push('beforeExternalExecute')
      return { verified: true, summary: 'target unchanged' }
    },
    async verifyExecute () {
      calls.push('verifyExecute')
      if (options.verifyFailure) {
        throw new Error('target verification failed')
      }
      return { verified: true, summary: 'target verified' }
    },
    async rollback () {
      calls.push('rollback')
      return { verified: true }
    },
    async verifyRollback () {
      calls.push('verifyRollback')
      return { verified: true }
    }
  }
  const runner = createTransactionRunner({
    runRemote: async () => { throw new Error('shell execution forbidden') },
    cancelRemote: async () => {},
    getCurrentEndpoint: async () => endpoint(),
    buildRecoveryPlan: async () => { throw new Error('shell recovery forbidden') },
    sideEffectAdapter: adapter,
    store,
    now: () => new Date('2026-07-14T00:00:00.000Z')
  })
  const request = buildSideEffectSafetyRequest({
    id: 'sftp-transfer-upload-external-1',
    source: 'sftp',
    title: 'SFTP upload',
    endpoint: endpoint(),
    effect: transferEffect('upload')
  }, { now: new Date('2026-07-14T00:00:00.000Z') })
  return { runner, request, store, calls }
}

test('transfer side effects authoritatively bind upload copy and move identities', async () => {
  const { buildSideEffectSafetyRequest } = await importTransactionModule(
    'side-effect-model.js'
  )

  for (const action of ['upload', 'copy', 'move']) {
    const operation = buildSideEffectSafetyRequest({
      id: `sftp-transfer-${action}-1`,
      source: 'sftp',
      title: `SFTP ${action}`,
      endpoint: endpoint(),
      effect: transferEffect(action)
    }, { now: new Date('2026-07-14T00:00:00.000Z') })

    assert.equal(operation.command, undefined)
    assert.equal(operation.effect.action, action)
    assert.equal(operation.effect.transfer.identity, 'transfer-item-7')
    assert.equal(operation.effect.transfer.batchId, 'batch-3')
    assert.match(operation.effectKey, new RegExp(`^sftp:${action}:`))
    assert.equal(operation.risk, 'change')
    assert.equal(operation.reversible, true)
  }
})

test('transfer safety planning bypasses readonly local FTP skip and cancel cases', async () => {
  const {
    buildTransferSafetyPlan
  } = await import(transferSafetyUrl)

  const cases = [
    [{ typeFrom: 'remote', typeTo: 'local' }, 'download'],
    [{ typeFrom: 'local', typeTo: 'local', operation: 'cp' }, 'local-only'],
    [{ typeFrom: 'remote', typeTo: 'remote', isFtp: true }, 'ftp'],
    [{ typeFrom: 'local', typeTo: 'remote', conflictPolicy: 'skip' }, 'skip'],
    [{ typeFrom: 'local', typeTo: 'remote', conflictPolicy: 'cancel' }, 'cancel']
  ]

  for (const [input, reason] of cases) {
    assert.deepEqual(buildTransferSafetyPlan(input), {
      required: false,
      reason
    })
  }
})

test('remote write planning uses the final conflict path and stable retry identity', async () => {
  const {
    buildTransferSafetyPlan
  } = await import(transferSafetyUrl)

  const transfer = {
    id: 'item-9',
    transferBatch: 'batch-4',
    typeFrom: 'local',
    typeTo: 'remote',
    fromPath: 'C:/release/app.zip',
    toPath: '/srv/app/app.zip',
    finalToPath: '/srv/app/app(rename-1).zip',
    conflictPolicy: 'rename',
    fromFile: { isDirectory: false, size: 8192 }
  }
  const first = buildTransferSafetyPlan(transfer)
  const retry = buildTransferSafetyPlan({ ...transfer, retryAttempt: 2 })

  assert.equal(first.required, true)
  assert.equal(first.action, 'upload')
  assert.equal(first.paths.target, '/srv/app/app(rename-1).zip')
  assert.equal(first.expected.size, 8192)
  assert.equal(first.transfer.identity, retry.transfer.identity)
  assert.equal(first.operationId, retry.operationId)
  assert.equal(first.transfer.batchId, 'batch-4')
  assert.match(first.transfer.sourceIdentity, /^source:/)

  const differentSource = buildTransferSafetyPlan({
    ...transfer,
    fromPath: 'C:/release/other-app.zip'
  })
  assert.notEqual(first.operationId, differentSource.operationId)
})

test('protected uploads bind and recheck a full local source descriptor', async () => {
  const {
    buildTransferSafetyPlan,
    captureLocalTransferSource,
    verifyLocalTransferSource
  } = await import(transferSafetyUrl)
  const descriptors = [
    {
      type: 'file',
      mode: 0o640,
      uid: 1000,
      gid: 1000,
      size: 3,
      digest: 'a'.repeat(64),
      digestAlgorithm: 'SHELLPILOT-SHA-256-CHAIN-V1'
    },
    {
      type: 'file',
      mode: 0o640,
      uid: 1000,
      gid: 1000,
      size: 3,
      digest: 'b'.repeat(64),
      digestAlgorithm: 'SHELLPILOT-SHA-256-CHAIN-V1'
    }
  ]
  let calls = 0
  const transfer = {
    id: 'integrity-upload',
    typeFrom: 'local',
    typeTo: 'remote',
    fromPath: 'C:/release.bin',
    toPath: '/srv/release.bin',
    fromFile: { isDirectory: false, size: 3 }
  }
  const sourceDescriptor = await captureLocalTransferSource({
    transfer,
    describeLocal: async () => descriptors[calls++]
  })
  const plan = buildTransferSafetyPlan({ ...transfer, sourceDescriptor })

  assert.deepEqual(plan.expected.sourceDescriptor, descriptors[0])
  await assert.rejects(
    verifyLocalTransferSource({
      transfer,
      sourceDescriptor,
      describeLocal: async () => descriptors[calls++]
    }),
    /本地上传源.*变化/
  )
})

test('transfer attempt generations reject late callbacks and serialize completion', async () => {
  const { createTransferAttemptGuard } = await import(transferSafetyUrl)
  const guard = createTransferAttemptGuard()
  const first = guard.start()
  assert.equal(guard.isCurrent(first), true)

  guard.invalidate(first)
  assert.equal(guard.isCurrent(first), false)
  const second = guard.start()
  assert.notEqual(second, first)
  assert.equal(guard.beginCompletion(second), true)
  assert.equal(guard.start(), null)
  assert.equal(guard.beginCompletion(second), false)

  guard.finishCompletion(second)
  const third = guard.start()
  assert.notEqual(third, second)
  assert.equal(guard.isCurrent(third), true)
})

test('overwrite-all keeps one operation identity per transfer item in a shared batch', async () => {
  const { buildTransferSafetyPlan } = await import(transferSafetyUrl)
  const base = {
    transferBatch: 'batch-overwrite',
    typeFrom: 'local',
    typeTo: 'remote',
    conflictPolicy: 'mergeOrOverwrite',
    fromFile: { isDirectory: false, size: 12 }
  }
  const left = buildTransferSafetyPlan({
    ...base,
    id: 'left',
    fromPath: 'C:/left',
    toPath: '/srv/left'
  })
  const right = buildTransferSafetyPlan({
    ...base,
    id: 'right',
    fromPath: 'C:/right',
    toPath: '/srv/right'
  })

  assert.notEqual(left.operationId, right.operationId)
  assert.equal(left.transfer.batchId, right.transfer.batchId)
  assert.equal(left.transfer.batchId, 'batch-overwrite')
})

test('cross-host remote transfer protects only the target write phase', async () => {
  const { buildTransferSafetyPlan } = await import(transferSafetyUrl)
  const readonlyStep = buildTransferSafetyPlan({
    id: 'remote-step-1',
    typeFrom: 'remote',
    typeTo: 'local',
    remote2remoteStep: 1
  })
  const targetStep = buildTransferSafetyPlan({
    id: 'remote-step-2',
    typeFrom: 'local',
    typeTo: 'remote',
    fromPath: 'C:/Temp/remote-item',
    toPath: '/srv/remote-item',
    remote2remoteStep: 2,
    fromFile: { isDirectory: false, size: 17 }
  })

  assert.deepEqual(readonlyStep, { required: false, reason: 'download' })
  assert.equal(targetStep.required, true)
  assert.equal(targetStep.action, 'upload')
  assert.equal(targetStep.transfer.direction, 'cross-host-target')
})

test('cross-host target binds the complete stable source security identity', async () => {
  const {
    assertCrossHostSourceHistory,
    buildCrossHostSourceIdentity,
    buildTransferSafetyPlan,
    buildTransferSourceEndpointKey,
    verifyCrossHostSourceContent
  } = await import(transferSafetyUrl)
  const baseEndpoint = {
    host: 'Source.Example.com.',
    port: 22,
    username: 'root',
    tabId: 'source-tab',
    pid: 'sftp:source-tab:session-1'
  }
  const sourceEndpointKey = buildTransferSourceEndpointKey(baseEndpoint)
  const sourceIdentity = buildCrossHostSourceIdentity({
    sourceEndpointKey,
    path: '/srv/release.bin',
    file: { isDirectory: false, size: 17 }
  })
  const sourceDescriptor = transferFileDescriptor('a'.repeat(64), 17)
  const verifiedContent = await verifyCrossHostSourceContent({
    transfer: {
      remote2remoteStep: 1,
      fromPath: '/srv/release.bin',
      toPath: 'C:/Temp/remote-item'
    },
    sourcePin: { sftp: {} },
    preflight: {
      verifiedSourceEndpointKey: sourceEndpointKey,
      verifiedSourceIdentity: sourceIdentity,
      sourceDescriptor
    },
    describeRemote: async () => sourceDescriptor,
    describeLocal: async () => sourceDescriptor
  })
  const sourceContentIdentity = verifiedContent.verifiedSourceContentIdentity

  assert.notEqual(sourceEndpointKey, buildTransferSourceEndpointKey({
    ...baseEndpoint,
    username: 'deploy'
  }))
  assert.notEqual(sourceEndpointKey, buildTransferSourceEndpointKey({
    ...baseEndpoint,
    port: 2222
  }))
  assert.notEqual(sourceEndpointKey, buildTransferSourceEndpointKey({
    ...baseEndpoint,
    tabId: 'other-tab'
  }))
  assert.notEqual(sourceEndpointKey, buildTransferSourceEndpointKey({
    ...baseEndpoint,
    pid: 'sftp:source-tab:session-2'
  }))
  assert.equal(assertCrossHostSourceHistory({
    verifiedSourceEndpointKey: sourceEndpointKey,
    verifiedSourceIdentity: sourceIdentity,
    verifiedSourceContentIdentity: sourceContentIdentity,
    verifiedSourceDescriptor: sourceDescriptor
  }, { sourceEndpointKey, sourceIdentity, sourceContentIdentity }), true)
  assert.throws(() => assertCrossHostSourceHistory({
    verifiedSourceEndpointKey: buildTransferSourceEndpointKey({
      ...baseEndpoint,
      username: 'deploy'
    }),
    verifiedSourceIdentity: sourceIdentity,
    verifiedSourceContentIdentity: sourceContentIdentity,
    verifiedSourceDescriptor: sourceDescriptor
  }, { sourceEndpointKey, sourceIdentity }), /来源安全身份/)

  const targetStep = buildTransferSafetyPlan({
    id: 'remote-step-2-bound',
    typeFrom: 'local',
    typeTo: 'remote',
    fromPath: 'C:/Temp/remote-item',
    toPath: '/srv/remote-item',
    remote2remoteStep: 2,
    sourceEndpointKey,
    sourceIdentity,
    sourceContentIdentity,
    sourceDescriptor,
    fromFile: { isDirectory: false, size: 17 }
  })
  assert.equal(targetStep.transfer.sourceEndpointKey, sourceEndpointKey)
  assert.equal(targetStep.transfer.sourceIdentity, sourceIdentity)
  assert.equal(targetStep.transfer.sourceContentIdentity, sourceContentIdentity)
  assert.deepEqual(targetStep.expected.sourceDescriptor, sourceDescriptor)
  const { buildSideEffectSafetyRequest } = await importTransactionModule(
    'side-effect-model.js'
  )
  const operation = buildSideEffectSafetyRequest({
    id: 'cross-host-content-binding',
    source: 'sftp',
    title: 'cross-host upload',
    endpoint: endpoint(),
    effect: {
      adapter: 'sftp',
      action: targetStep.action,
      paths: targetStep.paths,
      resources: [{ path: targetStep.paths.target, type: targetStep.type }],
      type: targetStep.type,
      expected: targetStep.expected,
      transfer: targetStep.transfer
    }
  })
  assert.equal(
    operation.effect.transfer.sourceContentIdentity,
    sourceContentIdentity
  )

  const fs = require('node:fs')
  const handlerSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/remote2remote-handler.jsx'
  ), 'utf8')
  const handlersSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/remote2remote-handlers.jsx'
  ), 'utf8')
  const fileItemSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/file-item.jsx'
  ), 'utf8')
  assert.match(handlerSource, /assertCrossHostSourceHistory\(step1/)
  assert.match(handlerSource, /sourceEndpointKey/)
  assert.match(handlerSource, /sourceIdentity/)
  assert.match(handlersSource, /getSftpSafetyEndpoint\(\)/)
  assert.match(handlersSource, /buildTransferSourceEndpointKey/)
  assert.match(handlersSource, /fromFile\.tabId\s*!==\s*targetTab\.id/)
  assert.match(fileItemSource, /file\.tabId\s*!==\s*targetTabId/)
})

test('cross-host step1 revalidates the live source endpoint before any download', async () => {
  const {
    buildCrossHostSourceIdentity,
    buildTransferSourceEndpointKey,
    resolveTransferRuntimeTransport,
    verifyCrossHostSourcePreflight
  } = await import(transferSafetyUrl)
  const queuedEndpoint = {
    host: 'source.example.com',
    port: 22,
    username: 'root',
    tabId: 'source-tab',
    pid: 'sftp:source-tab:session-a'
  }
  const sourceEndpointKey = buildTransferSourceEndpointKey(queuedEndpoint)
  const fromFile = { isDirectory: false, size: 23 }
  const transfer = {
    remote2remoteStep: 1,
    tabId: 'source-tab',
    fromPath: '/srv/shared/release.bin',
    fromFile,
    sourceEndpointKey,
    sourceIdentity: buildCrossHostSourceIdentity({
      sourceEndpointKey,
      path: '/srv/shared/release.bin',
      file: fromFile
    })
  }
  let capabilityLookup
  let downloadCalls = 0
  const reconnectedCapability = {
    sftp: descriptorSftp({ size: 23 }),
    getSftpSafetyEndpoint: () => ({
      ...queuedEndpoint,
      port: 2222,
      username: 'deploy',
      pid: 'sftp:source-tab:session-b'
    })
  }

  await assert.rejects(async () => {
    await verifyCrossHostSourcePreflight({
      transfer,
      getCapability: (sourceTabId) => {
        capabilityLookup = sourceTabId
        return reconnectedCapability
      }
    })
    downloadCalls += 1
  }, /来源.*变化|来源.*不一致/)
  assert.equal(capabilityLookup, 'source-tab')
  assert.equal(downloadCalls, 0)

  const stableCapability = {
    sftp: descriptorSftp({ size: 23 }),
    getSftpSafetyEndpoint: () => queuedEndpoint
  }
  const verified = await verifyCrossHostSourcePreflight({
    transfer,
    getCapability: () => stableCapability
  })
  assert.deepEqual(verified.verified, {
    verifiedSourceEndpointKey: transfer.sourceEndpointKey,
    verifiedSourceIdentity: transfer.sourceIdentity,
    sourceDescriptor: verified.verified.sourceDescriptor
  })
  assert.ok(verified.runtime.capability)
  assert.ok(verified.runtime.sftp)
  assert.equal(resolveTransferRuntimeTransport({
    transfer: { remote2remoteStep: 1 },
    sourcePin: verified.runtime,
    getCapability: () => reconnectedCapability
  }), verified.runtime)

  const fs = require('node:fs')
  const transferSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')
  const handlerSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/remote2remote-handler.jsx'
  ), 'utf8')
  assert.match(
    transferSource,
    /verifyCrossHostSourcePreflight[\s\S]*transferSafety\.begin\(\)[\s\S]*transferFile\(transfer/
  )
  assert.match(transferSource, /verifiedSourceEndpointKey/)
  assert.match(transferSource, /verifiedSourceIdentity/)
  assert.match(transferSource, /resolveTransferRuntimeTransport/)
  assert.match(handlerSource, /fromFile:\s*copy\(this\.fromFile\)/)
  assert.match(handlerSource, /step1\.verifiedSourceEndpointKey/)
  assert.match(handlerSource, /step1\.verifiedSourceIdentity/)
})

test('cross-host step1 atomically pins one SFTP transport across ref replacement', async () => {
  const {
    buildCrossHostSourceIdentity,
    buildTransferSourceEndpointKey,
    resolveTransferRuntimeTransport,
    verifyCrossHostSourcePreflight
  } = await import(transferSafetyUrl)
  const endpoint = {
    host: 'source.example.com',
    port: 22,
    username: 'root',
    tabId: 'source-tab',
    pid: 'sftp:source-tab:session-a'
  }
  const sourceEndpointKey = buildTransferSourceEndpointKey(endpoint)
  const fromFile = { isDirectory: true, size: 41 }
  const transfer = {
    remote2remoteStep: 1,
    tabId: 'source-tab',
    fromPath: '/srv/shared/tree',
    fromFile,
    sourceEndpointKey,
    sourceIdentity: buildCrossHostSourceIdentity({
      sourceEndpointKey,
      path: '/srv/shared/tree',
      file: fromFile
    })
  }
  let oldDownloads = 0
  let newDownloads = 0
  let oldDestroyed = false
  const oldSftp = descriptorSftp({
    directory: true,
    methods: {
      download: async () => {
        if (oldDestroyed) throw new Error('旧来源连接已关闭')
        oldDownloads += 1
      }
    }
  })
  const newSftp = descriptorSftp({
    directory: true,
    methods: {
      download: async () => {
        newDownloads += 1
      }
    }
  })
  const newComponent = {
    sftp: newSftp,
    getSftpSafetyEndpoint: () => ({
      ...endpoint,
      username: 'deploy',
      pid: 'sftp:source-tab:session-b'
    })
  }
  let currentComponent
  const replacingComponent = {
    sftp: oldSftp,
    getSftpSafetyEndpoint: () => {
      queueMicrotask(() => {
        replacingComponent.sftp = newSftp
        currentComponent = newComponent
      })
      return endpoint
    }
  }
  currentComponent = replacingComponent

  await assert.rejects(
    verifyCrossHostSourcePreflight({
      transfer,
      getCapability: () => currentComponent
    }),
    /来源.*替换|来源.*变化/
  )
  assert.equal(oldDownloads, 0)
  assert.equal(newDownloads, 0)

  const stableComponent = {
    sftp: oldSftp,
    sftpList: (sftp, path) => ({ sftp, path }),
    getSftpSafetyEndpoint: () => endpoint
  }
  currentComponent = stableComponent
  const pin = await verifyCrossHostSourcePreflight({
    transfer,
    getCapability: () => currentComponent
  })
  currentComponent = newComponent
  const runtime = resolveTransferRuntimeTransport({
    transfer,
    sourcePin: pin.runtime,
    getCapability: () => currentComponent
  })
  assert.equal(runtime.capability, stableComponent)
  assert.equal(runtime.sftp, oldSftp)
  assert.deepEqual(runtime.capability.sftpList(runtime.sftp, '/srv/shared/tree'), {
    sftp: oldSftp,
    path: '/srv/shared/tree'
  })
  await runtime.sftp.download()
  assert.equal(oldDownloads, 1)
  assert.equal(newDownloads, 0)

  oldDestroyed = true
  await assert.rejects(runtime.sftp.download(), /旧来源连接已关闭/)
  assert.equal(newDownloads, 0)

  const fs = require('node:fs')
  const transferSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')
  assert.match(transferSource, /getTransferRuntimeTransport/)
  assert.match(transferSource, /transferFile[\s\S]*getTransferRuntimeTransport\(transfer\)/)
  assert.match(transferSource, /transferFileAsSubTransfer[\s\S]*getTransferRuntimeTransport\(transfer\)/)
  assert.match(transferSource, /list\(typeFrom, fromPath, tabId, transfer, attemptToken\)/)
  assert.match(transferSource, /mkdir[\s\S]*getTransferRuntimeTransport\(transfer\)/)
})

test('cross-host step1 retry drops a dead pin and revalidates the replacement transport', async () => {
  const {
    buildCrossHostSourceIdentity,
    buildTransferSourceEndpointKey,
    resetCrossHostSourceAttemptForRetry,
    resolveTransferRuntimeTransport,
    verifyCrossHostSourcePreflight
  } = await import(transferSafetyUrl)
  const endpoint = {
    host: 'source.example.com',
    port: 22,
    username: 'root',
    tabId: 'source-tab',
    pid: 'sftp:source-tab:stable-session'
  }
  const sourceEndpointKey = buildTransferSourceEndpointKey(endpoint)
  const fromFile = { isDirectory: false, size: 64 }
  const transfer = {
    remote2remoteStep: 1,
    tabId: 'source-tab',
    fromPath: '/srv/shared/retry.bin',
    fromFile,
    sourceEndpointKey,
    sourceIdentity: buildCrossHostSourceIdentity({
      sourceEndpointKey,
      path: '/srv/shared/retry.bin',
      file: fromFile
    })
  }
  let aDownloads = 0
  let bDownloads = 0
  let cDownloads = 0
  const transportA = descriptorSftp({
    size: 64,
    methods: {
      download: async () => {
        aDownloads += 1
        throw new Error('socket closed during transfer')
      }
    }
  })
  const transportB = descriptorSftp({
    size: 64,
    methods: {
      download: async () => {
        bDownloads += 1
      }
    }
  })
  const transportC = descriptorSftp({
    size: 64,
    methods: {
      download: async () => {
        cDownloads += 1
      }
    }
  })
  const capabilityA = {
    sftp: transportA,
    getSftpSafetyEndpoint: () => endpoint
  }
  const capabilityB = {
    sftp: transportB,
    getSftpSafetyEndpoint: () => endpoint
  }
  const capabilityC = {
    sftp: transportC,
    getSftpSafetyEndpoint: () => ({
      ...endpoint,
      username: 'deploy',
      pid: 'sftp:source-tab:different-session'
    })
  }

  const attemptA = await verifyCrossHostSourcePreflight({
    transfer,
    getCapability: () => capabilityA
  })
  await assert.rejects(attemptA.runtime.sftp.download(), /socket closed/)

  const retryState = resetCrossHostSourceAttemptForRetry({
    transfer,
    sourcePin: attemptA.runtime,
    verifiedSource: attemptA.verified
  })
  assert.deepEqual(retryState, {
    sourcePin: null,
    verifiedSource: null,
    sourcePreflight: null
  })

  const attemptB = await verifyCrossHostSourcePreflight({
    transfer,
    getCapability: () => capabilityB
  })
  const runtimeB = resolveTransferRuntimeTransport({
    transfer,
    sourcePin: attemptB.runtime,
    getCapability: () => capabilityC
  })
  await runtimeB.sftp.download()
  assert.equal(runtimeB.sftp, transportB)
  assert.equal(aDownloads, 1)
  assert.equal(bDownloads, 1)
  assert.equal(cDownloads, 0)

  await assert.rejects(
    verifyCrossHostSourcePreflight({
      transfer,
      getCapability: () => capabilityC
    }),
    /来源端点已变化/
  )
  assert.equal(aDownloads, 1)
  assert.equal(bDownloads, 1)
  assert.equal(cDownloads, 0)

  const fs = require('node:fs')
  const transferSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')
  assert.match(
    transferSource,
    /scheduleRetry[\s\S]*resetCrossHostSourceAttemptForRetry[\s\S]*setTimeout\(\(\)\s*=>\s*this\.startTransfer\(\)/
  )
  assert.match(transferSource, /this\.crossHostSourcePin\s*=\s*retrySource\.sourcePin/)
  assert.match(transferSource, /this\.verifiedCrossHostSource\s*=\s*retrySource\.verifiedSource/)
})

test('upload safety model requires an opaque source binding', async () => {
  const { buildSideEffectSafetyRequest } = await importTransactionModule(
    'side-effect-model.js'
  )
  const effect = transferEffect('upload')
  delete effect.transfer.sourceIdentity

  assert.throws(() => buildSideEffectSafetyRequest({
    id: 'upload-without-source-binding',
    source: 'sftp',
    title: 'upload',
    endpoint: endpoint(),
    effect
  }), /source/i)
})

test('external SFTP transfer persists mutation marker before transport and verifies completion', async () => {
  const { runner, request, store, calls } = await createExternalTransferRunner()
  const prepared = await runner.prepare(request)
  assert.equal(prepared.state, 'awaiting-confirmation')

  const begun = await runner.beginExternalExecution(request.id, {
    confirmed: true,
    transferIdentity: request.effect.transfer.identity,
    cancelExternal: async () => {}
  })
  const persisted = await store.get(request.id)

  assert.equal(begun.state, 'executing')
  assert.equal(persisted.mutationStarted, true)
  assert.equal(persisted.commitPoint, true)
  assert.equal(
    persisted.metadata.externalExecution.transferIdentity,
    request.effect.transfer.identity
  )
  assert.deepEqual(calls, ['prepare', 'beforeExternalExecute'])

  const completed = await runner.completeExternalExecution(request.id, {
    executionId: begun.executionId,
    effectKey: request.effectKey,
    transferIdentity: request.effect.transfer.identity,
    exitCode: 0
  })
  assert.equal(completed.state, 'rollback-available')
  assert.deepEqual(calls, [
    'prepare',
    'beforeExternalExecute',
    'verifyExecute'
  ])
})

test('cancelling a running external transfer stops transport and keeps rollback available', async () => {
  const { runner, request, store } = await createExternalTransferRunner()
  let cancelled = 0
  await runner.prepare(request)
  await runner.beginExternalExecution(request.id, {
    confirmed: true,
    transferIdentity: request.effect.transfer.identity,
    cancelExternal: async () => { cancelled += 1 }
  })

  const result = await runner.cancel(request.id)
  const persisted = await store.get(request.id)

  assert.equal(cancelled, 1)
  assert.equal(result.state, 'failed')
  assert.equal(persisted.state, 'failed')
  assert.equal(persisted.mutationStarted, true)
  assert.match(persisted.error, /取消|cancel/i)
})

test('external transfer completion rejects mismatched transfer identity', async () => {
  const { runner, request } = await createExternalTransferRunner()
  await runner.prepare(request)
  const begun = await runner.beginExternalExecution(request.id, {
    confirmed: true,
    transferIdentity: request.effect.transfer.identity,
    cancelExternal: async () => {}
  })

  await assert.rejects(
    runner.completeExternalExecution(request.id, {
      executionId: begun.executionId,
      effectKey: request.effectKey,
      transferIdentity: 'forged-transfer',
      exitCode: 0
    }),
    /identity|标识|匹配/i
  )
})

test('external transfer verification failure persists a rollbackable failure', async () => {
  const { runner, request, store } = await createExternalTransferRunner({
    verifyFailure: true
  })
  await runner.prepare(request)
  const begun = await runner.beginExternalExecution(request.id, {
    confirmed: true,
    transferIdentity: request.effect.transfer.identity,
    cancelExternal: async () => {}
  })

  const completed = await runner.completeExternalExecution(request.id, {
    executionId: begun.executionId,
    effectKey: request.effectKey,
    transferIdentity: request.effect.transfer.identity,
    exitCode: 0
  })
  assert.equal(completed.state, 'failed')
  assert.equal((await store.get(request.id)).state, 'failed')
  assert.match(completed.error, /verification failed/i)

  const restored = await runner.rollback(request.id)
  assert.equal(restored.state, 'restored')
})

test('file-transfer safety controller prepares once across retries and completes by identity', async () => {
  const {
    createTransferSafetyController
  } = await import(transferSafetyUrl)
  const calls = []
  const transfer = {
    id: 'upload-retry',
    transferBatch: 'batch-retry',
    typeFrom: 'local',
    typeTo: 'remote',
    fromPath: 'C:/release.bin',
    toPath: '/srv/release.bin',
    fromFile: { isDirectory: false, size: 7 }
  }
  const capability = {
    async prepareTransferSafetyOperation (plan) {
      calls.push(['prepare', plan.operationId])
      return { id: plan.operationId, effectKey: 'effect-key-1' }
    },
    async beginTransferSafetyOperation (id, options) {
      calls.push(['begin', id, options.transferIdentity])
      assert.equal(typeof options.cancelExternal, 'function')
      return { id, effectKey: 'effect-key-1', executionId: 'execution-1' }
    },
    async completeTransferSafetyOperation (id, completion) {
      calls.push(['complete', id, completion])
      return { id, state: completion.exitCode === 0 ? 'rollback-available' : 'failed' }
    },
    async cancelTransferSafetyOperation (id) {
      calls.push(['cancel', id])
      return { id, state: 'failed' }
    }
  }
  const controller = createTransferSafetyController({
    getTransfer: () => transfer,
    getCapability: () => capability,
    cancelTransport: async () => {}
  })

  const first = await controller.begin()
  const retry = await controller.begin()
  assert.equal(first.executionId, retry.executionId)
  assert.deepEqual(calls.map(call => call[0]), ['prepare', 'begin'])

  const completed = await controller.complete({ exitCode: 0 })
  assert.equal(completed.state, 'rollback-available')
  assert.equal(calls[2][2].executionId, 'execution-1')
  assert.equal(calls[2][2].effectKey, 'effect-key-1')
  assert.match(calls[2][2].transferIdentity, /^transfer:/)
})

test('file-transfer safety controller retries lifecycle calls without replacing recovery', async () => {
  const { createTransferSafetyController } = await import(transferSafetyUrl)
  let prepareCalls = 0
  let beginCalls = 0
  let completeCalls = 0
  const capability = {
    async prepareTransferSafetyOperation (plan) {
      prepareCalls += 1
      return { id: plan.operationId, effectKey: 'effect-retry' }
    },
    async beginTransferSafetyOperation (id) {
      beginCalls += 1
      if (beginCalls === 1) throw new Error('temporary begin failure')
      return { id, effectKey: 'effect-retry', executionId: 'execution-retry' }
    },
    async completeTransferSafetyOperation (id) {
      completeCalls += 1
      if (completeCalls === 1) throw new Error('temporary complete failure')
      return { id, state: 'rollback-available' }
    }
  }
  const controller = createTransferSafetyController({
    getTransfer: () => ({
      id: 'lifecycle-retry',
      typeFrom: 'local',
      typeTo: 'remote',
      fromPath: 'C:/release.bin',
      toPath: '/srv/release.bin',
      fromFile: { isDirectory: false, size: 7 }
    }),
    getCapability: () => capability,
    cancelTransport: async () => {}
  })

  await assert.rejects(controller.begin(), /temporary begin failure/)
  await controller.begin()
  assert.equal(prepareCalls, 1)
  assert.equal(beginCalls, 2)

  await assert.rejects(controller.complete(), /temporary complete failure/)
  const completed = await controller.complete()
  assert.equal(completed.state, 'rollback-available')
  assert.equal(completeCalls, 2)
})

test('file-transfer safety controller bypasses downloads and exposes transport cancellation', async () => {
  const {
    createTransferSafetyController
  } = await import(transferSafetyUrl)
  let capabilityReads = 0
  const bypass = createTransferSafetyController({
    getTransfer: () => ({ typeFrom: 'remote', typeTo: 'local' }),
    getCapability: () => {
      capabilityReads += 1
      return null
    },
    cancelTransport: async () => {}
  })
  assert.equal(await bypass.begin(), null)
  assert.equal(capabilityReads, 0)

  let cancelled = 0
  const capability = {
    async prepareTransferSafetyOperation (plan) {
      return { id: plan.operationId, effectKey: 'effect-key-2' }
    },
    async beginTransferSafetyOperation (id) {
      return { id, effectKey: 'effect-key-2', executionId: 'execution-2' }
    },
    async cancelTransferSafetyOperation () {
      cancelled += 1
      return { state: 'failed' }
    }
  }
  const protectedTransfer = createTransferSafetyController({
    getTransfer: () => ({
      id: 'upload-cancel',
      transferBatch: 'batch-cancel',
      typeFrom: 'local',
      typeTo: 'remote',
      fromPath: 'C:/release.bin',
      toPath: '/srv/release.bin',
      fromFile: { isDirectory: false, size: 7 }
    }),
    getCapability: () => capability,
    cancelTransport: async () => {}
  })
  await protectedTransfer.begin()
  await protectedTransfer.cancel()
  assert.equal(cancelled, 1)
})

test('file-transfer safety controller disposes only an active external execution', async () => {
  const { createTransferSafetyController } = await import(transferSafetyUrl)
  let cancelled = 0
  const capability = {
    async prepareTransferSafetyOperation (plan) {
      return { id: plan.operationId, effectKey: 'effect-dispose' }
    },
    async beginTransferSafetyOperation (id) {
      return { id, effectKey: 'effect-dispose', executionId: 'execution-dispose' }
    },
    async completeTransferSafetyOperation (id) {
      return { id, state: 'rollback-available' }
    },
    async cancelTransferSafetyOperation () {
      cancelled += 1
      return { state: 'failed' }
    }
  }
  const makeController = () => createTransferSafetyController({
    getTransfer: () => ({
      id: 'upload-dispose',
      typeFrom: 'local',
      typeTo: 'remote',
      fromPath: 'C:/release.bin',
      toPath: '/srv/release.bin',
      fromFile: { isDirectory: false, size: 7 }
    }),
    getCapability: () => capability,
    cancelTransport: async () => {}
  })

  const neverStarted = makeController()
  assert.equal(await neverStarted.dispose(), null)
  assert.equal(cancelled, 0)

  const active = makeController()
  await active.begin()
  await Promise.all([active.dispose(), active.dispose()])
  assert.equal(cancelled, 1)

  const completed = makeController()
  await completed.begin()
  await completed.complete()
  assert.equal(await completed.dispose(), null)
  assert.equal(cancelled, 1)
})

test('file-transfer safety controller closes an execution that starts during dispose', async () => {
  const { createTransferSafetyController } = await import(transferSafetyUrl)
  let releaseBegin
  let cancelled = 0
  const beginGate = new Promise(resolve => { releaseBegin = resolve })
  const capability = {
    async prepareTransferSafetyOperation (plan) {
      return { id: plan.operationId, effectKey: 'effect-unmount-race' }
    },
    async beginTransferSafetyOperation (id) {
      await beginGate
      return { id, effectKey: 'effect-unmount-race', executionId: 'execution-race' }
    },
    async cancelTransferSafetyOperation () {
      cancelled += 1
      return { state: 'failed' }
    }
  }
  const controller = createTransferSafetyController({
    getTransfer: () => ({
      id: 'upload-unmount-race',
      typeFrom: 'local',
      typeTo: 'remote',
      fromPath: 'C:/release.bin',
      toPath: '/srv/release.bin',
      fromFile: { isDirectory: false, size: 7 }
    }),
    getCapability: () => capability,
    cancelTransport: async () => {}
  })
  const starting = controller.begin()
  await Promise.resolve()
  const disposing = controller.dispose()
  releaseBegin()
  await Promise.all([starting, disposing])
  assert.equal(cancelled, 1)
})

test('cross-host source content must match preflight remote postflight remote and local temp', async () => {
  const {
    verifyCrossHostSourceContent,
    verifyCrossHostSourcePreflight
  } = await import(transferSafetyUrl)
  const endpoint = {
    host: 'source.example.com',
    port: 22,
    username: 'root',
    tabId: 'source-tab',
    pid: 'sftp:source-tab:session-a'
  }
  const {
    buildCrossHostSourceIdentity,
    buildTransferSourceEndpointKey
  } = await import(transferSafetyUrl)
  const sourceEndpointKey = buildTransferSourceEndpointKey(endpoint)
  const fromFile = { isDirectory: false, size: 7 }
  const transfer = {
    remote2remoteStep: 1,
    tabId: 'source-tab',
    fromPath: '/srv/release.bin',
    toPath: 'C:/temp/release.bin',
    fromFile,
    sourceEndpointKey,
    sourceIdentity: buildCrossHostSourceIdentity({
      sourceEndpointKey,
      path: '/srv/release.bin',
      file: fromFile
    })
  }
  const source = transferFileDescriptor()
  let remote = clone(source)
  const pinnedSftp = {}
  const capability = {
    sftp: pinnedSftp,
    getSftpSafetyEndpoint: () => endpoint
  }
  const preflight = await verifyCrossHostSourcePreflight({
    transfer,
    getCapability: () => capability,
    describeRemote: async sftp => {
      assert.equal(sftp, pinnedSftp)
      return clone(remote)
    }
  })
  const verified = await verifyCrossHostSourceContent({
    transfer,
    sourcePin: preflight.runtime,
    preflight: preflight.verified,
    describeRemote: async sftp => {
      assert.equal(sftp, pinnedSftp)
      return clone(remote)
    },
    describeLocal: async () => clone(source)
  })
  assert.match(verified.verifiedSourceContentIdentity, /^content:/)
  assert.deepEqual(verified.verifiedSourceDescriptor, source)

  remote = transferFileDescriptor('b'.repeat(64))
  await assert.rejects(verifyCrossHostSourceContent({
    transfer,
    sourcePin: preflight.runtime,
    preflight: preflight.verified,
    describeRemote: async () => clone(remote),
    describeLocal: async () => clone(source)
  }), /来源内容.*变化|内容身份.*不一致/)

  remote = clone(source)
  await assert.rejects(verifyCrossHostSourceContent({
    transfer,
    sourcePin: preflight.runtime,
    preflight: preflight.verified,
    describeRemote: async () => clone(remote),
    describeLocal: async () => transferFileDescriptor('c'.repeat(64))
  }), /临时文件.*不一致|内容身份.*不一致/)

  const directoryBefore = {
    type: 'directory',
    mode: 0o755,
    uid: 1000,
    gid: 1000,
    entries: [{
      name: 'app.conf',
      entry: transferFileDescriptor('d'.repeat(64), 9)
    }]
  }
  const directoryAfter = {
    ...clone(directoryBefore),
    entries: []
  }
  await assert.rejects(verifyCrossHostSourceContent({
    transfer: {
      ...transfer,
      fromPath: '/srv/config',
      toPath: 'C:/temp/config',
      fromFile: { isDirectory: true }
    },
    sourcePin: preflight.runtime,
    preflight: {
      ...preflight.verified,
      sourceDescriptor: directoryBefore
    },
    describeRemote: async () => directoryAfter,
    describeLocal: async () => directoryBefore
  }), /来源内容.*变化/)
})

test('transport success still reports a failed target verification to history and remote2remote', async () => {
  const {
    getTransferSafetyCompletionFailure
  } = await import(transferSafetyUrl)
  const failure = getTransferSafetyCompletionFailure({
    state: 'failed',
    error: 'SFTP 上传后的远程目标校验失败。',
    metadata: {
      externalCompletion: {
        exitCode: 0,
        cancelled: false
      }
    }
  })

  assert.deepEqual(failure, {
    status: 'exception',
    error: 'SFTP 上传后的远程目标校验失败。'
  })

  const fs = require('node:fs')
  const transferSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')
  assert.match(transferSource, /getTransferSafetyCompletionFailure\(completed\)/)
  assert.match(transferSource, /status:\s*update\.status/)
  assert.match(transferSource, /error:\s*update\.error/)
})

test('SFTP directory zip optimization falls back to native protected transfer', async () => {
  const {
    shouldUseLegacyZipOptimization
  } = await import(transferSafetyUrl)

  assert.equal(shouldUseLegacyZipOptimization({ zip: true, isFtp: false }), false)
  assert.equal(shouldUseLegacyZipOptimization({ zip: true, isFtp: true }), true)
  assert.equal(shouldUseLegacyZipOptimization({ zip: false, isFtp: false }), false)

  const fs = require('node:fs')
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')
  assert.match(source, /shouldUseLegacyZipOptimization/)
  assert.match(source, /shouldUseLegacyZipOptimization\(\{\s*zip,\s*isFtp:\s*this\.isFtp\s*\}\)/)
})

test('transfer component keeps native queue progress pause resume retry and adds safety hooks', () => {
  const fs = require('node:fs')
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')

  assert.match(source, /createTransferSafetyController/)
  assert.match(source, /transferSafety\.begin\(/)
  assert.match(source, /transferSafety\.complete\(/)
  assert.match(source, /transferSafety\.cancel\(/)
  assert.match(source, /this\.transport\?\.pause\(\)/)
  assert.match(source, /this\.transport\?\.resume\(\)/)
  assert.match(source, /shouldRetryTransfer/)
  assert.match(source, /refsStatic\.get\('transfer-queue'\)/)
  assert.match(source, /componentWillUnmount[\s\S]*transferSafety\.dispose\(\)/)
  assert.match(source, /scheduleRetry[\s\S]*transferAttempts\.invalidate\(attemptToken\)/)
})

test('SFTP capability exposes authoritative transfer transaction lifecycle', () => {
  const fs = require('node:fs')
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-entry.jsx'
  ), 'utf8')

  assert.match(source, /prepareTransferSafetyOperation\s*=/)
  assert.match(source, /beginTransferSafetyOperation\s*=/)
  assert.match(source, /completeTransferSafetyOperation\s*=/)
  assert.match(source, /cancelTransferSafetyOperation\s*=/)
  assert.match(source, /fileTransferSafety:\s*true/)
  assert.match(source, /transfer:\s*plan\.transfer/)
  assert.match(source, /beginExternalExecution/)
  assert.match(source, /completeExternalExecution/)
})
