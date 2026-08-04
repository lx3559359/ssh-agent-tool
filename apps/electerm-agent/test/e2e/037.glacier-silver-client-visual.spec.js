const { promises: fs } = require('fs')
const { tmpdir } = require('os')
const { join, resolve, sep } = require('path')
const { _electron: electron, test, expect } = require('@playwright/test')
const appOptions = require('./common/app-options')
const {
  acquireIsolatedApp,
  cleanupPreservingPrimaryError
} = require('./common/isolated-electron-app')

const profilePrefix = 'shellpilot-glacier-visual-'
const screenshotDir = resolve(
  process.cwd(),
  'test-results',
  'glacier-silver-consistency-qa'
)

test.setTimeout(2 * 60 * 1000)

function assertSafeProfileRoot (profileRoot) {
  const tempRoot = resolve(tmpdir()) + sep
  if (!profileRoot.startsWith(tempRoot) || !profileRoot.includes(profilePrefix)) {
    throw new Error(`Refusing to use unexpected Glacier visual profile: ${profileRoot}`)
  }
}

function launchOptions (profileRoot) {
  return {
    ...appOptions,
    env: {
      ...appOptions.env,
      APPDATA: profileRoot,
      LOCALAPPDATA: profileRoot,
      DATA_PATH: resolve(profileRoot, 'data')
    }
  }
}

async function closeIsolatedApp (electronApp, profileRoot) {
  if (electronApp) {
    await electronApp.close().catch(() => electronApp.process().kill())
  }
  assertSafeProfileRoot(profileRoot)
  await fs.rm(profileRoot, { recursive: true, force: true })
}

async function runWithIsolatedApp (callback) {
  const acquired = await acquireIsolatedApp({
    createProfileRoot: () => fs.mkdtemp(resolve(tmpdir(), profilePrefix)),
    validateProfileRoot: assertSafeProfileRoot,
    launch: root => electron.launch(launchOptions(root)),
    readUserDataPath: (app, root) => resolve(root, 'data', 'electron-user-data'),
    validateUserDataPath: (root, actualPath) => {
      if (!resolve(actualPath).startsWith(resolve(root) + sep)) {
        throw new Error(`Electron ignored isolated Glacier profile: ${actualPath}`)
      }
    },
    cleanup: closeIsolatedApp
  })
  let primaryError
  try {
    await callback(acquired.electronApp)
  } catch (error) {
    primaryError = error
  }
  await cleanupPreservingPrimaryError(
    () => closeIsolatedApp(acquired.electronApp, acquired.profileRoot),
    primaryError
  )
  if (primaryError) throw primaryError
}

async function inspectShell (page) {
  return page.evaluate(() => {
    const style = selector => window.getComputedStyle(document.querySelector(selector))
    const topbar = style('.aigshell-topbar')
    const actions = style('.aigshell-topbar-actions')
    const controls = style('.window-controls')
    const card = style('.no-session-action:not(.no-session-action-primary)')
    const themeButton = document.querySelector('.aigshell-topbar-action[data-action-key="theme"]')
    themeButton.focus()
    const focused = window.getComputedStyle(themeButton)
    return {
      theme: window.store.config.theme,
      terminalTheme: window.store.config.terminalTheme,
      topbarBackground: topbar.backgroundImage,
      actionsBackground: actions.backgroundColor,
      controlsBackground: controls.backgroundColor,
      cardBackground: card.backgroundImage,
      focus: {
        outlineStyle: focused.outlineStyle,
        outlineWidth: focused.outlineWidth,
        boxShadow: focused.boxShadow
      },
      overflow: {
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - window.innerWidth
      }
    }
  })
}

