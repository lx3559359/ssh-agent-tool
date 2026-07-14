const { promises: fs } = require('fs')
const { tmpdir } = require('os')
const { resolve, sep } = require('path')
const { _electron: electron, test, expect } = require('@playwright/test')
const appOptions = require('./common/app-options')

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
const requestedZoom = Number(process.env.SHELLPILOT_VISUAL_MATRIX_ZOOM)
const requestedLanguage = process.env.SHELLPILOT_VISUAL_MATRIX_LANGUAGE
const dimensionOnly = process.env.SHELLPILOT_VISUAL_MATRIX_DIMENSION_ONLY === '1'
const matrixSizes = requestedSize
  ? sizes.filter(size => `${size.width}x${size.height}` === requestedSize)
  : smokeMatrix ? [sizes[0]] : sizes
const matrixZooms = Number.isFinite(requestedZoom) && requestedZoom > 0
  ? [requestedZoom]
  : smokeMatrix ? [zooms[0]] : zooms
const matrixLanguages = languages.includes(requestedLanguage)
  ? [requestedLanguage]
  : smokeMatrix ? [languages[0]] : languages
const matrixThemes = dimensionOnly ? [] : smokeMatrix ? [themeIds[0]] : themeIds
const matrixThemeSizes = smokeMatrix ? [sizes[0]] : [sizes[0], sizes[2]]
const lockedTerminalRgb = 'rgb(14, 15, 18)'
const profilePrefix = 'shellpilot-secondary-visual-'
const profileRoot = resolve(tmpdir(), `${profilePrefix}${process.pid}-${Date.now()}`)
const bookmarkId = `visual-matrix-${process.pid}`

test.setTimeout(20 * 60 * 1000)

function launchOptions () {
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

function assertSafeProfileRoot () {
  const tempRoot = resolve(tmpdir()) + sep
  if (!profileRoot.startsWith(tempRoot) || !profileRoot.includes(profilePrefix)) {
    throw new Error(`Refusing to use unexpected visual profile: ${profileRoot}`)
  }
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
}

async function openBatch (page) {
  await page.evaluate(async () => {
    window.store.openWidgetsModal()
    const widgets = await window.store.listWidgets()
    window.store.setSettingItem(widgets.find(widget => widget.id === 'batch-op'))
  })
  await page.locator('.batch-op-editor').waitFor({ state: 'visible' })
}

async function dispatchContextMenu (locator) {
  await locator.evaluate(element => {
    const rect = element.getBoundingClientRect()
    element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: Math.max(1, Math.min(window.innerWidth - 2, rect.left + Math.min(48, rect.width / 2))),
      clientY: Math.max(1, Math.min(window.innerHeight - 2, rect.top + Math.min(32, rect.height / 2)))
    }))
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
  await ensureVisualBookmark(page)
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
  { name: 'bookmark-menu', selector: '.shellpilot-context-menu.ant-dropdown:visible', open: openBookmarkMenu, menu: true },
  { name: 'terminal-menu', selector: '.shellpilot-context-menu.ant-dropdown:visible', open: openTerminalMenu, menu: true },
  { name: 'input-menu', selector: '.shellpilot-context-menu.ant-dropdown:visible', open: openInputMenu, menu: true }
]

async function makePrimaryActionsReachable (page, selector) {
  const buttons = page.locator(`${selector} button.ant-btn-primary:visible`)
  const count = await buttons.count()
  for (let index = 0; index < count; index += 1) {
    await buttons.nth(index).scrollIntoViewIfNeeded()
  }
}

