const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { pathToFileURL } = require('node:url')

const storeModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/transaction-store.js'
)).href
const legacySftpKey = 'shellpilot-sftp-recovery-records'
const legacyQuickKey = 'shellpilot-network-rollback'
const unifiedSafetyKey = 'shellpilot-safety-operation-records'

function importStore () {
  return import(storeModuleUrl)
}

function clone (value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

function createMemoryAdapter (options = {}) {
  const tables = new Map()
  const calls = []
  const updateCallCounts = new Map()
  const updateFailureAt = new Map()

  function getTable (name) {
    if (!tables.has(name)) tables.set(name, new Map())
    return tables.get(name)
  }

  return {
    calls,
    tables,
    failUpdateAt (table, callNumber) {
      updateFailureAt.set(table, callNumber)
    },
    getUpdateCallCount (table) {
      return updateCallCounts.get(table) || 0
    },
    seed (table, value) {
      getTable(table).set(value.id, clone(value))
    },
    read (table, id) {
      return clone(getTable(table).get(id))
    },
    async update (id, value, table, upsert, propagateError) {
      calls.push({ method: 'update', id, table, upsert, propagateError })
      const updateCount = (updateCallCounts.get(table) || 0) + 1
      updateCallCounts.set(table, updateCount)
      if (updateFailureAt.get(table) === updateCount) {
        updateFailureAt.delete(table)
        throw new Error(`forced ${table} update failure at ${updateCount}`)
      }
      getTable(table).set(id, clone(value))
      await options.onUpdate?.({ id, value: clone(value), table })
      return 1
    },
    async findOne (table, id, propagateError) {
      calls.push({ method: 'findOne', id, table, propagateError })
      const found = clone(getTable(table).get(id))
      if (options.wrapDataFindOne && table === 'data' && found) {
        return { id, value: found }
      }
      return found
    },
    async find (table, propagateError) {
      calls.push({ method: 'find', table, propagateError })
      return [...getTable(table).values()].map(clone)
    },
    async remove (table, id, propagateError) {
      calls.push({ method: 'remove', id, table, propagateError })
      getTable(table).delete(id)
    }
  }
}

function createLegacyRecords (count, start = 0) {
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset
    return {
      id: `legacy-bulk-${index}`,
      source: 'sftp',
      sourcePath: `/etc/shellpilot/app-${index}.conf`,
      backupPath: `/tmp/shellpilot/app-${index}.conf.bak`,
      host: '10.0.0.8',
      username: 'root',
      createdAt: new Date(Date.UTC(2026, 6, 12, 8, 0, index)).toISOString(),
      status: 'available'
    }
  })
}

function createLegacyStorage (sftpRecords, options = {}) {
  let unifiedRecords = []
  let currentSftpRecords = clone(sftpRecords)
  let quickRollbackRecord = options.quickRollbackRecord || null
  let sftpReadCount = 0
  const removed = []

  return {
    removed,
    get sftpRecords () {
      return clone(currentSftpRecords)
    },
    appendSftpRecords (records) {
      currentSftpRecords.push(...clone(records))
    },
    safeGetItemJSON: (key, fallback) => key === unifiedSafetyKey
      ? clone(unifiedRecords)
      : fallback,
    safeSetItemJSON: (key, value) => {
      if (key === unifiedSafetyKey) unifiedRecords = clone(value)
    },
    getItemJSON: (key, fallback) => {
      if (key === legacySftpKey) {
        sftpReadCount += 1
        options.onSftpRead?.({
          readCount: sftpReadCount,
          records: currentSftpRecords
        })
        return clone(currentSftpRecords)
      }
      if (key === legacyQuickKey) return clone(quickRollbackRecord) || fallback
      return fallback
    },
    removeItem: key => {
      removed.push(key)
      options.onRemove?.(key)
      if (key === legacySftpKey) currentSftpRecords = []
      if (key === legacyQuickKey) quickRollbackRecord = null
    }
  }
}