async function inspectDenseFixtures (page) {
  return page.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'glacier-dense-fixtures'
    host.innerHTML = `
      <div class="sftp-item">file.txt</div>
      <div class="batch-op-log-entry">log</div>
      <div class="agent-task-output"><pre>output</pre></div>
      <div class="ai-file-change-review-diff"><pre>diff</pre></div>
      <div class="rdp-scroll-wrapper"><canvas></canvas></div>
    `
    document.body.appendChild(host)
    const snapshot = selector => {
      const computed = window.getComputedStyle(document.querySelector(selector))
      return {
        backgroundImage: computed.backgroundImage,
        boxShadow: computed.boxShadow,
        filter: computed.filter
      }
    }
    const result = {
      terminal: snapshot('.term-wrap'),
      xterm: snapshot('.xterm'),
      sftp: snapshot('#glacier-dense-fixtures .sftp-item'),
      log: snapshot('#glacier-dense-fixtures .batch-op-log-entry'),
      task: snapshot('#glacier-dense-fixtures .agent-task-output pre'),
      diff: snapshot('#glacier-dense-fixtures .ai-file-change-review-diff pre'),
      remoteCanvas: snapshot('#glacier-dense-fixtures canvas')
    }
    host.remove()
    return result
  })
}

async function setWindowSize (electronApp, page, width, height) {
  await electronApp.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.webContents.setZoomFactor(1)
    window.setContentSize(size.width, size.height)
  }, { width, height })
  await expect.poll(() => page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))).toEqual({ width, height })
}

async function captureQaState (page, name) {
  await page.screenshot({
    path: join(screenshotDir, `${name}.png`),
    animations: 'disabled',
    caret: 'hide',
    scale: 'css'
  })
}

async function resetQaSurfaces (page) {
  await page.evaluate(() => {
    const store = window.store
    store.closeFleetStatus()
    store.closeArtifactWorkspace()
    store.closeIncidentArchiveWorkspace()
    store.closeOperationsToolkit()
    store.setOpenedSideBar('')
    store.openQuickCommandBar = false
    store.pinnedQuickCommandBar = false
  })
}

test('Glacier and Graphite Silver preserve the approved shell and dense-surface hierarchy', async () => {
  await runWithIsolatedApp(async electronApp => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await expect(page.locator('.aigshell-topbar')).toBeVisible()
    await expect(page.locator('.no-session-action:not(.no-session-action-primary)').first()).toBeVisible()

    const glacier = await inspectShell(page)
    expect(glacier.theme).toBe('shellpilot-glacier')
    expect(glacier.terminalTheme).toBe('default')
    expect(glacier.topbarBackground).toMatch(/linear-gradient\(100deg/)
    expect(glacier.topbarBackground).toContain('rgb(48, 98, 144)')
    expect(glacier.topbarBackground).toContain('rgb(64, 88, 142)')
    expect(glacier.topbarBackground).toContain('rgb(85, 71, 166)')
    expect(glacier.actionsBackground).toBe('rgba(0, 0, 0, 0)')
    expect(glacier.controlsBackground).toBe('rgba(0, 0, 0, 0)')
    expect(glacier.cardBackground).toContain('radial-gradient')
    expect(glacier.cardBackground).toContain('linear-gradient')
    expect(glacier.cardBackground).toContain('rgb(248, 251, 253)')
    expect(glacier.cardBackground).toContain('rgb(231, 238, 244)')
    expect(glacier.cardBackground).toContain('rgb(216, 228, 236)')
    expect(
      glacier.focus.outlineStyle !== 'none' || glacier.focus.boxShadow !== 'none',
      JSON.stringify(glacier.focus)
    ).toBe(true)
    expect(glacier.overflow.document).toBeLessThanOrEqual(1)
    expect(glacier.overflow.body).toBeLessThanOrEqual(1)

    await page.locator('.aigshell-topbar-action[data-action-key="theme"]').click()
    await expect.poll(() => page.evaluate(() => window.store.config.theme))
      .toBe('shellpilot-graphite-silver')
    expect(await page.evaluate(() => window.store.config.terminalTheme)).toBe('default')
    const graphite = await inspectShell(page)
    expect(graphite.cardBackground).toContain('rgb(43, 55, 69)')
    expect(graphite.cardBackground).toContain('rgb(32, 42, 55)')
    expect(graphite.cardBackground).toContain('rgb(23, 33, 44)')
    expect(graphite.overflow.document).toBeLessThanOrEqual(1)
    expect(graphite.overflow.body).toBeLessThanOrEqual(1)

    await page.locator('.aigshell-topbar-action[data-action-key="theme"]').click()
    await expect.poll(() => page.evaluate(() => window.store.config.theme))
      .toBe('shellpilot-glacier')
    expect(await page.evaluate(() => window.store.config.terminalTheme)).toBe('default')

    await page.locator('.add-new-tab-btn').click()
    await expect(page.locator('.term-wrap:visible')).toBeVisible()
    await expect(page.locator('.xterm:visible')).toBeVisible()
    const dense = await inspectDenseFixtures(page)
    for (const [name, style] of Object.entries(dense)) {
      expect(style.backgroundImage, `${name}: ${JSON.stringify(style)}`).toBe('none')
      expect(style.boxShadow, `${name}: ${JSON.stringify(style)}`).toBe('none')
    }
    expect(dense.remoteCanvas.filter).toBe('none')
  })
})

