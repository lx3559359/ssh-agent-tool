/**
 * app entry
 */
const { app: electronApp } = require('electron')
const { safeStorageAppName } = require('./common/runtime-constants')
const { resolveUserDataPath } = require('./common/user-data-path')

// Keep Electron userData on the legacy internal name so safeStorage can
// decrypt configs and credentials saved before the ShellPilot rebrand.
electronApp.setName(safeStorageAppName)
electronApp.setPath('userData', resolveUserDataPath({
  nodeTest: process.env.NODE_TEST,
  dataPath: process.env.DATA_PATH,
  appDataPath: electronApp.getPath('appData'),
  safeStorageAppName
}))

const log = require('./common/log')
const { createApp } = require('./lib/create-app')
const globalState = require('./lib/glob-state')

globalState.set('initTime', Date.now())

log.debug('electerm start')

const app = createApp()
globalState.set('app', app)
