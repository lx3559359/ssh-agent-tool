const { promises: fs } = require('fs')
const { tmpdir } = require('os')
const { resolve, sep } = require('path')
const { _electron: electron, test, expect } = require('@playwright/test')
const appOptions = require('./common/app-options')
const {
  acquireIsolatedApp,
  cleanupPreservingPrimaryError
} = require('./common/isolated-electron-app')

const profilePrefix = 'shellpilot-service-selector-'
const selectorThemes = [
  { theme: 'default', mode: 'dark' },
  { theme: 'defaultLight', mode: 'light' }
]

test.setTimeout(180000)

function assertSafeProfileRoot (profileRoot) {
  const tempRoot = resolve(tmpdir()) + sep
  if (!profileRoot.startsWith(tempRoot) || !profileRoot.includes(profilePrefix)) {
    throw new Error(`Refusing to use unexpected selector profile: ${profileRoot}`)
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
        throw new Error(`Electron ignored isolated selector profile: ${actualPath}`)
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
  return [
    {
      id: 'selector-web',
      type: 'ssh',
      title: 'Web Production',
      host: '10.40.0.10',
      port: 22,
      username: 'ops'
    },
    {
      id: 'selector-worker',
      type: 'ssh',
      title: 'Worker Production',
      host: '10.40.0.11',
      port: 22,
      username: 'ops'
    }
  ]
}

async function installFixture (page) {
  await page.evaluate(items => {
    const statusResult = target => ({
      target: { id: target.id },
      status: 'success',
      probes: [{
        id: 'system',
        status: 'success',
        data: { uptimeSeconds: 3600 }
      }]
    })
    const inventoryItems = target => target.id === 'selector-web'
      ? [
          {
            id: 'systemd:nginx.service',
            name: 'nginx.service',
            type: 'service',
            group: 'system',
            state: 'running',
            autostart: 'enabled',
            description: 'Web gateway',
            source: 'systemd'
          },
          {
            id: 'docker:database',
            name: 'database',
            type: 'container',
            group: 'container',
            state: 'stopped',
            autostart: 'enabled',
            description: 'PostgreSQL',
            source: 'docker'
          }
        ]
      : [{
          id: 'pm2:queue-worker',
          name: 'queue-worker',
          type: 'process',
          group: 'process-manager',
          state: 'failed',
          autostart: 'unknown',
          description: 'Background jobs',
          source: 'pm2'
        }]

    window.__serviceFixture = {
      mode: 'complete',
      inventoryCalls: 0,
      cancelCalls: 0
    }
    window.wsFetch = payload => {
      if (payload.action === 'cancel-fleet-status') {
        window.__serviceFixture.cancelCalls += 1
        return Promise.resolve({ taskId: payload.taskId, cancelled: true })
      }
      if (payload.action === 'collect-fleet-service-inventory') {
        window.__serviceFixture.inventoryCalls += 1
        if (window.__serviceFixture.mode === 'pending') {
          return new Promise(() => {})
        }
        return Promise.resolve({
          taskId: payload.taskId,
          target: {
            id: payload.target.id,
            title: payload.target.title
          },
          status: 'completed',
          items: inventoryItems(payload.target),
          errors: []
        })
      }
      return Promise.resolve({
        taskId: payload.taskId,
        status: 'completed',
        results: payload.targets.map(statusResult)
      })
    }

    window.store.setBookmarks(items)
    window.store.setBookmarkGroups([{
      id: 'selector-group',
      title: 'Selector E2E',
      bookmarkIds: items.map(item => item.id),
      bookmarkGroupIds: []
    }])
    window.store.openFleetStatus()
  }, bookmarks())

  await expect(page.locator('.fleet-status-workspace-active')).toBeVisible()
  await page.locator('.fleet-status-toolbar button').filter({ hasText: '刷新' }).click()
  await expect(page.locator('.fleet-status-table tbody tr')).toHaveCount(2)
}

async function chooseSelectOption (selector, direction) {
  await selector.click()
  await selector.press(direction)
  await selector.press('Enter')
}
async function setShortWindow (electronApp, page) {
  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setContentSize(640, 420)
  })
  await expect.poll(() => page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))).toEqual({ width: 640, height: 420 })
}

