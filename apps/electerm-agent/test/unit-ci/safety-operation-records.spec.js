const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/common/safety-operation-records.js')
).href

test('legacy SFTP and quick-command rollback records migrate into one history', async () => {
  const { migrateSafetyOperationRecords } = await import(moduleUrl)
  const records = migrateSafetyOperationRecords({
    unifiedRecords: [],
    sftpRecords: [{
      id: 'sftp-1',
      kind: 'backup',
      sourcePath: '/etc/app.conf',
      backupPath: '/etc/.shellpilot-backups/app.conf-1',
      host: '10.0.0.8',
      createdAt: '2026-07-12T08:00:00.000Z',
      status: 'available'
    }],
    quickRollbackRecord: {
      path: '/tmp/shellpilot-rollback/network.sh',
      title: '修改服务器 IP',
      host: '10.0.0.9',
      createdAt: 1783846800000,
      protected: true
    }
  })

  assert.equal(records.length, 2)
  assert.deepEqual(records.map(item => item.source).sort(), ['quick-command', 'sftp'])
  assert.equal(records.find(item => item.source === 'sftp').target, '/etc/app.conf')
  assert.equal(records.find(item => item.source === 'quick-command').rollbackPath, '/tmp/shellpilot-rollback/network.sh')
  assert.equal(records.find(item => item.source === 'quick-command').rollbackStatus, 'available')
})

test('unified completion status wins over stale legacy records during migration', async () => {
  const { migrateSafetyOperationRecords } = await import(moduleUrl)
  const legacy = {
    id: 'same-record',
    sourcePath: '/etc/app.conf',
    createdAt: '2026-07-12T08:00:00.000Z',
    status: 'available'
  }
  const records = migrateSafetyOperationRecords({
    unifiedRecords: [{
      ...legacy,
      source: 'sftp',
      status: 'restored',
      rollbackStatus: 'completed'
    }],
    sftpRecords: [legacy]
  })

  assert.equal(records[0].status, 'restored')
  assert.equal(records[0].rollbackStatus, 'completed')
})

test('new records are merged without overwriting history and are sorted newest first', async () => {
  const { mergeSafetyOperationRecords } = await import(moduleUrl)
  const records = mergeSafetyOperationRecords(
    [{ id: 'old', createdAt: '2026-07-12T08:00:00.000Z' }],
    [
      { id: 'new', createdAt: '2026-07-12T09:00:00.000Z' },
      { id: 'old', createdAt: '2026-07-12T10:00:00.000Z' }
    ]
  )

  assert.deepEqual(records.map(item => item.id), ['old', 'new'])
  assert.equal(records[0].createdAt, '2026-07-12T10:00:00.000Z')
})

test('updating a rollback record preserves it as completed history', async () => {
  const { updateSafetyOperationRecord } = await import(moduleUrl)
  const records = updateSafetyOperationRecord(
    [{ id: 'r1', status: 'available', rollbackStatus: 'available' }],
    'r1',
    {
      status: 'restored',
      rollbackStatus: 'completed',
      restoredAt: '2026-07-12T09:10:11.000Z'
    }
  )

  assert.equal(records.length, 1)
  assert.equal(records[0].status, 'restored')
  assert.equal(records[0].rollbackStatus, 'completed')
  assert.equal(records[0].restoredAt, '2026-07-12T09:10:11.000Z')
})

test('successful retry clears an earlier failure and receives a newer update version', async () => {
  const { updateSafetyOperationRecord } = await import(moduleUrl)
  const records = updateSafetyOperationRecord([
    {
      id: 'r1',
      status: 'failed',
      rollbackStatus: 'failed',
      error: 'permission denied',
      failedAt: '2026-07-12T09:00:00.000Z',
      updatedAt: '2026-07-12T09:00:00.000Z'
    }
  ], 'r1', {
    status: 'restored',
    rollbackStatus: 'completed',
    updatedAt: '2026-07-12T09:00:00.000Z'
  })

  assert.equal(records[0].status, 'restored')
  assert.equal(records[0].error, '')
  assert.equal(records[0].failedAt, '')
  assert.notEqual(records[0].updatedAt, '2026-07-12T09:00:00.000Z')
})

