const path = require('path')

function resolveSmokePaths ({
  projectRoot = path.resolve(__dirname, '../..'),
  tmpRoot
} = {}) {
  const root = tmpRoot || path.join(
    require('os').tmpdir(),
    `aigshell-package-smoke-${process.pid}-${Date.now()}`
  )
  const dataPath = path.join(root, 'data')
  const userPath = path.join(dataPath, 'users', 'default_user')

  return {
    tmpRoot: root,
    exePath: path.join(projectRoot, 'dist', 'win-unpacked', 'AIGShell.exe'),
    dataPath,
    mainDbPath: path.join(userPath, 'electerm.db'),
    dataDbPath: path.join(userPath, 'electerm_data.db')
  }
}

function resolvePortableZipPaths ({
  projectRoot = path.resolve(__dirname, '../..'),
  tmpRoot,
  version,
  arch = 'x64'
} = {}) {
  const root = tmpRoot || path.join(
    require('os').tmpdir(),
    `aigshell-portable-verify-${process.pid}-${Date.now()}`
  )
  return {
    tmpRoot: root,
    zipPath: path.join(projectRoot, 'dist', `AIGShell-${version}-win-${arch}-portable.zip`),
    extractPath: path.join(root, 'extract')
  }
}

function buildSmokeEnvironment (baseEnv, dataPath) {
  return {
    ...baseEnv,
    DATA_PATH: dataPath,
    DISABLE_GPU: '1'
  }
}

function validateSmokeResult ({
  runningAfterWait,
  mainDbExists,
  dataDbExists,
  exitCode
}) {
  if (!runningAfterWait) {
    throw new Error(`AIGShell exited before startup completed. Exit code: ${exitCode}`)
  }
  if (!mainDbExists || !dataDbExists) {
    throw new Error('AIGShell did not create sqlite databases in DATA_PATH')
  }
}

function normalizeZipEntry (file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

function validatePortableZipExtractedFiles (files = []) {
  const entries = files.map(normalizeZipEntry).filter(Boolean)
  const lowerEntries = entries.map(file => file.toLowerCase())
  const hasBatLauncher = lowerEntries.some(file => /\.(bat|cmd)$/.test(file))
  const hasExe = lowerEntries.some(file => path.basename(file) === 'aigshell.exe')
  const hasAppAsar = lowerEntries.includes('resources/app.asar')

  if (hasBatLauncher) {
    throw new Error('便携包不应包含 BAT/CMD 启动脚本')
  }
  if (!hasExe) {
    throw new Error('便携包缺少 AIGShell.exe')
  }
  if (!hasAppAsar) {
    throw new Error('便携包缺少 resources/app.asar')
  }
}

function listFilesRecursive (rootDir, dir = rootDir) {
  return require('fs').readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return listFilesRecursive(rootDir, fullPath)
    }
    return entry.isFile()
      ? [path.relative(rootDir, fullPath)]
      : []
  })
}

module.exports = {
  buildSmokeEnvironment,
  listFilesRecursive,
  resolvePortableZipPaths,
  resolveSmokePaths,
  validatePortableZipExtractedFiles,
  validateSmokeResult
}