test('captures the seven approved Glacier surfaces and paired Graphite state at 1920x1080', async () => {
  await runWithIsolatedApp(async electronApp => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await fs.rm(screenshotDir, { recursive: true, force: true })
    await fs.mkdir(screenshotDir, { recursive: true })
    await setWindowSize(electronApp, page, 1920, 1080)

    await page.evaluate(() => {
      const store = window.store
      store.setConfig({ ...store.config, language: 'zh_cn' })
      store.setTheme('shellpilot-glacier')
      store.setBookmarks([{
        id: 'glacier-qa-server',
        type: 'ssh',
        title: 'VPS-1',
        host: '192.0.2.10',
        port: 22,
        username: 'root',
        tags: ['qa']
      }])
      store.setBookmarkGroups([{
        id: 'default',
        title: 'default',
        bookmarkIds: ['glacier-qa-server'],
        bookmarkGroupIds: []
      }])
      store.rightPanelVisible = true
      store.rightPanelPinned = true
      store.rightPanelTab = 'ai'
    })

    await expect(page.locator('.no-sessions')).toBeVisible()
    await expect(page.locator('.right-side-panel')).toBeVisible()
    await captureQaState(page, '01-home-glacier')

    await page.evaluate(() => window.store.openFleetStatus())
    await expect(page.locator('.fleet-status-workspace-active')).toBeVisible()
    await expect(page.locator('.fleet-status-toolbar')).toBeVisible()
    await captureQaState(page, '02-fleet-glacier')

    await resetQaSurfaces(page)
    await page.evaluate(() => window.store.openArtifactWorkspace())
    await expect(page.locator('.artifact-workspace-active')).toBeVisible()
    await expect(page.locator('.artifact-list-filters')).toBeVisible()
    await captureQaState(page, '03-artifacts-glacier')

    await resetQaSurfaces(page)
    await page.evaluate(() => window.store.openIncidentArchiveWorkspace())
    await expect(page.locator('.incident-workspace-active')).toBeVisible()
    await expect(page.locator('.incident-list-toolbar')).toBeVisible()
    await captureQaState(page, '04-incidents-glacier')

    await resetQaSurfaces(page)
    await page.evaluate(() => {
      window.store.handleSidebarPanelTab('bookmarks')
      window.store.setOpenedSideBar('bookmarks')
    })
    await expect(page.locator('.sidebar-panel.bookmarks-panel')).toBeVisible()
    await expect(page.locator('.tree-list-action-toolbar')).toBeVisible()
    await captureQaState(page, '05-server-sidebar-glacier')

    await resetQaSurfaces(page)
    await page.evaluate(() => window.store.openOperationsToolkit('quick'))
    await expect(page.locator('.operations-toolkit-workspace')).toBeVisible()
    await expect(page.locator('.qm-wrap-embedded')).toBeVisible()
    await captureQaState(page, '06-operations-quick-glacier')

    await page.evaluate(() => window.store.openOperationsToolkit('diagnostic'))
    await expect(page.locator('.operations-tool-list')).toBeVisible()
    await expect(page.locator('.operations-tool-list > button')).toHaveCount(24)
    await captureQaState(page, '07-operations-diagnostic-glacier')

    await resetQaSurfaces(page)
    await page.evaluate(() => window.store.setTheme('shellpilot-graphite-silver'))
    await expect.poll(() => page.evaluate(() => window.store.config.theme))
      .toBe('shellpilot-graphite-silver')
    await captureQaState(page, '08-home-graphite')
  })
})