function createOperation (overrides = {}) {
  return {
    id: 'op-1',
    source: 'terminal',
    command: 'systemctl restart nginx',
    endpoint: { host: '10.0.0.1', port: 22, username: 'root' },
    ...overrides
  }
}

test('transaction store exports the browser-independent persistence contract', async () => {
  const storeModule = await importStore()
  for (const name of [
    'saveOperation',
    'getOperation',
    'listOperations',
    'patchOperation',
    'guardedPatchOperation',
    'removeOperation',
    'saveTask',
    'getTask',
    'listTasks',
    'patchTask'
  ]) {
    assert.equal(typeof storeModule[name], 'function', name)
  }

  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/common/safety-transactions/transaction-store.js'
  ), 'utf8')
  assert.doesNotMatch(source, /window\.store|from ['"]react['"]/)
  assert.match(source, /import\('\.\.\/db\.js'\)/)
})

test('operation CRUD normalizes records and explicitly propagates database failures', async () => {
  const { createTransactionStore } = await importStore()
  const adapter = createMemoryAdapter()
  const fixedNow = new Date('2026-07-13T08:09:10.000Z')
  const store = createTransactionStore({ adapter, now: () => fixedNow })

  const saved = await store.saveOperation(createOperation())
  assert.equal(saved.schemaVersion, 1)
  assert.equal(saved.state, 'preparing')
  assert.equal(saved.endpointKey, 'root@10.0.0.1:22')
  assert.equal(saved.createdAt, fixedNow.toISOString())

  const patched = await store.patchOperation('op-1', {
    id: 'replacement-id',
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: fixedNow.toISOString(),
    state: 'executing',
    endpoint: { title: '生产服务器' },
    recoveryBinding: {
      schemaVersion: 1,
      algorithm: 'SHA-256',
      fingerprint: 'a'.repeat(64)
    },
    integrityError: '恢复计划完整性校验失败，已拒绝提交远程结果。'
  })
  assert.equal(patched.id, 'op-1')
  assert.equal(patched.createdAt, saved.createdAt)
  assert.equal(patched.state, 'executing')
  assert.equal(patched.endpoint.host, '10.0.0.1')
  assert.equal(patched.endpoint.title, '生产服务器')
  assert.deepEqual(patched.recoveryBinding, {
    schemaVersion: 1,
    algorithm: 'SHA-256',
    fingerprint: 'a'.repeat(64)
  })
  assert.equal(
    patched.integrityError,
    '恢复计划完整性校验失败，已拒绝提交远程结果。'
  )
  assert.ok(new Date(patched.updatedAt) > new Date(saved.updatedAt))
  assert.deepEqual(await store.getOperation('op-1'), patched)
  assert.deepEqual((await store.listOperations()).map(item => item.id), ['op-1'])

  await store.removeOperation('op-1')
  assert.equal(await store.getOperation('op-1'), undefined)
  assert.equal(
    adapter.calls.every(call => call.propagateError === true),
    true,
    'every operation DB call must opt into propagateError'
  )
})

test('operation storage rejects instead of swallowing database errors', async () => {
  const { createTransactionStore } = await importStore()
  const expected = new Error('disk full')
  const adapter = createMemoryAdapter()
  adapter.update = async () => { throw expected }
  const store = createTransactionStore({ adapter })

  await assert.rejects(store.saveOperation(createOperation()), error => error === expected)
})

test('concurrent operation patches for one id are serialized without losing fields', async () => {
  const { createTransactionStore } = await importStore()
  const adapter = createMemoryAdapter()
  const fixedNow = new Date('2026-07-13T08:09:10.000Z')
  const store = createTransactionStore({ adapter, now: () => fixedNow })
  const saved = await store.saveOperation(createOperation({
    title: 'original',
    metadata: { baseline: true }
  }))

  const [first, second] = await Promise.all([
    store.patchOperation(saved.id, { title: 'first patch' }),
    store.patchOperation(saved.id, { metadata: { concurrent: true } })
  ])
  const final = await store.getOperation(saved.id)

  assert.equal(final.title, 'first patch')
  assert.deepEqual(final.metadata, { baseline: true, concurrent: true })
  assert.ok(new Date(first.updatedAt) > new Date(saved.updatedAt))
  assert.ok(new Date(second.updatedAt) > new Date(first.updatedAt))
  assert.equal(final.updatedAt, second.updatedAt)
})

