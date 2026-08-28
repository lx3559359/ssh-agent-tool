const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/sftp/sftp-safety.js')
).href

test('SFTP backup and trash paths stay beside the source with timestamps', async () => {
  const { buildSftpSafetyPath } = await import(moduleUrl)
  const now = new Date('2026-07-12T08:09:10Z')

  assert.equal(
    buildSftpSafetyPath('/var/www/app', 'backup', now),
    '/var/www/.shellpilot-backups/app-20260712-080910'
  )
  assert.equal(
    buildSftpSafetyPath('/var/log/app.log', 'trash', now),
    '/var/log/.shellpilot-trash/app.log-20260712-080910'
  )
})

test('one-click SFTP backup copies files and folders without changing originals', async () => {
  const { backupRemoteFiles } = await import(moduleUrl)
  const calls = []
  const sftp = {
    mkdir: async value => calls.push(['mkdir', value]),
    cp: async (from, to) => calls.push(['cp', from, to])
  }
  const files = [
    { path: '/var/www', name: 'app', isDirectory: true },
    { path: '/var/www', name: 'nginx.conf', isDirectory: false }
  ]
  const records = await backupRemoteFiles({
    sftp,
    files,
    tab: { id: 'tab-1', host: '10.0.0.8', port: 2222, username: 'root', title: '生产服务器' },
    now: new Date('2026-07-12T08:09:10Z')
  })

  assert.deepEqual(calls, [
    ['mkdir', '/var/www/.shellpilot-backups'],
    ['cp', '/var/www/app', '/var/www/.shellpilot-backups/app-20260712-080910'],
    ['cp', '/var/www/nginx.conf', '/var/www/.shellpilot-backups/nginx.conf-20260712-080910']
  ])
  assert.equal(records.length, 2)
  assert.equal(records[0].kind, 'backup')
  assert.equal(records[0].sourcePath, '/var/www/app')
  assert.equal(records[0].status, 'available')
  assert.equal(records[0].source, 'sftp')
  assert.equal(records[0].target, '/var/www/app')
  assert.equal(records[0].rollbackStatus, 'available')
  assert.equal(records[0].port, 2222)
  assert.equal(records[0].username, 'root')
})

test('SFTP backup publishes each recovery record before starting the next copy', async () => {
  const { backupRemoteFiles } = await import(moduleUrl)
  const events = []
  const secondCopyError = new Error('second copy failed')
  const sftp = {
    mkdir: async value => events.push(['mkdir', value]),
    cp: async (from, to) => {
      events.push(['cp', from, to])
      if (from.endsWith('/second.conf')) throw secondCopyError
    }
  }

  await assert.rejects(
    backupRemoteFiles({
      sftp,
      files: [
        { path: '/etc/app', name: 'first.conf', isDirectory: false },
        { path: '/etc/app', name: 'second.conf', isDirectory: false }
      ],
      tab: { id: 'tab-1', host: '10.0.0.8' },
      now: new Date('2026-07-12T08:09:10Z'),
      onRecord: async record => {
        events.push(['record', record.sourcePath, record.backupPath])
        return { ...record, metadata: { persisted: true } }
      }
    }),
    error => error === secondCopyError
  )

  assert.deepEqual(events, [
    ['mkdir', '/etc/app/.shellpilot-backups'],
    ['cp', '/etc/app/first.conf', '/etc/app/.shellpilot-backups/first.conf-20260712-080910'],
    ['record', '/etc/app/first.conf', '/etc/app/.shellpilot-backups/first.conf-20260712-080910'],
    ['cp', '/etc/app/second.conf', '/etc/app/.shellpilot-backups/second.conf-20260712-080910']
  ])
})

test('SFTP backup chooses a collision-free path when the timestamped name already exists', async () => {
  const { backupRemoteFiles } = await import(moduleUrl)
  const calls = []
  const existing = '/var/www/.shellpilot-backups/app-20260712-080910'
  const sftp = {
    stat: async value => {
      if (value === existing) return { isDirectory: true }
      throw new Error('No such file')
    },
    mkdir: async value => calls.push(['mkdir', value]),
    cp: async (from, to) => calls.push(['cp', from, to])
  }

  const records = await backupRemoteFiles({
    sftp,
    files: [{ path: '/var/www', name: 'app', isDirectory: true }],
    tab: { id: 'tab-1', host: '10.0.0.8' },
    now: new Date('2026-07-12T08:09:10Z')
  })

  assert.deepEqual(calls, [
    ['mkdir', '/var/www/.shellpilot-backups'],
    ['cp', '/var/www/app', `${existing}-2`]
  ])
  assert.equal(records[0].backupPath, `${existing}-2`)
})

