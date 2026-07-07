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

module.exports = {
  buildSmokeEnvironment,
  resolveSmokePaths,
  validateSmokeResult
}
