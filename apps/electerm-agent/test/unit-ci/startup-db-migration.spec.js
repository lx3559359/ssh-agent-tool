const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const createAppPath = path.resolve(__dirname, '../../src/app/lib/create-app.js')
const mainPath = path.resolve(__dirname, '../../src/client/components/main/main.jsx')
const rendererUpgradePath = path.resolve(__dirname, '../../src/client/store/db-upgrade.js')

test('desktop database migration finishes before the first window is created', () => {
  const source = fs.readFileSync(createAppPath, 'utf8')
  const prepareIndex = source.indexOf('await prepareDatabase()')
  const configIndex = source.indexOf('conf = await getDbConfig()')
  const windowIndex = source.indexOf('createWindow(conf)', configIndex)

  assert.notEqual(prepareIndex, -1)
  assert.equal(prepareIndex < configIndex, true)
  assert.equal(configIndex < windowIndex, true)
})

test('renderer startup does not run a second migration-and-restart flow', () => {
  const source = fs.readFileSync(mainPath, 'utf8')

  assert.equal(source.includes('store.checkForDbUpgrade()'), false)
})

test('legacy renderer database check cannot migrate or restart the desktop app', () => {
  const source = fs.readFileSync(rendererUpgradePath, 'utf8')

  assert.equal(source.includes("runGlobalAsync('migrate')"), false)
  assert.equal(source.includes("runGlobalAsync('doUpgrade')"), false)
  assert.equal(source.includes('store.restart()'), false)
  assert.equal(source.includes('Database Migrated'), false)
})