test('guarded operation patches share the per-id queue and never write on predicate failure', async () => {
  const { createTransactionStore } = await importStore()
  const adapter = createMemoryAdapter()
  const store = createTransactionStore({ adapter })
  const saved = await store.saveOperation(createOperation({ title: 'original' }))

  const tamper = store.patchOperation(saved.id, { title: 'tampered' })
  const guarded = store.guardedPatchOperation(
    saved.id,
    async current => current.title === 'original',
    { state: 'rollback-available' }
  )
  await tamper
  const writesBeforeGuardFailure = adapter.getUpdateCallCount('safetyOperations')
  await assert.rejects(guarded, /完整性|原子更新|拒绝/)
  assert.equal(
    adapter.getUpdateCallCount('safetyOperations'),
    writesBeforeGuardFailure
  )
  const unchanged = await store.getOperation(saved.id)
  assert.equal(unchanged.title, 'tampered')
  assert.equal(unchanged.state, 'preparing')

  const updated = await store.guardedPatchOperation(
    saved.id,
    current => current.title === 'tampered',
    current => ({
      state: 'executing',
      metadata: { guardedFrom: current.state }
    })
  )
  assert.equal(updated.state, 'executing')
  assert.deepEqual(updated.metadata, { guardedFrom: 'preparing' })
})

test('agent task CRUD enforces schema version, valid status and monotonic timestamps', async () => {
  const { createTransactionStore, taskStatuses } = await importStore()
  const adapter = createMemoryAdapter()
  const fixedNow = new Date('2026-07-13T09:00:00.000Z')
  const store = createTransactionStore({ adapter, now: () => fixedNow })

  assert.deepEqual(Object.values(taskStatuses), [
    'draft',
    'awaiting-plan-confirmation',
    'running-readonly',
    'awaiting-change-confirmation',
    'running-change',
    'completed',
    'failed',
    'cancelled',
    'partially-completed'
  ])

  const saved = await store.saveTask({
    id: 'task-1',
    title: '检查生产服务',
    output: '诊断输出'
  })
  assert.equal(saved.schemaVersion, 1)
  assert.equal(saved.status, 'draft')
  assert.equal(saved.createdAt, fixedNow.toISOString())

  const patched = await store.patchTask('task-1', {
    id: 'task-replacement',
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: fixedNow.toISOString(),
    status: 'running-readonly'
  })
  assert.equal(patched.id, 'task-1')
  assert.equal(patched.createdAt, saved.createdAt)
  assert.ok(new Date(patched.updatedAt) > new Date(saved.updatedAt))
  assert.equal((await store.getTask('task-1')).status, 'running-readonly')
  assert.deepEqual((await store.listTasks()).map(item => item.id), ['task-1'])

  await assert.rejects(
    store.saveTask({ id: 'task-bad', status: 'done' }),
    /任务状态/
  )
})

test('task store rejects credential-like commands instead of silently rewriting them', async () => {
  const { createTransactionStore } = await importStore()
  const adapter = createMemoryAdapter()
  const store = createTransactionStore({
    adapter,
    now: () => new Date('2026-07-13T09:00:00.000Z')
  })
  const unsafeCommand = 'cat /srv/password=actual-value/config'

  await assert.rejects(
    store.saveTask({
      id: 'task-command-redaction-rejected',
      status: 'draft',
      steps: [{ id: 'inspect', command: unsafeCommand }]
    }),
    /命令|敏感|凭据|拒绝/
  )
  assert.equal(await store.getTask('task-command-redaction-rejected'), undefined)

  const safeCommand = "printf '%s\\n' /srv/passwordless/config"
  const saved = await store.saveTask({
    id: 'task-command-preserved',
    status: 'draft',
    steps: [{ id: 'inspect', command: safeCommand }]
  })
  assert.equal(saved.steps[0].command, safeCommand)

  const patched = await store.patchTask(saved.id, { title: 'safe patch' })
  assert.equal(patched.steps[0].command, safeCommand)
})

