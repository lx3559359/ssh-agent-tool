/**
 * app path
 */
const { app } = require('electron')
const { resolve } = require('path')
const constants = require('./runtime-constants')
const installSrc = require('../lib/install-src')
const { resolveAppDataProps } = require('./app-data-path')

function getDataPath () {
  return resolveAppDataProps({
    isWin: constants.isWin,
    appDataPath: app.getPath('appData'),
    exePath: app.getPath('exe'),
    installSrc,
    existsSync: require('fs').existsSync
  })
}

module.exports = {
  ...getDataPath(),
  sshKeysPath: resolve(
    app.getPath('home'),
    '.ssh'
  ),
  ...constants
}
