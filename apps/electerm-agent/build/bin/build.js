/**
 * build
 */

const { exec, echo, cp } = require('shelljs')
const fs = require('fs')
const os = require('os')
const { resolve } = require('path')

function cleanGeneratedFrontendAssets () {
  const assetsRoot = resolve(__dirname, '../../work/app/assets')
  const targets = ['chunk', 'js', 'css']
    .map(name => resolve(assetsRoot, name))

  for (const target of targets) {
    fs.rmSync(target, { recursive: true, force: true })
  }
}

function syncRuntimeFiles () {
  const packPath = resolve(__dirname, '../../package.json')
  const targetPackPath = resolve(__dirname, '../../work/app/package.json')
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'))

  pack.main = 'app.js'
  delete pack.scripts
  delete pack.standard
  delete pack.files
  delete pack.engines
  delete pack.preferGlobal

  if (os.platform() === 'win32') {
    delete pack.dependencies['node-bash']
  } else {
    delete pack.dependencies['node-powershell']
  }

  cp('-r', 'src/app', 'work/')
  fs.writeFileSync(
    targetPackPath,
    JSON.stringify(pack, null, 2) + '\n'
  )
}

echo('start build')

const timeStart = +new Date()

cleanGeneratedFrontendAssets()
echo('version file')
echo('js/css file')
exec('npm run vite-build')
echo('copy file')
exec('node.exe ./build/bin/copy.js')
echo('runtime file')
syncRuntimeFiles()
echo('html file')
exec('node.exe ./build/bin/pug.js')

const endTime = +new Date()
echo(`done build in ${(endTime - timeStart) / 1000} s`)
