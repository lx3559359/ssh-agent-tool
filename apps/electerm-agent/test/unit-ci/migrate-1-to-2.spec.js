const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')

const migrationPath = path.resolve(__dirname, '../../src/app/migrate/migrate-1-to-2.js')
const noop = () => {}
const log = { info: noop, warn: noop, error: noop }

function loadMigrationModule () {
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === migrationPath && request === '../common/app-props') {
      return { appPath: 'unused', defaultUserName: 'unused' }
    }
    if (parent?.filename === migrationPath && request === '../common/log') return log
    return originalLoad.call(this, request, parent, isMain)
  }
  delete require.cache[migrationPath]
  try {
    return require(migrationPath)
  } finally {
    Module._load = originalLoad
    delete require.cache[migrationPath]
  }
}

function enc (value) {
  return Buffer.from(value, 'utf8').toString('base64')
}

function dec (value) {
  return Buffer.from(value, 'base64').toString('utf8')
}

function createTestMigration (module, appPath, defaultUserName = 'testuser') {
  return module.createMigration({
    appPath,
    defaultUserName,
    enc,
    dec,
    createNedb: require('../../src/app/lib/nedb').createDb,
    createSqlite: require('../../src/app/lib/sqlite').createDb,
    checkDbUpgrade: async () => false,
    doUpgrade: async () => {},
    log
  })
}

test('v1 to v2 migration table set includes safety operations and agent tasks', () => {
  const migrationModule = loadMigrationModule()

  assert.equal(migrationModule.tables.includes('safetyOperations'), true)
  assert.equal(migrationModule.tables.includes('agentTasks'), true)
})

test('migration refuses to run when encryption or decryption is not configured', () => {
  const migrationModule = loadMigrationModule()
  const migration = migrationModule.createMigration({
    appPath: 'unused',
    defaultUserName: 'unused',
    enc,
    dec: undefined,
    checkDbUpgrade: async () => false,
    doUpgrade: async () => {},
    log,
    nodeVersion: '22.0.0'
  })

  assert.throws(
    migration.checkMigrate,
    /requires explicit encryption and decryption functions/
  )
})

test('encrypted NeDB safety tables migrate into encrypted and readable SQLite tables', async () => {
  const migrationModule = loadMigrationModule()
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-migrate-safety-'))
  const defaultUserName = 'testuser'
  const { createDb: createNedb } = require('../../src/app/lib/nedb')
  const source = createNedb(appPath, defaultUserName, { enc, dec })
  const operation = {
    _id: 'legacy-operation',
    command: 'legacy-secret-command',
    endpoint: { host: 'legacy-secret-host.example.com' }
  }
  const task = {
    _id: 'legacy-task',
    output: 'legacy-secret-task-output'
  }
  await source.dbAction('safetyOperations', 'insert', operation)
  await source.dbAction('agentTasks', 'insert', task)

  const migration = createTestMigration(migrationModule, appPath, defaultUserName)
  assert.equal(migration.checkMigrate(), true)
  await migration.migrate()

  const { createDb: createSqlite } = require('../../src/app/lib/sqlite')
  const target = createSqlite(appPath, defaultUserName, { enc, dec })
  assert.equal(
    (await target.dbAction('safetyOperations', 'findOne', { _id: operation._id })).command,
    operation.command
  )
  assert.equal(
    (await target.dbAction('agentTasks', 'findOne', { _id: task._id })).output,
    task.output
  )

  const dbFolder = path.join(appPath, 'electerm', 'users', defaultUserName)
  const sqliteRaw = fs.readFileSync(path.join(dbFolder, 'electerm.db'), 'latin1')
  assert.equal(sqliteRaw.includes(operation.command), false)
  assert.equal(sqliteRaw.includes(operation.endpoint.host), false)
  assert.equal(sqliteRaw.includes(task.output), false)
  assert.equal(fs.existsSync(path.join(dbFolder, 'electerm.safetyOperations.nedb.bak')), true)
  assert.equal(fs.existsSync(path.join(dbFolder, 'electerm.agentTasks.nedb.bak')), true)
})

test('corrupt encrypted safety data aborts migration without backing up the source file', async () => {
  const migrationModule = loadMigrationModule()
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-migrate-corrupt-'))
  const defaultUserName = 'testuser'
  const dbFolder = path.join(appPath, 'electerm', 'users', defaultUserName)
  const sourcePath = path.join(dbFolder, 'electerm.safetyOperations.nedb')
  fs.mkdirSync(dbFolder, { recursive: true })
  fs.writeFileSync(sourcePath, JSON.stringify({
    _id: 'corrupt-operation',
    _encdata: `enc:${enc('{invalid-json')}`
  }) + '\n')

  const migration = createTestMigration(migrationModule, appPath, defaultUserName)

  await assert.rejects(migration.migrate(), /JSON|Unexpected|property name/i)
  assert.equal(fs.existsSync(sourcePath), true)
  assert.equal(fs.existsSync(sourcePath + '.bak'), false)
})
