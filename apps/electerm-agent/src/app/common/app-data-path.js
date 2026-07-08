const { dirname, resolve } = require('path')

function resolveAppDataProps ({
  isWin,
  appDataPath,
  exePath,
  installSrc,
  existsSync
}) {
  const defaultValue = {
    appPath: appDataPath,
    isPortable: false
  }

  if (!isWin) {
    return defaultValue
  }

  const exeDir = dirname(exePath)
  const portableDataPath = resolve(exeDir, 'electerm')
  if (
    installSrc === 'win-x64-portable.tar.gz' ||
    existsSync(portableDataPath)
  ) {
    return {
      appPath: exeDir,
      exePath: exeDir,
      isPortable: true
    }
  }

  return {
    ...defaultValue,
    exePath: exeDir
  }
}

module.exports = {
  resolveAppDataProps
}
