const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  createIncidentDatabase
} = require('../../src/app/lib/incidents/incident-database')
const {
  INCIDENT_MIGRATIONS
} = require('../../src/app/lib/incidents/incident-migrations')

let rootPath

test.beforeEach(() => {
  rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-incidents-'))
})

test.afterEach(() => {
  fs.rmSync(rootPath, { recursive: true, force: true })
})

function seedVersionOneDatabase (target) {
  const manager = createIncidentDatabase({ rootPath: target })
  manager.close()
}

test('creates version 1 schema with fts and indexes', () => {
  const manager = createIncidentDatabase({ rootPath })
  assert.equal(manager.db.prepare('PRAGMA user_version').get().user_version, 1)
  assert.ok(manager.db.prepare(
    "SELECT name FROM sqlite_master WHERE name = 'incident_search'"
  ).get())
  assert.ok(manager.db.prepare(
    "SELECT name FROM sqlite_master WHERE name = 'idx_incidents_state_updated'"
  ).get())
  manager.close()
})

test('restores pre-migration backup when the next migration fails', () => {
  seedVersionOneDatabase(rootPath)
  assert.throws(() => createIncidentDatabase({
    rootPath,
    migrationSteps: [
      ...INCIDENT_MIGRATIONS,
      {
        version: 2,
        run () {
          throw new Error('forced migration failure')
        }
      }
    ]
  }), /forced migration failure/)
  const reopened = createIncidentDatabase({ rootPath })
  assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, 1)
  assert.equal(reopened.listBackups().length, 1)
  reopened.close()
})

test('reports storage and restores a validated manual backup', () => {
  const manager = createIncidentDatabase({ rootPath, now: () => 1000 })
  const backup = manager.createBackup('manual')
  const secondBackup = manager.createBackup('manual')
  assert.notEqual(secondBackup.filename, backup.filename)
  manager.db.exec("INSERT INTO incidents (id, title, state, severity, verification_status, storage_policy, created_at, updated_at) VALUES ('later', 'Later', 'investigating', 'medium', 'pending', 'standard', 2, 2)")
  manager.restoreBackup(backup.filename, 'RESTORE')
  assert.equal(manager.db.prepare("SELECT id FROM incidents WHERE id = 'later'").get(), undefined)
  const storage = manager.getStorageStats()
  assert.equal(storage.backupCount, 3)
  assert.ok(storage.databaseBytes > 0)
  manager.close()
})

test('recovers a corrupt database from the newest healthy backup', () => {
  const manager = createIncidentDatabase({ rootPath, now: () => 2000 })
  manager.db.exec("INSERT INTO incidents (id, title, state, severity, verification_status, storage_policy, created_at, updated_at) VALUES ('saved', 'Saved', 'investigating', 'medium', 'pending', 'standard', 2, 2)")
  manager.createBackup('manual')
  const databasePath = manager.databasePath
  manager.close()
  fs.writeFileSync(databasePath, Buffer.from('not-a-sqlite-database'))

  const recovered = createIncidentDatabase({ rootPath, now: () => 3000 })
  assert.equal(
    recovered.db.prepare("SELECT title FROM incidents WHERE id = 'saved'").get().title,
    'Saved'
  )
  assert.ok(
    fs.readdirSync(rootPath).some(name => name.includes('.corrupt-3000'))
  )
  recovered.close()
})

test('preserves a corrupt database when no healthy backup exists', () => {
  const databasePath = path.join(rootPath, 'incidents.db')
  fs.writeFileSync(databasePath, Buffer.from('not-a-sqlite-database'))

  assert.throws(
    () => createIncidentDatabase({ rootPath, now: () => 4000 }),
    error => error.code === 'INCIDENT_DATABASE_CORRUPT'
  )
  assert.equal(
    fs.readFileSync(databasePath, 'utf8'),
    'not-a-sqlite-database'
  )
})
