const { promises: fs } = require('fs')
const { tmpdir } = require('os')
const { resolve, sep } = require('path')
const { _electron: electron, test, expect } = require('@playwright/test')
const appOptions = require('./common/app-options')
const {
  acquireIsolatedApp,
  cleanupPreservingPrimaryError
} = require('./common/isolated-electron-app')

const sizes = [
  { width: 590, height: 400 },
  { width: 820, height: 600 },
  { width: 1100, height: 700 },
  { width: 1600, height: 900 }
]
const zooms = [1, 1.25, 1.5]
const languages = ['zh_cn', 'en_us']
const themeIds = [
  'shellpilot-ocean',
  'shellpilot-jade',
  'shellpilot-indigo',
  'shellpilot-amber',
  'shellpilot-graphite'
]
const smokeMatrix = process.env.SHELLPILOT_VISUAL_MATRIX_SMOKE === '1'
const requestedSize = process.env.SHELLPILOT_VISUAL_MATRIX_SIZE
const requestedZoomValue = process.env.SHELLPILOT_VISUAL_MATRIX_ZOOM
const requestedZoom = Number(requestedZoomValue)
const requestedLanguage = process.env.SHELLPILOT_VISUAL_MATRIX_LANGUAGE
const dimensionOnly = process.env.SHELLPILOT_VISUAL_MATRIX_DIMENSION_ONLY === '1'
const matrixSizes = requestedSize
  ? sizes.filter(size => `${size.width}x${size.height}` === requestedSize)
  : smokeMatrix ? [sizes[0]] : sizes
const matrixZooms = requestedZoomValue !== undefined
  ? Number.isFinite(requestedZoom) && requestedZoom > 0 ? [requestedZoom] : []
  : smokeMatrix ? [zooms[0]] : zooms
const matrixLanguages = requestedLanguage !== undefined
  ? languages.includes(requestedLanguage) ? [requestedLanguage] : []
  : smokeMatrix ? [languages[0]] : languages
const matrixThemes = dimensionOnly ? [] : smokeMatrix ? [themeIds[0]] : themeIds
const matrixThemeSizes = requestedSize
  ? matrixSizes
  : smokeMatrix ? [sizes[0]] : [sizes[0], sizes[2]]
const lockedTerminalRgb = 'rgb(14, 15, 18)'
const profilePrefix = 'shellpilot-secondary-visual-'
const screenshotTimeout = 1800
const geometryTimeout = 1200
const overflowTolerance = 1
const bookmarkId = `visual-matrix-${process.pid}-${Date.now()}`

test.setTimeout(20 * 60 * 1000)

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

function assertSafeProfileRoot (profileRoot) {
  const tempRoot = resolve(tmpdir()) + sep
  if (!profileRoot.startsWith(tempRoot) || !profileRoot.includes(profilePrefix)) {
    throw new Error(`Refusing to use unexpected visual profile: ${profileRoot}`)
  }
}

async function launchIsolatedApp (label) {
  const { electronApp, profileRoot, userDataPath } = await acquireIsolatedApp({
    createProfileRoot: () => fs.mkdtemp(resolve(tmpdir(), `${profilePrefix}${label}-`)),
    validateProfileRoot: assertSafeProfileRoot,
    launch: root => electron.launch(launchOptions(root)),
    readUserDataPath: app => app.evaluate(({ app }) => app.getPath('userData')),
    validateUserDataPath: (root, actualPath) => {
      if (!resolve(actualPath).startsWith(resolve(root) + sep)) {
        throw new Error(`Electron ignored the isolated profile: ${JSON.stringify({ profileRoot: root, userDataPath: actualPath })}`)
      }
    },
    cleanup: closeIsolatedApp
  })
  console.log(`SECONDARY_ISOLATED_PROFILE=${JSON.stringify({ label, profileRoot, userDataPath })}`)
  return { electronApp, profileRoot }
}

async function closeIsolatedApp (electronApp, profileRoot) {
  let shutdownError
  let removalError
  if (electronApp) {
    try {
      await electronApp.close()
    } catch (closeError) {
      try {
        electronApp.process().kill()
      } catch (killError) {
        killError.closeError = closeError
        shutdownError = killError
      }
    }
  }
  try {
    assertSafeProfileRoot(profileRoot)
    await fs.rm(profileRoot, { recursive: true, force: true })
  } catch (error) {
    removalError = error
  }
  if (shutdownError) {
    if (removalError) shutdownError.cleanupError = removalError
    throw shutdownError
  }
  if (removalError) throw removalError
}

async function runWithIsolatedApp (label, callback) {
  const { electronApp, profileRoot } = await launchIsolatedApp(label)
  let result
  let primaryError
  try {
    result = await callback(electronApp)
  } catch (error) {
    primaryError = error
  }
  await cleanupPreservingPrimaryError(
    () => closeIsolatedApp(electronApp, profileRoot),
    primaryError
  )
  if (primaryError) throw primaryError
  return result
}

function expectedMatrixCounts () {
  const dimensionBatches = matrixSizes.length * matrixZooms.length * matrixLanguages.length
  const themeBatches = matrixThemes.length * matrixThemeSizes.length
  return {
    dimensionBatches,
    themeBatches,
    dimension: dimensionBatches * surfaces.length,
    theme: themeBatches * surfaces.length,
    total: (dimensionBatches + themeBatches) * surfaces.length
  }
}

function assertMatrixConfiguration () {
  const expected = expectedMatrixCounts()
  expect(expected.dimension, JSON.stringify({ matrixSizes, matrixZooms, matrixLanguages })).toBeGreaterThan(0)
  expect(expected.total, JSON.stringify({ matrixSizes, matrixZooms, matrixLanguages, matrixThemes })).toBeGreaterThan(0)
  if (smokeMatrix) {
    expect(expected.dimension).toBe(12)
    expect(expected.theme).toBe(dimensionOnly ? 0 : 12)
    expect(expected.total).toBe(dimensionOnly ? 12 : 24)
  } else if (!requestedSize && requestedZoomValue === undefined && requestedLanguage === undefined && !dimensionOnly) {
    expect(expected.dimension).toBe(288)
    expect(expected.theme).toBe(120)
    expect(expected.total).toBe(408)
  }
  if (dimensionOnly) {
    expect(expected.theme).toBe(0)
  }
  return expected
}

async function setWindowCase (electronApp, page, size, zoom) {
  await electronApp.evaluate(({ BrowserWindow }, values) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setContentSize(values.size.width, values.size.height)
    window.webContents.setZoomFactor(values.zoom)
  }, { size, zoom })
  await page.waitForTimeout(160)
}

async function resetSurface (page, language) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page.evaluate((nextLanguage) => {
    const store = window.store
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    store.previewLanguage = nextLanguage
    store.showAIConfigModal = false
    store.setOpenedSideBar('')
    if (store.showModal) {
      store.hideSettingModal()
    }
  }, language)
  await page.locator('.shellpilot-context-menu.ant-dropdown:visible')
    .waitFor({ state: 'hidden', timeout: 2000 })
    .catch(() => {})
  await page.waitForTimeout(80)
}

async function openSettings (page) {
  await page.evaluate(() => window.store.openSetting())
  await page.locator('.setting-wrap').waitFor({ state: 'visible' })
  await page.locator('.sp-settings-form').waitFor({ state: 'visible' })
}

async function openConnection (page) {
  await page.evaluate(() => window.store.onNewSsh())
  await page.locator('.sp-configuration-form').waitFor({ state: 'visible' })
}

async function openAi (page) {
  await page.evaluate(() => window.store.toggleAIConfig())
  await page.locator('.ai-config-modal').waitFor({ state: 'visible' })
  await page.locator('.sp-ai-config-form').waitFor({ state: 'visible' })
}

async function openSync (page) {
  await page.evaluate(() => window.store.openSettingSync())
  await page.locator('.sp-sync-config-form').waitFor({ state: 'visible' })
}

