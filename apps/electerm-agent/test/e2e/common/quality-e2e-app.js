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
  const appData = path.resolve(resolved, 'AppData', 'Roaming')
  const localAppData = path.resolve(resolved, 'AppData', 'Local')
  return {
    ...appOptions,
    env: {
      ...appOptions.env,
      ...env,
      HOME: resolved,
      USERPROFILE: resolved,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
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
    let taskkillError
    await execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true
    }).catch(error => {
      taskkillError = error
    })
    if (child.exitCode === null && taskkillError) {
      await Promise.race([
        exited,
        new Promise(resolve => setTimeout(resolve, 2000))
      ])
    }
    if (child.exitCode === null) {
      child.kill('SIGKILL')
    }
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
    launch: async root => {
      const launchOptions = qualityLaunchOptions(root, options.env)
      await Promise.all([
        fs.mkdir(launchOptions.env.APPDATA, { recursive: true }),
        fs.mkdir(launchOptions.env.LOCALAPPDATA, { recursive: true }),
        fs.mkdir(path.resolve(root, '.ssh'), { recursive: true })
      ])
      return electron.launch(launchOptions)
    },
    // Playwright's main-process evaluate context is transient with newer
    // Electron releases. NODE_TEST + DATA_PATH deterministically controls
    // userData through common/user-data-path.js, so validate that contract
    // without racing the inspector context during startup.
    readUserDataPath: (app, root) => path.resolve(root, 'data', 'electron-user-data'),
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
