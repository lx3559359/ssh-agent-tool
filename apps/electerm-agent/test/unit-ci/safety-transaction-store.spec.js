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

function createMemoryAdapter () {
  const tables = new Map()
  const calls = []
  let findOneFailures = 0
  let findOneFailureAt = 0
  let findOneCallCount = 0

  function getTable (name) {
    if (!tables.has(name)) tables.set(name, new Map())
    return tables.get(name)
  }

  return {
    calls,
    tables,
    failNextFindOne (count = 1) {
      findOneFailures = count
    },
    failFindOneAt (callNumber) {
      findOneFailureAt = callNumber
    },
    get findOneCallCount () {
      return findOneCallCount
    },
    seed (table, value) {
      getTable(table).set(value.id, clone(value))
    },
    read (table, id) {
      return clone(getTable(table).get(id))
    },
    async update (id, value, table, upsert, propagateError) {
      calls.push({ method: 'update', id, table, upsert, propagateError })
      getTable(table).set(id, clone(value))
      return 1
    },
    async findOne (table, id, propagateError) {
      calls.push({ method: 'findOne', id, table, propagateError })
      findOneCallCount += 1
      if (findOneFailureAt === findOneCallCount) {
        findOneFailureAt = 0
        return undefined
      }
      if (findOneFailures > 0) {
        findOneFailures -= 1
        return undefined
      }
      return clone(getTable(table).get(id))
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
    endpoint: { title: '生产服务器' }
  })
  assert.equal(patched.id, 'op-1')
  assert.equal(patched.createdAt, saved.createdAt)
  assert.equal(patched.state, 'executing')
  assert.equal(patched.endpoint.host, '10.0.0.1')
  assert.equal(patched.endpoint.title, '生产服务器')
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

test('legacy migration is deterministic, idempotent and includes newly appearing records', async () => {
  const {
    createTransactionStore,
    legacyMigrationMarkerId
  } = await importStore()
  const adapter = createMemoryAdapter()
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
  let cleanupCount = 0
  const store = createTransactionStore({
    adapter,
    readLegacyRecords: () => legacy,
    cleanupLegacyRecords: () => { cleanupCount += 1 },
    now: () => new Date('2026-07-13T10:00:00.000Z')
  })

  const first = await store.listOperations()
  const generatedId = first.find(item => item.id !== 'legacy-existing-id').id
  assert.match(generatedId, /^legacy:quick-command:/)
  assert.equal(adapter.tables.get('safetyOperations').size, 2)
  assert.deepEqual(
    adapter.read('data', legacyMigrationMarkerId).migratedIds.sort(),
    first.map(item => item.id).sort()
  )

  const second = await store.listOperations()
  assert.deepEqual(second.map(item => item.id).sort(), first.map(item => item.id).sort())
  assert.equal(adapter.tables.get('safetyOperations').size, 2)
  assert.equal(second.find(item => item.source === 'quick-command').id, generatedId)

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
  assert.equal(cleanupCount, 3)
})

test('migration persists and verifies all 250 legacy records before cleaning their source key', async () => {
  const { createTransactionStore } = await importStore()
  const adapter = createMemoryAdapter()
  const storage = createLegacyStorage(createLegacyRecords(250), {
    onRemove: key => {
      if (key === legacySftpKey) assert.equal(adapter.findOneCallCount, 250)
    }
  })
  const store = createTransactionStore({
    adapter,
    legacyStorage: storage,
    now: () => new Date('2026-07-13T10:00:00.000Z')
  })

  const records = await store.listOperations()

  assert.equal(records.length, 250)
  assert.equal(adapter.tables.get('safetyOperations').size, 250)
  assert.equal(adapter.findOneCallCount, 250)
  assert.deepEqual(storage.removed, [legacySftpKey])
  assert.equal(storage.sftpRecords.length, 0)
})

test('record 201 readback failure retains all 250 legacy records and retries safely', async () => {
  const {
    createTransactionStore,
    legacyMigrationMarkerId
  } = await importStore()
  const adapter = createMemoryAdapter()
  adapter.failFindOneAt(201)
  const storage = createLegacyStorage(createLegacyRecords(250))
  const store = createTransactionStore({ adapter, legacyStorage: storage })

  await assert.rejects(store.listOperations(), /迁移回读验证失败/)
  assert.equal(adapter.findOneCallCount, 201)
  assert.equal(storage.sftpRecords.length, 250)
  assert.deepEqual(storage.removed, [])
  assert.equal(adapter.read('data', legacyMigrationMarkerId), undefined)

  const retried = await store.listOperations()
  assert.equal(retried.length, 250)
  assert.equal(adapter.tables.get('safetyOperations').size, 250)
  assert.deepEqual(storage.removed, [legacySftpKey])
})

test('a legacy source key is retained when a new record appears during migration', async () => {
  const { createTransactionStore } = await importStore()
  const adapter = createMemoryAdapter()
  let addedDuringMigration = false
  const storage = createLegacyStorage(createLegacyRecords(201), {
    onSftpRead: ({ readCount, records }) => {
      if (readCount === 2) {
        records.push(...createLegacyRecords(1, 201))
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
  assert.deepEqual(storage.removed, [legacySftpKey])
})

test('legacy data is retained until database write readback verification succeeds', async () => {
  const {
    createTransactionStore,
    legacyMigrationMarkerId
  } = await importStore()
  const adapter = createMemoryAdapter()
  adapter.failNextFindOne()
  let cleanupCount = 0
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
    cleanupLegacyRecords: () => { cleanupCount += 1 }
  })

  await assert.rejects(store.listOperations(), /迁移回读验证失败/)
  assert.equal(cleanupCount, 0)
  assert.equal(adapter.read('data', legacyMigrationMarkerId), undefined)

  const retried = await store.listOperations()
  assert.deepEqual(retried.map(item => item.id), ['legacy-retry'])
  assert.equal(cleanupCount, 1)
  assert.ok(adapter.read('data', legacyMigrationMarkerId))
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
  assert.equal(record.state, 'restored')
  assert.equal(adapter.read('safetyOperations', 'same-record').state, 'restored')
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