test('safety history supports host, source, status and keyword filters', async () => {
  const { filterSafetyOperationRecords } = await import(moduleUrl)
  const records = [
    {
      id: 'a',
      source: 'sftp',
      status: 'available',
      host: '10.0.0.8',
      title: 'SFTP 快捷备份',
      target: '/etc/nginx/nginx.conf'
    },
    {
      id: 'b',
      source: 'quick-command',
      status: 'restored',
      host: '10.0.0.9',
      title: '修改服务器 IP',
      target: '网络配置'
    }
  ]

  assert.deepEqual(filterSafetyOperationRecords(records, { host: '10.0.0.8' }).map(item => item.id), ['a'])
  assert.deepEqual(filterSafetyOperationRecords(records, { source: 'quick-command' }).map(item => item.id), ['b'])
  assert.deepEqual(filterSafetyOperationRecords(records, { status: 'restored' }).map(item => item.id), ['b'])
  assert.deepEqual(filterSafetyOperationRecords(records, { keyword: 'nginx' }).map(item => item.id), ['a'])
})

test('quick-command records include rollback location, server context and lifecycle status', async () => {
  const { createQuickCommandSafetyRecord } = await import(moduleUrl)
  const record = createQuickCommandSafetyRecord({
    title: '修改服务器 IP',
    rollbackPath: '/tmp/shellpilot-rollback/network.sh',
    tab: { id: 'tab-1', host: '10.0.0.8', port: 22, username: 'root', title: '生产服务器' },
    seconds: 120,
    now: new Date('2026-07-12T09:10:11.000Z')
  })

  assert.equal(record.source, 'quick-command')
  assert.equal(record.kind, 'server-change')
  assert.equal(record.host, '10.0.0.8')
  assert.equal(record.port, 22)
  assert.equal(record.username, 'root')
  assert.equal(record.rollbackPath, '/tmp/shellpilot-rollback/network.sh')
  assert.equal(record.status, 'available')
  assert.equal(record.rollbackStatus, 'available')
  assert.equal(record.seconds, 120)
  assert.equal(record.protected, true)
  assert.equal(record.expiresAt, '2026-07-12T09:12:11.000Z')
})

test('unified UI history reads legacy data without cleaning sources before database migration', async () => {
  const {
    readSafetyOperationRecords,
    safetyOperationStorageKey
  } = await import(moduleUrl)
  const writes = []
  const removed = []
  let encrypted = []
  const storage = {
    safeGetItemJSON: (key, fallback) => key === safetyOperationStorageKey ? encrypted : fallback,
    safeSetItemJSON: (key, value) => {
      writes.push([key, value])
      encrypted = value
    },
    removeItem: key => removed.push(key),
    getItemJSON: (key, fallback) => {
      if (key === 'shellpilot-sftp-recovery-records') {
        return [{ id: 'legacy', sourcePath: '/etc/hosts', createdAt: '2026-07-12T08:00:00.000Z' }]
      }
      return fallback
    }
  }

  const records = readSafetyOperationRecords(storage)

  assert.equal(records.length, 1)
  assert.equal(records[0].source, 'sftp')
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0], safetyOperationStorageKey)
  assert.deepEqual(removed, [])
})

test('legacy plaintext is retained when encrypted migration cannot be verified', async () => {
  const { readSafetyOperationRecords, safetyOperationStorageKey } = await import(moduleUrl)
  const removed = []
  const storage = {
    safeGetItemJSON: (key, fallback) => key === safetyOperationStorageKey ? [] : fallback,
    safeSetItemJSON: () => {},
    removeItem: key => removed.push(key),
    getItemJSON: (key, fallback) => key === 'shellpilot-sftp-recovery-records'
      ? [{ id: 'legacy', sourcePath: '/etc/hosts', createdAt: '2026-07-12T08:00:00.000Z' }]
      : fallback
  }

  readSafetyOperationRecords(storage)
  assert.deepEqual(removed, [])
})