test('SFTP safe delete moves entries to trash instead of removing them', async () => {
  const { softDeleteRemoteFiles } = await import(moduleUrl)
  const calls = []
  const sftp = {
    mkdir: async value => calls.push(['mkdir', value]),
    rename: async (from, to) => calls.push(['rename', from, to]),
    rm: async value => calls.push(['rm', value]),
    rmdir: async value => calls.push(['rmdir', value])
  }
  const records = await softDeleteRemoteFiles({
    sftp,
    files: [{ path: '/opt/app', name: 'config.yml', isDirectory: false }],
    tab: { id: 'tab-1', host: '10.0.0.8' },
    now: new Date('2026-07-12T08:09:10Z')
  })

  assert.deepEqual(calls, [
    ['mkdir', '/opt/app/.shellpilot-trash'],
    ['rename', '/opt/app/config.yml', '/opt/app/.shellpilot-trash/config.yml-20260712-080910']
  ])
  assert.equal(records[0].kind, 'trash')
  assert.equal(records[0].backupPath, '/opt/app/.shellpilot-trash/config.yml-20260712-080910')
})

test('SFTP restore preserves current content before restoring a backup', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const calls = []
  const sftp = {
    stat: async () => ({ isDirectory: false }),
    mkdir: async value => calls.push(['mkdir', value]),
    rename: async (from, to) => calls.push(['rename', from, to]),
    cp: async (from, to) => calls.push(['cp', from, to])
  }
  const result = await restoreSftpRecoveryRecord({
    sftp,
    record: {
      id: 'r1',
      kind: 'backup',
      sourcePath: '/etc/nginx/nginx.conf',
      backupPath: '/etc/nginx/.shellpilot-backups/nginx.conf-20260712-080910',
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z')
  })

  assert.deepEqual(calls, [
    ['mkdir', '/etc/nginx/.shellpilot-before-restore'],
    ['rename', '/etc/nginx/nginx.conf', '/etc/nginx/.shellpilot-before-restore/nginx.conf-20260712-091011'],
    ['cp', '/etc/nginx/.shellpilot-backups/nginx.conf-20260712-080910', '/etc/nginx/nginx.conf']
  ])
  assert.equal(result.status, 'restored')
  assert.equal(result.rollbackStatus, 'completed')
  assert.equal(result.displacedPath, '/etc/nginx/.shellpilot-before-restore/nginx.conf-20260712-091011')
})

test('SFTP restore persists displacement before moving current content and exposes double-failure uncertainty', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const persisted = []
  const displacedPath = '/etc/nginx/.shellpilot-before-restore/nginx.conf-20260712-091011'
  const descriptor = Object.freeze({
    type: 'file',
    device: '1',
    inode: '42',
    size: 7,
    mode: 0o600,
    uid: 0,
    gid: 0,
    sha256: 'a'.repeat(64)
  })
  const primaryCause = new Error('primary restore failed')
  const rollbackCause = new Error('compensation failed')
  const sftp = {
    stat: async () => ({ isDirectory: false }),
    mkdir: async () => {},
    rename: async (from, to) => {
      if (from === displacedPath && to === '/etc/nginx/nginx.conf') {
        throw rollbackCause
      }
    },
    cp: async () => { throw primaryCause }
  }
  const record = {
    id: 'r-uncertain',
    kind: 'backup',
    sourcePath: '/etc/nginx/nginx.conf',
    backupPath: '/etc/nginx/.shellpilot-backups/nginx.conf-20260712-080910',
    status: 'available'
  }

  const error = await restoreSftpRecoveryRecord({
    sftp,
    record,
    now: new Date('2026-07-12T09:10:11Z'),
    describeEntry: async () => descriptor,
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error.code, 'REMOTE_FILE_RECOVERY_UNCERTAIN')
  assert.equal(error.primaryCause, primaryCause)
  assert.equal(error.rollbackCause, rollbackCause)
  assert.equal(error.displacedPath, displacedPath)
  assert.deepEqual(error.displacedDescriptor, descriptor)
  assert.deepEqual(persisted.map(value => value.displacement?.status), [
    'planned',
    'displaced',
    'uncertain'
  ])
  assert.equal(persisted[0].displacement.path, displacedPath)
  assert.deepEqual(persisted[0].displacement.descriptor, descriptor)
  assert.equal(persisted.at(-1).status, 'uncertain')
  assert.equal(persisted.at(-1).rollbackStatus, 'uncertain')
})