test('checks selected servers, filters and multi-selects services, cancels, and restores focus', async () => {
  await runWithIsolatedApp(async electronApp => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
    await dismissStartupModals(page)
    await installFixture(page)

    await page.getByRole('checkbox', { name: '选择 Web Production' }).check()
    await page.getByRole('checkbox', { name: '选择 Worker Production' }).check()
    await page.evaluate(() => {
      window.store.rightPanelVisible = true
      window.store.rightPanelPinned = false
      window.store.rightPanelWidth = 320
    })
    await setShortWindow(electronApp, page)

    const sidePanel = page.locator('.right-side-panel')
    await expect(sidePanel).toBeVisible()
    const checkServices = page.getByRole('button', { name: /检查服务/ })
    await expect(checkServices).toBeEnabled()
    const shortLayout = await checkServices.evaluate(button => {
      const workspace = button.closest('.fleet-status-workspace-active')
      const panel = document.querySelector('.right-side-panel')
      const buttonRect = button.getBoundingClientRect()
      const workspaceRect = workspace.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const hitTarget = document.elementFromPoint(
        buttonRect.left + buttonRect.width / 2,
        buttonRect.top + buttonRect.height / 2
      )
      return {
        buttonRight: buttonRect.right,
        workspaceRight: workspaceRect.right,
        panelLeft: panelRect.left,
        hitIsButton: hitTarget === button || button.contains(hitTarget)
      }
    })
    expect(shortLayout.workspaceRight).toBeLessThanOrEqual(
      shortLayout.panelLeft + 1
    )
    expect(shortLayout.buttonRight).toBeLessThanOrEqual(
      shortLayout.workspaceRight
    )
    expect(shortLayout.hitIsButton).toBe(true)
    await checkServices.click()

    const drawer = page.locator('.ant-drawer.fleet-service-selector-drawer')
    const dialog = page.getByRole('dialog', {
      name: /自动识别服务/,
      includeHidden: true
    })
    await expect(drawer).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('自动识别服务')).toBeVisible()
    await expect(dialog.getByText('Web Production', { exact: true }).first()).toBeVisible()
    await expect(dialog.getByText('Worker Production', { exact: true }).first()).toBeVisible()
    await expect(dialog.locator('.fleet-service-selector-service-row')).toHaveCount(3)
    await expect(dialog).toHaveAttribute('role', 'dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    const themeColors = {}
    for (const selectorTheme of selectorThemes) {
      await page.evaluate(theme => window.store.setTheme(theme), selectorTheme.theme)
      await expect.poll(() => page.evaluate(() => window.store.config.theme))
        .toBe(selectorTheme.theme)
      const metrics = await dialog.evaluate(root => {
        const colorChannels = value => {
          const values = value.match(/[\d.]+/g).map(Number)
          return value.startsWith('color(srgb')
            ? values.slice(0, 3).map(channel => channel * 255)
            : values.slice(0, 3)
        }
        const luminance = value => {
          const linear = colorChannels(value).map(channel => {
            channel /= 255
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * linear[0] +
            0.7152 * linear[1] +
            0.0722 * linear[2]
        }
        const contrastRatio = (foreground, background) => {
          const foregroundLuminance = luminance(foreground)
          const backgroundLuminance = luminance(background)
          return (
            Math.max(foregroundLuminance, backgroundLuminance) + 0.05
          ) / (
            Math.min(foregroundLuminance, backgroundLuminance) + 0.05
          )
        }
        return [...root.querySelectorAll(
          '.fleet-service-selector-state, .fleet-service-selector-server-status'
        )].map(element => {
          const foreground = window.getComputedStyle(element).color
          const surface = element.closest('td, li')
          const background = window.getComputedStyle(surface).backgroundColor
          return {
            foreground,
            background,
            fontSize: window.getComputedStyle(element).fontSize,
            contrast: contrastRatio(foreground, background)
          }
        })
      })
      expect(metrics.length).toBeGreaterThan(0)
      for (const metric of metrics) {
        expect(metric.fontSize).toBe('12px')
        expect(metric.contrast).toBeGreaterThanOrEqual(4.5)
      }
      themeColors[selectorTheme.mode] = metrics.map(metric => metric.foreground)
    }
    expect(themeColors.light).not.toEqual(themeColors.dark)

    const shortMetrics = await dialog.evaluate(root => {
      const body = root.querySelector('.ant-drawer-body')
      const content = root.querySelector('.fleet-service-selector-content')
      const targets = root.querySelector('.fleet-service-selector-targets')
      const table = root.querySelector('.fleet-service-selector-table-scroll')
      return {
        bodyOverflowY: window.getComputedStyle(body).overflowY,
        contentOverflowY: window.getComputedStyle(content).overflowY,
        targetOverflowY: window.getComputedStyle(targets).overflowY,
        targetMaxHeight: Number.parseFloat(window.getComputedStyle(targets).maxHeight),
        tableMinHeight: Number.parseFloat(window.getComputedStyle(table).minHeight),
        tableOverflowX: window.getComputedStyle(table).overflowX,
        viewportHeight: window.innerHeight
      }
    })
    expect(shortMetrics.bodyOverflowY).toBe('auto')
    expect(shortMetrics.contentOverflowY).toBe('auto')
    expect(shortMetrics.targetOverflowY).toBe('auto')
    expect(shortMetrics.targetMaxHeight).toBeGreaterThan(0)
    expect(shortMetrics.tableMinHeight).toBeLessThan(shortMetrics.viewportHeight)
    expect(shortMetrics.tableOverflowX).toBe('auto')

    await chooseSelectOption(
      dialog.getByLabel('服务状态筛选'),
      'ArrowUp'
    )
    await expect(dialog.locator('.fleet-service-selector-service-row')).toHaveCount(1)
    await expect(dialog.getByText('queue-worker')).toBeVisible()

    await chooseSelectOption(
      dialog.getByLabel('服务状态筛选'),
      'ArrowDown'
    )
    const search = dialog.getByLabel('搜索自动发现的服务')
    await search.fill('PostgreSQL')
    await expect(dialog.locator('.fleet-service-selector-service-row')).toHaveCount(1)
    await dialog.getByRole('button', { name: '选择当前筛选结果' }).click()
    await expect(dialog.getByText('已选择 1 项')).toBeVisible()

    await search.fill('')
    await dialog.getByRole('button', { name: '选择全部异常' }).click()
    await expect(dialog.getByText('已选择 2 项')).toBeVisible()

    await page.evaluate(() => { window.__serviceFixture.mode = 'pending' })
    await dialog.getByRole('button', { name: '重新检测' }).click()
    const cancel = dialog.getByRole('button', { name: '取消检测' })
    await expect(cancel).toBeEnabled()
    await cancel.click()
    await expect(dialog.getByText('已取消')).toHaveCount(2)
    await expect.poll(() => page.evaluate(() => (
      window.__serviceFixture.cancelCalls
    ))).toBe(2)

    await dialog.getByRole('button', { name: '关闭服务面板' }).click()
    await expect(dialog).toHaveCount(1)
    await expect(dialog).toBeHidden()
    await expect(dialog.getByLabel('搜索自动发现的服务')).toBeHidden()
    await expect(checkServices).toBeFocused()
    await page.evaluate(() => { window.__serviceFixture.mode = 'complete' })
    await checkServices.click()
    await expect(dialog).toBeVisible()
    const reopenedSearch = dialog.getByLabel('搜索自动发现的服务')
    await reopenedSearch.focus()
    await expect(reopenedSearch).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(dialog.getByLabel('搜索自动发现的服务')).toBeHidden()
    await expect(checkServices).toBeFocused()
  })
})
