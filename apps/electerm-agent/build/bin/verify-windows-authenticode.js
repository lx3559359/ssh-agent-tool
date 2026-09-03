const path = require('node:path')
const { spawnSync } = require('node:child_process')
const pack = require('../../package.json')

function buildAuthenticodeArgs ({ scriptPath, filePaths }) {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    ...filePaths
  ]
}

function resolveDefaultAuthenticodeTargets ({
  cwd = process.cwd(),
  version = pack.version
} = {}) {
  return [
    path.resolve(cwd, 'dist/win-unpacked/ShellPilot.exe'),
    path.resolve(cwd, `dist/ShellPilot-${version}-win-x64-installer.exe`)
  ]
}

function verifyWindowsAuthenticode ({
  filePaths = resolveDefaultAuthenticodeTargets(),
  platform = process.platform,
  powershell = 'powershell.exe',
  scriptPath = path.resolve(__dirname, 'verify-windows-authenticode.ps1'),
  spawn = spawnSync
} = {}) {
  if (platform !== 'win32') {
    throw new Error('Authenticode verification is Windows only.')
  }
  if (!Array.isArray(filePaths) || filePaths.length === 0 ||
      filePaths.some(filePath => typeof filePath !== 'string' || !filePath.trim())) {
    throw new Error('Authenticode verification requires explicit file paths.')
  }

  const result = spawn(
    powershell,
    buildAuthenticodeArgs({ scriptPath, filePaths }),
    { encoding: 'utf8', windowsHide: true }
  )
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Authenticode verification failed with exit code ${result.status}.`)
  }
  return result.stdout || ''
}

function main () {
  verifyWindowsAuthenticode()
}

if (require.main === module) {
  main()
}

module.exports = {
  buildAuthenticodeArgs,
  main,
  resolveDefaultAuthenticodeTargets,
  verifyWindowsAuthenticode
}
