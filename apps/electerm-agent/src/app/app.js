/**
 * app entry
 */
const { app: electronApp } = require('electron')
const { resolve } = require('path')
const { safeStorageAppName } = require('./common/runtime-constants')

// Keep Electron userData on the legacy internal name so safeStorage can
// decrypt configs and credentials saved before the ShellPilot rebrand.
electronApp.setName(safeStorageAppName)
electronApp.setPath('userData', resolve(electronApp.getPath('appData'), safeStorageAppName))

const log = require('./common/log')
const { createApp } = require('./lib/create-app')
const globalState = require('./lib/glob-state')

globalState.set('initTime', Date.now())

log.debug('electerm start')

const app = createApp()
globalState.set('app', app)