test('task store accepts only structurally valid immutable plan grants', async () => {
  const { createTransactionStore } = await importStore()
  const store = createTransactionStore({
    adapter: createMemoryAdapter(),
    now: () => new Date('2026-07-13T09:00:00.000Z')
  })
  const payload = {
    schemaVersion: 1,
    endpoint: { host: 'srv.test', port: 22, username: 'ops' },
    goal: 'inspect service',
    orderedCalls: [],
    skillBindings: [],
    artifactDigests: [],
    impactTargets: [],
    resourceImpact: { duration: 'short' },
    recovery: null,
    verification: []
  }
  const planGrant = {
    schemaVersion: 1,
    algorithm: 'SHA-256',
    digest: 'a'.repeat(64),
    confirmedAt: '2026-07-13T09:00:00.000Z',
    confirmedBy: 'user',
    payload
  }

  const saved = await store.saveTask({ id: 'valid-plan-grant', planGrant })
  assert.deepEqual(saved.planGrant, planGrant)
  await assert.rejects(
    store.saveTask({
      id: 'invalid-plan-grant',
      planGrant: { ...planGrant, digest: 'not-a-sha256-digest' }
    }),
    /计划授权结构无效/
  )
})

test('concurrent task patches for one id are serialized with monotonic timestamps', async () => {
  const { createTransactionStore } = await importStore()
  const adapter = createMemoryAdapter()
  const fixedNow = new Date('2026-07-13T09:00:00.000Z')
  const store = createTransactionStore({ adapter, now: () => fixedNow })
  const saved = await store.saveTask({
    id: 'task-concurrent',
    title: 'original',
    metadata: { baseline: true }
  })

  const [first, second] = await Promise.all([
    store.patchTask(saved.id, { title: 'first patch' }),
    store.patchTask(saved.id, { metadata: { concurrent: true } })
  ])
  const final = await store.getTask(saved.id)

  assert.equal(final.title, 'first patch')
  assert.deepEqual(final.metadata, { baseline: true, concurrent: true })
  assert.ok(new Date(first.updatedAt) > new Date(saved.updatedAt))
  assert.ok(new Date(second.updatedAt) > new Date(first.updatedAt))
  assert.equal(final.updatedAt, second.updatedAt)
})

test('successful operation and task writes emit credential-free local update events', async () => {
  const {
    createTransactionStore,
    safetyTransactionUpdatedEvent
  } = await importStore()
  const adapter = createMemoryAdapter()
  const events = []
  const store = createTransactionStore({
    adapter,
    onChange: event => events.push(event)
  })
  const savedOperation = await store.saveOperation(createOperation({
    id: 'event-operation',
    command: 'password=operation-secret'
  }))
  await store.patchOperation(savedOperation.id, { state: 'executing' })
  await store.removeOperation(savedOperation.id)
  const savedTask = await store.saveTask({
    id: 'event-task',
    title: '本地刷新任务'
  })
  await store.patchTask(savedTask.id, { status: 'running-readonly' })

  assert.equal(safetyTransactionUpdatedEvent, 'shellpilot-safety-transaction-updated')
  assert.deepEqual(events, [
    { recordType: 'operation', id: 'event-operation', action: 'save' },
    { recordType: 'operation', id: 'event-operation', action: 'patch' },
    { recordType: 'operation', id: 'event-operation', action: 'remove' },
    { recordType: 'task', id: 'event-task', action: 'save' },
    { recordType: 'task', id: 'event-task', action: 'patch' }
  ])
  assert.doesNotMatch(JSON.stringify(events), /operation-secret|password|host|command/)
})