async function openThemes (page) {
  await page.evaluate(() => window.store.openTerminalThemes())
  await page.locator('.sp-theme-center').waitFor({ state: 'visible' })
  await page.locator('.sp-theme-preview-terminal').waitFor({ state: 'visible' })
}

async function openWidgets (page) {
  await page.evaluate(() => window.store.openWidgetsModal())
  await page.locator('.widgets-shell').waitFor({ state: 'visible' })
  await page.locator('.widgets-card-list').waitFor({ state: 'visible' })
  await waitForWidgetInventory(page)
}

async function readWidgetInventory (page) {
  return page.evaluate(async () => {
    try {
      const widgets = await window.store.listWidgets()
      return {
        error: '',
        items: Array.isArray(widgets)
          ? widgets.map(widget => ({ id: widget.id, type: widget.info?.type || '' }))
          : []
      }
    } catch (error) {
      return { error: error?.message || String(error), items: [] }
    }
  })
}

async function waitForWidgetInventory (page) {
  let inventory = { error: 'Widget IPC has not completed', items: [] }
  try {
    await expect.poll(async () => {
      inventory = await readWidgetInventory(page)
      return inventory.error === '' && inventory.items.length > 0
    }, {
      timeout: 10000,
      intervals: [100, 200, 400, 800],
      message: 'Waiting for the real listWidgets IPC response'
    }).toBe(true)
  } catch (error) {
    throw new Error(`Widget IPC did not become ready: ${JSON.stringify(inventory)}`, { cause: error })
  }
  return inventory
}

async function selectBatchWidget (page) {
  const inventory = await waitForWidgetInventory(page)
  const batch = inventory.items.find(widget => widget.id === 'batch-op' && widget.type === 'frontend')
  if (!batch) {
    throw new Error(`Required batch-op/frontend widget is missing: ${JSON.stringify(inventory.items)}`)
  }
  const card = page.locator('.widget-card[data-widget-id="batch-op"][data-widget-type="frontend"]')
  try {
    await card.waitFor({ state: 'visible', timeout: 5000 })
  } catch (error) {
    throw new Error(`Batch widget exists in IPC inventory but no matching visible card rendered: ${JSON.stringify(inventory.items)}`, { cause: error })
  }
  await card.scrollIntoViewIfNeeded()
  await card.click()
  try {
    await expect.poll(() => page.evaluate(() => ({
      id: window.store.settingItem?.id || '',
      type: window.store.settingItem?.info?.type || ''
    })), { timeout: 5000 }).toEqual({ id: 'batch-op', type: 'frontend' })
    await page.locator('.batch-op-editor').waitFor({ state: 'visible', timeout: 5000 })
  } catch (error) {
    const state = await page.evaluate(() => ({
      settingTab: window.store.settingTab,
      showModal: window.store.showModal,
      settingItem: {
        id: window.store.settingItem?.id || '',
        type: window.store.settingItem?.info?.type || '',
        name: window.store.settingItem?.info?.name || ''
      },
      editorCount: document.querySelectorAll('.batch-op-editor').length,
      controlCount: document.querySelectorAll('.widget-control').length,
      controlHtml: document.querySelector('.widget-control')?.innerHTML.slice(0, 500) || '',
      rightColumn: (() => {
        const element = document.querySelector('.setting-tabs-widgets .setting-row-right')
        if (!element) return null
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return { rect: rect.toJSON(), display: style.display, visibility: style.visibility, overflow: style.overflow }
      })()
    }))
    throw new Error(`Batch widget was selected but its editor did not render: ${JSON.stringify(state)}`, { cause: error })
  }
}

async function openBatch (page) {
  await openWidgets(page)
  await selectBatchWidget(page)
}

async function dispatchContextMenu (locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const point = {
      x: Math.max(1, Math.min(window.innerWidth - 2, rect.left + Math.min(48, rect.width / 2))),
      y: Math.max(1, Math.min(window.innerHeight - 2, rect.top + Math.min(32, rect.height / 2)))
    }
    element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: point.x,
      clientY: point.y
    }))
    return point
  })
}

async function waitForPopupMotion (popup) {
  await expect.poll(() => {
    return popup.evaluate(element => window.getComputedStyle(element).transform)
  }, { timeout: 5000 }).toBe('none')
}

async function openInputMenu (page) {
  await openSettings(page)
  const input = page.locator('.setting-header input').first()
  if (!await input.isVisible()) {
    await page.locator('.setting-header-search-toggle').click()
  }
  await input.waitFor({ state: 'visible' })
  await input.fill('theme')
  await input.evaluate(element => element.setSelectionRange(0, element.value.length))
  await dispatchContextMenu(input)
  const popup = page.locator('.shellpilot-context-menu.ant-dropdown:visible').last()
  await popup.waitFor()
  await waitForPopupMotion(popup)
}

async function ensureVisualBookmark (page) {
  await page.evaluate((id) => {
    const store = window.store
    if (!store.bookmarks.some(bookmark => bookmark.id === id)) {
      store.addItem({
        id,
        type: 'local',
        title: 'Visual Matrix Local Connection With A Long Name',
        color: '#2878E6'
      }, 'bookmarks')
      const defaultGroup = store.bookmarkGroups.find(group => group.id === 'default')
      if (defaultGroup && !defaultGroup.bookmarkIds.includes(id)) {
        defaultGroup.bookmarkIds.unshift(id)
      }
    }
    store.handleSidebarPanelTab('bookmarks')
    store.setOpenedSideBar('bookmarks')
  }, bookmarkId)
  await page.locator(`.sidebar-panel-bookmarks .tree-item[data-item-id="${bookmarkId}"]`).waitFor()
}

async function openBookmarkMenu (page) {
  await dispatchContextMenu(
    page.locator(`.sidebar-panel-bookmarks .tree-item[data-item-id="${bookmarkId}"]`)
  )
  const popup = page.locator('.shellpilot-context-menu.ant-dropdown:visible').last()
  await popup.waitFor()
  await waitForPopupMotion(popup)
}

async function openTerminalMenu (page) {
  const terminal = page.locator('.term-wrap:visible').first()
  await terminal.waitFor()
  await dispatchContextMenu(terminal)
  const popup = page.locator('.shellpilot-context-menu.ant-dropdown:visible').last()
  await popup.waitFor()
  await waitForPopupMotion(popup)
}

async function ensureTwoTerminalTabs (page) {
  await page.evaluate(() => {
    const firstTab = window.store.tabs[0]
    if (!firstTab) throw new Error('Terminal invariant fixture requires one source tab')
    if (window.store.tabs.length < 2) window.store.duplicateTab(firstTab.id)
  })
  await expect(page.locator('.tabs.terminal-session-tabs .tab')).toHaveCount(2, { timeout: 20000 })
  await expect(page.locator('.tabs.terminal-session-tabs .tab:not(.active)')).toHaveCount(1)
}

const surfaces = [
  { name: 'settings-shell', selector: '.setting-wrap', open: openSettings },
  { name: 'general-settings', selector: '.sp-settings-form', open: openSettings },
  { name: 'connection-form', selector: '.sp-configuration-form', open: openConnection },
  { name: 'ai-config', selector: '.ai-config-modal', open: openAi },
  { name: 'sync-config', selector: '.sp-sync-config', open: openSync },
  { name: 'theme-center', selector: '.sp-theme-center', open: openThemes },
  { name: 'advanced-theme-editor', selector: '#terminal-theme-form', open: openThemes },
  { name: 'tool-center', selector: '.widgets-shell', open: openWidgets },
  { name: 'batch-editor', selector: '.batch-op-editor', open: openBatch },
  { name: 'bookmark-menu', selector: '.shellpilot-context-menu.ant-dropdown:visible', prepare: ensureVisualBookmark, open: openBookmarkMenu, menu: true, dangerPolicy: 'menu-last' },
  { name: 'terminal-menu', selector: '.shellpilot-context-menu.ant-dropdown:visible', open: openTerminalMenu, menu: true, dangerPolicy: 'semantic-group-last' },
  { name: 'input-menu', selector: '.shellpilot-context-menu.ant-dropdown:visible', open: openInputMenu, menu: true, dangerPolicy: 'none' }
]

