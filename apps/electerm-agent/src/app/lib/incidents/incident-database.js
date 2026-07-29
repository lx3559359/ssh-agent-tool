const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const {
  INCIDENT_MIGRATIONS
} = require('./incident-migrations')
const { incidentError } = require('./incident-model')

function fileBytes (target) {
  try {
    return fs.statSync(target).size
  } catch {
    return 0
  }
}

function createIncidentDatabase ({
  rootPath,
  migrationSteps = INCIDENT_MIGRATIONS,
  now = Date.now,
  maxBackups = 5
}) {
  const databasePath = path.join(rootPath, 'incidents.db')
  const backupsPath = path.join(rootPath, 'backups')
  let db

  fs.mkdirSync(backupsPath, { recursive: true })

  function backupEntries () {
    return fs.readdirSync(backupsPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.db'))
      .map(entry => {
        const target = path.join(backupsPath, entry.name)
        const stat = fs.statSync(target)
        return {
          filename: entry.name,
          bytes: stat.size,
          createdAt: stat.mtimeMs
        }
      })
      .sort((left, right) => (
        right.createdAt - left.createdAt ||
        right.filename.localeCompare(left.filename)
      ))
  }

  function listBackups () {
    return backupEntries()
  }

  function pruneBackups () {
    const entries = backupEntries()
    for (const entry of entries.slice(Math.max(0, maxBackups))) {
      fs.rmSync(path.join(backupsPath, entry.filename), { force: true })
    }
  }

  function assertHealthyDatabase (target) {
    const candidate = new DatabaseSync(target, { readOnly: true })
    try {
      const row = candidate.prepare('PRAGMA integrity_check').get()
      if (row.integrity_check !== 'ok') {
        throw new Error('Incident backup integrity check failed.')
      }
    } finally {
      candidate.close()
    }
  }

  function removeSidecars () {
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true })
    }
  }

  function replaceDatabaseFromFile (source, label) {
    const stamp = now()
    const replacement = `${databasePath}.${stamp}.${label}`
    const previous = `${databasePath}.${stamp}.previous`
    fs.copyFileSync(source, replacement)
    try {
      if (fs.existsSync(databasePath)) {
        fs.renameSync(databasePath, previous)
      }
      fs.renameSync(replacement, databasePath)
      removeSidecars()
    } catch (error) {
      fs.rmSync(databasePath, { force: true })
      if (fs.existsSync(previous)) {
        fs.renameSync(previous, databasePath)
      }
      fs.rmSync(replacement, { force: true })
      throw error
    }
    fs.rmSync(previous, { force: true })
  }

  function recoverCorruptDatabase () {
    const stamp = now()
    const corruptPath = `${databasePath}.corrupt-${stamp}`
    removeSidecars()
    fs.renameSync(databasePath, corruptPath)

    let healthyBackup
    for (const entry of backupEntries()) {
      const candidate = path.join(backupsPath, entry.filename)
      try {
        assertHealthyDatabase(candidate)
        healthyBackup = candidate
        break
      } catch {
        // Keep looking for the newest healthy backup.
      }
    }

    if (!healthyBackup) {
      fs.renameSync(corruptPath, databasePath)
      throw incidentError(
        'INCIDENT_DATABASE_CORRUPT',
        'Incident database is corrupt and no healthy backup is available.'
      )
    }
    fs.copyFileSync(healthyBackup, databasePath)
  }

  function checkExistingDatabase () {
    if (!fs.existsSync(databasePath)) return
    let candidate
    try {
      candidate = new DatabaseSync(databasePath, { readOnly: true })
      const row = candidate.prepare('PRAGMA quick_check').get()
      if (row.quick_check !== 'ok') {
        throw new Error('Incident database quick check failed.')
      }
    } catch {
      candidate?.close()
      recoverCorruptDatabase()
      return
    }
    candidate.close()
  }

  function createBackup (reason = 'manual') {
    db.exec('PRAGMA wal_checkpoint(FULL)')
    const stamp = now()
    let sequence = 0
    let filename
    do {
      const suffix = sequence ? `-${sequence}` : ''
      filename = `incidents-${reason}-${stamp}${suffix}.db`
      sequence += 1
    } while (fs.existsSync(path.join(backupsPath, filename)))
    const target = path.join(backupsPath, filename)
    const escaped = target.replaceAll("'", "''")
    db.exec(`VACUUM INTO '${escaped}'`)
    pruneBackups()
    return { filename, bytes: fs.statSync(target).size }
  }

  function migrate () {
    const currentVersion = db.prepare('PRAGMA user_version').get().user_version
    const pending = [...migrationSteps]
      .filter(step => step.version > currentVersion)
      .sort((left, right) => left.version - right.version)
    if (!pending.length) return

    const migrationBackup = currentVersion > 0
      ? createBackup('pre-migration')
      : null
    try {
      for (const step of pending) {
        db.exec('BEGIN IMMEDIATE')
        try {
          step.run(db)
          db.exec(`PRAGMA user_version = ${Number(step.version)}`)
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
    } catch (error) {
      db.close()
      db = undefined
      if (migrationBackup) {
        replaceDatabaseFromFile(
          path.join(backupsPath, migrationBackup.filename),
          'migration-restore'
        )
      }
      throw error
    }
  }

  function open () {
    checkExistingDatabase()
    db = new DatabaseSync(databasePath)
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA busy_timeout = 5000')
    migrate()
    return db
  }

  function restoreBackup (filename, confirmation) {
    if (confirmation !== 'RESTORE') {
      throw new Error('Incident backup restore requires confirmation.')
    }
    if (path.basename(filename) !== filename) {
      throw new Error('Incident backup path is invalid.')
    }
    const source = path.join(backupsPath, filename)
    assertHealthyDatabase(source)

    const stagedSource = `${databasePath}.${now()}.restore-source`
    fs.copyFileSync(source, stagedSource)
    try {
      createBackup('pre-restore')
      db.close()
      db = undefined
      replaceDatabaseFromFile(stagedSource, 'restore')
      open()
    } catch (error) {
      if (!db) {
        open()
      }
      throw error
    } finally {
      fs.rmSync(stagedSource, { force: true })
    }
    return { restored: true, filename }
  }

  function getStorageStats () {
    const backups = backupEntries()
    return {
      databaseBytes: fileBytes(databasePath),
      walBytes: fileBytes(`${databasePath}-wal`),
      backupBytes: backups.reduce((total, entry) => total + entry.bytes, 0),
      backupCount: backups.length,
      latestBackupAt: backups[0]?.createdAt || null
    }
  }

  open()
  return {
    get db () {
      return db
    },
    databasePath,
    createBackup,
    restoreBackup,
    listBackups,
    getStorageStats,
    close: () => {
      if (db) {
        db.close()
        db = undefined
      }
    }
  }
}

module.exports = {
  createIncidentDatabase
}
