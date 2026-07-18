const { promises: fs } = require('fs')
const { tmpdir } = require('os')
const { resolve, sep } = require('path')
const { _electron: electron, test, expect } = require('@playwright/test')
const appOptions = require('./common/app-options')
const {
  acquireIsolatedApp,
  cleanupPreservingPrimaryError
} = require('./common/isolated-electron-app')

const profilePrefix = 'shellpilot-fleet-status-'
const viewportCases = [
  { width: 1440, height: 900, zoom: 1, theme: 'default', mode: 'dark' },
  { width: 1920, height: 1080, zoom: 1, theme: 'defaultLight', mode: 'light' },
  { width: 1440, height: 900, zoom: 1.25, theme: 'default', mode: 'dark-125' }
]

test.setTimeout(180000)

function assertSafeProfileRoot (profileRoot) {
  const tempRoot = resolve(tmpdir()) + sep
  if (!profileRoot.startsWith(tempRoot) || !profileRoot.includes(profilePrefix)) {
    throw new Error(`Refusing to use unexpected fleet profile: ${profileRoot}`)
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
    readUserDataPath: app => app.evaluate(({ app }) => app.getPath('userData')),
    validateUserDataPath: (root, actualPath) => {
      if (!resolve(actualPath).startsWith(resolve(root) + sep)) {
        throw new Error(`Electron ignored isolated fleet profile: ${actualPath}`)
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

async function setWindowCase (electronApp, page, viewport) {
  await electronApp.evaluate(({ BrowserWindow }, value) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setContentSize(value.width, value.height)
    window.webContents.setZoomFactor(value.zoom)
  }, viewport)
  await expect.poll(() => page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))).toEqual({
    width: Math.round(viewport.width / viewport.zoom),
    height: Math.round(viewport.height / viewport.zoom)
  })
}

async function dismissStartupModals (page) {
  const modal = page.locator('.custom-modal-container:visible')
  for (let attempt = 0; attempt < 4 && await modal.count(); attempt += 1) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    if (!await modal.count()) break
    const close = modal.locator('.custom-modal-close:visible').last()
    if (await close.count()) await close.click()
  }
  await expect(modal).toHaveCount(0)
}

function bookmarks () {
  const ssh = Array.from({ length: 8 }, (_, index) => ({
    id: `fleet-e2e-${index + 1}`,
    type: index === 0 ? undefined : 'ssh',
    title: index === 0 ? 'Fleet Unique Edge' : `Fleet Server ${index + 1}`,
    host: `10.20.0.${index + 1}`,
    port: 22,
    username: 'fleet-user',
    tags: index === 0 ? ['unique-edge'] : ['fleet']
  }))
  return [
    ...ssh,
    { id: 'fleet-telnet', type: 'telnet', title: 'Excluded Telnet', host: '10.30.0.1', port: 23 },
    { id: 'fleet-local', type: 'local', title: 'Excluded Local' }
  ]
}

async function installFleetFixture (page) {
  await page.evaluate((items) => {
    const store = window.store
    const success = (target, provider = 'nftables') => ({
      target: { id: target.id },
      status: 'success',
      probes: [
        {
          id: 'system',
          status: 'success',
          data: { uptimeSeconds: 86400 + Number(target.id.split('-').at(-1) || 0) }
        },
        {
          id: 'resources',
          status: 'success',
          data: {
            cpu: { usedPercent: 23 },
            memory: { totalBytes: 1000, availableBytes: 420 },
            filesystems: [{ mount: '/', usedPercent: 61 }],
            load: { one: 0.42 }
          }
        },
        {
          id: 'network',
          status: 'success',
          data: { interfaces: [{ name: 'eth0', addresses: [`${target.connection.host}/24`] }] }
        },
        {
          id: 'firewall',
          status: 'success',
          data: { provider, enabled: true }
        }
      ]
    })

    window.__fleetFixture = {
      mode: 'complete',
      cancelCalls: 0,
      pending: new Map()
    }
    window.wsFetch = payload => {
      if (payload.action === 'cancel-fleet-status') {
        window.__fleetFixture.cancelCalls += 1
        const pending = window.__fleetFixture.pending.get(payload.taskId)
        if (pending) {
          setTimeout(() => pending.resolve({
            taskId: payload.taskId,
            status: 'completed',
            results: pending.payload.targets.map(target => success(target, 'late-result'))
          }), 0)
        }
        return Promise.resolve({ taskId: payload.taskId, cancelled: true })
      }
      if (window.__fleetFixture.mode === 'pending') {
        return new Promise(resolve => {
          window.__fleetFixture.pending.set(payload.taskId, { payload, resolve })
        })
      }
      return Promise.resolve({
        taskId: payload.taskId,
        status: 'completed',
        results: [...payload.targets].reverse().map(target => success(target))
      })
    }
    store.setBookmarks(items)
    store.setBookmarkGroups([{
      id: 'default',
      title: 'Fleet E2E',
      bookmarkIds: items.map(item => item.id),
      bookmarkGroupIds: []
    }])
    store.rightPanelVisible = true
    store.rightPanelPinned = true
    store.rightPanelTab = 'ai'
    store.openFleetStatus()
  }, bookmarks())

  await expect(page.locator('.fleet-status-workspace-active')).toBeVisible()
  await expect(page.locator('.right-side-panel')).toBeVisible()
  await expect(page.locator('.fleet-status-bookmark-count strong')).toHaveText('8')
  await page.locator('.fleet-status-toolbar button').filter({ hasText: '刷新' }).click()
  await expect(page.locator('.fleet-status-table tbody tr')).toHaveCount(8)
}