async function makePrimaryActionsReachable (page, selector) {
  const buttons = page.locator(`${selector} button.ant-btn-primary:visible`)
  const count = await buttons.count()
  for (let index = 0; index < count; index += 1) {
    await buttons.nth(index).scrollIntoViewIfNeeded()
  }
}

async function inspectDocumentBaseline (page) {
  return page.evaluate((tolerance) => {
    const nodes = [
      ['documentElement', document.documentElement],
      ['body', document.body],
      ['root', document.getElementById('container')]
    ].map(([name, element]) => ({
      name,
      found: Boolean(element),
      scrollWidth: element?.scrollWidth || 0,
      clientWidth: element?.clientWidth || 0
    }))
    const offenders = [...document.body.querySelectorAll('*')]
      .flatMap(element => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        if (
          rect.width <= 0 || rect.height <= 0 ||
          rect.right <= window.innerWidth + tolerance ||
          rect.bottom <= 0 || rect.top >= window.innerHeight ||
          style.display === 'none' || style.visibility === 'hidden'
        ) {
          return []
        }
        return [{
          tag: element.tagName,
          className: String(element.className).slice(0, 160),
          right: Number(rect.right.toFixed(3))
        }]
      })
      .slice(0, 10)
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      nodes,
      offenders
    }
  }, overflowTolerance)
}

async function inspectSurface (page, selector, menu, documentBaseline) {
  await makePrimaryActionsReachable(page, selector)
  const rootLocator = menu ? page.locator(selector).last() : page.locator(selector).first()
  return rootLocator.evaluate((root, options) => {
    const visible = element => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      if (
        rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' ||
        rect.right <= 0 || rect.bottom <= 0 ||
        rect.left >= window.innerWidth || rect.top >= window.innerHeight
      ) {
        return false
      }
      const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2))
      const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2))
      const painted = document.elementFromPoint(x, y)
      return Boolean(painted && (painted === element || element.contains(painted)))
    }
    const importantSelector = [
      'h1', 'h2', 'h3', 'label', '.ant-form-item-label', '.ant-tabs-tab',
      '.ant-btn', '.sp-theme-card-title strong', '.widget-card-title'
    ].join(',')
    const important = [...root.querySelectorAll(importantSelector)].filter(visible)
    const clippedText = important.flatMap((element, index) => {
      const style = window.getComputedStyle(element)
      const overflowing = element.scrollWidth > element.clientWidth + 1
      const clipped = overflowing && (
        style.textOverflow === 'ellipsis' ||
        (style.whiteSpace === 'nowrap' && !['auto', 'scroll'].includes(style.overflowX))
      )
      return clipped
        ? [{ index, text: element.textContent.trim().slice(0, 100), className: String(element.className), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }]
        : []
    })
    const primaryClipping = [...root.querySelectorAll('button.ant-btn-primary')]
      .filter(visible)
      .flatMap((button, index) => {
        const rect = button.getBoundingClientRect()
        const clipped = button.scrollWidth > button.clientWidth + 1 ||
          rect.left < -1 || rect.right > window.innerWidth + 1
        return clipped
          ? [{ index, text: button.textContent.trim(), rect: rect.toJSON(), scrollWidth: button.scrollWidth, clientWidth: button.clientWidth }]
          : []
      })
    const buttons = [...root.querySelectorAll('button.ant-btn, [role="menuitem"]')].filter(visible)
    const overlaps = []
    for (let leftIndex = 0; leftIndex < buttons.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < buttons.length; rightIndex += 1) {
        const left = buttons[leftIndex]
        const right = buttons[rightIndex]
        if (left.contains(right) || right.contains(left)) continue
        const a = left.getBoundingClientRect()
        const b = right.getBoundingClientRect()
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (width > 1 && height > 1) {
          overlaps.push([left.textContent.trim(), right.textContent.trim()])
        }
      }
    }
    const parseColor = value => {
      const channels = String(value).match(/[\d.]+/g)?.map(Number) || []
      if (channels.length < 3) return { r: 0, g: 0, b: 0, a: 0 }
      return {
        r: channels[0],
        g: channels[1],
        b: channels[2],
        a: channels.length > 3 ? channels[3] : 1
      }
    }
    const composite = (foreground, background) => {
      const alpha = foreground.a + background.a * (1 - foreground.a)
      if (alpha <= 0) return { r: 255, g: 255, b: 255, a: 1 }
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha
      }
    }
    const luminance = color => {
      const linear = channel => {
        const normalized = channel / 255
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
    }
    const contrast = (foreground, background) => {
      const foregroundLuminance = luminance(foreground)
      const backgroundLuminance = luminance(background)
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    }
    const resolvedBackground = element => {
      const layers = []
      let current = element
      while (current) {
        const color = parseColor(window.getComputedStyle(current).backgroundColor)
        if (color.a > 0) layers.push(color)
        current = current.parentElement
      }
      let result = { r: 255, g: 255, b: 255, a: 1 }
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        result = composite(layers[index], result)
      }
      return result
    }
    const effectiveOpacity = element => {
      let result = 1
      let current = element
      while (current) {
        result *= Number.parseFloat(window.getComputedStyle(current).opacity || '1')
        current = current.parentElement
      }
      return result
    }
    const disabledContrast = [...root.querySelectorAll('[disabled], [aria-disabled="true"], .ant-dropdown-menu-item-disabled')]
      .filter(visible)
      .map((element, index) => {
        const style = window.getComputedStyle(element)
        const background = resolvedBackground(element)
        const foreground = parseColor(style.color)
        foreground.a *= effectiveOpacity(element)
        const effectiveForeground = composite(foreground, background)
        return {
          index,
          text: element.textContent.trim().slice(0, 100),
          color: style.color,
          background: style.backgroundColor,
          opacity: style.opacity,
          ratio: Number(contrast(effectiveForeground, background).toFixed(3))
        }
      })
    const disabledUnreadable = disabledContrast.filter(item => item.ratio < 3)
    const rendered = element => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && window.getComputedStyle(element).visibility !== 'hidden'
    }
    const menuItems = options.menu
      ? [...root.querySelectorAll('[role="menuitem"]')].filter(rendered)
      : []
    const dangerIndexes = menuItems
      .map((item, index) => item.classList.contains('ant-dropdown-menu-item-danger') ? index : -1)
      .filter(index => index >= 0)
    const lastActionIndex = menuItems.length - 1
    const dangerGroups = dangerIndexes.map(index => {
      const item = menuItems[index]
      const siblings = [...item.parentElement.children]
      const siblingIndex = siblings.indexOf(item)
      const nextSibling = siblings[siblingIndex + 1] || null
      const followingActions = siblings.slice(siblingIndex + 1)
        .filter(sibling => !sibling.classList.contains('ant-dropdown-menu-item-divider'))
        .filter(sibling => sibling.getAttribute('role') === 'menuitem')
      const beforeNextDivider = []
      for (const sibling of siblings.slice(siblingIndex + 1)) {
        if (sibling.classList.contains('ant-dropdown-menu-item-divider')) break
        if (sibling.getAttribute('role') === 'menuitem') beforeNextDivider.push(sibling)
      }
      return {
        index,
        text: item.textContent.trim().slice(0, 100),
        isLastAction: index === lastActionIndex,
        isLastInSemanticGroup: beforeNextDivider.length === 0,
        followedByDividerOrEnd: !nextSibling || nextSibling.classList.contains('ant-dropdown-menu-item-divider'),
        followingActionCount: followingActions.length
      }
    })
    const rect = root.getBoundingClientRect()
    const rootStyle = window.getComputedStyle(root)
    const menuElement = options.menu ? root.querySelector('.ant-dropdown-menu') : null
    const menuStyle = menuElement ? window.getComputedStyle(menuElement) : null
    const rootContentOverflow = root.scrollWidth > root.clientWidth + 1 &&
      !['auto', 'scroll'].includes(rootStyle.overflowX)
    const overflowNodes = [
      ['documentElement', document.documentElement],
      ['body', document.body],
      ['root', document.getElementById('container')]
    ].map(([name, element]) => {
      const baselineNode = options.documentBaseline?.nodes?.find(item => item.name === name)
      const clientWidth = element?.clientWidth || 0
      const allowedScrollWidth = name === 'root'
        ? clientWidth
        : Math.max(clientWidth, baselineNode?.scrollWidth || 0)
      return {
        name,
        found: Boolean(element),
        scrollWidth: element?.scrollWidth || 0,
        clientWidth,
        baselineScrollWidth: baselineNode?.scrollWidth || 0,
        allowedScrollWidth,
        overflow: Boolean(element && element.scrollWidth > allowedScrollWidth + options.overflowTolerance)
      }
    })
    const documentOverflowOffenders = [...document.body.querySelectorAll('*')]
      .flatMap(element => {
        const itemRect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        const horizontallyOutside = itemRect.left < -options.overflowTolerance ||
          itemRect.right > window.innerWidth + options.overflowTolerance
        const verticallyRelevant = itemRect.bottom > 0 && itemRect.top < window.innerHeight
        if (
          itemRect.width <= 0 || itemRect.height <= 0 || !horizontallyOutside ||
          !verticallyRelevant || style.display === 'none' || style.visibility === 'hidden'
        ) {
          return []
        }
        return [{
          tag: element.tagName,
          id: element.id,
          className: String(element.className).slice(0, 180),
          text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 100),
          rect: itemRect.toJSON(),
          position: style.position,
          overflowX: style.overflowX,
          transform: style.transform
        }]
      })
      .slice(0, 30)
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentOverflow: overflowNodes.some(item => !item.found || item.overflow),
      documentOverflowDetails: overflowNodes,
      documentOverflowOffenders,
      rootContentOverflow,
      rootScrollWidth: root.scrollWidth,
      rootClientWidth: root.clientWidth,
      rootOverflowX: rootStyle.overflowX,
      rootRect: rect.toJSON(),
      rootHorizontalClip: rect.left < -1 || rect.right > window.innerWidth + 1,
      menuViewportClip: Boolean(options.menu && (
        rect.left < -options.overflowTolerance ||
        rect.right > window.innerWidth + options.overflowTolerance ||
        rect.top < -options.overflowTolerance ||
        rect.bottom > window.innerHeight + options.overflowTolerance
      )),
      menuScroll: menuElement
        ? {
            clientHeight: menuElement.clientHeight,
            scrollHeight: menuElement.scrollHeight,
            overflowY: menuStyle.overflowY,
            maxHeight: menuStyle.maxHeight
          }
        : null,
      clippedText,
      primaryClipping,
      overlaps,
      disabledUnreadable,
      disabledContrast,
      dangerIndexes,
      lastActionIndex,
      dangerGroups
    }
  }, { menu, overflowTolerance, documentBaseline })
}

