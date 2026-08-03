/**
 * post install script
 */
const { cp, exec } = require('shelljs')
const { existsSync } = require('fs')
const { resolve } = require('path')
const { removeOptionalNativeResidue } = require('./prepare-cleanup-utils')
const prePushPath = resolve(__dirname, '../../.git/hooks/pre-push')
const prePushPathFrom = resolve(__dirname, 'pre-push')
const os = require('os')

const platform = os.platform()
const isWin = platform === 'win32'
// const rest = ''
if (isWin && process.env.CI) {
  exec('npm cache clear -f')
  exec('npm uninstall node-gyp -g')
  exec('npm install node-gyp -g')
}

// Remove optional native module that may fail to rebuild
try {
  const projectRoot = resolve(__dirname, '../..')
  for (const relativePath of removeOptionalNativeResidue(projectRoot)) {
    console.log('Removed optional module residue:', relativePath)
  }
} catch (e) {
  console.warn('Failed to remove optional native residue:', e?.message || e)
}

exec(resolve('./node_modules/.bin/electron-rebuild'))

if (!existsSync(prePushPath)) {
  cp(prePushPathFrom, prePushPath)
}
