/**
 * migrate from NeDB (v1) to SQLite (v2)
 */

const { resolve } = require('path')

const tables = [
  'bookmarks',
  'bookmarkGroups',
  'addressBookmarks',
  'terminalThemes',
  'lastStates',
  'data',
  'quickCommands',
  'log',
  'dbUpgradeLog',
  'profiles',
  'safetyOperations',
  'agentTasks',
  'agentArtifacts'
]

const safetyTables = new Set([
  'safetyOperations',
  'agentTasks',
  'agentArtifacts'
])

function createMigration (options = {}) {
  let dependencies

  function getDependencies () {
    if (dependencies) return dependencies
    const appProps = options.appPath !== undefined && options.defaultUserName !== undefined
      ? options
      : require('../common/app-props')
    const fs = require('fs')
    const hasCryptoOptions = Object.prototype.hasOwnProperty.call(options, 'enc') ||
      Object.prototype.hasOwnProperty.call(options, 'dec')
    const crypto = hasCryptoOptions ? options : require('../lib/safe-storage')
    const enc = hasCryptoOptions ? crypto.enc : crypto.safeEncrypt
    const dec = hasCryptoOptions ? crypto.dec : crypto.safeDecrypt
    if (typeof enc !== 'function' || typeof dec !== 'function') {
      throw new Error('NeDB to SQLite migration requires explicit encryption and decryption functions')
    }
    const upgrade = options.checkDbUpgrade && options.doUpgrade
      ? options
      : require('./index')

    dependencies = {
      appPath: appProps.appPath,
      defaultUserName: appProps.defaultUserName,
      enc,
      dec,
      createNedb: options.createNedb || require('../lib/nedb').createDb,
      createSqlite: options.createSqlite || require('../lib/sqlite').createDb,
      checkDbUpgrade: upgrade.checkDbUpgrade,
      doUpgrade: upgrade.doUpgrade,
      existsSync: options.existsSync || fs.existsSync,
      renameSync: options.renameSync || fs.renameSync,
      log: options.log || require('../common/log'),
      nodeVersion: options.nodeVersion || process.versions.node
    }
    return dependencies
  }

  function reso (name) {
    const { appPath, defaultUserName } = getDependencies()
    return resolve(appPath, 'electerm', 'users', defaultUserName, `electerm.${name}.nedb`)
  }

  function checkMigrate () {
    const nodeVersion = options.nodeVersion || process.versions.node
    if (Number(String(nodeVersion).split('.')[0]) < 22) return false
    const { existsSync } = getDependencies()
    return tables.some(table => existsSync(reso(table)))
  }

  async function migrate () {
    const deps = getDependencies()
    const {
      appPath,
      defaultUserName,
      enc,
      dec,
      createNedb,
      createSqlite,
      checkDbUpgrade,
      doUpgrade,
      existsSync,
      renameSync,
      log
    } = deps
    log.info('Starting migration from NeDB (v1) to SQLite (v2)...')

    if (await checkDbUpgrade()) await doUpgrade()

    const encOptions = { enc, dec }
    const { dbAction: nedbDbAction } = createNedb(appPath, defaultUserName, encOptions)
    const { dbAction: sqliteDbAction } = createSqlite(appPath, defaultUserName, encOptions)

    for (const table of tables) {
      const nedbPath = reso(table)
      if (!existsSync(nedbPath)) {
        log.info(`NeDB file for ${table} does not exist, skipping`)
        continue
      }

      log.info(`Migrating table: ${table}`)
      const nedbData = await nedbDbAction(table, 'find', {})
      if (nedbData && nedbData.length > 0) {
        log.info(`Found ${nedbData.length} records in ${table}`)
        for (const record of nedbData) {
          if (safetyTables.has(table) && Object.prototype.hasOwnProperty.call(record, '_encdata')) {
            throw new Error(`Refusing to migrate undecrypted ${table} record ${record._id || record.id || ''}`)
          }
          const recordId = record._id || record.id
          if (!recordId) {
            log.warn(`Record in ${table} has no _id or id field, skipping:`, record)
            continue
          }
          await sqliteDbAction(table, 'update',
            { _id: recordId },
            { $set: record },
            { upsert: true }
          )
        }
        log.info(`Successfully migrated ${nedbData.length} records from ${table}`)
      } else {
        log.info(`Table ${table} is empty, nothing to migrate`)
      }

      const backupPath = nedbPath + '.bak'
      try {
        renameSync(nedbPath, backupPath)
        log.info(`Backed up ${nedbPath} to ${backupPath}`)
      } catch (renameError) {
        log.error(`Error backing up ${nedbPath}:`, renameError)
      }
    }

    log.info('Migration from NeDB to SQLite completed successfully')
    return true
  }

  return {
    checkMigrate,
    migrate
  }
}

const defaultMigration = createMigration()

module.exports = {
  tables,
  createMigration,
  checkMigrate: defaultMigration.checkMigrate,
  migrate: defaultMigration.migrate
}