function assertSurfaceSnapshot (snapshot, context, surface) {
  expect(snapshot.documentOverflow, JSON.stringify({ context, snapshot })).toBe(false)
  expect(snapshot.rootContentOverflow, JSON.stringify({ context, snapshot })).toBe(false)
  expect(snapshot.rootHorizontalClip, JSON.stringify({ context, snapshot })).toBe(false)
  expect(snapshot.menuViewportClip, JSON.stringify({ context, snapshot })).toBe(false)
  expect(snapshot.clippedText, JSON.stringify({ context, snapshot })).toEqual([])
  expect(snapshot.primaryClipping, JSON.stringify({ context, snapshot })).toEqual([])
  expect(snapshot.overlaps, JSON.stringify({ context, snapshot })).toEqual([])
  expect(snapshot.disabledUnreadable, JSON.stringify({ context, snapshot })).toEqual([])
  if (surface.dangerPolicy === 'menu-last') {
    expect(snapshot.dangerIndexes.length, JSON.stringify({ context, snapshot })).toBeGreaterThan(0)
    expect(snapshot.dangerGroups.every(item => item.isLastAction), JSON.stringify({ context, snapshot })).toBe(true)
  } else if (surface.dangerPolicy === 'semantic-group-last') {
    expect(snapshot.dangerIndexes.length, JSON.stringify({ context, snapshot })).toBeGreaterThan(0)
    expect(snapshot.dangerGroups.every(item => item.isLastInSemanticGroup && item.followedByDividerOrEnd), JSON.stringify({ context, snapshot })).toBe(true)
  } else {
    expect(snapshot.dangerIndexes, JSON.stringify({ context, snapshot })).toEqual([])
  }
}

