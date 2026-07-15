const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const {
  appExecutableName,
  buildSmokeEnvironment,
  resolveSmokePaths,
  validateSmokeResult
} = require('./package-smoke-utils')

const timeoutMs = Number(process.env.AIGSHELL_PACKAGE_SMOKE_TIMEOUT || 15000)
const intervalMs = 500

function parseArgs (argv = process.argv.slice(2)) {
  const appIndex = argv.indexOf('--app')
  return {
    app: appIndex >= 0 ? argv[appIndex + 1] : undefined
  }
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForDatabases (paths, child) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return false
    }
    if (fs.existsSync(paths.mainDbPath) && fs.existsSync(paths.dataDbPath)) {
      return true
    }
    await sleep(intervalMs)
  }
  return fs.existsSync(paths.mainDbPath) && fs.existsSync(paths.dataDbPath)
}

function waitForChildClose (child, waitMs) {
  return new Promise(resolve => {
    let settled = false
    const finish = (closed) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      child.removeListener('close', onClose)
      child.removeListener('error', onError)
      resolve(closed)
    }
    const onClose = () => finish(true)
    const onError = () => finish(false)
    const timer = setTimeout(() => finish(false), waitMs)
    child.once('close', onClose)
    child.once('error', onError)
  })
}

async function stopChild (child, {
  graceMs = 1500,
  forceMs = 5000
} = {}) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  const gracefulClose = waitForChildClose(child, graceMs)
  child.kill()
  if (await gracefulClose) {
    return
  }

  const forcedClose = waitForChildClose(child, forceMs)
  child.kill('SIGKILL')
  await forcedClose
}

function cleanupSmokeDir (tmpRoot) {
  const base = path.basename(tmpRoot)
  if (!base.startsWith('aigshell-package-smoke-')) {
    return
  }
  fs.rmSync(tmpRoot, {
    recursive: true,
    force: true
  })
}

async function main () {
  if (process.platform !== 'win32') {
    console.log('Package smoke test skipped: Windows only.')
    return
  }

  const args = parseArgs()
  const paths = resolveSmokePaths({
    exePath: args.app ? path.resolve(args.app) : undefined
  })
  if (!fs.existsSync(paths.exePath)) {
    throw new Error(`${appExecutableName} package not found: ${paths.exePath}. Run npm run b first.`)
  }

  fs.mkdirSync(paths.dataPath, { recursive: true })
  const child = spawn(paths.exePath, [], {
    env: buildSmokeEnvironment(process.env, paths.dataPath),
    stdio: 'ignore',
    windowsHide: true
  })

  const databasesReady = await waitForDatabases(paths, child)
  const runningAfterWait = child.exitCode === null && child.signalCode === null
  const result = {
    runningAfterWait,
    mainDbExists: fs.existsSync(paths.mainDbPath),
    dataDbExists: fs.existsSync(paths.dataDbPath),
    exitCode: child.exitCode
  }

  await stopChild(child)

  validateSmokeResult(result)
  console.log(`Package smoke test passed: ${paths.exePath}`)
  console.log(`DATA_PATH initialized: ${paths.dataPath}`)

  if (process.env.AIGSHELL_KEEP_SMOKE_DATA !== '1' && databasesReady) {
    cleanupSmokeDir(paths.tmpRoot)
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message)
    process.exit(1)
  })
}

module.exports = {
  main,
  parseArgs,
  stopChild
}
