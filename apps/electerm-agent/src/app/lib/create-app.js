const {
  app
} = require('electron')
const path = require('path')
const { createWindow } = require('./create-window')
const {
  appDisplayName,
  safeStorageAppName,
  isTest
} = require('../common/runtime-constants')
const { initCommandLine } = require('./command-line')
const globalState = require('./glob-state')
const {
  setupDeepLinkHandlers
} = require('./deep-link')
const { handleSingleInstance } = require('./single-instance')
const log = require('../common/log')
const {
  installProcessErrorLogging
} = require('./process-error-logging')
const {
  createPerformanceMetrics
} = require('./quality/performance-metrics')
const {
  createRecoverySnapshotManager
} = require('./quality/recovery-snapshot')

let conf = {}
const processStartedAt = Date.now()
const MEMORY_SAMPLE_INTERVAL_MS = 60 * 1000
const MEMORY_STABLE_DELAY_MS = 10 * 1000
let memoryTimer = null
let initialMemoryTimer = null

function toMb (workingSetSizeKb) {
  const value = Number(workingSetSizeKb)
  return Number.isFinite(value) && value >= 0
    ? Math.round((value / 1024) * 1000) / 1000
    : 0
}

async function sampleApplicationMemory (metrics) {
  try {
    const ownMemory = typeof process.getProcessMemoryInfo === 'function'
      ? await process.getProcessMemoryInfo()
      : {}
    const appMetrics = typeof app.getAppMetrics === 'function'
      ? app.getAppMetrics()
      : []
    const rendererKb = appMetrics
      .filter(item => item?.type === 'Tab')
      .reduce((sum, item) => sum + Number(item?.memory?.workingSetSize || 0), 0)
    const totalKb = appMetrics
      .reduce((sum, item) => sum + Number(item?.memory?.workingSetSize || 0), 0)
    metrics.recordMemory({
      mainMb: toMb(ownMemory.workingSetSize),
      rendererMb: toMb(rendererKb),
      totalMb: toMb(totalKb || ownMemory.workingSetSize)
    })
  } catch (error) {
    // Performance sampling must never affect application startup or shutdown.
  }
}

function startMemorySampling (metrics) {
  if (initialMemoryTimer || memoryTimer) return
  initialMemoryTimer = setTimeout(() => {
    initialMemoryTimer = null
    sampleApplicationMemory(metrics)
    memoryTimer = setInterval(
      () => sampleApplicationMemory(metrics),
      MEMORY_SAMPLE_INTERVAL_MS
    )
    memoryTimer.unref?.()
  }, MEMORY_STABLE_DELAY_MS)
  initialMemoryTimer.unref?.()
}

function stopPerformanceCollection (metrics) {
  if (initialMemoryTimer) clearTimeout(initialMemoryTimer)
  if (memoryTimer) clearInterval(memoryTimer)
  initialMemoryTimer = null
  memoryTimer = null
  try {
    metrics?.flush().catch(() => false)
  } catch (error) {}
}

// GPU error suggestion message
const GPU_ERROR_SUGGESTION = `
================================================================================
⚠️  GPU Process Error Detected
================================================================================
If you encounter GPU process crashes (exit_code=-2147483645 or similar),
try running electerm with one of these flags:

  1. --no-sandbox          (Recommended - run without sandbox)
  2. --disable-gpu        (Disable GPU rendering)
  3. --disable-gpu-sandbox (Disable GPU sandbox)
  4. --disable-hardware-acceleration

Or set environment variable:
  set DISABLE_GPU=1

Example:
  electerm.exe --no-sandbox
  or
  set DISABLE_GPU=1 && electerm.exe
================================================================================
`

installProcessErrorLogging({
  app,
  log,
  gpuSuggestion: GPU_ERROR_SUGGESTION,
  onAbnormalExit: reason => {
    globalState.get('recoverySnapshot')?.markAbnormalSync(reason)
  }
})

