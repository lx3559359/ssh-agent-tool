const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const clientRoot = path.resolve(__dirname, '../../src/client')
const actionsModuleUrl = pathToFileURL(path.join(
  clientRoot,
  'components/main/safety-operation-center-actions.js'
)).href
const modelModuleUrl = pathToFileURL(path.join(
  clientRoot,
  'components/main/safety-operation-center-model.js'
)).href
const storeModuleUrl = pathToFileURL(path.join(
  clientRoot,
  'common/safety-transactions/transaction-store.js'
)).href

function clone (value) {
  return value === undefined ? undefined : structuredClone(value)
}

function createMemoryAdapter () {
  const tables = new Map()

  function table (name) {
    if (!tables.has(name)) tables.set(name, new Map())
    return tables.get(name)
  }

  return {
    async update (id, value, name) {
      table(name).set(id, clone(value))
      return 1
    },
    async findOne (name, id) {
      return clone(table(name).get(id))
    },
    async find (name) {
      return [...table(name).values()].map(clone)
    },
    async remove (name, id) {
      return table(name).delete(id) ? 1 : 0
    }
  }
}

function legacyOperation (id = 'real-store-sftp', overrides = {}) {
  return {
    id,
    schemaVersion: 1,
    source: 'sftp',
    state: 'rollback-available',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      sessionType: 'ssh'
    },
    metadata: {
      legacy: true,
      legacyRecord: {
        id,
        source: 'sftp',
        status: 'available',
        sourcePath: '/etc/nginx/nginx.conf',
        backupPath: '/tmp/nginx.conf.bak',
        host: 'prod.example.com',
        port: 22,
        username: 'root',
        tabId: 'tab-1',
        createdAt: '2026-07-13T10:00:00.000Z',
        updatedAt: '2026-07-13T10:00:00.000Z'
      }
    },
    createdAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T10:00:00.000Z',
    ...overrides
  }
}

function legacySourceRecord (overrides = {}) {
  return {
    id: 'real-store-migration',
    source: 'sftp',
    title: 'SFTP 安全备份',
    sourcePath: '/etc/nginx/nginx.conf',
    backupPath: '/tmp/nginx.conf.bak',
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    tabId: 'tab-1',
    createdAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T10:00:00.000Z',
    status: 'available',
    ...overrides
  }
}

function deferred () {
  let resolveDeferred
  const promise = new Promise(resolve => { resolveDeferred = resolve })
  return { promise, resolve: resolveDeferred }
}

async function waitFor (predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('timed out waiting for condition')
}

async function createRealStoreHarness ({
  record = legacyOperation(),
  now = () => new Date('2026-07-13T12:00:00.000Z'),
  readLegacyRecords = async () => []
} = {}) {
  const { createTransactionStore } = await import(storeModuleUrl)
  const store = createTransactionStore({
    adapter: createMemoryAdapter(),
    now,
    readLegacyRecords,
    onChange: () => {}
  })
  if (record) await store.saveOperation(record)
  return store
}

function actionOptions (store, overrides = {}) {
  return {
    getOperation: store.getOperation,
    guardedPatchOperation: store.guardedPatchOperation,
    syncLegacyOperation: async id => store.getOperation(id),
    now: () => new Date('2026-07-13T12:00:00.000Z'),
    claimLeaseMs: 60_000,
    resolveLegacyTarget: async () => ({ kind: 'sftp' }),
    runLegacyAction: async () => true,
    ...overrides
  }
}

test('real transaction store preserves a claim id and commits legacy success', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const { buildSafetyRecordViewModel } = await import(modelModuleUrl)
  const store = await createRealStoreHarness()
  const record = await store.getOperation('real-store-sftp')
  const pending = deferred()
  const execution = executeSafetyCenterAction({
    record,
    action: 'rollback',
    ...actionOptions(store, {
      createClaimId: () => 'success-claim-id',
      runLegacyAction: async () => pending.promise
    })
  })

  await waitFor(async () => {
    const current = await store.getOperation(record.id)
    return current?.metadata?.safetyCenterLegacyClaim?.claimId === 'success-claim-id'
  })
  const claimed = await store.getOperation(record.id)
  assert.deepEqual(claimed.metadata.safetyCenterLegacyClaim, {
    claimId: 'success-claim-id',
    action: 'rollback',
    claimedAt: '2026-07-13T12:00:00.000Z',
    expiresAt: '2026-07-13T12:01:00.000Z'
  })
  assert.doesNotMatch(
    Object.keys(claimed.metadata.safetyCenterLegacyClaim).join(','),
    /token|secret|credential/i
  )
  assert.doesNotMatch(
    JSON.stringify(buildSafetyRecordViewModel(claimed)),
    /success-claim-id/
  )
  assert.doesNotMatch(JSON.stringify(claimed.audit || []), /success-claim-id/)

  pending.resolve(true)
  assert.equal((await execution).state, 'restored')
  const restored = await store.getOperation(record.id)
  assert.equal(restored.state, 'restored')
  assert.equal(restored.metadata.safetyCenterLegacyClaim, null)
})