test('legacy migration is deterministic, idempotent and includes newly appearing records', async () => {
  const {
    createTransactionStore,
    legacyMigrationMarkerId
  } = await importStore()
  const adapter = createMemoryAdapter({ wrapDataFindOne: true })
  const legacy = [{
    id: 'legacy-existing-id',
    source: 'sftp',
    title: 'SFTP 安全备份',
    sourcePath: '/etc/nginx/nginx.conf',
    backupPath: '/tmp/nginx.conf.bak',
    host: '10.0.0.8',
    username: 'root',
    createdAt: '2026-07-12T08:00:00.000Z',
    status: 'available'
  }, {
    source: 'quick-command',
    title: '修改服务器网络',
    rollbackPath: '/tmp/shellpilot-rollback/network.sh',
    host: '10.0.0.9',
    username: 'root',
    createdAt: '2026-07-12T09:00:00.000Z',
    status: 'available'
  }]
  const store = createTransactionStore({
    adapter,
    readLegacyRecords: () => legacy,
    cleanupLegacyRecords: () => { throw new Error('legacy cleanup must not run') },
    now: () => new Date('2026-07-13T10:00:00.000Z')
  })

  const first = await store.listOperations()
  const generatedId = first.find(item => item.id !== 'legacy-existing-id').id
  const firstMarker = adapter.read('data', legacyMigrationMarkerId)
  assert.match(generatedId, /^legacy:quick-command:/)
  assert.equal(adapter.tables.get('safetyOperations').size, 2)
  assert.equal(firstMarker.legacyCount, 2)
  assert.match(firstMarker.legacyFingerprint, /^[a-z0-9]+$/)
  assert.deepEqual(
    firstMarker.migratedIds.sort(),
    first.map(item => item.id).sort()
  )
  assert.equal(
    adapter.calls.filter(call => call.method === 'findOne' && call.table === 'safetyOperations').length,
    0
  )

  const writesBeforeSecond = adapter.getUpdateCallCount('safetyOperations')
  const markerWritesBeforeSecond = adapter.getUpdateCallCount('data')
  const second = await store.listOperations()
  assert.deepEqual(second.map(item => item.id).sort(), first.map(item => item.id).sort())
  assert.equal(adapter.tables.get('safetyOperations').size, 2)
  assert.equal(second.find(item => item.source === 'quick-command').id, generatedId)
  assert.equal(adapter.getUpdateCallCount('safetyOperations'), writesBeforeSecond)
  assert.equal(adapter.getUpdateCallCount('data'), markerWritesBeforeSecond)

  legacy.push({
    id: 'legacy-new',
    source: 'sftp',
    sourcePath: '/etc/hosts',
    host: '10.0.0.10',
    username: 'deploy',
    createdAt: '2026-07-13T11:00:00.000Z',
    status: 'available'
  })
  const third = await store.listOperations()
  assert.deepEqual(third.map(item => item.id).sort(), [
    'legacy-existing-id',
    'legacy-new',
    generatedId
  ].sort())
  assert.equal(adapter.tables.get('safetyOperations').size, 3)
  assert.equal(adapter.getUpdateCallCount('safetyOperations'), writesBeforeSecond + 1)
  const thirdMarker = adapter.read('data', legacyMigrationMarkerId)
  assert.equal(thirdMarker.legacyCount, 3)
  assert.notEqual(thirdMarker.legacyFingerprint, firstMarker.legacyFingerprint)
})