exports.createApp = async function () {
  // Keep the legacy internal app name so Electron safeStorage can decrypt
  // API keys and SSH settings saved before the ShellPilot rebrand.
  app.setName(safeStorageAppName)
  let performanceStoragePath = ''
  try {
    performanceStoragePath = path.join(
      app.getPath('userData'),
      'quality',
      'performance-metrics.json'
    )
  } catch (error) {}
  const performanceMetrics = createPerformanceMetrics({
    storagePath: performanceStoragePath,
    logger: log
  })
  performanceMetrics.mark('app_start', processStartedAt)
  globalState.set('performanceMetrics', performanceMetrics)
  let recoveryStoragePath = ''
  try {
    recoveryStoragePath = path.join(
      app.getPath('userData'),
      'quality',
      'recovery-snapshot.json'
    )
  } catch (error) {}
  const recoverySnapshot = createRecoverySnapshotManager({
    storagePath: recoveryStoragePath,
    logger: log
  })
  recoverySnapshot.initialize()
  globalState.set('recoverySnapshot', recoverySnapshot)
  app.once('before-quit', () => {
    stopPerformanceCollection(performanceMetrics)
    recoverySnapshot.markCleanExitSync()
  })
  const { getUserConfigNoEnc, getDbConfig } = require('./get-config')
  // Set desktop name so Linux taskbars (e.g. UOS/Deepin dde-dock) can match
  // the window to the .desktop file embedded in the AppImage.
  if (process.platform === 'linux' && app.setDesktopName) {
    app.setDesktopName(appDisplayName)
  }
  // Handle GPU issues on Linux
  // On Linux, disable GPU for compatibility
  if (process.platform === 'linux' || process.env.DISABLE_GPU) {
    app.commandLine.appendSwitch('--disable-gpu')
  }
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('--enable-transparent-visuals')
    app.commandLine.appendSwitch('--in-process-gpu')
  }
  if (process.platform === 'linux' || process.env.DISABLE_HARDWARE_ACCELERATION) {
    app.disableHardwareAcceleration()
  }
  if (process.env.DISABLE_GPU_SANDBOX) {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('--disable-gpu')
    app.commandLine.appendSwitch('--disable-gpu-compositing')
    app.commandLine.appendSwitch('--disable-gpu-rasterization')
    app.commandLine.appendSwitch('--disable-gpu-sandbox')
    app.commandLine.appendSwitch('--disable-software-rasterizer')
    app.commandLine.appendSwitch('--use-gl', 'swiftshader')
  }
  // Handle proxy-related command-line arguments
  if (process.env.NO_PROXY_SERVER) {
    app.commandLine.appendSwitch('no-proxy-server')
  }
  if (process.env.PROXY_BYPASS_LIST) {
    app.commandLine.appendSwitch('proxy-bypass-list', process.env.PROXY_BYPASS_LIST)
  }
  if (process.env.PROXY_PAC_URL) {
    app.commandLine.appendSwitch('proxy-pac-url', process.env.PROXY_PAC_URL)
  }
  if (process.env.PROXY_SERVER) {
    app.commandLine.appendSwitch('proxy-server', process.env.PROXY_SERVER)
  }

  const progs = initCommandLine()
  const opts = progs?.options
  globalState.set('serverPort', opts?.serverPort)

  const { allowMultiInstance = false } = await getUserConfigNoEnc()

  // Setup deep link handlers (open-url for macOS, etc.)
  setupDeepLinkHandlers()
  // Only request single instance lock if multi-instance is not allowed
  if (!allowMultiInstance && !isTest) {
    // Use socket-based single instance lock for compatibility with Electron 22
    // where additionalData doesn't work in the second-instance event
    const isPrimaryInstance = await handleSingleInstance(progs)

    if (!isPrimaryInstance) {
      app.quit()
      return app
    }

    // Also use Electron's built-in lock as a fallback
    app.requestSingleInstanceLock()
  }

  app.on('second-instance', (event, commandLine) => {
    const newWindowFlag = commandLine.includes('--new-window')
    if (newWindowFlag) {
      createWindow(conf)
      return
    }
    const win = globalState.get('win')
    if (win) {
      if (win.isMinimized()) {
        win.restore()
      }
      win.focus()
    }
  })
  app.whenReady().then(async () => {
    conf = await getDbConfig()
    createWindow(conf)
    startMemorySampling(performanceMetrics)
  })
  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (globalState.get('win') === null) {
      app.once('ready', () => createWindow(conf))
    }
  })
  return app
}
