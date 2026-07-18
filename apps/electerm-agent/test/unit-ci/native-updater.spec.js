const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.resolve(__dirname, '../..')

test('package includes electron-updater for in-client differential updates', () => {
  const pack = require(path.join(root, 'package.json'))
  assert.ok(
    pack.dependencies['electron-updater'],
    'electron-updater must be a runtime dependency, not a manual installer helper'
  )
})

test('main updater service uses native autoUpdater behind release approval', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/app/lib/native-updater.js'),
    'utf8'
  )

  assert.match(source, /require\('electron-updater'\)/)
  assert.match(source, /autoDownload\s*=\s*false/)
  assert.match(source, /aigshell-update\.json/)
  assert.match(source, /publishApproved/)
  assert.match(source, /checkForUpdates/)
  assert.match(source, /downloadUpdate/)
  assert.match(source, /quitAndInstall\(true,\s*true\)/)
})

test('windows nsis installer lets first-time users choose an installation directory', () => {
  const config = require(path.join(root, 'build/electron-builder.json'))

  assert.equal(config.nsis.oneClick, false)
  assert.equal(config.nsis.allowToChangeInstallationDirectory, true)
})

test('windows nsis build refreshes the effective electron-builder config before packaging', () => {
  const source = fs.readFileSync(
    path.join(root, 'build/bin/build-win-nsis.js'),
    'utf8'
  )

  assert.match(source, /prepareElectronBuilderConfig/)
  assert.match(source, /prepareElectronBuilderConfig\(\)/)
})

test('renderer upgrade panel defaults to native updater instead of installer mirror download', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/components/main/upgrade.jsx'),
    'utf8'
  )

  assert.match(source, /nativeUpdateCheck/)
  assert.match(source, /nativeUpdateDownload/)
  assert.match(source, /nativeUpdateInstall/)
  assert.doesNotMatch(source, /renderMirrorSelector\(\)/)
  assert.doesNotMatch(source, /<Space\.Compact>/)
})

test('ipc exposes native update operations to the renderer', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/app/lib/ipc.js'),
    'utf8'
  )

  assert.match(source, /nativeUpdateCheck/)
  assert.match(source, /nativeUpdateDownload/)
  assert.match(source, /nativeUpdateInstall/)
})

test('native updater records check and download terminal events with an optional renderer trace', async () => {
  const updaterPath = path.join(root, 'src/app/lib/native-updater.js')
  const originalLoad = Module._load
  const events = []
  const log = {
    info: () => {},
    warn: () => {},
    recordQualityEvent: (context, event) => {
      events.push({ context, event })
      return true
    }
  }
  const autoUpdater = {
    on: () => {},
    setFeedURL: () => {},
    checkForUpdates: async () => {},
    downloadUpdate: async () => {},
    quitAndInstall: () => {}
  }
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          isPackaged: false,
          getPath: () => process.cwd()
        }
      }
    }
    if (request === 'electron-updater') return { autoUpdater }
    if (parent?.filename === updaterPath && request === '../common/log') return log
    if (parent?.filename === updaterPath && request === '../common/app-props') {
      return {
        isWin: false,
        isMac: false,
        isArm: false,
        packInfo: { version: '0.0.0' }
      }
    }
    if (parent?.filename === updaterPath && request === '../common/update-sources') {
      return {
        appendUpdateCacheBuster: value => value,
        getUpdateReleaseSources: () => [],
        githubFeedConfig: { provider: 'generic', url: 'https://updates.invalid' }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  delete require.cache[require.resolve(updaterPath)]

  try {
    const updater = require(updaterPath)
    const traceContext = {
      traceId: 'sp-1784304000000-12345678',
      requestId: 'update-request-id'
    }
    const check = await updater.nativeUpdateCheck({}, traceContext)
    const download = await updater.nativeUpdateDownload({}, traceContext)

    assert.equal(check.status, 'unsupported')
    assert.equal(download.status, 'unsupported')
    assert.deepEqual(events.map(entry => ({
      traceId: entry.context.traceId,
      requestId: entry.context.requestId,
      action: entry.event.action,
      phase: entry.event.phase,
      result: entry.event.result
    })), [
      {
        traceId: traceContext.traceId,
        requestId: traceContext.requestId,
        action: 'check',
        phase: 'started',
        result: undefined
      },
      {
        traceId: traceContext.traceId,
        requestId: traceContext.requestId,
        action: 'check',
        phase: 'completed',
        result: 'unsupported'
      },
      {
        traceId: traceContext.traceId,
        requestId: traceContext.requestId,
        action: 'download',
        phase: 'started',
        result: undefined
      },
      {
        traceId: traceContext.traceId,
        requestId: traceContext.requestId,
        action: 'download',
        phase: 'completed',
        result: 'unsupported'
      }
    ])
  } finally {
    Module._load = originalLoad
    delete require.cache[require.resolve(updaterPath)]
  }
})

