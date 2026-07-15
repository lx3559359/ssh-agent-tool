const { resolve } = require('path')

function resolveUserDataPath ({
  nodeTest,
  dataPath,
  appDataPath,
  safeStorageAppName
}) {
  if (nodeTest === 'yes' && dataPath) {
    return resolve(dataPath, 'electron-user-data')
  }

  return resolve(appDataPath, safeStorageAppName)
}

module.exports = {
  resolveUserDataPath
}