test('SFTP restore retry reuses a persisted displacement instead of moving current content again', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const calls = []
  const displacedPath = '/etc/nginx/.shellpilot-before-restore/nginx.conf-existing'
  const record = {
    id: 'r-retry',
    kind: 'backup',
    sourcePath: '/etc/nginx/nginx.conf',
    backupPath: '/etc/nginx/.shellpilot-backups/nginx.conf-old',
    status: 'uncertain',
    displacement: {
      path: displacedPath,
      descriptor: { type: 'file', inode: '42' },
      status: 'displaced'
    }
  }
  const result = await restoreSftpRecoveryRecord({
    sftp: {
      stat: async () => ({ isDirectory: false }),
      mkdir: async value => calls.push(['mkdir', value]),
      rename: async (from, to) => calls.push(['rename', from, to]),
      cp: async (from, to) => calls.push(['cp', from, to])
    },
    record,
    persistRecord: async value => value
  })

  assert.deepEqual(calls, [[
    'cp',
    '/etc/nginx/.shellpilot-backups/nginx.conf-old',
    '/etc/nginx/nginx.conf'
  ]])
  assert.equal(result.status, 'restored')
  assert.equal(result.displacedPath, displacedPath)
})

test('successful restore compensation clears active displacement before a later retry', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const primaryCause = new Error('restore copy failed')
  const persisted = []
  const record = {
    id: 'r-compensated',
    kind: 'backup',
    sourcePath: '/etc/app.conf',
    backupPath: '/etc/.shellpilot-backups/app.conf-old',
    status: 'available'
  }
  const error = await restoreSftpRecoveryRecord({
    sftp: {
      stat: async () => ({ mode: 0o600, uid: 0, gid: 0, size: 4 }),
      mkdir: async () => {},
      rename: async () => {},
      cp: async () => { throw primaryCause }
    },
    record,
    describeEntry: async () => ({ type: 'file', inode: '42' }),
    persistRecord: async value => {
      persisted.push(structuredClone(value))
      return value
    }
  }).catch(error => error)

  assert.equal(error, primaryCause)
  assert.equal(persisted.at(-1).status, 'failed')
  assert.equal(persisted.at(-1).displacement, null)
  assert.equal(persisted.at(-1).lastDisplacement.status, 'compensated')
})

test('SFTP permission recovery restores the previous mode directly', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const calls = []
  const sftp = {
    chmod: async (target, mode) => calls.push(['chmod', target, mode])
  }
  const result = await restoreSftpRecoveryRecord({
    sftp,
    record: {
      id: 'chmod-1',
      kind: 'chmod',
      sourcePath: '/srv/app/config.yml',
      previousMode: 420,
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z')
  })

  assert.deepEqual(calls, [['chmod', '/srv/app/config.yml', 420]])
  assert.equal(result.status, 'restored')
})

test('SFTP rename recovery moves the renamed entry back to its original path', async () => {
  const { restoreSftpRecoveryRecord } = await import(moduleUrl)
  const calls = []
  const sftp = {
    stat: async target => {
      if (target.endsWith('/old.conf')) throw new Error('No such file')
      return { isDirectory: false }
    },
    rename: async (from, to) => calls.push(['rename', from, to])
  }
  const result = await restoreSftpRecoveryRecord({
    sftp,
    record: {
      id: 'rename-1',
      kind: 'rename',
      sourcePath: '/etc/app/old.conf',
      backupPath: '/etc/app/new.conf',
      status: 'available'
    },
    now: new Date('2026-07-12T09:10:11Z')
  })

  assert.deepEqual(calls, [['rename', '/etc/app/new.conf', '/etc/app/old.conf']])
  assert.equal(result.status, 'restored')
})

test('SFTP safety UI exposes backup, recovery center, and safe-delete wiring', () => {
  const itemSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/sftp/sftp-file-context-menu.js'),
    'utf8'
  )
  const entrySource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/sftp/sftp-entry.jsx'),
    'utf8'
  )
  const mcpSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/mcp-handler.js'),
    'utf8'
  )

  assert.match(itemSource, /quickBackup/)
  assert.match(itemSource, /shellpilotSftpRestoreLatestBackup/)
  assert.match(itemSource, /shellpilotSftpQuickBackup/)
  assert.match(entrySource, /runSftpSafetyOperation/)
  assert.match(entrySource, /buildSideEffectSafetyRequest/)
  assert.match(entrySource, /createSftpTransactionAdapter/)
  assert.match(entrySource, /shellpilotSftpSafetyCenter/)
  assert.match(entrySource, /shellpilotSftpQuickBackup/)
  assert.doesNotMatch(entrySource, /delFiles[\s\S]{0,900}remoteDel\(f\)/)
  assert.match(mcpSource, /sftpEntry\.delFiles/)
  assert.doesNotMatch(mcpSource, /mcpSftpDel[\s\S]{0,700}sftp\.(rm|rmdir)\(/)
})