async function inspectKeyboardFocus (page, surface) {
  const rootLocator = surface.menu
    ? page.locator(surface.selector).last()
    : page.locator(surface.selector).first()
  if (surface.menu) {
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))
    await page.mouse.move(viewport.width - 2, viewport.height - 2)
    const menu = rootLocator.locator('.ant-dropdown-menu').first()
    const result = await menu.evaluate((menuElement) => {
      const enabledItems = [...menuElement.querySelectorAll('[role="menuitem"]')].filter(item => {
        return !item.classList.contains('ant-dropdown-menu-item-disabled') &&
          item.getAttribute('aria-disabled') !== 'true'
      })
      const styleOf = element => {
        const style = window.getComputedStyle(element)
        return {
          outline: `${style.outlineStyle}|${style.outlineWidth}|${style.outlineColor}`,
          boxShadow: style.boxShadow,
          border: `${style.borderTopColor}|${style.borderRightColor}|${style.borderBottomColor}|${style.borderLeftColor}`,
          background: style.backgroundColor
        }
      }
      return {
        enabledCount: enabledItems.length,
        before: enabledItems.map(styleOf)
      }
    })
    if (result.enabledCount === 0) {
      throw new Error(`Menu surface ${surface.name} has no enabled keyboard target`)
    }
    await menu.focus()
    await expect(menu).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => menu.evaluate(menuElement => {
      const activeItem = menuElement.querySelector('.ant-dropdown-menu-item-active')
      if (!activeItem) return false
      const rect = activeItem.getBoundingClientRect()
      const style = window.getComputedStyle(activeItem)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
        rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight
    }), { timeout: 2000 }).toBe(true)
    const after = await menu.evaluate((menuElement, before) => {
      const enabledItems = [...menuElement.querySelectorAll('[role="menuitem"]')].filter(item => {
        return !item.classList.contains('ant-dropdown-menu-item-disabled') &&
          item.getAttribute('aria-disabled') !== 'true'
      })
      const activeItem = enabledItems.find(item => item.classList.contains('ant-dropdown-menu-item-active')) ||
        enabledItems.find(item => item === document.activeElement) || null
      const styleOf = element => {
        const style = window.getComputedStyle(element)
        return {
          outline: `${style.outlineStyle}|${style.outlineWidth}|${style.outlineColor}`,
          boxShadow: style.boxShadow,
          border: `${style.borderTopColor}|${style.borderRightColor}|${style.borderBottomColor}|${style.borderLeftColor}`,
          background: style.backgroundColor
        }
      }
      const visible = element => {
        if (!element) return false
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
          rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight
      }
      const index = activeItem ? enabledItems.indexOf(activeItem) : -1
      const activeStyle = activeItem ? styleOf(activeItem) : null
      const baseStyle = index >= 0 ? before[index] : null
      const deltas = activeStyle && baseStyle
        ? Object.keys(activeStyle).filter(key => activeStyle[key] !== baseStyle[key])
        : []
      return {
        method: 'ArrowDown',
        enabledCount: enabledItems.length,
        activeIndex: index,
        activeText: activeItem?.textContent.trim().slice(0, 100) || '',
        activeItemVisible: visible(activeItem),
        activeElementVisible: visible(document.activeElement),
        activeElementRole: document.activeElement?.getAttribute?.('role') || document.activeElement?.tagName || '',
        indicatorDeltas: deltas,
        activeStyle,
        baseStyle
      }
    }, result.before)
    return after
  }

  await page.evaluate(() => document.activeElement?.blur?.())
  const interactiveSelector = [
    'button:not([disabled])', 'input:not([disabled])', 'textarea:not([disabled])',
    'select:not([disabled])', 'a[href]',
    '[role="button"]:not([aria-disabled="true"])',
    '[role="tab"]:not([aria-disabled="true"])',
    '[role="checkbox"]:not([aria-disabled="true"])',
    '[role="switch"]:not([aria-disabled="true"])',
    '[tabindex]:not([tabindex="-1"]):not([aria-disabled="true"])'
  ].join(',')
  const enabledCount = await rootLocator.locator(interactiveSelector).count()
  if (enabledCount === 0) {
    throw new Error(`Surface ${surface.name} has no enabled interactive element and is not allowlisted`)
  }
  for (let attempt = 1; attempt <= Math.max(24, enabledCount * 3); attempt += 1) {
    await page.keyboard.press('Tab')
    const focus = await rootLocator.evaluate((root, attemptNumber) => {
      const active = document.activeElement
      if (!active || !root.contains(active)) return null
      const rect = active.getBoundingClientRect()
      const style = window.getComputedStyle(active)
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
        rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight
      const styleOf = element => {
        const computed = window.getComputedStyle(element)
        return {
          outline: `${computed.outlineStyle}|${computed.outlineWidth}|${computed.outlineColor}`,
          boxShadow: computed.boxShadow,
          border: `${computed.borderTopColor}|${computed.borderRightColor}|${computed.borderBottomColor}|${computed.borderLeftColor}`,
          background: computed.backgroundColor
        }
      }
      const owners = []
      let owner = active
      while (owner && root.contains(owner)) {
        owners.push(owner)
        if (owner === root || owners.length >= 6) break
        owner = owner.parentElement
      }
      const focusedOwners = owners.map(element => ({
        tag: element.tagName,
        className: String(element.className || ''),
        style: styleOf(element)
      }))
      active.blur()
      const baseOwners = owners.map(element => ({
        tag: element.tagName,
        className: String(element.className || ''),
        style: styleOf(element)
      }))
      active.focus()
      const indicatorOwners = focusedOwners.flatMap((focusedOwner, index) => {
        const baseOwner = baseOwners[index]
        const deltas = Object.keys(focusedOwner.style)
          .filter(key => focusedOwner.style[key] !== baseOwner.style[key])
        return deltas.length
          ? [{
              depth: index,
              tag: focusedOwner.tag,
              className: focusedOwner.className,
              deltas,
              focusedStyle: focusedOwner.style,
              baseStyle: baseOwner.style
            }]
          : []
      })
      return {
        method: 'Tab',
        attempt: attemptNumber,
        enabledCount: root.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [role="button"]:not([aria-disabled="true"]), [role="tab"]:not([aria-disabled="true"]), [role="checkbox"]:not([aria-disabled="true"]), [role="switch"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"]):not([aria-disabled="true"])').length,
        activeText: (active.getAttribute('aria-label') || active.textContent || active.getAttribute('placeholder') || active.tagName).trim().slice(0, 100),
        activeTag: active.tagName,
        activeVisible: visible,
        indicatorDeltas: indicatorOwners.flatMap(item => item.deltas),
        indicatorOwner: indicatorOwners[0] || null,
        focusedOwners,
        baseOwners
      }
    }, attempt)
    if (focus) return focus
  }
  throw new Error(`Tab did not enter an enabled interactive element on ${surface.name} after ${Math.max(24, enabledCount * 3)} attempts`)
}

function assertFocusSnapshot (focus, context) {
  const message = JSON.stringify({ context, focus })
  if (focus.method === 'ArrowDown') {
    expect(focus.activeIndex, message).toBeGreaterThanOrEqual(0)
    expect(focus.activeItemVisible, message).toBe(true)
    expect(focus.activeElementVisible, message).toBe(true)
  } else {
    expect(focus.activeVisible, message).toBe(true)
  }
  expect(focus.indicatorDeltas.length, message).toBeGreaterThan(0)
}

async function inspectTerminalInvariant (page) {
  return page.evaluate(() => {
    const selectors = [
      '.tabs.terminal-session-tabs',
      '.tabs.terminal-session-tabs .tab.active',
      '.tabs.terminal-session-tabs .tab:not(.active)',
      '.terminal-control',
      '.term-wrap',
      '.xterm',
      '.xterm-viewport'
    ]
    return selectors.map(selector => {
      const element = [...document.querySelectorAll(selector)].find(candidate => {
        const rect = candidate.getBoundingClientRect()
        const style = window.getComputedStyle(candidate)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
      })
      return {
        selector,
        found: Boolean(element),
        background: element ? window.getComputedStyle(element).backgroundColor : ''
      }
    })
  })
}

function assertTerminalInvariant (terminal, context) {
  expect(terminal, JSON.stringify({ context, terminal })).not.toEqual([])
  for (const item of terminal) {
    expect(item.found, JSON.stringify({ context, item })).toBe(true)
    expect(item.background, JSON.stringify({ context, item })).toBe(lockedTerminalRgb)
  }
}

async function recordCaseFailure (page, testInfo, failures, context, error) {
  const originalError = error?.stack || error?.message || String(error)
  const failure = { context, error: originalError }
  failures.push(failure)
  console.log(`SECONDARY_SURFACE_FAILURE=${JSON.stringify(context)}`)
  const safeName = Object.values(context).join('-').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 120)
  try {
    failure.geometry = await Promise.race([
      page.evaluate(() => {
        const describe = element => {
          if (!element) return null
          const rect = element.getBoundingClientRect()
          return {
            tag: element.tagName,
            id: element.id,
            className: String(element.className || ''),
            rect: rect.toJSON(),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth
          }
        }
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          documentElement: describe(document.documentElement),
          body: describe(document.body),
          root: describe(document.getElementById('container')),
          activeElement: describe(document.activeElement)
        }
      }),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: geometryTimeout }), geometryTimeout))
    ])
  } catch (geometryError) {
    failure.geometryError = geometryError?.message || String(geometryError)
  }
  try {
    const body = await page.screenshot({ fullPage: true, timeout: screenshotTimeout })
    await testInfo.attach(`visual-failure-${safeName}`, {
      body,
      contentType: 'image/png'
    })
    failure.screenshotAttached = true
  } catch (screenshotError) {
    failure.screenshotAttached = false
    failure.screenshotError = screenshotError?.message || String(screenshotError)
  }
  console.log(`SECONDARY_SURFACE_FAILURE_DETAIL=${JSON.stringify(failure)}`)
}

function formatFailures (failures) {
  return failures.map(failure => JSON.stringify(failure, null, 2)).join('\n\n')
}

function createMatrixStats () {
  return {
    focusSurfaceChecks: 0,
    disabledContrastChecks: 0,
    secondaryOverflowAdded: 0,
    dangerActionChecks: 0,
    dangerMenuLastChecks: 0,
    dangerSemanticGroupChecks: 0
  }
}

