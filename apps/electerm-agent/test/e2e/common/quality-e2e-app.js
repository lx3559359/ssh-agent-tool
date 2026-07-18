const { promises: fs } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { once } = require('node:events')
const { promisify } = require('node:util')
const appOptions = require('./app-options')
const { acquireIsolatedApp, cleanupPreservingPrimaryError } = require('./isolated-electron-app')

const profilePrefix = 'shellpilot-quality-e2e-'
const execFileAsync = promisify(execFile)

function assertSafeQualityRoot (profileRoot) {
  const tempRoot = path.resolve(tmpdir()) + path.sep
  const resolved = path.resolve(profileRoot)
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith(profilePrefix)) {
    throw new Error('Refusing to use an unexpected quality E2E profile')
  }
  return resolved
}

function qualityLaunchOptions (profileRoot, env = {}) {
  const resolved = assertSafeQualityRoot(profileRoot)
  return {
    ...appOptions,
    env: {
      ...appOptions.env,
      ...env,
      APPDATA: resolved,
      LOCALAPPDATA: resolved,
      DATA_PATH: path.resolve(resolved, 'data')
    }
  }
}

async function cleanupQualityApp (electronApp, profileRoot) {
  if (electronApp) {
    await electronApp.close().catch(() => forceKillQualityApp(electronApp))
  }
  assertSafeQualityRoot(profileRoot)
  await fs.rm(profileRoot, { recursive: true, force: true })
}

async function forceKillQualityApp (electronApp) {
  const child = electronApp.process()
  if (child.exitCode !== null) return
  const exited = once(child, 'exit')
  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true
    }).catch(error => {
      if (child.exitCode === null) throw error
    })
  } else {
    child.kill('SIGKILL')
  }
  await exited
}

async function launchQualityApp (electron, options = {}) {
  const reusableProfileRoot = options.profileRoot
    ? assertSafeQualityRoot(options.profileRoot)
    : null
  const acquired = await acquireIsolatedApp({
    createProfileRoot: () => reusableProfileRoot || fs.mkdtemp(path.join(tmpdir(), profilePrefix)),
    validateProfileRoot: assertSafeQualityRoot,
    launch: root => electron.launch(qualityLaunchOptions(root, options.env)),
    readUserDataPath: app => app.evaluate(({ app }) => app.getPath('userData')),
    validateUserDataPath: (root, actualPath) => {
      const expected = path.resolve(root) + path.sep
      if (!path.resolve(actualPath).startsWith(expected)) {
        throw new Error('Electron ignored the isolated quality E2E profile')
      }
    },
    cleanup: cleanupQualityApp
  })
  const page = acquired.electronApp.windows()[0] || await acquired.electronApp.firstWindow()
  await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 30000 })
  return { ...acquired, page }
}

async function closeQualityRun (run, primaryError) {
  await cleanupPreservingPrimaryError(
    () => cleanupQualityApp(run?.electronApp, run?.profileRoot),
    primaryError
  )
}

module.exports = {
  assertSafeQualityRoot,
  cleanupQualityApp,
  closeQualityRun,
  forceKillQualityApp,
  launchQualityApp,
  qualityLaunchOptions
}