test('legacy plaintext cleanup retries after an earlier removal failure', async () => {
  const {
    cleanupMigratedSafetyOperationRecords,
    readSafetyOperationRecordsForMigration,
    safetyOperationStorageKey
  } = await import(moduleUrl)
  let encrypted = []
  let legacyPresent = true
  let removalAttempts = 0
  const legacyRecord = {
    id: 'legacy-retry',
    sourcePath: '/etc/hosts',
    createdAt: '2026-07-12T08:00:00.000Z'
  }
  const storage = {
    safeGetItemJSON: (key, fallback) => key === safetyOperationStorageKey ? encrypted : fallback,
    safeSetItemJSON: (key, value) => { encrypted = value },
    removeItem: key => {
      if (key !== 'shellpilot-sftp-recovery-records') return
      removalAttempts += 1
      if (removalAttempts === 1) throw new Error('temporary storage failure')
      legacyPresent = false
    },
    getItemJSON: (key, fallback) => {
      return key === 'shellpilot-sftp-recovery-records' && legacyPresent
        ? [legacyRecord]
        : fallback
    }
  }

  const { legacySources } = readSafetyOperationRecordsForMigration(storage)
  assert.doesNotThrow(() => cleanupMigratedSafetyOperationRecords(storage, legacySources))
  assert.equal(legacyPresent, true)
  assert.doesNotThrow(() => cleanupMigratedSafetyOperationRecords(storage, legacySources))
  assert.equal(legacyPresent, false)
  assert.equal(removalAttempts, 2)
})

test('verified migration cleanup removes only the matching nonempty legacy source', async () => {
  const {
    cleanupMigratedSafetyOperationRecords,
    readSafetyOperationRecords,
    readSafetyOperationRecordsForMigration,
    safetyOperationStorageKey
  } = await import(moduleUrl)
  let encrypted = []
  const removed = []
  const legacyRecord = {
    id: 'legacy-deferred',
    sourcePath: '/etc/hosts',
    createdAt: '2026-07-12T08:00:00.000Z'
  }
  const storage = {
    safeGetItemJSON: (key, fallback) => key === safetyOperationStorageKey ? encrypted : fallback,
    safeSetItemJSON: (key, value) => { encrypted = value },
    removeItem: key => removed.push(key),
    getItemJSON: (key, fallback) => key === 'shellpilot-sftp-recovery-records'
      ? [legacyRecord]
      : fallback
  }

  const { legacySources } = readSafetyOperationRecordsForMigration(storage)
  readSafetyOperationRecords(storage)
  assert.deepEqual(removed, [])
  assert.deepEqual(encrypted.map(record => record.id), ['legacy-deferred'])

  cleanupMigratedSafetyOperationRecords(storage, legacySources)
  assert.deepEqual(removed, ['shellpilot-sftp-recovery-records'])
})

test('migration snapshot reads all 250 legacy records while UI history remains capped at 200', async () => {
  const {
    readSafetyOperationRecords,
    readSafetyOperationRecordsForMigration,
    legacySftpRecoveryStorageKey
  } = await import(moduleUrl)
  const legacyRecords = Array.from({ length: 250 }, (_, index) => ({
    id: `legacy-${index}`,
    sourcePath: `/etc/app-${index}.conf`,
    createdAt: new Date(Date.UTC(2026, 6, 12, 8, 0, index)).toISOString()
  }))
  const storage = {
    safeGetItemJSON: () => [],
    safeSetItemJSON: () => {},
    getItemJSON: (key, fallback) => key === legacySftpRecoveryStorageKey
      ? legacyRecords
      : fallback
  }

  const migration = readSafetyOperationRecordsForMigration(storage)
  const uiRecords = readSafetyOperationRecords(storage, { cleanupLegacy: false })

  assert.equal(migration.records.length, 250)
  assert.equal(migration.legacySources[legacySftpRecoveryStorageKey].count, 250)
  assert.equal(uiRecords.length, 200)
})

test('writing a stale snapshot merges records already persisted by another component', async () => {
  const { writeSafetyOperationRecords, safetyOperationStorageKey } = await import(moduleUrl)
  let persisted = [{ id: 'sftp-new', source: 'sftp', createdAt: '2026-07-12T10:00:00.000Z' }]
  const storage = {
    safeGetItemJSON: key => key === safetyOperationStorageKey ? persisted : [],
    safeSetItemJSON: (key, value) => { persisted = value }
  }

  writeSafetyOperationRecords(storage, [
    { id: 'quick-stale', source: 'quick-command', createdAt: '2026-07-12T09:00:00.000Z' }
  ])

  assert.deepEqual(persisted.map(record => record.id), ['sftp-new', 'quick-stale'])
})

