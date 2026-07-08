const fs = require('fs')
const { spawnSync } = require('child_process')
const pack = require('../../package.json')
const {
  listFilesRecursive,
  resolvePortableZipPaths,
  validatePortableZipExtractedFiles
} = require('./package-smoke-utils')

function cleanupVerifyDir (tmpRoot) {
  const base = require('path').basename(tmpRoot)
  if (!base.startsWith('aigshell-portable-verify-')) {
    return
  }
  fs.rmSync(tmpRoot, {
    recursive: true,
    force: true
  })
}

function expandZip (zipPath, extractPath) {
  fs.rmSync(extractPath, {
    recursive: true,
    force: true
  })
  fs.mkdirSync(extractPath, { recursive: true })

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
    zipPath,
    extractPath
  ], {
    stdio: 'inherit',
    windowsHide: true
  })

  if (result.status !== 0) {
    throw new Error(`便携 ZIP 解压失败：${zipPath}`)
  }
}

function main () {
  if (process.platform !== 'win32') {
    console.log('Portable ZIP verification skipped: Windows only.')
    return
  }

  const paths = resolvePortableZipPaths({
    version: pack.version,
    arch: process.env.AIGSHELL_RELEASE_ARCH || 'x64'
  })
  if (!fs.existsSync(paths.zipPath)) {
    throw new Error(`便携 ZIP 不存在：${paths.zipPath}`)
  }

  expandZip(paths.zipPath, paths.extractPath)
  const files = listFilesRecursive(paths.extractPath)
  validatePortableZipExtractedFiles(files)
  console.log(`Portable ZIP verification passed: ${paths.zipPath}`)

  if (process.env.AIGSHELL_KEEP_PORTABLE_VERIFY_DATA !== '1') {
    cleanupVerifyDir(paths.tmpRoot)
  }
}

main()