test('real fleet workspace preserves AI panel, scrolling and interactions across viewports and themes', async () => {
  await runWithIsolatedApp(async electronApp => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
    await dismissStartupModals(page)
    await installFleetFixture(page)

    const search = page.locator('.fleet-status-search input')
    await search.fill('unique-edge')
    await expect(page.locator('.fleet-status-table tbody tr')).toHaveCount(1)
    await expect(page.locator('.fleet-status-name-cell strong')).toHaveText('Fleet Unique Edge')
    await search.fill('')
    await expect(page.locator('.fleet-status-table tbody tr')).toHaveCount(8)

    await page.getByRole('checkbox', { name: '选择 Fleet Unique Edge' }).check()
    const batchBar = page.locator('.fleet-status-batch-bar')
    await expect(batchBar).toBeVisible()
    const checkServices = batchBar.getByRole('button', { name: /检查服务/ })
    const aiDiagnose = batchBar.getByRole('button', { name: /AI 批量诊断/ })
    await expect(checkServices).toBeEnabled()
    await expect(aiDiagnose).toBeEnabled()
    await expect(page.locator('.ai-chat-container')).toBeVisible()
    await aiDiagnose.click()
    await expect(page.locator('.ai-chat-textarea')).toContainText('Fleet Unique Edge')
    await page.getByRole('button', { name: '清除选择' }).click()
    await expect(batchBar).toHaveCount(0)

    await page.evaluate(() => { window.__fleetFixture.mode = 'pending' })
    await page.getByRole('button', { name: '重新采集 Fleet Unique Edge' }).click()
    const cancel = page.locator('.fleet-status-toolbar button').filter({ hasText: '取消' })
    await expect(cancel).toBeEnabled()
    await cancel.click()
    await expect(cancel).toBeDisabled()
    await expect.poll(() => page.evaluate(() => window.__fleetFixture.cancelCalls)).toBe(1)

    const backgrounds = {}
    for (const viewport of viewportCases) {
      await page.evaluate(theme => window.store.setTheme(theme), viewport.theme)
      await expect.poll(() => page.evaluate(() => window.store.config.theme)).toBe(viewport.theme)
      await setWindowCase(electronApp, page, viewport)

      const metrics = await page.evaluate(() => {
        const workspace = document.querySelector('.fleet-status-workspace-active')
        const panel = document.querySelector('.right-side-panel')
        const scroll = document.querySelector('.fleet-status-table-scroll')
        const cell = document.querySelector('.fleet-status-table tbody td:nth-child(4)')
        scroll.scrollLeft = scroll.scrollWidth
        const workspaceRect = workspace.getBoundingClientRect()
        const panelRect = panel.getBoundingClientRect()
        const cellStyle = window.getComputedStyle(cell)
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          workspaceRect: workspaceRect.toJSON(),
          panelRect: panelRect.toJSON(),
          tableClientWidth: scroll.clientWidth,
          tableScrollWidth: scroll.scrollWidth,
          tableScrollLeft: scroll.scrollLeft,
          overflowX: window.getComputedStyle(scroll).overflowX,
          writingMode: cellStyle.writingMode,
          whiteSpace: cellStyle.whiteSpace,
          cellWidth: cell.getBoundingClientRect().width,
          cellHeight: cell.getBoundingClientRect().height,
          background: window.getComputedStyle(workspace).backgroundColor
        }
      })
      const context = JSON.stringify({ viewport, metrics })
      expect(metrics.workspaceRect.width, context).toBeGreaterThan(300)
      expect(metrics.panelRect.width, context).toBeGreaterThanOrEqual(320)
      expect(metrics.workspaceRect.right, context).toBeLessThanOrEqual(metrics.panelRect.left + 1)
      expect(metrics.workspaceRect.bottom, context).toBeLessThanOrEqual(metrics.viewportHeight + 1)
      expect(metrics.tableScrollWidth, context).toBeGreaterThan(metrics.tableClientWidth)
      expect(metrics.tableScrollLeft, context).toBeGreaterThan(0)
      expect(metrics.overflowX, context).toBe('auto')
      expect(metrics.writingMode, context).toBe('horizontal-tb')
      expect(metrics.whiteSpace, context).toBe('nowrap')
      expect(metrics.cellWidth, context).toBeGreaterThan(60)
      expect(metrics.cellHeight, context).toBeLessThan(60)
      backgrounds[viewport.mode] = metrics.background
    }

    expect(backgrounds.light).not.toBe(backgrounds.dark)
    expect(backgrounds['dark-125']).toBe(backgrounds.dark)
  })
})