async function runSurfaceCase (page, testInfo, failures, context, surface, stats) {
  try {
    await resetSurface(page, context.language)
    if (surface.prepare) await surface.prepare(page)
    const documentBaseline = await inspectDocumentBaseline(page)
    console.log(`SECONDARY_MAIN_CHROME_BASELINE=${JSON.stringify({ ...context, surface: surface.name, ...documentBaseline })}`)
    await surface.open(page)
    const snapshot = await inspectSurface(page, surface.selector, surface.menu, documentBaseline)
    const surfaceContext = { ...context, surface: surface.name }
    stats.disabledContrastChecks += snapshot.disabledContrast.length
    stats.secondaryOverflowAdded += snapshot.documentOverflowDetails.reduce((total, item) => {
      return total + Math.max(0, item.scrollWidth - item.allowedScrollWidth)
    }, 0)
    stats.dangerActionChecks += snapshot.dangerIndexes.length
    if (surface.dangerPolicy === 'menu-last') stats.dangerMenuLastChecks += snapshot.dangerIndexes.length
    if (surface.dangerPolicy === 'semantic-group-last') stats.dangerSemanticGroupChecks += snapshot.dangerIndexes.length
    assertSurfaceSnapshot(snapshot, surfaceContext, surface)
    const focus = await inspectKeyboardFocus(page, surface)
    assertFocusSnapshot(focus, surfaceContext)
    stats.focusSurfaceChecks += 1
    if (surface.name === 'theme-center') {
      const background = await page.locator('.sp-theme-preview-terminal').evaluate(element => {
        return window.getComputedStyle(element).backgroundColor
      })
      expect(background).toBe(lockedTerminalRgb)
    }
  } catch (error) {
    await recordCaseFailure(page, testInfo, failures, { ...context, surface: surface.name }, error)
  }
}

async function exerciseLanguageAndThemeState (page) {
  await resetSurface(page, 'zh_cn')
  await openSettings(page)
  const initial = await page.evaluate(() => ({
    language: window.store.config.language,
    locales: window.et.langs.length
  }))
  expect(initial.locales).toBe(14)
  const targetLanguage = initial.language === 'en_us' ? 'zh_cn' : 'en_us'
  const targetText = await page.evaluate((language) => {
    return window.et.langs.find(item => item.id === language)?.name || ''
  }, targetLanguage)
  expect(targetText).not.toBe('')
  const languageSelect = page.locator('.setting-header .ant-select')
  const languageCombobox = languageSelect.getByRole('combobox')
  const chooseTargetOption = async () => {
    if (await languageCombobox.getAttribute('aria-expanded') !== 'true') {
      await languageCombobox.press('ArrowDown')
    }
    await expect(languageCombobox).toHaveAttribute('aria-expanded', 'true', { timeout: 5000 })
    await languageCombobox.press('Home')
    await expect(languageCombobox).toHaveAttribute('aria-activedescendant', /.+/, { timeout: 5000 })
    const visitedOptions = []
    for (let step = 0; step < initial.locales; step += 1) {
      const activeId = await languageCombobox.getAttribute('aria-activedescendant')
      const activeOption = page.locator(`[role="option"][id=${JSON.stringify(activeId)}]`)
      await expect(activeOption).toBeAttached({ timeout: 5000 })
      const activeText = (await activeOption.textContent())?.trim()
      visitedOptions.push({ activeId, activeText })
      if (activeText === targetText) {
        await languageCombobox.press('Enter')
        await expect(languageCombobox).toHaveAttribute('aria-expanded', 'false', { timeout: 5000 })
        return
      }
      await languageCombobox.press('ArrowDown')
    }
    throw new Error(`Language option was not reached: ${JSON.stringify({ targetLanguage, targetText, visitedOptions })}`)
  }
  await chooseTargetOption()
  expect(await page.evaluate(() => window.store.previewLanguage)).toBe(targetLanguage)
  expect(await page.evaluate(() => window.store.config.language)).toBe(initial.language)
  await page.locator('.setting-header button.ant-btn-default').click()
  expect(await page.evaluate(() => window.store.previewLanguage)).toBe('')
  expect(await page.evaluate(() => window.store.config.language)).toBe(initial.language)

  await chooseTargetOption()
  await page.locator('.setting-header button.ant-btn-primary').click()
  expect(await page.evaluate(() => window.store.previewLanguage)).toBe('')
  expect(await page.evaluate(() => window.store.config.language)).toBe(targetLanguage)

  await page.evaluate((language) => window.store.setConfig({ language }), initial.language)
  await resetSurface(page, 'en_us')
  await openThemes(page)
  const initialTheme = await page.evaluate(() => window.store.config.theme)
  const themeCards = page.locator('.sp-theme-card')
  await expect.poll(() => themeCards.count(), { timeout: 20000 }).toBeGreaterThanOrEqual(7)
  const oceanCard = themeCards.nth(2)
  const oceanActions = oceanCard.locator('.sp-theme-card-actions button')
  await oceanActions.nth(1).click()
  expect(await page.evaluate(() => window.store.config.theme)).toBe(initialTheme)
  await oceanActions.nth(2).click()
  await expect.poll(() => page.evaluate(() => window.store.config.theme)).toBe('shellpilot-ocean')
  await page.evaluate((theme) => window.store.setTheme(theme), initialTheme)
}

test('active terminal session tab keeps the locked SSH background', async ({ browserName }) => {
  await runWithIsolatedApp('terminal', async (electronApp) => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
    await ensureTwoTerminalTabs(page)
    const terminal = await inspectTerminalInvariant(page)
    assertTerminalInvariant(terminal, { runner: browserName, surface: 'terminal-invariant' })
  })
})

test('theme center deletes the active terminal palette without changing the ShellPilot UI palette', async ({ browserName }) => {
  await runWithIsolatedApp('terminal-theme-deletion', async (electronApp) => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
    await setWindowCase(electronApp, page, { width: 1100, height: 700 }, 1)
    await resetSurface(page, 'en_us')
    const themeId = `deletion-lifecycle-${Date.now()}`
    await page.evaluate((id) => {
      window.store.addTheme({
        id,
        name: 'Deletion Lifecycle Theme',
        uiThemeConfig: { main: '#20252D', text: '#F4F7FB' },
        themeConfig: { foreground: '#D7DEE8', background: '#FFFFFF' }
      })
      window.store.updateConfig({
        theme: 'shellpilot-ocean',
        terminalTheme: id
      })
      window.store.openTerminalThemes()
    }, themeId)
    const card = page.locator('.sp-theme-card').filter({ hasText: 'Deletion Lifecycle Theme' })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Delete Deletion Lifecycle Theme' }).click()
    await page.locator('.ant-popconfirm:visible')
      .getByRole('button', { name: 'Delete', exact: true })
      .click()
    await expect(card).toBeHidden()

    const state = await page.evaluate((id) => ({
      theme: window.store.config.theme,
      terminalTheme: window.store.config.terminalTheme,
      stored: window.store.terminalThemes.some(theme => theme.id === id)
    }), themeId)
    expect(state, JSON.stringify({ runner: browserName, state })).toEqual({
      theme: 'shellpilot-ocean',
      terminalTheme: 'default',
      stored: false
    })
  })
})