async function inspectSurface (page, selector, menu) {
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
    const disabledUnreadable = [...root.querySelectorAll('[disabled], .ant-dropdown-menu-item-disabled')]
      .filter(visible)
      .flatMap((element, index) => {
        const style = window.getComputedStyle(element)
        const color = style.color
        const unreadable = Number.parseFloat(style.opacity || '1') < 0.25 ||
          color === 'rgba(0, 0, 0, 0)' || color === 'transparent'
        return unreadable ? [{ index, text: element.textContent.trim(), color, opacity: style.opacity }] : []
      })
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
    const dangerNotAtBottom = menuItems.some(item => {
      if (!item.classList.contains('ant-dropdown-menu-item-danger')) return false
      const next = item.nextElementSibling
      return Boolean(next && !next.classList.contains('ant-dropdown-menu-item-divider'))
    })
    const rect = root.getBoundingClientRect()
    const rootStyle = window.getComputedStyle(root)
    const menuElement = options.menu ? root.querySelector('.ant-dropdown-menu') : null
    const menuStyle = menuElement ? window.getComputedStyle(menuElement) : null
    const rootContentOverflow = root.scrollWidth > root.clientWidth + 1 &&
      !['auto', 'scroll'].includes(rootStyle.overflowX)
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      rootContentOverflow,
      rootScrollWidth: root.scrollWidth,
      rootClientWidth: root.clientWidth,
      rootOverflowX: rootStyle.overflowX,
      rootRect: rect.toJSON(),
      rootHorizontalClip: rect.left < -1 || rect.right > window.innerWidth + 1,
      menuViewportClip: Boolean(options.menu && (
        rect.left < 7 || rect.right > window.innerWidth - 7 ||
        rect.top < 7 || rect.bottom > window.innerHeight - 7
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
      dangerIndexes,
      lastActionIndex,
      dangerNotAtBottom
    }
  }, { menu })
}

function assertSurfaceSnapshot (snapshot, context) {
  expect(snapshot.rootContentOverflow, JSON.stringify({ context, snapshot })).toBe(false)
  expect(snapshot.rootHorizontalClip, JSON.stringify({ context, snapshot })).toBe(false)
  expect(snapshot.menuViewportClip, JSON.stringify({ context, snapshot })).toBe(false)
  expect(snapshot.clippedText, JSON.stringify({ context, snapshot })).toEqual([])
  expect(snapshot.primaryClipping, JSON.stringify({ context, snapshot })).toEqual([])
  expect(snapshot.overlaps, JSON.stringify({ context, snapshot })).toEqual([])
  expect(snapshot.disabledUnreadable, JSON.stringify({ context, snapshot })).toEqual([])
  expect(snapshot.dangerNotAtBottom, JSON.stringify({ context, snapshot })).toBe(false)
}