test('real transaction store commits legacy failure without leaving rolling-back', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const store = await createRealStoreHarness()
  const record = await store.getOperation('real-store-sftp')

  await assert.rejects(
    executeSafetyCenterAction({
      record,
      action: 'rollback',
      ...actionOptions(store, {
        createClaimId: () => 'failure-claim-id',
        runLegacyAction: async () => false
      })
    }),
    /未成功/
  )

  const failed = await store.getOperation(record.id)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.metadata.safetyCenterLegacyClaim, null)
})

test('real transaction store lets an expired claim id be taken over', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const original = legacyOperation('real-store-expired')
  const record = legacyOperation('real-store-expired', {
    state: 'rolling-back',
    metadata: {
      ...original.metadata,
      safetyCenterLegacyClaim: {
        claimId: 'expired-owner',
        action: 'rollback',
        claimedAt: '2026-07-13T11:58:00.000Z',
        expiresAt: '2026-07-13T11:59:00.000Z'
      }
    }
  })
  const store = await createRealStoreHarness({ record })

  const restored = await executeSafetyCenterAction({
    record: await store.getOperation(record.id),
    action: 'rollback',
    ...actionOptions(store, {
      createClaimId: () => 'takeover-claim-id'
    })
  })

  assert.equal(restored.state, 'restored')
  assert.equal((await store.getOperation(record.id)).state, 'restored')
})

test('real transaction store rejects a late owner without blocking its takeover owner', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  let currentTime = new Date('2026-07-13T12:00:00.000Z')
  const now = () => currentTime
  const store = await createRealStoreHarness({ now })
  const record = await store.getOperation('real-store-sftp')
  const firstPending = deferred()
  const secondPending = deferred()
  const first = executeSafetyCenterAction({
    record,
    action: 'rollback',
    ...actionOptions(store, {
      now,
      createClaimId: () => 'owner-1',
      runLegacyAction: async () => firstPending.promise
    })
  })
  await waitFor(async () => {
    const current = await store.getOperation(record.id)
    return current?.metadata?.safetyCenterLegacyClaim?.claimId === 'owner-1'
  })

  currentTime = new Date('2026-07-13T12:02:00.000Z')
  const second = executeSafetyCenterAction({
    record,
    action: 'rollback',
    ...actionOptions(store, {
      now,
      createClaimId: () => 'owner-2',
      runLegacyAction: async () => secondPending.promise
    })
  })
  await waitFor(async () => {
    const current = await store.getOperation(record.id)
    return current?.metadata?.safetyCenterLegacyClaim?.claimId === 'owner-2'
  })

  firstPending.resolve(true)
  await assert.rejects(first, /状态已变化/)
  let current = await store.getOperation(record.id)
  assert.equal(current.state, 'rolling-back')
  assert.equal(current.metadata.safetyCenterLegacyClaim.claimId, 'owner-2')

  secondPending.resolve(true)
  assert.equal((await second).state, 'restored')
  current = await store.getOperation(record.id)
  assert.equal(current.state, 'restored')
  assert.equal(current.metadata.safetyCenterLegacyClaim, null)
})

test('real migration terminal state is idempotent with the same claim target', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  let legacy = legacySourceRecord()
  const store = await createRealStoreHarness({
    record: null,
    readLegacyRecords: async () => [clone(legacy)]
  })
  const [record] = await store.listOperations()

  const restored = await executeSafetyCenterAction({
    record,
    action: 'rollback',
    ...actionOptions(store, {
      createClaimId: () => 'migration-claim-id',
      syncLegacyOperation: async () => store.listOperations(),
      runLegacyAction: async claimed => {
        assert.equal(
          claimed.metadata.safetyCenterLegacyClaim.claimId,
          'migration-claim-id'
        )
        legacy = legacySourceRecord({
          status: 'restored',
          rollbackStatus: 'completed',
          updatedAt: '2026-07-13T12:05:00.000Z'
        })
        await store.listOperations()
        return true
      }
    })
  })

  assert.equal(restored.state, 'restored')
  const current = await store.getOperation(record.id)
  assert.equal(current.state, 'restored')
  assert.equal(current.metadata.safetyCenterLegacyClaim, undefined)
})

test('default real-store claim ids remain random and unique', async () => {
  const { executeSafetyCenterAction } = await import(actionsModuleUrl)
  const store = await createRealStoreHarness()
  await store.saveOperation(legacyOperation('real-store-sftp-2'))
  const claimIds = []

  for (const id of ['real-store-sftp', 'real-store-sftp-2']) {
    const record = await store.getOperation(id)
    await executeSafetyCenterAction({
      record,
      action: 'rollback',
      ...actionOptions(store, {
        runLegacyAction: async claimed => {
          claimIds.push(claimed.metadata.safetyCenterLegacyClaim.claimId)
          return true
        }
      })
    })
  }

  assert.equal(claimIds.length, 2)
  assert.notEqual(claimIds[0], claimIds[1])
  for (const claimId of claimIds) {
    assert.equal(typeof claimId, 'string')
    assert.notEqual(claimId, '[REDACTED]')
    assert.ok(claimId.length >= 16)
  }
})