test('legacy ids stay deterministic when createdAt is missing or invalid', async () => {
  const { createTransactionStore } = await importStore()
  const storage = createLegacyStorage([{
    source: 'sftp',
    sourcePath: '/etc/missing-time.conf',
    host: '10.0.0.8',
    username: 'root'
  }, {
    source: 'sftp',
    sourcePath: '/etc/invalid-time.conf',
    host: '10.0.0.8',
    username: 'root',
    createdAt: 'not-a-date'
  }])
  const firstStore = createTransactionStore({
    adapter: createMemoryAdapter(),
    legacyStorage: storage,
    now: () => new Date('2026-07-13T10:00:00.000Z')
  })
  const secondStore = createTransactionStore({
    adapter: createMemoryAdapter(),
    legacyStorage: storage,
    now: () => new Date('2030-01-01T00:00:00.000Z')
  })

  const first = await firstStore.listOperations()
  const second = await secondStore.listOperations()

  assert.deepEqual(second.map(record => record.id), first.map(record => record.id))
  assert.equal(first.every(record => /^legacy:sftp:/.test(record.id)), true)
  assert.equal(first.every(record => record.createdAt === '1970-01-01T00:00:00.000Z'), true)
})

test('migration persists and verifies all 250 legacy records without deleting their source key', async () => {
  const { createTransactionStore } = await importStore()
  const adapter = createMemoryAdapter()
  const storage = createLegacyStorage(createLegacyRecords(250))
  const store = createTransactionStore({
    adapter,
    legacyStorage: storage,
    now: () => new Date('2026-07-13T10:00:00.000Z')
  })

  const records = await store.listOperations()

  assert.equal(records.length, 250)
  assert.equal(adapter.tables.get('safetyOperations').size, 250)
  assert.equal(
    adapter.calls.filter(call => call.method === 'findOne' && call.table === 'safetyOperations').length,
    0
  )
  assert.equal(adapter.read('data', 'safetyOperations:legacy-migration:v1').legacyCount, 250)
  assert.deepEqual(storage.removed, [])
  assert.equal(storage.sftpRecords.length, 250)
})

test('record 201 batch write failure leaves marker unset and retries only missing records', async () => {
  const {
    createTransactionStore,
    legacyMigrationMarkerId
  } = await importStore()
  const adapter = createMemoryAdapter()
  adapter.failUpdateAt('safetyOperations', 201)
  const storage = createLegacyStorage(createLegacyRecords(250))
  const store = createTransactionStore({ adapter, legacyStorage: storage })

  await assert.rejects(store.listOperations(), /forced safetyOperations update failure at 201/)
  assert.equal(adapter.getUpdateCallCount('safetyOperations'), 201)
  assert.equal(storage.sftpRecords.length, 250)
  assert.deepEqual(storage.removed, [])
  assert.equal(adapter.read('data', legacyMigrationMarkerId), undefined)

  const retried = await store.listOperations()
  assert.equal(retried.length, 250)
  assert.equal(adapter.tables.get('safetyOperations').size, 250)
  assert.equal(adapter.getUpdateCallCount('safetyOperations'), 251)
  assert.equal(
    adapter.calls.filter(call => call.method === 'findOne' && call.table === 'safetyOperations').length,
    0
  )
  assert.equal(adapter.read('data', legacyMigrationMarkerId).legacyCount, 250)
  assert.equal(storage.sftpRecords.length, 250)
  assert.deepEqual(storage.removed, [])
})

test('a concurrent legacy write during migration is retained and migrates on the next pass', async () => {
  const {
    createTransactionStore,
    legacyMigrationMarkerId
  } = await importStore()
  let addedDuringMigration = false
  const storage = createLegacyStorage(createLegacyRecords(201))
  const adapter = createMemoryAdapter({
    onUpdate: ({ table }) => {
      if (table === 'safetyOperations' && !addedDuringMigration) {
        storage.appendSftpRecords(createLegacyRecords(1, 201))
        addedDuringMigration = true
      }
    }
  })
  const store = createTransactionStore({ adapter, legacyStorage: storage })

  const first = await store.listOperations()
  assert.equal(first.length, 201)
  assert.equal(addedDuringMigration, true)
  assert.equal(storage.sftpRecords.length, 202)
  assert.deepEqual(storage.removed, [])

  const second = await store.listOperations()
  assert.equal(second.length, 202)
  assert.equal(adapter.tables.get('safetyOperations').size, 202)
  assert.equal(storage.sftpRecords.length, 202)
  assert.deepEqual(storage.removed, [])
  assert.equal(
    adapter.read('data', legacyMigrationMarkerId).migratedIds.includes('legacy-bulk-201'),
    true
  )

  const third = await store.listOperations()
  assert.equal(third.length, 202)
  assert.equal(adapter.tables.get('safetyOperations').size, 202)
  assert.equal(storage.sftpRecords.length, 202)
  assert.deepEqual(storage.removed, [])
})

