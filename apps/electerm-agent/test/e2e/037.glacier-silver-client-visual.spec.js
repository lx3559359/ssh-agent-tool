const { promises: fs } = require('fs')
const { tmpdir } = require('os')
const { resolve, sep } = require('path')
const { _electron: electron, test, expect } = require('@playwright/test')
const appOptions = require('./common/app-options')
const {
  acquireIsolatedApp,
  cleanupPreservingPrimaryError
} = require('./common/isolated-electron-app')

const profilePrefix = 'shellpilot-glacier-visual-'

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
    expect(glacier.cardBackground).toContain('rgb(246, 250, 252)')
    expect(glacier.cardBackground).toContain('rgb(234, 241, 246)')
    expect(glacier.cardBackground).toContain('rgb(220, 230, 238)')
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
    expect(graphite.cardBackground).toContain('rgb(42, 53, 67)')
    expect(graphite.cardBackground).toContain('rgb(32, 42, 55)')
    expect(graphite.cardBackground).toContain('rgb(24, 33, 44)')
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
