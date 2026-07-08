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
    /^win-.+-portable\.(tar\.gz|zip)$/i.test(installSrc || '') ||
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
