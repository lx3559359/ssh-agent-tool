const { existsSync, readdirSync } = require('fs')
const { resolve } = require('path')
const { cp } = require('shelljs')

function hasFiles (dir) {
  try {
    return existsSync(dir) && readdirSync(dir).length > 0
  } catch (err) {
    return false
  }
}

function copyOptionalResource ({ fromDir, to }) {
  if (!hasFiles(fromDir)) {
    return false
  }

  cp(resolve(fromDir, '*'), to)
  return true
}

function copyBuildResources () {
  const trayIconsDir = resolve(
    __dirname,
    '../../node_modules/@electerm/electerm-resource/tray-icons'
  )
  const electermIconsDir = resolve(
    __dirname,
    '../../node_modules/electerm-icons/icons'
  )
  const imageTargetDir = resolve(
    __dirname,
    '../../work/app/assets/images/'
  )
  const iconsTargetDir = resolve(
    __dirname,
    '../../work/app/assets/icons'
  )

  copyOptionalResource({
    fromDir: trayIconsDir,
    to: imageTargetDir
  })
  cp('-r', electermIconsDir, iconsTargetDir)
}

if (require.main === module) {
  copyBuildResources()
}

module.exports = {
  copyBuildResources,
  copyOptionalResource,
  hasFiles
}
