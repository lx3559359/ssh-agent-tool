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
    buildTransferSourceEndpointKey
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
    sourceEndpointKey,
    sourceIdentity
  }, { sourceEndpointKey, sourceIdentity }), true)
  assert.throws(() => assertCrossHostSourceHistory({
    sourceEndpointKey: buildTransferSourceEndpointKey({
      ...baseEndpoint,
      username: 'deploy'
    }),
    sourceIdentity
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
    fromFile: { isDirectory: false, size: 17 }
  })
  assert.equal(targetStep.transfer.sourceEndpointKey, sourceEndpointKey)
  assert.equal(targetStep.transfer.sourceIdentity, sourceIdentity)

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