test('migration marker read failures propagate before legacy writes', async () => {
  const {
    createTransactionStore,
    legacyMigrationMarkerId
  } = await importStore()
  const adapter = createMemoryAdapter()
  const expected = new Error('marker database unavailable')
  const findOne = adapter.findOne
  adapter.findOne = async (...args) => {
    if (args[0] === 'data') throw expected
    return findOne(...args)
  }
  const store = createTransactionStore({
    adapter,
    readLegacyRecords: () => [{
      id: 'legacy-retry',
      source: 'sftp',
      sourcePath: '/etc/hosts',
      host: '10.0.0.8',
      username: 'root',
      createdAt: '2026-07-12T08:00:00.000Z',
      status: 'available'
    }],
    cleanupLegacyRecords: () => { throw new Error('legacy cleanup must not run') }
  })

  await assert.rejects(store.listOperations(), error => error === expected)
  assert.equal(adapter.read('data', legacyMigrationMarkerId), undefined)
  assert.equal(adapter.getUpdateCallCount('safetyOperations'), 0)
})

test('completed database state wins over a stale available legacy snapshot', async () => {
  const { createTransactionStore } = await importStore()
  const adapter = createMemoryAdapter()
  const writer = createTransactionStore({ adapter })
  await writer.saveOperation(createOperation({
    id: 'same-record',
    source: 'sftp',
    state: 'restored',
    createdAt: '2026-07-12T08:00:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z'
  }))

  const reader = createTransactionStore({
    adapter,
    readLegacyRecords: () => [{
      id: 'same-record',
      source: 'sftp',
      sourcePath: '/etc/app.conf',
      host: '10.0.0.1',
      username: 'root',
      createdAt: '2026-07-12T08:00:00.000Z',
      updatedAt: '2026-07-12T09:00:00.000Z',
      status: 'available'
    }]
  })

  const [record] = await reader.listOperations()
  const [repeated] = await reader.listOperations()
  assert.equal(record.state, 'restored')
  assert.equal(repeated.state, 'restored')
  assert.equal(adapter.read('safetyOperations', 'same-record').state, 'restored')
})

test('legacy completed status migrates as a terminal restored operation', async () => {
  const { createTransactionStore } = await importStore()
  const adapter = createMemoryAdapter()
  const store = createTransactionStore({
    adapter,
    readLegacyRecords: () => [{
      id: 'legacy-completed',
      source: 'sftp',
      sourcePath: '/etc/app.conf',
      host: '10.0.0.1',
      username: 'root',
      createdAt: '2026-07-12T08:00:00.000Z',
      status: 'completed'
    }]
  })

  const [record] = await store.listOperations()

  assert.equal(record.state, 'restored')
  assert.equal(adapter.read('safetyOperations', record.id).state, 'restored')
})