test('settings search supports visible results, keyboard navigation, preview language and compact mouse entry', async ({ browserName }) => {
  await runWithIsolatedApp('settings-search', async (electronApp) => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })

    await setWindowCase(electronApp, page, { width: 1100, height: 700 }, 1)
    await resetSurface(page, 'en_us')
    const protectedShortcutEvents = await page.evaluate(() => {
      const fixtures = [
        ['input', Object.assign(document.createElement('input'), { type: 'text' })],
        ['textarea', document.createElement('textarea')],
        ['contenteditable', document.createElement('div')],
        ['xterm', document.createElement('textarea')]
      ]
      fixtures[2][1].contentEditable = 'true'
      fixtures[3][1].className = 'xterm-helper-textarea'
      const results = {}
      for (const [name, element] of fixtures) {
        element.style.position = 'fixed'
        element.style.left = '-9999px'
        document.body.appendChild(element)
        element.focus()
        const event = new window.KeyboardEvent('keydown', {
          key: 'k',
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
        element.dispatchEvent(event)
        results[name] = event.defaultPrevented
        element.remove()
      }
      const composing = new window.KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true
      })
      document.body.dispatchEvent(composing)
      results.composing = composing.defaultPrevented
      return results
    })
    expect(protectedShortcutEvents).toEqual({
      input: false,
      textarea: false,
      contenteditable: false,
      xterm: false,
      composing: false
    })
    expect(await page.locator('.setting-wrap').count()).toBe(0)

    await page.keyboard.press('Control+K')
    await page.locator('.setting-wrap').waitFor({ state: 'visible' })
    const searchInput = page.locator('.setting-header-search input')
    await expect(searchInput).toBeFocused()
    await expect(searchInput).toHaveAttribute('role', 'combobox')
    await expect(searchInput).toHaveAttribute('aria-expanded', 'false')
    await searchInput.fill('model')
    const results = page.locator('.setting-search-results[role="listbox"]')
    await expect(results).toBeVisible()
    await expect(searchInput).toHaveAttribute('aria-expanded', 'true')
    await expect(searchInput).toHaveAttribute('aria-controls', 'setting-search-results')
    await expect(results.getByRole('option')).toHaveCount(1)
    await expect(results.getByRole('option')).toHaveText('AI and Models')
    await searchInput.press('ArrowDown')
    await expect(results.getByRole('option')).toHaveAttribute('aria-selected', 'true')
    const activeResultId = await results.getByRole('option').getAttribute('id')
    await expect(searchInput).toHaveAttribute('aria-activedescendant', activeResultId)
    await searchInput.press('ArrowUp')
    await expect(results.getByRole('option')).toHaveAttribute('aria-selected', 'true')
    await searchInput.press('Escape')
    await expect(results).toBeHidden()
    await expect(searchInput).toHaveAttribute('aria-expanded', 'false')
    await searchInput.fill('model')
    await expect(results).toBeVisible()

    await page.evaluate(() => { window.store.previewLanguage = 'zh_cn' })
    await expect(results.getByRole('option')).toHaveText('AI 与模型')
    await page.evaluate(() => { window.store.previewLanguage = 'en_us' })
    await expect(results.getByRole('option')).toHaveText('AI and Models')
    await results.getByRole('option').click()
    await expect(results).toBeHidden()
    expect(await page.evaluate(() => ({
      tab: window.store.settingTab,
      item: window.store.settingItem.id
    })), JSON.stringify({ runner: browserName })).toEqual({
      tab: 'setting',
      item: 'setting-ai'
    })

    await page.keyboard.press('Control+K')
    await expect(searchInput).toBeFocused()
    await searchInput.fill('theme')
    await searchInput.press('ArrowDown')
    await expect(page.locator('.setting-search-results [role="option"]')).toHaveAttribute('aria-selected', 'true')
    await searchInput.press('Enter')
    expect(await page.evaluate(() => window.store.settingTab)).toBe('terminalThemes')

    await resetSurface(page, 'en_us')
    await setWindowCase(electronApp, page, { width: 590, height: 400 }, 1)
    await openSettings(page)
    const compactToggle = page.locator('.setting-header-search-toggle')
    const compactSearch = page.locator('.setting-header-search')
    await expect(compactToggle).toBeVisible()
    await expect(compactSearch).toBeHidden()
    const collapsedMetrics = await page.locator('.setting-header').evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }))
    expect(collapsedMetrics.scrollWidth, JSON.stringify({ runner: browserName, collapsedMetrics }))
      .toBeLessThanOrEqual(collapsedMetrics.clientWidth)

    await compactToggle.click()
    await expect(compactSearch).toBeVisible()
    await expect(searchInput).toBeFocused()
    await searchInput.fill('model')
    await expect(page.locator('.setting-search-results')).toBeVisible()
    const expandedMetrics = await page.locator('.setting-header').evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }))
    expect(expandedMetrics.scrollWidth, JSON.stringify({ runner: browserName, expandedMetrics }))
      .toBeLessThanOrEqual(expandedMetrics.clientWidth)
  })
})

test('context menus keep pointer placement and compact long-menu reachability', async ({ browserName }) => {
  await runWithIsolatedApp('context-menu-placement', async (electronApp) => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })

    await setWindowCase(electronApp, page, { width: 1100, height: 700 }, 1)
    await resetSurface(page, 'en_us')
    await openSettings(page)
    const input = page.locator('.setting-header input').first()
    await input.fill('theme')
    await input.evaluate(element => element.setSelectionRange(0, element.value.length))
    const pointer = await dispatchContextMenu(input)
    const shortMenu = page.locator('.shellpilot-context-menu.ant-dropdown:visible').last()
    await shortMenu.waitFor()
    await waitForPopupMotion(shortMenu)
    const shortRect = await shortMenu.evaluate(element => element.getBoundingClientRect().toJSON())
    expect(shortRect.top, JSON.stringify({ runner: browserName, pointer, shortRect }))
      .toBeGreaterThanOrEqual(pointer.y - 8)
    expect(shortRect.top, JSON.stringify({ runner: browserName, pointer, shortRect }))
      .toBeLessThanOrEqual(pointer.y + 24)

    await resetSurface(page, 'en_us')
    await setWindowCase(electronApp, page, { width: 590, height: 400 }, 1.5)
    const baseline = await inspectDocumentBaseline(page)
    await openTerminalMenu(page)
    const longMenu = page.locator('.shellpilot-context-menu.ant-dropdown:visible').last()
    const snapshot = await inspectSurface(page, '.shellpilot-context-menu.ant-dropdown:visible', true, baseline)
    expect(snapshot.documentOverflow, JSON.stringify({ runner: browserName, snapshot })).toBe(false)
    expect(snapshot.menuViewportClip, JSON.stringify({ runner: browserName, snapshot })).toBe(false)
    expect(snapshot.menuScroll.scrollHeight, JSON.stringify({ runner: browserName, snapshot }))
      .toBeGreaterThan(snapshot.menuScroll.clientHeight)
    expect(snapshot.menuScroll.overflowY, JSON.stringify({ runner: browserName, snapshot })).toBe('auto')
    const reachability = await longMenu.locator('.ant-dropdown-menu').evaluate(menu => {
      const items = [...menu.querySelectorAll('[role="menuitem"]')]
      const visibleInside = item => {
        const itemRect = item.getBoundingClientRect()
        const menuRect = menu.getBoundingClientRect()
        return itemRect.top >= menuRect.top - 1 && itemRect.bottom <= menuRect.bottom + 1
      }
      menu.scrollTop = 0
      const firstReachable = visibleInside(items[0])
      items.at(-1).scrollIntoView({ block: 'nearest' })
      return {
        itemCount: items.length,
        firstReachable,
        lastReachable: visibleInside(items.at(-1)),
        scrollTop: menu.scrollTop,
        maxScrollTop: menu.scrollHeight - menu.clientHeight
      }
    })
    expect(reachability.itemCount, JSON.stringify({ runner: browserName, reachability })).toBeGreaterThan(1)
    expect(reachability.firstReachable, JSON.stringify({ runner: browserName, reachability })).toBe(true)
    expect(reachability.lastReachable, JSON.stringify({ runner: browserName, reachability })).toBe(true)
    expect(reachability.scrollTop, JSON.stringify({ runner: browserName, reachability })).toBeGreaterThan(0)
    expect(reachability.scrollTop, JSON.stringify({ runner: browserName, reachability }))
      .toBeLessThanOrEqual(reachability.maxScrollTop + 1)
  })
})