async function inspectTerminalInvariant (page) {
  return page.evaluate(() => {
    const selectors = [
      '.tabs .tab.active',
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
  failures.push(`${JSON.stringify(context)}\n${error.stack || error.message}`)
  console.log(`SECONDARY_SURFACE_FAILURE=${JSON.stringify(context)}`)
  const safeName = Object.values(context).join('-').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 120)
  await testInfo.attach(`visual-failure-${safeName}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  })
}

async function runSurfaceCase (page, testInfo, failures, context, surface) {
  try {
    await resetSurface(page, context.language)
    await surface.open(page)
    const snapshot = await inspectSurface(page, surface.selector, surface.menu)
    assertSurfaceSnapshot(snapshot, { ...context, surface: surface.name })
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
  const targetText = targetLanguage === 'en_us' ? 'English' : '简体中文'
  const languageSelect = page.locator('.setting-header .ant-select')
  const targetOption = () => page.locator(
    `.ant-select-dropdown:visible .rc-virtual-list-holder-inner .ant-select-item-option[title="${targetText}"]`
  )
  await languageSelect.click()
  await targetOption().click()
  expect(await page.evaluate(() => window.store.previewLanguage)).toBe(targetLanguage)
  expect(await page.evaluate(() => window.store.config.language)).toBe(initial.language)
  await page.locator('.setting-header button.ant-btn-default').click()
  expect(await page.evaluate(() => window.store.previewLanguage)).toBe('')
  expect(await page.evaluate(() => window.store.config.language)).toBe(initial.language)

  await languageSelect.click()
  await targetOption().click()
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
  assertSafeProfileRoot()
  const electronApp = await electron.launch(launchOptions())
  try {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
    const terminal = await inspectTerminalInvariant(page)
    assertTerminalInvariant(terminal, { runner: browserName, surface: 'terminal-invariant' })
  } finally {
    await electronApp.close().catch(() => electronApp.process().kill())
    await fs.rm(profileRoot, { recursive: true, force: true })
  }
})

test('tool center and batch editor stay reachable in compact real app windows', async ({ browserName }) => {
  assertSafeProfileRoot()
  const electronApp = await electron.launch(launchOptions())
  let compactChecks = 0
  try {
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

      await page.evaluate(async () => {
        const widgets = await window.store.listWidgets()
        window.store.setSettingItem(widgets.find(widget => widget.id === 'batch-op'))
      })
      const editor = page.locator('.batch-op-editor')
      await editor.waitFor({ state: 'visible' })
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
  } finally {
    await electronApp.close().catch(() => electronApp.process().kill())
    await fs.rm(profileRoot, { recursive: true, force: true })
  }
})

test('real app covers the secondary UI visual acceptance matrix', async ({ browserName }, testInfo) => {
  const runner = browserName
  assertSafeProfileRoot()
  const electronApp = await electron.launch(launchOptions())
  const failures = []
  let dimensionChecks = 0
  let themeChecks = 0
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
          const failuresBeforeCase = failures.length
          for (const surface of surfaces) {
            await runSurfaceCase(page, testInfo, failures, context, surface)
            dimensionChecks += 1
          }
          try {
            await resetSurface(page, language)
            const terminal = await inspectTerminalInvariant(page)
            assertTerminalInvariant(terminal, context)
          } catch (error) {
            await recordCaseFailure(page, testInfo, failures, { ...context, surface: 'terminal-invariant' }, error)
          }
          const caseFailures = failures.length - failuresBeforeCase
          console.log(`SECONDARY_DIMENSION_CASE=${JSON.stringify({ ...context, surfaces: surfaces.length, failures: caseFailures })}`)
          if (caseFailures) {
            throw new Error(failures.slice(failuresBeforeCase).join('\n\n'))
          }
        }
      }
    }

    for (const theme of matrixThemes) {
      await page.evaluate((themeId) => window.store.setTheme(themeId), theme)
      for (const size of matrixThemeSizes) {
        await setWindowCase(electronApp, page, size, 1)
        const context = { matrix: 'theme', runner, size: `${size.width}x${size.height}`, zoom: 1, language: 'en_us', theme }
        const failuresBeforeCase = failures.length
        for (const surface of surfaces) {
          await runSurfaceCase(page, testInfo, failures, context, surface)
          themeChecks += 1
        }
        try {
          await resetSurface(page, 'en_us')
          const terminal = await inspectTerminalInvariant(page)
          assertTerminalInvariant(terminal, context)
        } catch (error) {
          await recordCaseFailure(page, testInfo, failures, { ...context, surface: 'terminal-invariant' }, error)
        }
        const caseFailures = failures.length - failuresBeforeCase
        console.log(`SECONDARY_THEME_CASE=${JSON.stringify({ ...context, surfaces: surfaces.length, failures: caseFailures })}`)
        if (caseFailures) {
          throw new Error(failures.slice(failuresBeforeCase).join('\n\n'))
        }
      }
    }

    console.log(`SECONDARY_DIMENSION_SURFACE_CHECKS=${dimensionChecks}`)
    console.log(`SECONDARY_THEME_SURFACE_CHECKS=${themeChecks}`)
    console.log(`SECONDARY_VISUAL_FAILURES=${failures.length}`)
    expect(failures, failures.join('\n\n')).toEqual([])
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
    await electronApp.close().catch(() => electronApp.process().kill())
    await fs.rm(profileRoot, { recursive: true, force: true })
  }
})