test('native updater install closes notDownloaded and installing traces exactly once', () => {
  const updaterPath = path.join(root, 'src/app/lib/native-updater.js')
  const originalLoad = Module._load
  const events = []
  const handlers = new Map()
  let installCalls = 0
  const log = {
    info: () => {},
    warn: () => {},
    recordQualityEvent: (context, event) => {
      events.push({ context, event })
      return true
    }
  }
  const autoUpdater = {
    on: (event, handler) => handlers.set(event, handler),
    setFeedURL: () => {},
    checkForUpdates: async () => {},
    downloadUpdate: async () => {},
    quitAndInstall: () => { installCalls += 1 }
  }
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          isPackaged: false,
          getPath: () => process.cwd()
        }
      }
    }
    if (request === 'electron-updater') return { autoUpdater }
    if (parent?.filename === updaterPath && request === '../common/log') return log
    if (parent?.filename === updaterPath && request === '../common/app-props') {
      return {
        isWin: false,
        isMac: false,
        isArm: false,
        packInfo: { version: '0.0.0' }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  delete require.cache[require.resolve(updaterPath)]

  try {
    const updater = require(updaterPath)
    const parentTrace = {
      traceId: 'sp-1784304000000-87654321',
      action: 'upgrade'
    }
    const notDownloaded = updater.nativeUpdateInstall(parentTrace)

    updater.configureNativeUpdater()
    handlers.get('update-downloaded')({ version: '1.2.3' })
    const installing = updater.nativeUpdateInstall(parentTrace)

    assert.equal(notDownloaded.status, 'notDownloaded')
    assert.equal(installing.status, 'installing')
    assert.equal(installCalls, 1)
    assert.deepEqual(events.map(entry => ({
      traceId: entry.context.traceId,
      action: entry.event.action,
      phase: entry.event.phase,
      result: entry.event.result
    })), [
      {
        traceId: parentTrace.traceId,
        action: 'install',
        phase: 'started',
        result: undefined
      },
      {
        traceId: parentTrace.traceId,
        action: 'install',
        phase: 'completed',
        result: 'notDownloaded'
      },
      {
        traceId: parentTrace.traceId,
        action: 'install',
        phase: 'started',
        result: undefined
      },
      {
        traceId: parentTrace.traceId,
        action: 'install',
        phase: 'completed',
        result: 'installing'
      }
    ])
  } finally {
    Module._load = originalLoad
    delete require.cache[require.resolve(updaterPath)]
  }
})

test('renderer delegates native updater lifecycle and closes renderer-only early returns', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/components/main/upgrade.jsx'),
    'utf8'
  )
  const doUpgrade = source.slice(
    source.indexOf('doUpgrade ='),
    source.indexOf('clearNativeUpdatePoll =')
  )
  const getLatestRelease = source.slice(
    source.indexOf('getLatestRelease ='),
    source.indexOf('renderError =')
  )

  assert.ok(
    doUpgrade.indexOf('const traceContext = createTraceContext') <
      doUpgrade.indexOf('if (this.props.upgradeInfo.upgradeReady)')
  )
  assert.match(doUpgrade, /'nativeUpdateInstall',\s*traceContext/)
  assert.doesNotMatch(doUpgrade, /finishedActions|finishAction|activeAction/)

  const npmBranch = doUpgrade.slice(
    doUpgrade.indexOf("installSrc === 'npm'"),
    doUpgrade.indexOf('this.changeProps')
  )
  assert.match(npmBranch, /action:\s*'install'[\s\S]*phase:\s*'started'/)
  assert.match(npmBranch, /phase:\s*'completed'[\s\S]*result:\s*'npm'/)
  assert.match(npmBranch, /phase:\s*'failed'[\s\S]*result:\s*'failed'/)

  assert.ok(
    getLatestRelease.indexOf('const traceContext = createTraceContext') <
      getLatestRelease.indexOf('if (checkSkipSrc(installSrc))')
  )
  const skipped = getLatestRelease.slice(
    getLatestRelease.indexOf('if (checkSkipSrc(installSrc))'),
    getLatestRelease.indexOf('const checkingMessage')
  )
  assert.match(skipped, /phase:\s*'completed'/)
  assert.match(skipped, /result:\s*'skipped'/)
})