test('tool center and batch editor stay reachable in compact real app windows', async ({ browserName }) => {
  let compactChecks = 0
  await runWithIsolatedApp('compact-tools', async (electronApp) => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
    const compactSizes = [
      { width: 820, height: 600 },
      { width: 590, height: 400 },
      { width: 472, height: 320 },
      { width: 393, height: 267 }
    ]

    for (const size of compactSizes) {
      await setWindowCase(electronApp, page, size, 1)
      await resetSurface(page, 'en_us')
      await openWidgets(page)
      const metrics = await page.locator('.setting-tabs-widgets').evaluate(root => {
        const shell = root.querySelector('.widgets-shell')
        const cards = root.querySelector('.widgets-card-list')
        const style = window.getComputedStyle(root)
        const cardsStyle = window.getComputedStyle(cards)
        return {
          rootClientWidth: root.clientWidth,
          rootScrollWidth: root.scrollWidth,
          rootOverflowY: style.overflowY,
          shellClientWidth: shell.clientWidth,
          shellScrollWidth: shell.scrollWidth,
          cardsClientWidth: cards.clientWidth,
          cardsScrollWidth: cards.scrollWidth,
          cardsClientHeight: cards.clientHeight,
          cardsScrollHeight: cards.scrollHeight,
          cardsOverflowY: cardsStyle.overflowY,
          cardCount: cards.querySelectorAll('.widget-card').length
        }
      })
      const context = JSON.stringify({ runner: browserName, size, metrics })
      expect(metrics.rootScrollWidth, context).toBeLessThanOrEqual(metrics.rootClientWidth)
      expect(metrics.shellScrollWidth, context).toBeLessThanOrEqual(metrics.shellClientWidth)
      expect(metrics.cardsScrollWidth, context).toBeLessThanOrEqual(metrics.cardsClientWidth)
      expect(metrics.rootOverflowY, context).toBe('auto')
      expect(metrics.cardsOverflowY, context).toBe('auto')
      expect(metrics.cardsScrollHeight, context).toBeGreaterThan(metrics.cardsClientHeight)
      expect(metrics.cardCount, context).toBeGreaterThan(0)

      const lastCard = page.locator('.widgets-card-list .widget-card').last()
      await lastCard.scrollIntoViewIfNeeded()
      await expect(lastCard).toBeVisible()

      await selectBatchWidget(page)
      const editor = page.locator('.batch-op-editor')
      await editor.scrollIntoViewIfNeeded()
      const editorMetrics = await editor.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return {
          width: rect.width,
          height: rect.height,
          top: rect.top,
          bottom: rect.bottom,
          horizontalOverflow: element.scrollWidth > element.clientWidth + 1
        }
      })
      expect(editorMetrics.width, context).toBeGreaterThan(0)
      expect(editorMetrics.height, context).toBeGreaterThan(0)
      expect(editorMetrics.top, context).toBeLessThan(size.height)
      expect(editorMetrics.bottom, context).toBeGreaterThan(0)
      expect(editorMetrics.horizontalOverflow, context).toBe(false)
      compactChecks += 1
    }

    console.log(`SECONDARY_TOOL_CENTER_COMPACT_CHECKS=${compactChecks}`)
    expect(compactChecks).toBe(4)
  })
})

test('real app covers the secondary UI visual acceptance matrix', async ({ browserName }, testInfo) => {
  const runner = browserName
  const expected = assertMatrixConfiguration()
  const failures = []
  const stats = createMatrixStats()
  let dimensionChecks = 0
  let themeChecks = 0
  await runWithIsolatedApp('matrix', async (electronApp) => {
    try {
      const page = electronApp.windows()[0] || await electronApp.firstWindow()
      await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
      await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
      await exerciseLanguageAndThemeState(page)

      for (const size of matrixSizes) {
        for (const zoom of matrixZooms) {
          await setWindowCase(electronApp, page, size, zoom)
          for (const language of matrixLanguages) {
            const context = { matrix: 'dimension', runner, size: `${size.width}x${size.height}`, zoom, language }
            await resetSurface(page, language)
            const failuresBeforeCase = failures.length
            for (const surface of surfaces) {
              await runSurfaceCase(page, testInfo, failures, context, surface, stats)
              dimensionChecks += 1
            }
            try {
              await resetSurface(page, language)
              await ensureTwoTerminalTabs(page)
              const terminal = await inspectTerminalInvariant(page)
              assertTerminalInvariant(terminal, context)
            } catch (error) {
              await recordCaseFailure(page, testInfo, failures, { ...context, surface: 'terminal-invariant' }, error)
            }
            const caseFailures = failures.length - failuresBeforeCase
            console.log(`SECONDARY_DIMENSION_CASE=${JSON.stringify({ ...context, surfaces: surfaces.length, failures: caseFailures })}`)
            if (caseFailures) {
              throw new Error(formatFailures(failures.slice(failuresBeforeCase)))
            }
          }
        }
      }

      for (const theme of matrixThemes) {
        await page.evaluate((themeId) => window.store.setTheme(themeId), theme)
        for (const size of matrixThemeSizes) {
          await setWindowCase(electronApp, page, size, 1)
          const context = { matrix: 'theme', runner, size: `${size.width}x${size.height}`, zoom: 1, language: 'en_us', theme }
          await resetSurface(page, 'en_us')
          const failuresBeforeCase = failures.length
          for (const surface of surfaces) {
            await runSurfaceCase(page, testInfo, failures, context, surface, stats)
            themeChecks += 1
          }
          try {
            await resetSurface(page, 'en_us')
            await ensureTwoTerminalTabs(page)
            const terminal = await inspectTerminalInvariant(page)
            assertTerminalInvariant(terminal, context)
          } catch (error) {
            await recordCaseFailure(page, testInfo, failures, { ...context, surface: 'terminal-invariant' }, error)
          }
          const caseFailures = failures.length - failuresBeforeCase
          console.log(`SECONDARY_THEME_CASE=${JSON.stringify({ ...context, surfaces: surfaces.length, failures: caseFailures })}`)
          if (caseFailures) {
            throw new Error(formatFailures(failures.slice(failuresBeforeCase)))
          }
        }
      }

      console.log(`SECONDARY_DIMENSION_SURFACE_CHECKS=${dimensionChecks}`)
      console.log(`SECONDARY_THEME_SURFACE_CHECKS=${themeChecks}`)
      console.log(`SECONDARY_TOTAL_SURFACE_CHECKS=${dimensionChecks + themeChecks}`)
      console.log(`SECONDARY_FOCUS_SURFACE_CHECKS=${stats.focusSurfaceChecks}`)
      console.log(`SECONDARY_DISABLED_CONTRAST_CHECKS=${stats.disabledContrastChecks}`)
      console.log(`SECONDARY_OVERFLOW_ADDED=${stats.secondaryOverflowAdded}`)
      console.log(`SECONDARY_DANGER_ACTION_CHECKS=${stats.dangerActionChecks}`)
      console.log(`SECONDARY_DANGER_MENU_LAST_CHECKS=${stats.dangerMenuLastChecks}`)
      console.log(`SECONDARY_DANGER_SEMANTIC_GROUP_CHECKS=${stats.dangerSemanticGroupChecks}`)
      console.log(`SECONDARY_VISUAL_FAILURES=${failures.length}`)
      expect(dimensionChecks).toBe(expected.dimension)
      expect(themeChecks).toBe(expected.theme)
      expect(dimensionChecks + themeChecks).toBe(expected.total)
      expect(stats.focusSurfaceChecks).toBe(expected.total)
      expect(stats.secondaryOverflowAdded).toBe(0)
      expect(stats.dangerMenuLastChecks).toBe(expected.dimensionBatches + expected.themeBatches)
      expect(stats.dangerSemanticGroupChecks).toBe(expected.dimensionBatches + expected.themeBatches)
      expect(failures, formatFailures(failures)).toEqual([])
    } finally {
      try {
        const page = electronApp.windows()[0]
        if (page) {
          await page.evaluate((id) => {
            const bookmark = window.store.bookmarks.find(item => item.id === id)
            if (bookmark) window.store.delBookmark(bookmark)
          }, bookmarkId)
        }
      } catch {}
    }
  })
})
