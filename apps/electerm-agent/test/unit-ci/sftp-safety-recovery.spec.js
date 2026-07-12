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
    path.resolve(__dirname, '../../src/client/components/sftp/file-item.jsx'),
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
  assert.match(itemSource, /恢复最近备份/)
  assert.match(itemSource, /一键备份/)
  assert.match(entrySource, /softDeleteRemoteFiles/)
  assert.match(entrySource, /安全操作中心/)
  assert.match(entrySource, /一键备份/)
  assert.doesNotMatch(entrySource, /delFiles[\s\S]{0,900}remoteDel\(f\)/)
  assert.match(mcpSource, /sftpEntry\.delFiles/)
  assert.doesNotMatch(mcpSource, /mcpSftpDel[\s\S]{0,700}sftp\.(rm|rmdir)\(/)
})
