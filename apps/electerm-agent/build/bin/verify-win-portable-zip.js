const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const pack = require('../../package.json')
const {
  listFilesRecursive,
  resolvePortableZipPaths,
  validatePortableZipExtractedFiles
} = require('./package-smoke-utils')

function cleanupVerifyDir (tmpRoot) {
  const base = path.basename(tmpRoot)
  if (!base.startsWith('aigshell-portable-verify-')) {
    return
  }
  fs.rmSync(tmpRoot, {
    recursive: true,
    force: true
  })
}

function buildExpandArchiveArgs ({
  scriptPath,
  zipPath,
  extractPath
}) {
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    zipPath,
    extractPath
  ]
}

function writeExpandArchiveScript (scriptPath) {
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true })
  fs.writeFileSync(scriptPath, [
    'param(',
    '  [Parameter(Mandatory=$true)][string]$ZipPath,',
    '  [Parameter(Mandatory=$true)][string]$ExtractPath',
    ')',
    'Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractPath -Force',
    ''
  ].join('\r\n'))
}

function expandZip (zipPath, extractPath) {
  fs.rmSync(extractPath, {
    recursive: true,
    force: true
  })
  fs.mkdirSync(extractPath, { recursive: true })

  const scriptPath = path.join(path.dirname(extractPath), 'expand-aigshell-portable.ps1')
  writeExpandArchiveScript(scriptPath)

  const result = spawnSync('powershell.exe', buildExpandArchiveArgs({
    scriptPath,
    zipPath,
    extractPath
  }), {
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

if (require.main === module) {
  main()
}

module.exports = {
  buildExpandArchiveArgs,
  cleanupVerifyDir,
  expandZip,
  main,
  writeExpandArchiveScript
}
