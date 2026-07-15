const fs = require('fs')
const path = require('path')
const { execFile, spawn } = require('child_process')
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

function createChildCloseWaiter (child, waitMs) {
  let resolvePromise
  const promise = new Promise(resolve => {
    resolvePromise = resolve
  })
  let lastError = null
  let settled = false

  const cleanup = () => {
    clearTimeout(timer)
    child.removeListener('close', onClose)
    child.removeListener('error', onError)
  }
  const finish = (result) => {
    if (settled) {
      return
    }
    settled = true
    cleanup()
    resolvePromise(result)
  }
  const onClose = () => finish({ closed: true, error: lastError })
  const onError = (error) => {
    lastError = error
  }

  child.once('close', onClose)
  child.on('error', onError)
  const timer = setTimeout(() => finish({ closed: false, error: lastError }), waitMs)

  return {
    promise,
    cancel: () => finish({ closed: false, error: lastError })
  }
}

function killWindowsProcessTree (pid, timeoutMs, execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    execFileImpl('taskkill.exe', [
      '/PID',
      String(pid),
      '/T',
      '/F'
    ], {
      windowsHide: true,
      timeout: timeoutMs,
      killSignal: 'SIGKILL'
    }, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function withTimeout (promise, waitMs, message) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), waitMs)
  })
  return Promise.race([promise, timeout])
    .finally(() => clearTimeout(timer))
}

function closeErrorDetail (result) {
  return result.error && result.error.message
    ? `: ${result.error.message}`
    : ''
}

async function stopChild (child, {
  platform = process.platform,
  graceMs = 1500,
  forceMs = 5000,
  closeState,
  killWindowsProcessTree: killWindowsTree = killWindowsProcessTree
} = {}) {
  if (closeState && closeState.observed) {
    return
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    const exitedWaiter = createChildCloseWaiter(child, forceMs)
    if (closeState && closeState.observed) {
      exitedWaiter.cancel()
      return
    }
    const exitedResult = await exitedWaiter.promise
    if (!exitedResult.closed) {
      throw new Error(`Packaged client exit was observed without process close${closeErrorDetail(exitedResult)}`)
    }
    return
  }

  if (platform === 'win32') {
    if (!Number.isInteger(child.pid) || child.pid <= 0) {
      throw new Error('Packaged client has no valid process id for Windows process tree shutdown.')
    }

    const closeWaiter = createChildCloseWaiter(child, forceMs)
    try {
      await withTimeout(
        killWindowsTree(child.pid, forceMs),
        forceMs,
        'Packaged client process tree shutdown timed out.'
      )
    } catch (error) {
      closeWaiter.cancel()
      throw new Error(`Failed to close packaged client process tree: ${error.message}`)
    }

    const result = await closeWaiter.promise
    if (!result.closed) {
      throw new Error(`Packaged client process tree did not exit after force close${closeErrorDetail(result)}`)
    }
    return
  }

  const gracefulWaiter = createChildCloseWaiter(child, graceMs)
  let gracefulSent
  try {
    gracefulSent = child.kill()
  } catch (error) {
    gracefulWaiter.cancel()
    throw new Error(`Failed to send graceful shutdown signal: ${error.message}`)
  }
  if (!gracefulSent) {
    gracefulWaiter.cancel()
    throw new Error('Failed to send graceful shutdown signal.')
  }

  const gracefulResult = await gracefulWaiter.promise
  if (gracefulResult.closed) {
    return
  }

  const forcedWaiter = createChildCloseWaiter(child, forceMs)
  let forceSent
  try {
    forceSent = child.kill('SIGKILL')
  } catch (error) {
    forcedWaiter.cancel()
    throw new Error(`Failed to send force close signal: ${error.message}`)
  }
  if (!forceSent) {
    forcedWaiter.cancel()
    throw new Error('Failed to send force close signal.')
  }

  const forcedResult = await forcedWaiter.promise
  if (!forcedResult.closed) {
    throw new Error(`Packaged client did not exit after force close${closeErrorDetail(forcedResult)}`)
  }
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
  const closeState = { observed: false }
  child.once('close', () => {
    closeState.observed = true
  })

  const databasesReady = await waitForDatabases(paths, child)
  const runningAfterWait = child.exitCode === null && child.signalCode === null
  const result = {
    runningAfterWait,
    mainDbExists: fs.existsSync(paths.mainDbPath),
    dataDbExists: fs.existsSync(paths.dataDbPath),
    exitCode: child.exitCode
  }

  await stopChild(child, { closeState })

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
  killWindowsProcessTree,
  main,
  parseArgs,
  stopChild
}