test('a stale available snapshot cannot reopen a completed rollback record', async () => {
  const { writeSafetyOperationRecords, safetyOperationStorageKey } = await import(moduleUrl)
  let persisted = [{
    id: 'same',
    source: 'quick-command',
    status: 'restored',
    rollbackStatus: 'completed',
    createdAt: '2026-07-12T09:00:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z'
  }]
  const storage = {
    safeGetItemJSON: key => key === safetyOperationStorageKey ? persisted : [],
    safeSetItemJSON: (key, value) => { persisted = value }
  }

  writeSafetyOperationRecords(storage, [{
    id: 'same',
    source: 'quick-command',
    status: 'available',
    createdAt: '2026-07-12T09:00:00.000Z'
  }])

  assert.equal(persisted[0].status, 'restored')
})

test('quick rollback commands safely quote the recorded remote path', async () => {
  const { buildQuickCommandRollbackAction } = await import(moduleUrl)
  const command = buildQuickCommandRollbackAction({
    rollbackPath: "/tmp/shellpilot rollback/net'work.sh"
  }, 'rollback')

  assert.match(command, /'\/tmp\/shellpilot rollback\/net'"'"'work\.sh'/)
  assert.doesNotMatch(command, /sh "\/tmp\/shellpilot rollback/)
  const injected = buildQuickCommandRollbackAction({
    rollbackPath: '/tmp/$(touch /tmp/unsafe).sh'
  }, 'rollback')
  assert.doesNotMatch(injected, /失效:.*\$\(/)
})

test('rollback session lookup falls back from a stale tab id to the current matching host', async () => {
  const { findSafetyOperationSession } = await import(moduleUrl)
  const sessions = {
    wrongEndpoint: {
      pid: 'pid-1',
      isSsh: () => true,
      props: { tab: { host: '10.0.0.8', port: 2222, username: 'deploy' } }
    },
    current: {
      pid: 'pid-2',
      isSsh: () => true,
      props: { tab: { host: '10.0.0.8', port: 22, username: 'root' } }
    },
    other: {
      pid: 'pid-3',
      isSsh: () => true,
      props: { tab: { host: '10.0.0.9', port: 22, username: 'root' } }
    }
  }
  const session = findSafetyOperationSession(
    { tabId: 'closed-tab', host: '10.0.0.8', port: 22, username: 'root' },
    ['wrongEndpoint', 'current', 'other'],
    tabId => sessions[tabId]
  )

  assert.equal(session, sessions.current)
})

test('rollback session lookup refuses host-only fallback when endpoint identity is incomplete', async () => {
  const { findSafetyOperationSession } = await import(moduleUrl)
  const session = findSafetyOperationSession(
    { tabId: 'closed-tab', host: '10.0.0.8', username: '' },
    ['current'],
    () => ({ pid: 'pid-2', isSsh: () => true, props: { tab: { host: '10.0.0.8', port: 22, username: 'root' } } })
  )
  assert.equal(session, undefined)
})

test('verified rollback wrapper rejects missing or nonzero remote result markers', async () => {
  const {
    buildVerifiedQuickCommandRollbackAction,
    assertVerifiedQuickCommandRollbackResult
  } = await import(moduleUrl)
  const command = buildVerifiedQuickCommandRollbackAction({ rollbackPath: '/tmp/rollback.sh' }, 'rollback', 'abc123')

  assert.match(command, /__SHELLPILOT_ROLLBACK_RC_abc123/)
  assert.doesNotThrow(() => assertVerifiedQuickCommandRollbackResult('done\n__SHELLPILOT_ROLLBACK_RC_abc123=0', 'abc123'))
  assert.throws(() => assertVerifiedQuickCommandRollbackResult('__SHELLPILOT_ROLLBACK_RC_abc123=44', 'abc123'), /44/)
  assert.throws(() => assertVerifiedQuickCommandRollbackResult('no marker', 'abc123'), /未返回执行状态/)
})