test('SQLite and NeDB encrypt safety operations and agent tasks at rest', async t => {
  const backends = [
    ['SQLite', '../../src/app/lib/sqlite', 'electerm.db'],
    ['NeDB', '../../src/app/lib/nedb', 'electerm.safetyOperations.nedb']
  ]
  const enc = value => Buffer.from(value, 'utf8').toString('base64')
  const dec = value => Buffer.from(value, 'base64').toString('utf8')

  for (const [name, modulePath, operationFile] of backends) {
    await t.test(name, async () => {
      const { createDb } = require(path.resolve(__dirname, modulePath))
      const appPath = fs.mkdtempSync(path.join(os.tmpdir(), `shellpilot-${name.toLowerCase()}-`))
      const { dbAction, tables } = createDb(appPath, 'default_user', { enc, dec })
      const operation = {
        _id: 'op-secret',
        command: 'secret-command-output-7419',
        endpoint: { host: 'secret-endpoint-7419.example.com' },
        auditOutput: 'secret-audit-record-7419'
      }
      const task = {
        _id: 'task-secret',
        output: 'secret-task-output-7419',
        endpoint: { host: 'secret-task-endpoint-7419.example.com' }
      }

      assert.equal(tables.includes('safetyOperations'), true)
      assert.equal(tables.includes('agentTasks'), true)
      await dbAction('safetyOperations', 'insert', operation)
      await dbAction('agentTasks', 'insert', task)

      const dbFolder = path.join(appPath, 'electerm', 'users', 'default_user')
      const files = name === 'SQLite'
        ? [operationFile]
        : [operationFile, 'electerm.agentTasks.nedb']
      const storedText = files
        .map(file => fs.readFileSync(path.join(dbFolder, file), 'utf8'))
        .join('\n')
      for (const secret of [
        operation.command,
        operation.endpoint.host,
        operation.auditOutput,
        task.output,
        task.endpoint.host
      ]) {
        assert.equal(storedText.includes(secret), false, `${name} leaked ${secret}`)
      }

      assert.equal(
        (await dbAction('safetyOperations', 'findOne', { _id: operation._id })).command,
        operation.command
      )
      assert.equal(
        (await dbAction('agentTasks', 'findOne', { _id: task._id })).output,
        task.output
      )
    })
  }
})

test('NeDB rejects safety records when encrypted payload decryption or JSON parsing fails', async () => {
  const { createDb } = require('../../src/app/lib/nedb')
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-nedb-corrupt-'))
  const enc = value => Buffer.from(value, 'utf8').toString('base64')
  const dec = value => Buffer.from(value, 'base64').toString('utf8')
  const writer = createDb(appPath, 'default_user', { enc, dec })
  await writer.dbAction('safetyOperations', 'insert', {
    _id: 'op-corrupt-check',
    command: 'must-not-return-an-encdata-shell'
  })

  const decryptFailure = createDb(appPath, 'default_user', {
    enc,
    dec: () => { throw new Error('decrypt failed') }
  })
  await assert.rejects(
    decryptFailure.dbAction('safetyOperations', 'findOne', { _id: 'op-corrupt-check' }),
    /decrypt failed/
  )

  const jsonFailure = createDb(appPath, 'default_user', {
    enc,
    dec: () => '{invalid-json'
  })
  await assert.rejects(
    jsonFailure.dbAction('safetyOperations', 'find', {}),
    /JSON|Unexpected|property name/i
  )
})

test('NeDB rejects malformed encrypted payload envelopes in safety tables', async t => {
  const { createDb } = require('../../src/app/lib/nedb')
  const enc = value => Buffer.from(value, 'utf8').toString('base64')
  const dec = value => Buffer.from(value, 'base64').toString('utf8')
  const cases = [
    ['empty ciphertext', ''],
    ['non-string ciphertext', 0],
    ['ciphertext without enc prefix', JSON.stringify({ command: 'plaintext' })],
    ['truncated ciphertext', `enc:${enc('{"command":"truncated')}`]
  ]

  for (const [name, encryptedPayload] of cases) {
    await t.test(name, async () => {
      const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-nedb-envelope-'))
      const dbFolder = path.join(appPath, 'electerm', 'users', 'default_user')
      const sourcePath = path.join(dbFolder, 'electerm.safetyOperations.nedb')
      const id = `malformed-${name.replaceAll(' ', '-')}`
      fs.mkdirSync(dbFolder, { recursive: true })
      fs.writeFileSync(sourcePath, JSON.stringify({
        _id: id,
        _encdata: encryptedPayload
      }) + '\n')

      const reader = createDb(appPath, 'default_user', { enc, dec })
      await assert.rejects(
        reader.dbAction('safetyOperations', 'findOne', { _id: id }),
        /decrypt|encrypted|JSON|Unexpected/i
      )
    })
  }
})
