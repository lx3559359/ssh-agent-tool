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

async function captureWindowState (electronApp) {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window || window.isDestroyed()) {
      throw new Error('Cannot capture state for a closed BrowserWindow')
    }
    const [minimumWidth, minimumHeight] = window.getMinimumSize()
    const [contentWidth, contentHeight] = window.getContentSize()
    return {
      minimumSize: { width: minimumWidth, height: minimumHeight },
      contentSize: { width: contentWidth, height: contentHeight },
      bounds: window.getBounds(),
      zoom: window.webContents.getZoomFactor()
    }
  })
}

async function restoreWindowState (electronApp, page, state) {
  const result = await electronApp.evaluate(({ BrowserWindow }, original) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window || window.isDestroyed()) {
      return { restored: false, reason: 'window-closed' }
    }
    const webContents = window.webContents
    if (webContents && !webContents.isDestroyed()) {
      webContents.setZoomFactor(original.zoom)
    }
    window.setContentSize(original.contentSize.width, original.contentSize.height)
    window.setBounds(original.bounds)
    window.setMinimumSize(original.minimumSize.width, original.minimumSize.height)
    return { restored: true }
  }, state)
  if (result.restored && !page.isClosed()) await page.waitForTimeout(160)
  return result
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
    store.upgradeInfo.showUpgradeModal = false
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

async function inspectSettingsControlStates (page) {
  const form = page.locator('.sp-settings-form')
  let result
  let cleanup = { fixtureRemoved: false, focusRestored: false }

  try {
    result = await form.evaluate(form => {
      const fixture = document.createElement('div')
      fixture.dataset.settingsStateFixture = 'true'
      fixture.style.position = 'fixed'
      fixture.style.left = '8px'
      fixture.style.bottom = '8px'
      fixture.style.width = '240px'
      fixture.style.zIndex = '9999'
      fixture.style.display = 'grid'
      fixture.style.gap = '4px'
      fixture.__previousSettingsFocus = document.activeElement
      form.appendChild(fixture)

      const snapshot = element => {
        const style = window.getComputedStyle(element)
        return {
          background: style.backgroundColor,
          border: style.borderTopColor,
          color: style.color,
          shadow: style.boxShadow
        }
      }
      const resolveToken = (token, property) => {
        const probe = document.createElement('span')
        probe.style[property] = `var(${token})`
        fixture.appendChild(probe)
        const value = window.getComputedStyle(probe)[property]
        probe.remove()
        return value
      }
      const createControl = kind => {
        let root
        let target
        let focusable
        let focusClasses
        let errorClasses
        let disabledClasses

        if (kind === 'input' || kind === 'textarea') {
          root = document.createElement(kind)
          root.className = 'ant-input ant-input-outlined'
          target = root
          focusable = root
          focusClasses = ['ant-input-focused']
          errorClasses = ['ant-input-status-error']
          disabledClasses = ['ant-input-disabled']
        } else if (kind === 'affix') {
          root = document.createElement('div')
          root.className = 'ant-input-affix-wrapper ant-input-outlined'
          focusable = document.createElement('input')
          focusable.className = 'ant-input'
          root.appendChild(focusable)
          target = root
          focusClasses = ['ant-input-affix-wrapper-focused']
          errorClasses = ['ant-input-status-error', 'ant-input-affix-wrapper-status-error']
          disabledClasses = ['ant-input-affix-wrapper-disabled']
        } else if (kind === 'inputNumber') {
          root = document.createElement('div')
          root.className = 'ant-input-number ant-input-number-outlined'
          focusable = document.createElement('input')
          focusable.className = 'ant-input-number-input'
          root.appendChild(focusable)
          target = root
          focusClasses = ['ant-input-number-focused']
          errorClasses = ['ant-input-number-status-error']
          disabledClasses = ['ant-input-number-disabled']
        } else {
          root = document.createElement('div')
          root.className = 'ant-select ant-select-outlined'
          root.tabIndex = 0
          target = document.createElement('div')
          target.className = 'ant-select-selector'
          root.appendChild(target)
          focusable = root
          focusClasses = ['ant-select-focused']
          errorClasses = ['ant-select-status-error']
          disabledClasses = ['ant-select-disabled']
        }

        root.style.minHeight = '28px'
        return { root, target, focusable, focusClasses, errorClasses, disabledClasses }
      }
      const setClasses = (element, classes, enabled) => {
        for (const className of classes) element.classList.toggle(className, enabled)
      }
      const setFocused = (control, enabled) => {
        if (enabled) {
          control.focusable.focus()
        } else {
          control.focusable.blur()
        }
        setClasses(control.root, control.focusClasses, enabled)
      }
      const inspectControl = kind => {
        const control = createControl(kind)
        fixture.appendChild(control.root)
        const normal = snapshot(control.target)

        setFocused(control, true)
        const focus = snapshot(control.target)
        const focusInnerShadow = kind === 'affix' ? snapshot(control.focusable).shadow : null
        setFocused(control, false)

        setClasses(control.root, control.errorClasses, true)
        const error = snapshot(control.target)
        setFocused(control, true)
        const errorFocus = snapshot(control.target)
        setFocused(control, false)
        setClasses(control.root, control.errorClasses, false)

        setClasses(control.root, control.disabledClasses, true)
        if ('disabled' in control.focusable) control.focusable.disabled = true
        const disabled = snapshot(control.target)
        setClasses(control.root, control.errorClasses, true)
        const disabledError = snapshot(control.target)
        control.root.remove()
        return { normal, focus, focusInnerShadow, error, errorFocus, disabled, disabledError }
      }
      const addHoverErrorControl = kind => {
        const control = createControl(kind)
        setClasses(control.root, control.errorClasses, true)
        control.root.dataset.settingsHoverError = kind
        fixture.appendChild(control.root)
      }

      const controls = {}
      for (const kind of ['input', 'textarea', 'affix', 'inputNumber', 'select']) {
        controls[kind] = inspectControl(kind)
      }
      addHoverErrorControl('input')
      addHoverErrorControl('affix')
      return {
        controls,
        tokens: {
          primary: resolveToken('--sp-primary', 'color'),
          danger: resolveToken('--sp-danger', 'color'),
          surfaceInset: resolveToken('--sp-surface-inset', 'backgroundColor'),
          surfaceSubtle: resolveToken('--sp-surface-subtle', 'backgroundColor'),
          textDisabled: resolveToken('--sp-text-disabled', 'color')
        }
      }
    })

    for (const kind of ['input', 'affix']) {
      const hoverControl = page.locator(`[data-settings-hover-error="${kind}"]`)
      await hoverControl.hover()
      result.controls[kind].errorHover = await hoverControl.evaluate(element => {
        const style = window.getComputedStyle(element)
        return {
          background: style.backgroundColor,
          border: style.borderTopColor,
          color: style.color,
          shadow: style.boxShadow
        }
      })
    }
  } finally {
    cleanup = await page.evaluate(async () => {
      const fixture = document.querySelector('[data-settings-state-fixture="true"]')
      const previousFocus = fixture?.__previousSettingsFocus
      fixture?.remove()
      await new Promise(resolve => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
      })
      if (previousFocus instanceof window.HTMLElement && previousFocus.isConnected) previousFocus.focus()
      await new Promise(resolve => window.requestAnimationFrame(resolve))
      return {
        fixtureRemoved: !document.querySelector('[data-settings-state-fixture="true"]'),
        focusRestored: document.activeElement === previousFocus
      }
    })
  }

  return { ...result, ...cleanup }
}

function assertSettingsControlStates (snapshot, context) {
  expect(snapshot.fixtureRemoved, context).toBe(true)
  expect(snapshot.focusRestored, context).toBe(true)
  for (const [kind, states] of Object.entries(snapshot.controls)) {
    const stateContext = JSON.stringify({ context, kind, states, tokens: snapshot.tokens })
    expect(states.normal.background, stateContext).toBe(snapshot.tokens.surfaceInset)
    expect(states.normal.shadow, stateContext).toContain('inset')
    expect(states.focus.border, stateContext).not.toBe(states.normal.border)
    expect(states.focus.border, stateContext).toBe(snapshot.tokens.primary)
    expect(states.focus.shadow, stateContext).not.toBe('none')
    expect(states.focus.shadow, stateContext).not.toContain('inset')
    expect(states.error.border, stateContext).not.toBe(states.normal.border)
    expect(states.error.border, stateContext).toBe(snapshot.tokens.danger)
    expect(states.errorFocus.border, stateContext).toBe(snapshot.tokens.danger)
    expect(states.errorFocus.shadow, stateContext).toBe(states.error.shadow)
    expect(states.disabled.background, stateContext).not.toBe(states.normal.background)
    expect(states.disabled.background, stateContext).toBe(snapshot.tokens.surfaceSubtle)
    expect(states.disabled.shadow, stateContext).toBe('none')
    expect(states.disabled.color, stateContext).toBe(snapshot.tokens.textDisabled)
    expect(states.disabledError.background, stateContext).toBe(snapshot.tokens.surfaceSubtle)
    expect(states.disabledError.shadow, stateContext).toBe('none')
    expect(states.disabledError.color, stateContext).toBe(snapshot.tokens.textDisabled)
  }
  expect(snapshot.controls.affix.focusInnerShadow, context).toBe('none')
  expect(snapshot.controls.input.errorHover.border, context).toBe(snapshot.tokens.danger)
  expect(snapshot.controls.input.errorHover.shadow, context).toBe(snapshot.controls.input.error.shadow)
  expect(snapshot.controls.affix.errorHover.border, context).toBe(snapshot.tokens.danger)
  expect(snapshot.controls.affix.errorHover.shadow, context).toBe(snapshot.controls.affix.error.shadow)
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

async function inspectOpenOverlayDepth (page, selectors) {
  const overlayMetrics = await page.evaluate((targetSelectors) => targetSelectors.map(selector => {
    const element = document.querySelector(selector)
    if (!element) return null
    const style = window.getComputedStyle(element)
    return {
      selector,
      shadow: style.boxShadow,
      radius: style.borderRadius,
      overflow: element.scrollWidth > element.clientWidth + 1
    }
  }).filter(Boolean), selectors)
  expect(overlayMetrics, JSON.stringify({ selectors, overlayMetrics })).toHaveLength(selectors.length)
  for (const metric of overlayMetrics) {
    expect(metric.shadow, JSON.stringify(metric)).not.toBe('none')
    expect(metric.radius, JSON.stringify(metric)).toBe('10px')
    expect(metric.overflow, JSON.stringify(metric)).toBe(false)
  }
  return overlayMetrics
}

async function inspectMenuDepth (menuRoot) {
  return menuRoot.evaluate((root) => {
    const surface = root.querySelector('.ant-dropdown-menu') || root
    const style = window.getComputedStyle(surface)
    const rootStyle = window.getComputedStyle(document.documentElement)
    const rect = surface.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    const items = [...surface.querySelectorAll('[role="menuitem"], .context-item')]
    const surfaceRect = surface.getBoundingClientRect()
    const splitShadowLayers = value => {
      if (!value || value === 'none') return []
      const layers = []
      let depth = 0
      let start = 0
      for (let index = 0; index < value.length; index += 1) {
        if (value[index] === '(') depth += 1
        if (value[index] === ')') depth -= 1
        if (value[index] === ',' && depth === 0) {
          layers.push(value.slice(start, index).trim())
          start = index + 1
        }
      }
      layers.push(value.slice(start).trim())
      return layers
    }
    const resolveStyle = (property, value) => {
      if (!value) return ''
      const probe = document.createElement('span')
      probe.style[property] = value
      document.body.appendChild(probe)
      const resolved = window.getComputedStyle(probe)[property]
      probe.remove()
      return resolved
    }
    const tokens = {
      surfaceElevated: rootStyle.getPropertyValue('--sp-surface-elevated').trim(),
      borderStrong: rootStyle.getPropertyValue('--sp-border-strong').trim(),
      highlightTop: rootStyle.getPropertyValue('--sp-highlight-top').trim(),
      shadowOverlay: rootStyle.getPropertyValue('--sp-shadow-overlay').trim()
    }
    const isReachable = item => {
      if (!item) return false
      const itemRect = item.getBoundingClientRect()
      return itemRect.top >= surfaceRect.top - 1 && itemRect.bottom <= surfaceRect.bottom + 1
    }
    return {
      radius: style.borderRadius,
      shadow: style.boxShadow,
      shadowLayers: splitShadowLayers(style.boxShadow),
      background: style.backgroundColor,
      border: style.borderTopColor,
      borderWidth: style.borderTopWidth,
      borderStyle: style.borderTopStyle,
      tokens,
      expected: {
        background: resolveStyle('backgroundColor', tokens.surfaceElevated),
        border: resolveStyle('color', tokens.borderStrong),
        highlight: resolveStyle('boxShadow', `inset 0 1px 0 ${tokens.highlightTop}`),
        overlay: resolveStyle('boxShadow', tokens.shadowOverlay)
      },
      viewport: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: window.innerWidth,
        height: window.innerHeight
      },
      rootViewport: {
        left: rootRect.left,
        top: rootRect.top,
        right: rootRect.right,
        bottom: rootRect.bottom
      },
      firstReachable: isReachable(items[0]),
      lastReachable: isReachable(items.at(-1))
    }
  })
}

function assertMenuDepth (metrics, context) {
  const message = JSON.stringify({ context, metrics })
  expect(metrics.radius, message).toBe('10px')
  expect(metrics.shadow, message).not.toBe('none')
  for (const value of Object.values(metrics.tokens)) {
    expect(value, message).not.toBe('')
  }
  expect(metrics.background, message).toBe(metrics.expected.background)
  expect(metrics.border, message).toBe(metrics.expected.border)
  expect(metrics.borderWidth, message).toBe('1px')
  expect(metrics.borderStyle, message).toBe('solid')
  expect(metrics.shadowLayers, message).toEqual([
    metrics.expected.highlight,
    metrics.expected.overlay
  ])
  expect(metrics.viewport.left, message).toBeGreaterThanOrEqual(-1)
  expect(metrics.viewport.top, message).toBeGreaterThanOrEqual(-1)
  expect(metrics.viewport.right, message).toBeLessThanOrEqual(metrics.viewport.width + 1)
  expect(metrics.viewport.bottom, message).toBeLessThanOrEqual(metrics.viewport.height + 1)
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

async function openSystemMenu (page, options = {}) {
  await page.locator('.upgrade-panel:not(.upgrade-panel-hide) .close-upgrade-panel')
    .click({ timeout: 1000 })
    .catch(() => {})
  const control = page.locator('.menu-control').first()
  if (options.dispatchClick) {
    await control.evaluate(element => element.click())
  } else {
    await control.click()
  }
  const popup = page.locator('.ant-popover:visible').filter({
    has: page.locator('.context-menu')
  }).last()
  await popup.waitFor()
  await waitForPopupMotion(popup)
  const menu = popup.locator('.context-menu')
  await menu.waitFor()
  return menu
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
      menuDepth: menuElement
        ? {
            radius: menuStyle.borderRadius,
            shadow: menuStyle.boxShadow
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
  if (surface.menu) {
    expect(snapshot.menuDepth, JSON.stringify({ context, snapshot })).not.toBeNull()
    expect(snapshot.menuDepth.radius, JSON.stringify({ context, snapshot })).toBe('10px')
    expect(snapshot.menuDepth.shadow, JSON.stringify({ context, snapshot })).not.toBe('none')
  }
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
      '.terms-box',
      '.terminal-control',
      '.term-wrap',
      '.xterm',
      '.xterm-screen',
      '.xterm-viewport'
    ]
    const effectiveBackground = element => {
      let current = element
      while (current) {
        const background = window.getComputedStyle(current).backgroundColor
        if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
          return background
        }
        current = current.parentElement
      }
      return ''
    }
    return selectors.map(selector => {
      const element = [...document.querySelectorAll(selector)].find(candidate => {
        const rect = candidate.getBoundingClientRect()
        const style = window.getComputedStyle(candidate)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
      })
      const style = element ? window.getComputedStyle(element) : null
      return {
        selector,
        found: Boolean(element),
        background: element ? effectiveBackground(element) : '',
        directBackground: style?.backgroundColor || '',
        shadow: style?.boxShadow || ''
      }
    })
  })
}

function assertTerminalInvariant (terminal, context) {
  expect(terminal, JSON.stringify({ context, terminal })).not.toEqual([])
  for (const item of terminal) {
    expect(item.found, JSON.stringify({ context, item })).toBe(true)
    expect(item.background, JSON.stringify({ context, item })).toBe(lockedTerminalRgb)
    if (item.selector !== '.xterm-screen') {
      expect(item.directBackground, JSON.stringify({ context, item })).toBe(lockedTerminalRgb)
    }
    expect(item.shadow, JSON.stringify({ context, item })).toBe('none')
  }
}

async function inspectShellChrome (page) {
  return page.evaluate(() => {
    const resolveToken = (token, property) => {
      const probe = document.createElement('span')
      probe.style[property] = `var(${token})`
      document.body.appendChild(probe)
      const value = window.getComputedStyle(probe)[property]
      probe.remove()
      return value
    }
    const shellSelectors = [
      ['topbar', '.aigshell-topbar', 'borderBottomColor'],
      ['sidebar', '.sidebar', 'borderRightColor'],
      ['rightPanel', '.right-side-panel', 'borderLeftColor'],
      ['footer', '.main-footer', 'borderTopColor']
    ]
    const interactiveSelector = [
      'button',
      'input',
      'textarea',
      'select',
      'a[href]',
      '[role="button"]',
      '[role="link"]',
      '[role="combobox"]',
      '[tabindex]',
      '.ai-icon',
      '.terminal-info-icon'
    ].join(', ')
    const renderedAndEnabled = element => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      const hiddenAncestor = element.closest('[hidden], [inert], [aria-hidden="true"]')
      return !hiddenAncestor &&
        !element.matches(':disabled, [disabled], [aria-disabled="true"]') &&
        rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity || '1') > 0
    }
    const clippingAncestors = (element, shellRoot) => {
      const result = []
      let current = element.parentElement
      while (current) {
        const style = window.getComputedStyle(current)
        const clipsX = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)
        const clipsY = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)
        if (clipsX || clipsY || current === shellRoot) {
          const rect = current.getBoundingClientRect()
          result.push({
            className: String(current.className || ''),
            root: current === shellRoot,
            clipsX,
            clipsY,
            clientWidth: current.clientWidth,
            scrollWidth: current.scrollWidth,
            horizontalScrollReachable: clipsX && current.scrollWidth > current.clientWidth + 1,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom
          })
        }
        if (current === shellRoot) break
        current = current.parentElement
      }
      return result
    }
    const shell = Object.fromEntries(shellSelectors.map(([name, selector, borderProperty]) => {
      const element = [...document.querySelectorAll(selector)].find(candidate => {
        const rect = candidate.getBoundingClientRect()
        const style = window.getComputedStyle(candidate)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
      })
      if (!element) return [name, { selector, found: false }]
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      const unreachableInteractive = [...element.querySelectorAll(interactiveSelector)]
        .filter(renderedAndEnabled)
        .flatMap(control => {
          const controlRect = control.getBoundingClientRect()
          const ancestors = clippingAncestors(control, element)
          const bounds = ancestors.reduce((current, ancestor) => ({
            left: ancestor.clipsX || ancestor.root
              ? Math.max(current.left, ancestor.left)
              : current.left,
            right: ancestor.clipsX || ancestor.root
              ? Math.min(current.right, ancestor.right)
              : current.right,
            top: ancestor.clipsY || ancestor.root
              ? Math.max(current.top, ancestor.top)
              : current.top,
            bottom: ancestor.clipsY || ancestor.root
              ? Math.min(current.bottom, ancestor.bottom)
              : current.bottom
          }), {
            left: 0,
            right: window.innerWidth,
            top: 0,
            bottom: window.innerHeight
          })
          const insideBounds = controlRect.left >= bounds.left - 1 &&
            controlRect.right <= bounds.right + 1 &&
            controlRect.top >= bounds.top - 1 &&
            controlRect.bottom <= bounds.bottom + 1
          const verticallyInsideBounds = controlRect.top >= bounds.top - 1 &&
            controlRect.bottom <= bounds.bottom + 1
          const horizontalScrollReachable = ancestors.some(ancestor => {
            return ancestor.horizontalScrollReachable &&
              controlRect.width <= ancestor.clientWidth + 1
          })
          if (insideBounds || (verticallyInsideBounds && horizontalScrollReachable)) return []
          return [{
            tag: control.tagName,
            className: String(control.className || ''),
            left: controlRect.left,
            right: controlRect.right,
            top: controlRect.top,
            bottom: controlRect.bottom,
            bounds,
            clippingAncestors: ancestors
          }]
        })
      return [name, {
        selector,
        found: true,
        background: style.backgroundColor,
        border: style[borderProperty],
        shadow: style.boxShadow,
        overflowX: style.overflowX,
        horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
        unreachableInteractive,
        rect: {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height
        },
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      }]
    }))
    const documentWidths = [
      ['documentElement', document.documentElement],
      ['body', document.body],
      ['container', document.getElementById('container')]
    ].map(([name, element]) => ({
      name,
      found: Boolean(element),
      scrollWidth: element?.scrollWidth || 0,
      clientWidth: element?.clientWidth || 0
    }))
    const footerFlex = document.querySelector('.main-footer .terminal-footer-flex')
    const footerStatus = document.querySelector('.main-footer .terminal-footer-status')
    const footerText = footerStatus
      ? [...footerStatus.querySelectorAll(':scope > span:not(.terminal-footer-dot)')].map(element => {
          const style = window.getComputedStyle(element)
          return {
            text: element.textContent.trim(),
            ariaHidden: element.getAttribute('aria-hidden'),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            overflowX: style.overflowX,
            textOverflow: style.textOverflow
          }
        })
      : []
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      shell,
      documentWidths,
      footerText,
      footerClipping: {
        flexOverflowX: footerFlex ? window.getComputedStyle(footerFlex).overflowX : '',
        statusOverflowX: footerStatus ? window.getComputedStyle(footerStatus).overflowX : ''
      },
      tokens: {
        surface: resolveToken('--sp-surface', 'backgroundColor'),
        surfaceElevated: resolveToken('--sp-surface-elevated', 'backgroundColor'),
        border: resolveToken('--sp-border', 'borderTopColor'),
        shadowControl: resolveToken('--sp-shadow-control', 'boxShadow'),
        shadowCard: resolveToken('--sp-shadow-card', 'boxShadow'),
        shadowOverlay: resolveToken('--sp-shadow-overlay', 'boxShadow')
      }
    }
  })
}

async function exerciseRightPanelScroll (page) {
  await page.evaluate(() => {
    window.store.handleOpenAIPanel()
    window.store.rightPanelPinned = false
  })
  await page.locator('.right-side-panel:visible').waitFor({ timeout: 20000 })
  const scroller = page.locator('.right-side-panel-content .ai-history-wrap')
  await scroller.waitFor({ state: 'attached', timeout: 20000 })
  return scroller.evaluate(async container => {
    const nextFrame = () => new Promise(resolve => window.requestAnimationFrame(resolve))
    const describe = element => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return {
        className: String(element.className || ''),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        rectTop: rect.top,
        rectBottom: rect.bottom,
        rectHeight: rect.height,
        display: style.display,
        height: style.height,
        minHeight: style.minHeight,
        maxHeight: style.maxHeight,
        flex: style.flex,
        flexBasis: style.flexBasis,
        flexGrow: style.flexGrow,
        flexShrink: style.flexShrink,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        marginTop: style.marginTop,
        marginBottom: style.marginBottom
      }
    }
    const scrollFixture = document.createElement('div')
    const contextActions = document.querySelector('.ai-context-actions')
    const originalScrollTop = container.scrollTop
    const originalScrollBehavior = container.style.scrollBehavior
    const originalContextScrollLeft = contextActions?.scrollLeft || 0
    const ancestors = []
    let current = container
    while (current) {
      ancestors.push(describe(current))
      if (current.classList.contains('right-side-panel')) break
      current = current.parentElement
    }
    const result = {
      className: String(container.className || ''),
      overflowY: window.getComputedStyle(container).overflowY,
      originalScrollTop,
      originalContextScrollLeft,
      beforeClientHeight: container.clientHeight,
      beforeScrollHeight: container.scrollHeight,
      ancestors,
      occupied: Object.fromEntries([
        ['panelHeader', '.right-panel-title'],
        ['panelContent', '.right-side-panel-content-ai'],
        ['chatContainer', '.ai-chat-container'],
        ['chatHistory', '.ai-chat-history'],
        ['contextActions', '.ai-context-actions'],
        ['attachmentQueue', '.ai-attachment-queue'],
        ['composer', '.ai-chat-input'],
        ['composerTextarea', '.ai-chat-textarea'],
        ['composerControls', '.ai-chat-terminals']
      ].map(([name, selector]) => [name, describe(document.querySelector(selector))]))
    }
    scrollFixture.dataset.shellChromeScrollFixture = 'true'
    scrollFixture.style.height = `${Math.max(640, container.clientHeight * 2)}px`
    scrollFixture.style.minHeight = scrollFixture.style.height
    scrollFixture.style.width = '1px'
    container.style.scrollBehavior = 'auto'
    try {
      container.appendChild(scrollFixture)
      await nextFrame()
      await nextFrame()
      container.scrollTop = 0
      const maxScrollTop = container.scrollHeight - container.clientHeight
      const targetScrollTop = Math.min(64, maxScrollTop)
      container.scrollTop = targetScrollTop
      await nextFrame()
      result.clientHeight = container.clientHeight
      result.scrollHeight = container.scrollHeight
      result.maxScrollTop = maxScrollTop
      result.targetScrollTop = targetScrollTop
      result.scrolledTop = container.scrollTop
      if (contextActions) {
        const maxScrollLeft = contextActions.scrollWidth - contextActions.clientWidth
        const targetScrollLeft = Math.min(64, maxScrollLeft)
        contextActions.scrollLeft = targetScrollLeft
        await nextFrame()
        result.contextRail = {
          clientWidth: contextActions.clientWidth,
          scrollWidth: contextActions.scrollWidth,
          maxScrollLeft,
          targetScrollLeft,
          scrolledLeft: contextActions.scrollLeft
        }
      }
    } finally {
      scrollFixture.remove()
      container.style.scrollBehavior = originalScrollBehavior
      container.scrollTop = originalScrollTop
      if (contextActions) contextActions.scrollLeft = originalContextScrollLeft
      await nextFrame()
      result.cleanup = {
        fixtureRemoved: !container.querySelector('[data-shell-chrome-scroll-fixture="true"]'),
        restoredScrollTop: container.scrollTop,
        scrollBehaviorRestored: container.style.scrollBehavior === originalScrollBehavior,
        restoredContextScrollLeft: contextActions?.scrollLeft || 0
      }
    }
    return result
  })
}

function assertShellChrome (snapshot, context) {
  const message = JSON.stringify({ context, snapshot })
  const expectedBackgrounds = {
    topbar: snapshot.tokens.surfaceElevated,
    sidebar: snapshot.tokens.surface,
    rightPanel: snapshot.tokens.surface,
    footer: snapshot.tokens.surfaceElevated
  }
  for (const [name, item] of Object.entries(snapshot.shell)) {
    const itemMessage = JSON.stringify({ context, name, item, tokens: snapshot.tokens })
    expect(item.found, itemMessage).toBe(true)
    expect(item.background, itemMessage).toBe(expectedBackgrounds[name])
    expect(item.background, itemMessage).not.toBe('rgba(0, 0, 0, 0)')
    expect(item.border, itemMessage).toBe(snapshot.tokens.border)
    expect(item.horizontalOverflow, itemMessage).toBe(false)
    if (name === 'topbar' || name === 'footer') {
      expect(item.unreachableInteractive, itemMessage).toEqual([])
    }
    expect(item.rect.left, itemMessage).toBeGreaterThanOrEqual(-overflowTolerance)
    expect(item.rect.right, itemMessage).toBeLessThanOrEqual(snapshot.viewport.width + overflowTolerance)
  }
  expect(snapshot.shell.topbar.shadow, message).toContain(snapshot.tokens.shadowControl)
  expect(snapshot.shell.topbar.shadow, message).not.toContain(snapshot.tokens.shadowCard)
  expect(snapshot.shell.topbar.shadow, message).not.toContain(snapshot.tokens.shadowOverlay)
  expect(snapshot.shell.footer.shadow, message).toMatch(/\s-\d+px\s/)
  expect(snapshot.shell.footer.shadow, message).not.toContain(snapshot.tokens.shadowCard)
  expect(snapshot.shell.footer.shadow, message).not.toContain(snapshot.tokens.shadowOverlay)
  for (const item of snapshot.documentWidths) {
    const itemMessage = JSON.stringify({ context, item })
    expect(item.found, itemMessage).toBe(true)
    expect(item.scrollWidth, itemMessage).toBeLessThanOrEqual(item.clientWidth + overflowTolerance)
  }
  expect(snapshot.footerClipping.flexOverflowX, message).not.toMatch(/^(?:hidden|clip)$/)
  expect(snapshot.footerClipping.statusOverflowX, message).not.toMatch(/^(?:hidden|clip)$/)
  expect(snapshot.footerText, message).not.toEqual([])
  for (const item of snapshot.footerText) {
    const itemMessage = JSON.stringify({ context, item })
    expect(item.text, itemMessage).not.toBe('')
    expect(item.ariaHidden, itemMessage).not.toBe('true')
    if (item.scrollWidth > item.clientWidth + overflowTolerance) {
      expect(item.overflowX, itemMessage).toBe('hidden')
      expect(item.textOverflow, itemMessage).toBe('ellipsis')
    }
  }
}

function assertRightPanelScroll (snapshot, context) {
  const message = JSON.stringify({ context, snapshot })
  expect(snapshot.className.split(/\s+/), message).toContain('ai-history-wrap')
  expect(snapshot.overflowY, message).toBe('auto')
  expect(snapshot.beforeClientHeight, message).toBeGreaterThan(0)
  expect(snapshot.clientHeight, message).toBeGreaterThan(0)
  expect(snapshot.scrollHeight, message).toBeGreaterThan(snapshot.clientHeight)
  expect(snapshot.maxScrollTop, message).toBeGreaterThan(0)
  expect(snapshot.targetScrollTop, message).toBeGreaterThan(0)
  expect(snapshot.scrolledTop, message).toBeGreaterThan(0)
  expect(snapshot.scrolledTop, message).toBeLessThanOrEqual(snapshot.maxScrollTop)
  expect(snapshot.cleanup.fixtureRemoved, message).toBe(true)
  expect(snapshot.cleanup.restoredScrollTop, message).toBe(snapshot.originalScrollTop)
  expect(snapshot.cleanup.scrollBehaviorRestored, message).toBe(true)
  expect(snapshot.occupied.contextActions.clientHeight, message).toBeGreaterThanOrEqual(24)
  if (snapshot.contextRail.scrollWidth > snapshot.contextRail.clientWidth) {
    expect(snapshot.contextRail.maxScrollLeft, message).toBeGreaterThan(0)
    expect(snapshot.contextRail.targetScrollLeft, message).toBeGreaterThan(0)
    expect(snapshot.contextRail.scrolledLeft, message).toBeGreaterThan(0)
    expect(snapshot.cleanup.restoredContextScrollLeft, message).toBe(snapshot.originalContextScrollLeft)
  }
  expect(snapshot.occupied.composerTextarea.clientHeight, message).toBeGreaterThan(0)
  expect(snapshot.occupied.composerControls.clientHeight, message).toBeGreaterThan(0)
  expect(snapshot.occupied.composer.rectTop, message).toBeGreaterThanOrEqual(snapshot.occupied.panelContent.rectTop)
  expect(snapshot.occupied.composer.rectBottom, message).toBeLessThanOrEqual(snapshot.occupied.panelContent.rectBottom)
  expect(snapshot.occupied.composerControls.rectTop, message).toBeGreaterThanOrEqual(snapshot.occupied.composer.rectTop)
  expect(snapshot.occupied.composerControls.rectBottom, message).toBeLessThanOrEqual(snapshot.occupied.composer.rectBottom)
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
    for (const node of documentBaseline.nodes) {
      expect(node.scrollWidth, JSON.stringify({ ...context, surface: surface.name, documentBaseline }))
        .toBeLessThanOrEqual(node.clientWidth)
    }
    console.log(`SECONDARY_MAIN_CHROME_BASELINE=${JSON.stringify({ ...context, surface: surface.name, ...documentBaseline })}`)
    await surface.open(page)
    if (surface.name === 'ai-config') {
      await inspectOpenOverlayDepth(page, ['.ai-config-modal .custom-modal-content'])
    }
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
  await page.waitForFunction(() => {
    const info = window.store?.upgradeInfo
    return Boolean(info?.lastCheckedAt) && info.checkingRemoteVersion === false
  }, undefined, { timeout: 30000 })
  const updatePanelClose = page.locator('.upgrade-panel:not(.upgrade-panel-hide) .close-upgrade-panel')
  if (await updatePanelClose.isVisible().catch(() => false)) {
    await updatePanelClose.click()
    await expect(page.locator('.upgrade-panel:not(.upgrade-panel-hide)')).toHaveCount(0)
  }
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
  const targetIndex = await page.evaluate((language) => {
    return window.et.langs.findIndex(item => item.id === language)
  }, targetLanguage)
  const initialIndex = await page.evaluate((language) => {
    return window.et.langs.findIndex(item => item.id === language)
  }, initial.language)
  expect(targetText).not.toBe('')
  expect(targetIndex).toBeGreaterThanOrEqual(0)
  expect(initialIndex).toBeGreaterThanOrEqual(0)
  const languageSelect = page.locator('.setting-header .ant-select')
  const languageCombobox = languageSelect.getByRole('combobox')
  const chooseTargetOption = async () => {
    const dropdown = page.locator('.ant-select-dropdown:visible')
    for (let attempt = 0; attempt < 3 && await dropdown.count() !== 1; attempt += 1) {
      await languageCombobox.focus()
      await languageCombobox.press('ArrowDown')
      await expect(languageCombobox).toHaveAttribute('aria-expanded', 'true', { timeout: 5000 })
      await dropdown.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {})
    }
    await expect(dropdown).toHaveCount(1)
    await expect(dropdown.getByRole('listbox')).toHaveCount(1)
    const holder = dropdown.locator('.rc-virtual-list-holder')
    await expect(holder).toBeVisible()
    const targetOption = dropdown.locator('.ant-select-item-option').filter({ hasText: targetText })
    const wheelDelta = targetIndex < initialIndex ? -480 : 480
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ready = await targetOption.count() === 1 && await targetOption.evaluate(option => {
        const holder = option.closest('.rc-virtual-list-holder')
        if (!holder) return false
        const optionRect = option.getBoundingClientRect()
        const holderRect = holder.getBoundingClientRect()
        const visibleLeft = Math.max(holderRect.left, 0)
        const visibleRight = Math.min(holderRect.right, window.innerWidth)
        const visibleTop = Math.max(holderRect.top, 0)
        const visibleBottom = Math.min(holderRect.bottom, window.innerHeight)
        const hit = document.elementFromPoint(
          (Math.max(optionRect.left, visibleLeft) + Math.min(optionRect.right, visibleRight)) / 2,
          (Math.max(optionRect.top, visibleTop) + Math.min(optionRect.bottom, visibleBottom)) / 2
        )
        return optionRect.left >= visibleLeft && optionRect.right <= visibleRight &&
          optionRect.top >= visibleTop && optionRect.bottom <= visibleBottom &&
          Boolean(hit && option.contains(hit))
      })
      if (ready) break
      const holderBox = await holder.boundingBox()
      expect(holderBox).not.toBeNull()
      const viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight
      }))
      const visibleLeft = Math.max(holderBox.x, 0)
      const visibleRight = Math.min(holderBox.x + holderBox.width, viewport.width)
      const visibleTop = Math.max(holderBox.y, 0)
      const visibleBottom = Math.min(holderBox.y + holderBox.height, viewport.height)
      expect(visibleRight - visibleLeft).toBeGreaterThan(2)
      expect(visibleBottom - visibleTop).toBeGreaterThan(2)
      await page.mouse.move(
        (visibleLeft + visibleRight) / 2,
        (visibleTop + visibleBottom) / 2
      )
      await page.mouse.wheel(0, wheelDelta)
      await page.waitForTimeout(80)
    }
    await expect(targetOption).toHaveCount(1)
    await expect(targetOption).toHaveText(targetText)
    await expect(targetOption).toBeVisible()
    await expect(targetOption).toBeEnabled()
    const firstBox = await targetOption.boundingBox()
    expect(firstBox).not.toBeNull()
    await page.waitForTimeout(120)
    const stableBox = await targetOption.boundingBox()
    expect(stableBox).not.toBeNull()
    expect(Math.abs(stableBox.x - firstBox.x)).toBeLessThan(1)
    expect(Math.abs(stableBox.y - firstBox.y)).toBeLessThan(1)
    await targetOption.click({ trial: true })
    await targetOption.click()
    await expect(languageCombobox).toHaveAttribute('aria-expanded', 'false', { timeout: 5000 })
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
  await page.locator('.notification').waitFor({ state: 'visible' })
  await inspectOpenOverlayDepth(page, ['.notification'])
  await page.locator('.notification-close').click()
  await page.locator('.notification').waitFor({ state: 'detached' })

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

test('narrow topbar actions avoid native window controls and keep the last action operable', async ({ browserName }) => {
  await runWithIsolatedApp('topbar-interaction', async (electronApp) => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
    await setWindowCase(electronApp, page, { width: 820, height: 600 }, 2)

    const rail = page.locator('.not-system-ui .aigshell-topbar-actions')
    const actions = rail.locator('.aigshell-topbar-action:not(:disabled)')
    await expect(rail).toBeVisible()
    await expect(actions).toHaveCount(12)

    await rail.evaluate(element => { element.scrollLeft = 0 })
    await actions.first().focus()
    for (let index = 1; index < await actions.count(); index += 1) {
      await page.keyboard.press('Tab')
    }
    const keyboardProbe = await rail.evaluate(element => {
      const lastAction = element.querySelector('.aigshell-topbar-action-wrap:last-child .aigshell-topbar-action')
      const railRect = element.getBoundingClientRect()
      const actionRect = lastAction.getBoundingClientRect()
      const hit = document.elementFromPoint(
        actionRect.left + actionRect.width / 2,
        actionRect.top + actionRect.height / 2
      )
      return {
        lastActionFocused: document.activeElement === lastAction,
        lastActionFullyVisible: actionRect.left >= railRect.left && actionRect.right <= railRect.right,
        lastActionHit: Boolean(hit && lastAction.contains(hit)),
        hitsWindowControl: Boolean(hit?.closest?.('.window-control-box')),
        scrollLeft: element.scrollLeft,
        maxScrollLeft: element.scrollWidth - element.clientWidth
      }
    })
    const systemUiMarginRight = await page.evaluate(() => {
      const rail = document.querySelector('.aigshell-topbar-actions')
      const modeRoot = rail.closest('.not-system-ui, .system-ui') || document.body
      const wasNotSystemUi = modeRoot.classList.contains('not-system-ui')
      const wasSystemUi = modeRoot.classList.contains('system-ui')
      modeRoot.classList.remove('not-system-ui')
      modeRoot.classList.add('system-ui')
      const marginRight = window.getComputedStyle(rail).marginRight
      modeRoot.classList.toggle('not-system-ui', wasNotSystemUi)
      modeRoot.classList.toggle('system-ui', wasSystemUi)
      return marginRight
    })
    await page.keyboard.press('Enter')
    await expect(page.locator('.shellpilot-help-center')).toBeVisible({ timeout: 20000 })
    await page.locator('.shellpilot-help-center .custom-modal-close').click()
    await expect(page.locator('.shellpilot-help-center')).toBeHidden()
    await rail.evaluate(element => { element.scrollLeft = 0 })

    const inspectHitTargets = () => rail.evaluate(element => {
      const railRect = element.getBoundingClientRect()
      const controls = document.querySelector('.window-controls')
      const controlsRect = controls?.getBoundingClientRect() || null
      const visibleActions = [...element.querySelectorAll('.aigshell-topbar-action:not(:disabled)')]
        .map((action, index) => {
          const rect = action.getBoundingClientRect()
          const center = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          }
          const centerInsideRail = center.x >= railRect.left && center.x <= railRect.right
          const hit = centerInsideRail ? document.elementFromPoint(center.x, center.y) : null
          return {
            index,
            center,
            centerInsideRail,
            hitClass: String(hit?.className || ''),
            hitsAction: Boolean(hit && action.contains(hit)),
            hitsWindowControl: Boolean(hit?.closest?.('.window-control-box'))
          }
        })
        .filter(item => item.centerInsideRail)
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        scrollLeft: element.scrollLeft,
        maxScrollLeft: element.scrollWidth - element.clientWidth,
        paddingRight: window.getComputedStyle(element).paddingRight,
        marginRight: window.getComputedStyle(element).marginRight,
        reservedRight: window.innerWidth - railRect.right,
        railRect: { left: railRect.left, right: railRect.right },
        controlsRect: controlsRect
          ? { left: controlsRect.left, right: controlsRect.right }
          : null,
        visibleActions
      }
    })

    const before = await inspectHitTargets()
    let lastTrialError = ''
    try {
      await actions.last().click({ trial: true, timeout: 3000 })
    } catch (error) {
      lastTrialError = error?.message || String(error)
    }
    const railBox = await rail.boundingBox()
    expect(railBox).not.toBeNull()
    await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + railBox.height / 2)
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(160)
    const afterWheel = await inspectHitTargets()
    console.log(`TOPBAR_INTERACTION_PROBE=${JSON.stringify({ browserName, keyboardProbe, systemUiMarginRight, before, lastTrialError, afterWheel })}`)

    expect(keyboardProbe.lastActionFocused).toBe(true)
    expect(keyboardProbe.lastActionFullyVisible).toBe(true)
    expect(keyboardProbe.lastActionHit).toBe(true)
    expect(keyboardProbe.hitsWindowControl).toBe(false)
    expect(keyboardProbe.scrollLeft).toBeGreaterThan(0)
    expect(systemUiMarginRight).toBe('0px')
    expect(before.marginRight).toBe('138px')
    expect(before.reservedRight).toBeGreaterThanOrEqual(138)
    expect(before.maxScrollLeft).toBeGreaterThan(0)
    expect(before.visibleActions.some(item => item.hitsWindowControl)).toBe(false)
    expect(lastTrialError).toBe('')
    expect(afterWheel.scrollLeft).toBeGreaterThan(before.scrollLeft)
    expect(afterWheel.scrollLeft).toBe(afterWheel.maxScrollLeft)
    expect(afterWheel.visibleActions.some(item => item.hitsWindowControl)).toBe(false)
    expect(afterWheel.visibleActions.every(item => item.hitsAction)).toBe(true)

    await actions.last().click()
    await expect(page.locator('.shellpilot-help-center')).toBeVisible({ timeout: 20000 })
    await page.locator('.shellpilot-help-center .custom-modal-close').click()
    await expect(page.locator('.shellpilot-help-center')).toBeHidden()

    await setWindowCase(electronApp, page, { width: 820, height: 600 }, 1)
    await rail.evaluate(element => { element.scrollLeft = 0 })
    const desktop = await inspectHitTargets()
    console.log(`TOPBAR_DESKTOP_INTERACTION_PROBE=${JSON.stringify({ browserName, desktop })}`)
    expect(desktop.marginRight).toBe('0px')
    expect(desktop.paddingRight).toBe('138px')
    expect(desktop.visibleActions.length).toBeGreaterThan(0)
    expect(desktop.visibleActions.every(item => item.hitsAction)).toBe(true)
    expect(desktop.visibleActions.some(item => item.hitsWindowControl)).toBe(false)
  })
})

test('590px topbar keeps every visible action clear of native controls and preserves real end actions', async ({ browserName }) => {
  await runWithIsolatedApp('topbar-590-interaction', async (electronApp) => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
    await setWindowCase(electronApp, page, { width: 590, height: 400 }, 1)

    const rail = page.locator('.not-system-ui .aigshell-topbar-actions')
    const actions = rail.locator('.aigshell-topbar-action:not(:disabled)')
    await expect(rail).toBeVisible()
    await expect(actions).toHaveCount(12)

    const inspectHitTargets = () => rail.evaluate(element => {
      const railRect = element.getBoundingClientRect()
      const controls = document.querySelector('.window-controls')
      const controlsRect = controls?.getBoundingClientRect() || null
      const visibleActions = [...element.querySelectorAll('.aigshell-topbar-action:not(:disabled)')]
        .map((action, index) => {
          const rect = action.getBoundingClientRect()
          const center = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          }
          const centerInsideRail = center.x >= railRect.left && center.x <= railRect.right
          const hit = centerInsideRail ? document.elementFromPoint(center.x, center.y) : null
          return {
            index,
            center,
            centerInsideRail,
            hitsAction: Boolean(hit && action.contains(hit)),
            hitsWindowControl: Boolean(hit?.closest?.('.window-control-box'))
          }
        })
        .filter(item => item.centerInsideRail)
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        scrollLeft: element.scrollLeft,
        maxScrollLeft: element.scrollWidth - element.clientWidth,
        marginRight: window.getComputedStyle(element).marginRight,
        reservedRight: window.innerWidth - railRect.right,
        railRect: { left: railRect.left, right: railRect.right },
        controlsRect: controlsRect
          ? { left: controlsRect.left, right: controlsRect.right }
          : null,
        visibleActions
      }
    })

    await rail.evaluate(element => { element.scrollLeft = 0 })
    const before = await inspectHitTargets()
    const railBox = await rail.boundingBox()
    expect(railBox).not.toBeNull()
    const safeRight = Math.min(railBox.x + railBox.width, before.controlsRect.left)
    await page.mouse.move((railBox.x + safeRight) / 2, railBox.y + railBox.height / 2)
    await page.mouse.wheel(0, 1200)
    await page.waitForTimeout(160)
    const afterWheel = await inspectHitTargets()

    await rail.evaluate(element => { element.scrollLeft = 0 })
    await actions.first().focus()
    for (let index = 1; index < await actions.count(); index += 1) {
      await page.keyboard.press('Tab')
    }
    const keyboardProbe = await rail.evaluate(element => {
      const lastAction = element.querySelector('.aigshell-topbar-action-wrap:last-child .aigshell-topbar-action')
      const railRect = element.getBoundingClientRect()
      const actionRect = lastAction.getBoundingClientRect()
      const hit = document.elementFromPoint(
        actionRect.left + actionRect.width / 2,
        actionRect.top + actionRect.height / 2
      )
      return {
        lastActionFocused: document.activeElement === lastAction,
        lastActionFullyVisible: actionRect.left >= railRect.left && actionRect.right <= railRect.right,
        lastActionHit: Boolean(hit && lastAction.contains(hit)),
        hitsWindowControl: Boolean(hit?.closest?.('.window-control-box')),
        scrollLeft: element.scrollLeft,
        maxScrollLeft: element.scrollWidth - element.clientWidth
      }
    })
    for (let index = (await actions.count()) - 2; index >= 0; index -= 1) {
      await page.keyboard.press('Shift+Tab')
    }
    const shiftTabProbe = await rail.evaluate(element => {
      const firstAction = element.querySelector('.aigshell-topbar-action:not(:disabled)')
      const railRect = element.getBoundingClientRect()
      const actionRect = firstAction.getBoundingClientRect()
      const hit = document.elementFromPoint(
        actionRect.left + actionRect.width / 2,
        actionRect.top + actionRect.height / 2
      )
      return {
        firstActionFocused: document.activeElement === firstAction,
        firstActionFullyVisible: actionRect.left >= railRect.left && actionRect.right <= railRect.right,
        firstActionHit: Boolean(hit && firstAction.contains(hit)),
        hitsWindowControl: Boolean(hit?.closest?.('.window-control-box')),
        scrollLeft: element.scrollLeft
      }
    })
    console.log(`TOPBAR_590_INTERACTION_PROBE=${JSON.stringify({
      browserName,
      before,
      afterWheel,
      keyboardProbe,
      shiftTabProbe
    })}`)

    expect(before.visibleActions.length).toBeGreaterThan(0)
    expect(before.visibleActions.every(item => item.hitsAction)).toBe(true)
    expect(before.visibleActions.some(item => item.hitsWindowControl)).toBe(false)
    expect(before.reservedRight).toBeGreaterThanOrEqual(138)
    expect(before.maxScrollLeft).toBeGreaterThan(0)
    expect(afterWheel.scrollLeft).toBe(afterWheel.maxScrollLeft)
    expect(afterWheel.visibleActions.length).toBeGreaterThan(0)
    expect(afterWheel.visibleActions.every(item => item.hitsAction)).toBe(true)
    expect(afterWheel.visibleActions.some(item => item.hitsWindowControl)).toBe(false)
    expect(keyboardProbe.lastActionFocused).toBe(true)
    expect(keyboardProbe.lastActionFullyVisible).toBe(true)
    expect(keyboardProbe.lastActionHit).toBe(true)
    expect(keyboardProbe.hitsWindowControl).toBe(false)
    expect(shiftTabProbe.firstActionFocused).toBe(true)
    expect(shiftTabProbe.firstActionFullyVisible).toBe(true)
    expect(shiftTabProbe.firstActionHit).toBe(true)
    expect(shiftTabProbe.hitsWindowControl).toBe(false)
    expect(shiftTabProbe.scrollLeft).toBe(0)

    const initialTheme = await page.evaluate(() => window.store.config.theme)
    const themeAction = rail.locator('button:has(.anticon-sun), button:has(.anticon-moon)')
    await expect(themeAction).toHaveCount(1)
    await themeAction.click({ trial: true })
    await themeAction.click()
    await expect.poll(() => page.evaluate(() => window.store.config.theme)).not.toBe(initialTheme)
    await themeAction.click()
    await expect.poll(() => page.evaluate(() => window.store.config.theme)).toBe(initialTheme)

    const settingAction = rail.locator('button:has(.anticon-setting)')
    await expect(settingAction).toHaveCount(1)
    await settingAction.click({ trial: true })
    await settingAction.click()
    await expect(page.locator('.setting-wrap')).toBeVisible()
    await page.locator('.setting-header .close-setting-wrap-icon').click()
    await expect(page.locator('.setting-wrap')).toBeHidden()

    const helpAction = rail.locator('button:has(.anticon-question-circle)')
    await expect(helpAction).toHaveCount(1)
    await helpAction.click({ trial: true })
    await helpAction.click()
    await expect(page.locator('.shellpilot-help-center')).toBeVisible({ timeout: 20000 })
    await page.locator('.shellpilot-help-center .custom-modal-close').click()
    await expect(page.locator('.shellpilot-help-center')).toBeHidden()
  })
})

test('sidebar standard tiles expose one consistent mouse keyboard and active affordance', async ({ browserName }) => {
  await runWithIsolatedApp('sidebar-interaction', async (electronApp) => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })

    const dashboardTile = page.locator('.sidebar-bar .control-icon-wrap:has(.anticon-dashboard)')
    const transferTile = page.locator('.sidebar-bar .control-icon-wrap:has(.anticon-swap)')
    await expect(dashboardTile).toHaveCount(1)
    await expect(transferTile).toHaveCount(1)

    const resetFleet = () => page.evaluate(() => window.store.closeFleetStatus())
    const readMode = () => page.evaluate(() => window.store.mainWorkspaceMode)
    const tabBackToDashboard = async () => {
      await dashboardTile.focus()
      await page.keyboard.press('Shift+Tab')
      const movedAway = await dashboardTile.evaluate(element => document.activeElement !== element)
      await page.keyboard.press('Tab')
      return movedAway && await dashboardTile.evaluate(element => document.activeElement === element)
    }
    await resetFleet()
    await dashboardTile.locator('.control-icon-label').click()
    const labelMode = await readMode()

    await resetFleet()
    const dashboardBox = await dashboardTile.boundingBox()
    expect(dashboardBox).not.toBeNull()
    await dashboardTile.click({ position: { x: dashboardBox.width / 2, y: 2 } })
    const blankMode = await readMode()

    await resetFleet()
    const tabReached = await tabBackToDashboard()
    let enterMode = await readMode()
    let spaceMode = await readMode()
    if (tabReached) {
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => window.store.mainWorkspaceMode === 'fleet-status', { timeout: 1000 }).catch(() => {})
      enterMode = await readMode()
      await resetFleet()
      if (!await dashboardTile.evaluate(element => document.activeElement === element)) {
        await dashboardTile.focus()
      }
      await page.keyboard.press('Space')
      await page.waitForFunction(() => window.store.mainWorkspaceMode === 'fleet-status', { timeout: 1000 }).catch(() => {})
      spaceMode = await readMode()
    }

    await page.evaluate(() => window.store.openFleetStatus())
    await expect(dashboardTile).toHaveClass(/active/)
    const activeColors = await dashboardTile.evaluate(element => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--sp-primary)'
      document.body.appendChild(probe)
      const primary = window.getComputedStyle(probe).color
      probe.remove()
      return {
        primary,
        icon: window.getComputedStyle(element.querySelector('.control-icon')).color,
        label: window.getComputedStyle(element.querySelector('.control-icon-label')).color
      }
    })

    await transferTile.locator('.control-icon-main').click({ button: 'right' })
    const transferPopoverVisible = await page.locator('.shellpilot-transfer-history-popover:visible').count() === 1
    const probe = {
      browserName,
      tagName: await dashboardTile.evaluate(element => element.tagName),
      tabIndex: await dashboardTile.evaluate(element => element.tabIndex),
      nestedButtons: await dashboardTile.locator('button').count(),
      labelMode,
      blankMode,
      tabReached,
      enterMode,
      spaceMode,
      activeColors,
      transferTagName: await transferTile.evaluate(element => element.tagName),
      transferPopoverVisible
    }
    console.log(`SIDEBAR_INTERACTION_PROBE=${JSON.stringify(probe)}`)

    expect(probe.tagName).toBe('BUTTON')
    expect(probe.tabIndex).toBe(0)
    expect(probe.nestedButtons).toBe(0)
    expect(probe.labelMode).toBe('fleet-status')
    expect(probe.blankMode).toBe('fleet-status')
    expect(probe.tabReached).toBe(true)
    expect(probe.enterMode).toBe('fleet-status')
    expect(probe.spaceMode).toBe('fleet-status')
    expect(probe.activeColors.icon).toBe(probe.activeColors.primary)
    expect(probe.activeColors.label).toBe(probe.activeColors.primary)
    expect(probe.transferTagName).toBe('BUTTON')
    expect(probe.transferPopoverVisible).toBe(true)
  })
})

test('low-height AI panel keeps meaningful history and real auxiliary rail interaction', async ({ browserName }) => {
  await runWithIsolatedApp('ai-compact-interaction', async (electronApp) => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
    const updatePanelClose = page.locator('.upgrade-panel:not(.upgrade-panel-hide) .close-upgrade-panel')
    if (await updatePanelClose.isVisible().catch(() => false)) {
      await updatePanelClose.click()
      await expect(page.locator('.upgrade-panel:not(.upgrade-panel-hide)')).toHaveCount(0)
    }
    await page.evaluate(() => {
      window.store.handleOpenAIPanel()
      window.store.rightPanelPinned = false
    })
    await page.locator('.right-side-panel-content-ai .ai-chat-container').waitFor({ state: 'visible', timeout: 20000 })
    await setWindowCase(electronApp, page, { width: 820, height: 600 }, 2)

    const fileInput = page.locator('.right-side-panel-content-ai input[type="file"]')
    await fileInput.setInputFiles([
      { name: 'compact-layout-attachment-one-with-long-name.txt', mimeType: 'text/plain', buffer: Buffer.from('one') },
      { name: 'compact-layout-attachment-two-with-long-name.txt', mimeType: 'text/plain', buffer: Buffer.from('two') },
      { name: 'compact-layout-attachment-three-with-long-name.txt', mimeType: 'text/plain', buffer: Buffer.from('three') },
      { name: 'compact-layout-attachment-four-with-long-name.txt', mimeType: 'text/plain', buffer: Buffer.from('four') }
    ])
    await expect(page.locator('.right-side-panel-content-ai .ai-attachment-chip')).toHaveCount(4)

    await page.evaluate(() => {
      const title = document.querySelector('.right-panel-title-text')
      const controls = document.querySelector('.right-panel-title .agent-takeover-controls')
      const availability = controls?.querySelector('.agent-takeover-availability')
      if (!title || !controls || !availability) throw new Error('AI compact header fixture target missing')
      const titleFixture = document.createElement('span')
      titleFixture.dataset.aiCompactFixture = 'title'
      titleFixture.textContent = ' — exceptionally long active takeover and model status'
      title.appendChild(titleFixture)
      const badge = document.createElement('span')
      badge.dataset.aiCompactFixture = 'badge'
      badge.className = 'agent-takeover-badge running'
      badge.textContent = 'running'
      const stop = document.createElement('button')
      stop.type = 'button'
      stop.dataset.aiCompactFixture = 'stop'
      stop.className = 'agent-takeover-stop'
      stop.textContent = 'stop'
      controls.insertBefore(badge, availability)
      controls.insertBefore(stop, availability)
      availability.dataset.aiCompactOriginalText = availability.textContent || ''
      availability.textContent = 'Active takeover endpoint with a deliberately long availability status that must not collide'
    })
    if (await updatePanelClose.isVisible().catch(() => false)) {
      await updatePanelClose.click()
      await expect(page.locator('.upgrade-panel:not(.upgrade-panel-hide)')).toHaveCount(0)
    }

    const contextRail = page.locator('.right-side-panel-content-ai .ai-context-actions')
    const attachmentRail = page.locator('.right-side-panel-content-ai .ai-attachment-queue')
    const wheelRail = async locator => {
      const box = await locator.boundingBox()
      expect(box).not.toBeNull()
      const before = await locator.evaluate(element => ({
        scrollLeft: element.scrollLeft,
        maxScrollLeft: element.scrollWidth - element.clientWidth
      }))
      await page.mouse.move(
        box.x + box.width / 2,
        box.y + box.height / 2
      )
      await page.mouse.wheel(0, 1200)
      await page.waitForTimeout(120)
      const after = await locator.evaluate(element => element.scrollLeft)
      await page.mouse.wheel(0, -1200)
      await page.waitForTimeout(120)
      const restored = await locator.evaluate(element => element.scrollLeft)
      return { ...before, after, restored }
    }

    let snapshot
    try {
      const contextWheel = await wheelRail(contextRail)
      const attachmentWheel = await wheelRail(attachmentRail)
      const contextActions = contextRail.locator('.ai-context-action')
      await contextActions.first().focus()
      for (let index = 1; index < await contextActions.count(); index += 1) {
        await page.keyboard.press('Tab')
      }
      const lastContextFocused = await contextActions.last().evaluate(element => document.activeElement === element)
      const contextFocusScrollLeft = await contextRail.evaluate(element => element.scrollLeft)
      await page.locator('.right-side-panel-content-ai .ai-chat-textarea').focus()
      const contextBox = await contextRail.boundingBox()
      await page.mouse.move(
        contextBox.x + contextBox.width / 2,
        contextBox.y + contextBox.height / 2
      )
      await page.mouse.wheel(0, -1200)
      await page.waitForTimeout(120)
      const contextRestoredAfterFocus = await contextRail.evaluate(element => element.scrollLeft)

      snapshot = await page.locator('.right-side-panel').evaluate(panel => {
        const describe = selector => {
          const element = panel.querySelector(selector)
          if (!element) return null
          const rect = element.getBoundingClientRect()
          return {
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom
          }
        }
        const header = panel.querySelector('.right-panel-title')
        const interactive = [
          '.right-panel-ai-profile-select',
          '.right-panel-ai-model-select',
          '.agent-takeover-switch',
          '[data-ai-compact-fixture="stop"]',
          '.right-panel-model-status',
          '.right-side-panel-pin',
          '.right-side-panel-close'
        ].map(selector => panel.querySelector(selector)).filter(Boolean)
        const overlaps = []
        for (let left = 0; left < interactive.length; left += 1) {
          for (let right = left + 1; right < interactive.length; right += 1) {
            const a = interactive[left].getBoundingClientRect()
            const b = interactive[right].getBoundingClientRect()
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            if (overlapX > 1 && overlapY > 1) {
              overlaps.push({
                left: String(interactive[left].className || ''),
                right: String(interactive[right].className || ''),
                overlapX,
                overlapY
              })
            }
          }
        }
        const headerRect = header.getBoundingClientRect()
        return {
          history: describe('.ai-history-wrap'),
          context: describe('.ai-context-actions'),
          attachments: describe('.ai-attachment-queue'),
          textarea: describe('.ai-chat-textarea'),
          composerControls: describe('.ai-chat-terminals'),
          header: describe('.right-panel-title'),
          panelContent: describe('.right-side-panel-content-ai'),
          pageScroll: {
            x: window.scrollX,
            y: window.scrollY,
            devicePixelRatio: window.devicePixelRatio
          },
          headerControlsInside: interactive.every(element => {
            const rect = element.getBoundingClientRect()
            return rect.left >= headerRect.left && rect.right <= headerRect.right &&
              rect.top >= headerRect.top && rect.bottom <= headerRect.bottom
          }),
          overlaps
        }
      })
      snapshot.contextWheel = contextWheel
      snapshot.attachmentWheel = attachmentWheel
      snapshot.lastContextFocused = lastContextFocused
      snapshot.contextFocusScrollLeft = contextFocusScrollLeft
      snapshot.contextRestoredAfterFocus = contextRestoredAfterFocus
      console.log(`AI_COMPACT_INTERACTION_PROBE=${JSON.stringify({ browserName, snapshot })}`)

      expect(snapshot.history.clientHeight).toBeGreaterThanOrEqual(64)
      expect(snapshot.contextWheel.maxScrollLeft).toBeGreaterThan(0)
      expect(snapshot.contextWheel.after).toBeGreaterThan(0)
      expect(snapshot.contextWheel.restored).toBe(0)
      expect(snapshot.attachmentWheel.maxScrollLeft).toBeGreaterThan(0)
      expect(snapshot.attachmentWheel.after).toBeGreaterThan(0)
      expect(snapshot.attachmentWheel.restored).toBe(0)
      expect(snapshot.lastContextFocused).toBe(true)
      expect(snapshot.contextFocusScrollLeft).toBeGreaterThan(0)
      expect(snapshot.contextRestoredAfterFocus).toBe(0)
      expect(snapshot.headerControlsInside).toBe(true)
      expect(snapshot.overlaps).toEqual([])
      expect(snapshot.pageScroll.y).toBe(0)
      expect(snapshot.textarea.bottom).toBeLessThanOrEqual(snapshot.panelContent.bottom)
      expect(snapshot.composerControls.bottom).toBeLessThanOrEqual(snapshot.panelContent.bottom)
    } finally {
      await page.evaluate(() => {
        document.querySelectorAll('[data-ai-compact-fixture]').forEach(element => element.remove())
        const availability = document.querySelector('.agent-takeover-availability[data-ai-compact-original-text]')
        if (availability) {
          availability.textContent = availability.dataset.aiCompactOriginalText || ''
          delete availability.dataset.aiCompactOriginalText
        }
      })
      const removeButtons = page.locator('.right-side-panel-content-ai .ai-attachment-remove')
      while (await removeButtons.count()) {
        await removeButtons.first().click()
      }
      await expect(page.locator('.right-side-panel-content-ai .ai-attachment-chip')).toHaveCount(0)
    }
  })
})

test('shell chrome keeps restrained depth, compact geometry and terminal isolation', async ({ browserName }) => {
  await runWithIsolatedApp('shell-chrome', async (electronApp) => {
    const page = electronApp.windows()[0] || await electronApp.firstWindow()
    await page.waitForFunction(() => window.store?.configLoaded === true, { timeout: 20000 })
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
    await page.evaluate(() => {
      window.store.handleOpenAIPanel()
      window.store.rightPanelPinned = false
    })
    await page.locator('.right-side-panel:visible').waitFor({ timeout: 20000 })
    await page.locator('.right-side-panel-content .ai-history-wrap:visible').waitFor({ timeout: 20000 })
    await ensureTwoTerminalTabs(page)

    const cases = [
      { size: { width: 590, height: 400 }, zoom: 1 },
      { size: { width: 820, height: 600 }, zoom: 1 },
      { size: { width: 820, height: 600 }, zoom: 2 }
    ]
    const scrollCases = []
    for (const item of cases) {
      await setWindowCase(electronApp, page, item.size, item.zoom)
      const context = {
        runner: browserName,
        surface: 'shell-chrome',
        size: `${item.size.width}x${item.size.height}`,
        zoom: item.zoom
      }
      const scroll = await exerciseRightPanelScroll(page)
      scrollCases.push({ scroll, context })
      console.log(`SHELL_CHROME_SCROLL_PROBE=${JSON.stringify({ context, scroll })}`)
      const shell = await inspectShellChrome(page)
      assertShellChrome(shell, context)
      const terminal = await inspectTerminalInvariant(page)
      assertTerminalInvariant(terminal, context)
    }
    for (const { scroll, context } of scrollCases) {
      assertRightPanelScroll(scroll, context)
    }
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
    const settingsDepth = await page.locator('.sp-setting-section').first().evaluate(element => {
      const style = window.getComputedStyle(element)
      return {
        background: style.backgroundColor,
        shadow: style.boxShadow,
        radius: style.borderRadius,
        overflow: element.scrollWidth > element.clientWidth + 1
      }
    })
    expect(settingsDepth.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(settingsDepth.shadow).not.toBe('none')
    expect(settingsDepth.radius).toBe('10px')
    expect(settingsDepth.overflow).toBe(false)
    const searchInput = page.locator('.setting-header-search input')
    await expect(searchInput).toBeFocused()
    const settingsControlStates = await inspectSettingsControlStates(page)
    assertSettingsControlStates(settingsControlStates, JSON.stringify({ runner: browserName }))
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

    let zoomedSectionMetrics
    try {
      await setWindowCase(electronApp, page, { width: 590, height: 400 }, 1.5)
      zoomedSectionMetrics = await page.locator('.sp-setting-section').first().evaluate(element => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflow: element.scrollWidth > element.clientWidth + 1
      }))
    } finally {
      await setWindowCase(electronApp, page, { width: 590, height: 400 }, 1)
    }
    expect(zoomedSectionMetrics.overflow, JSON.stringify({ runner: browserName, zoom: 1.5, zoomedSectionMetrics }))
      .toBe(false)
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
    const shortDepth = await inspectMenuDepth(shortMenu)
    assertMenuDepth(shortDepth, { runner: browserName, surface: 'input-menu' })
    expect(shortDepth.firstReachable).toBe(true)
    expect(shortDepth.lastReachable).toBe(true)

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

    await resetSurface(page, 'en_us')
    await setWindowCase(electronApp, page, { width: 590, height: 400 }, 1)
    const systemMenu = await openSystemMenu(page)
    const systemDepth = await inspectMenuDepth(systemMenu)
    assertMenuDepth(systemDepth, { runner: browserName, surface: 'system-menu' })
    expect(systemDepth.firstReachable).toBe(true)
    const systemReachability = await systemMenu.evaluate(menu => {
      const items = [...menu.querySelectorAll('.context-item')]
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
    expect(systemReachability.itemCount, JSON.stringify({ runner: browserName, systemReachability }))
      .toBeGreaterThan(1)
    expect(systemReachability.firstReachable, JSON.stringify({ runner: browserName, systemReachability }))
      .toBe(true)
    expect(systemReachability.lastReachable, JSON.stringify({ runner: browserName, systemReachability }))
      .toBe(true)
    expect(systemReachability.scrollTop, JSON.stringify({ runner: browserName, systemReachability }))
      .toBeGreaterThan(0)
    expect(systemReachability.scrollTop, JSON.stringify({ runner: browserName, systemReachability }))
      .toBeLessThanOrEqual(systemReachability.maxScrollTop + 1)

    const submenuTrigger = systemMenu.locator('.with-sub-menu').first()
    await submenuTrigger.scrollIntoViewIfNeeded()
    await submenuTrigger.hover()
    const systemSubmenu = submenuTrigger.locator('.sub-context-menu')
    await expect(systemSubmenu).toBeVisible()
    const submenuPointerReachable = await systemSubmenu.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2))
      const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + Math.min(rect.height, 32) / 2))
      return element.contains(document.elementFromPoint(x, y))
    })
    expect(submenuPointerReachable, JSON.stringify({ runner: browserName })).toBe(true)

    await resetSurface(page, 'en_us')
    const originalWindowState = await captureWindowState(electronApp)
    let highZoomError
    try {
      await electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window || window.isDestroyed()) {
          throw new Error('Cannot resize a closed BrowserWindow')
        }
        window.setMinimumSize(1, 1)
      })
      await setWindowCase(electronApp, page, { width: 393, height: 267 }, 2)
      const highZoomSystemMenu = await openSystemMenu(page, { dispatchClick: true })
      const highZoomDepth = await inspectMenuDepth(highZoomSystemMenu)
      expect(highZoomDepth.viewport.width).toBeGreaterThanOrEqual(196)
      expect(highZoomDepth.viewport.width).toBeLessThanOrEqual(198)
      expect(highZoomDepth.viewport.height).toBeGreaterThanOrEqual(132)
      expect(highZoomDepth.viewport.height).toBeLessThanOrEqual(135)
      assertMenuDepth(highZoomDepth, {
        runner: browserName,
        surface: 'system-menu',
        viewport: '393x267@200%'
      })
      const highZoomReachability = await highZoomSystemMenu.evaluate(menu => {
        const items = [...menu.querySelectorAll('.context-item')]
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
      expect(highZoomReachability.itemCount, JSON.stringify({ browserName, highZoomReachability }))
        .toBeGreaterThan(1)
      expect(highZoomReachability.firstReachable, JSON.stringify({ browserName, highZoomReachability }))
        .toBe(true)
      expect(highZoomReachability.lastReachable, JSON.stringify({ browserName, highZoomReachability }))
        .toBe(true)
      expect(highZoomReachability.scrollTop, JSON.stringify({ browserName, highZoomReachability }))
        .toBeGreaterThan(0)
      expect(highZoomReachability.scrollTop, JSON.stringify({ browserName, highZoomReachability }))
        .toBeLessThanOrEqual(highZoomReachability.maxScrollTop + 1)

      const highZoomSubmenuTrigger = highZoomSystemMenu.locator('.with-sub-menu').first()
      await highZoomSubmenuTrigger.scrollIntoViewIfNeeded()
      await highZoomSubmenuTrigger.hover()
      const highZoomSubmenu = highZoomSubmenuTrigger.locator('.sub-context-menu')
      await expect(highZoomSubmenu).toBeVisible()
      const highZoomSubmenuReachable = await highZoomSubmenu.evaluate(element => {
        const rect = element.getBoundingClientRect()
        const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2))
        const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + Math.min(rect.height, 32) / 2))
        return element.contains(document.elementFromPoint(x, y))
      })
      expect(highZoomSubmenuReachable, JSON.stringify({ browserName })).toBe(true)
    } catch (error) {
      highZoomError = error
      throw error
    } finally {
      await cleanupPreservingPrimaryError(
        () => restoreWindowState(electronApp, page, originalWindowState),
        highZoomError
      )
    }

    await resetSurface(page, 'en_us')
    await setWindowCase(electronApp, page, { width: 1100, height: 700 }, 1)
    const desktopSystemMenu = await openSystemMenu(page)
    const desktopSubmenuTrigger = desktopSystemMenu.locator('.with-sub-menu').first()
    await desktopSubmenuTrigger.hover()
    const desktopSubmenu = desktopSubmenuTrigger.locator('.sub-context-menu')
    await expect(desktopSubmenu).toBeVisible()
    const desktopSubmenuGeometry = await desktopSubmenu.evaluate((submenu) => {
      const root = submenu.closest('.context-menu')
      const trigger = submenu.closest('.with-sub-menu')
      const rootRect = root.getBoundingClientRect()
      const triggerRect = trigger.getBoundingClientRect()
      const submenuRect = submenu.getBoundingClientRect()
      const rootStyle = window.getComputedStyle(root)
      const x = Math.min(window.innerWidth - 1, Math.max(0, submenuRect.left + submenuRect.width / 2))
      const y = Math.min(window.innerHeight - 1, Math.max(0, submenuRect.top + Math.min(submenuRect.height, 32) / 2))
      return {
        rootOverflowX: rootStyle.overflowX,
        root: {
          left: rootRect.left,
          right: rootRect.right
        },
        trigger: {
          left: triggerRect.left,
          right: triggerRect.right
        },
        submenu: {
          left: submenuRect.left,
          top: submenuRect.top,
          right: submenuRect.right,
          bottom: submenuRect.bottom
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        pointerReachable: submenu.contains(document.elementFromPoint(x, y))
      }
    })
    const desktopContext = JSON.stringify({ runner: browserName, desktopSubmenuGeometry })
    console.log(`SECONDARY_SYSTEM_SUBMENU_DESKTOP=${desktopContext}`)
    expect(desktopSubmenuGeometry.rootOverflowX, desktopContext).toBe('visible')
    expect(desktopSubmenuGeometry.submenu.left, desktopContext)
      .toBeGreaterThanOrEqual(desktopSubmenuGeometry.trigger.right - 1)
    expect(desktopSubmenuGeometry.submenu.left, desktopContext)
      .toBeGreaterThanOrEqual(desktopSubmenuGeometry.root.right - 1)
    expect(desktopSubmenuGeometry.submenu.top, desktopContext).toBeGreaterThanOrEqual(-1)
    expect(desktopSubmenuGeometry.submenu.right, desktopContext)
      .toBeLessThanOrEqual(desktopSubmenuGeometry.viewport.width + 1)
    expect(desktopSubmenuGeometry.submenu.bottom, desktopContext)
      .toBeLessThanOrEqual(desktopSubmenuGeometry.viewport.height + 1)
    expect(desktopSubmenuGeometry.pointerReachable, desktopContext).toBe(true)
  })
})

async function captureCompactShellState (page) {
  return page.evaluate(() => {
    const store = window.store
    return {
      openedSideBar: store.openedSideBar,
      pinned: store.pinned,
      leftSidebarWidth: store.leftSidebarWidth,
      rightPanelVisible: store.rightPanelVisible,
      rightPanelPinned: store.rightPanelPinned,
      rightPanelWidth: store.rightPanelWidth,
      layout: store.layout,
      mainWorkspaceMode: store.mainWorkspaceMode
    }
  })
}

async function applyCompactShellState (page, state) {
  await page.evaluate((nextState) => {
    const store = window.store
    store.closeFleetStatus()
    store.setOpenedSideBar(nextState.openedSideBar)
    store.pinned = nextState.pinned
    store.setLeftSidePanelWidth(nextState.leftSidebarWidth)
    store.rightPanelVisible = nextState.rightPanelVisible
    store.rightPanelPinned = nextState.rightPanelPinned
    store.setRightSidePanelWidth(nextState.rightPanelWidth)
    store.setLayout('c3')
  }, state)
}

async function restoreCompactShellState (page, state) {
  await page.evaluate((originalState) => {
    const store = window.store
    store.setOpenedSideBar(originalState.openedSideBar)
    store.pinned = originalState.pinned
    store.setLeftSidePanelWidth(originalState.leftSidebarWidth)
    store.rightPanelVisible = originalState.rightPanelVisible
    store.rightPanelPinned = originalState.rightPanelPinned
    store.setRightSidePanelWidth(originalState.rightPanelWidth)
    store.setLayout(originalState.layout)
    if (originalState.mainWorkspaceMode === 'fleet-status') {
      store.openFleetStatus()
    } else {
      store.closeFleetStatus()
    }
  }, state)
}

async function inspectCompactShellGeometry (page) {
  return page.evaluate(() => {
    const describe = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        rect: rect.toJSON(),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth
      }
    }
    const inspectPointer = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return { reachable: false, rect: null, target: '' }
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        return { reachable: false, rect: rect.toJSON(), target: '' }
      }
      const target = document.elementFromPoint(
        Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
        Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2))
      )
      return {
        reachable: Boolean(target && element.contains(target)),
        rect: rect.toJSON(),
        target: target?.className?.baseVal || target?.className || target?.tagName || ''
      }
    }
    const panes = [...document.querySelectorAll('.layout-wrap-c3 .layout-item')]
      .map(element => element.getBoundingClientRect().toJSON())
    const overlaps = []
    for (let leftIndex = 0; leftIndex < panes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < panes.length; rightIndex += 1) {
        const left = panes[leftIndex]
        const right = panes[rightIndex]
        const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left)
        const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)
        if (overlapWidth > 1 && overlapHeight > 1) overlaps.push([leftIndex, rightIndex])
      }
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentElement: describe('html'),
      body: describe('body'),
      root: describe('#container'),
      leftPanel: describe('.sidebar-list'),
      rightPanel: describe('.right-side-panel'),
      terminal: describe('.layout-wrap-c3'),
      footer: describe('.main-footer'),
      panes,
      overlaps,
      pinControl: inspectPointer('.right-side-panel-pin'),
      closeControl: inspectPointer('.right-side-panel-close')
    }
  })
}

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
      { width: 393, height: 267 },
      { width: 590, height: 400, zoom: 1.75 },
      { width: 590, height: 400, zoom: 2 }
    ]
    const compactGeometryStates = [
      {
        name: 'dual-pinned-overlay',
        language: 'en_us',
        openedSideBar: 'bookmarks',
        pinned: true,
        leftSidebarWidth: 300,
        rightPanelVisible: true,
        rightPanelPinned: true,
        rightPanelWidth: 1000
      },
      {
        name: 'closed-left-pinned-right-overlay',
        language: 'zh_cn',
        openedSideBar: '',
        pinned: true,
        leftSidebarWidth: 300,
        rightPanelVisible: true,
        rightPanelPinned: true,
        rightPanelWidth: 1000
      },
      {
        name: 'dual-unpinned-overlay',
        language: 'en_us',
        openedSideBar: 'bookmarks',
        pinned: false,
        leftSidebarWidth: 300,
        rightPanelVisible: true,
        rightPanelPinned: false,
        rightPanelWidth: 1000
      },
      {
        name: 'oversized-dual-pinned-overlay',
        language: 'zh_cn',
        openedSideBar: 'bookmarks',
        pinned: true,
        leftSidebarWidth: 1000,
        rightPanelVisible: true,
        rightPanelPinned: true,
        rightPanelWidth: 1000
      }
    ]
    const originalCompactShellState = await captureCompactShellState(page)

    try {
      await setWindowCase(electronApp, page, { width: 1100, height: 700 }, 1)
      await resetSurface(page, 'en_us')
      await applyCompactShellState(page, compactGeometryStates[0])
      await expect(page.locator('.layout-wrap-c3 .layout-item')).toHaveCount(3)
      await expect(page.locator('.right-side-panel')).toBeVisible()
      const sideBySideMetrics = await inspectCompactShellGeometry(page)
      const sideBySideContext = JSON.stringify({ surface: 'desktop-side-by-side', sideBySideMetrics })
      expect(sideBySideMetrics.leftPanel.rect.width, sideBySideContext).toBeCloseTo(300, 0)
      expect(sideBySideMetrics.rightPanel.rect.width, sideBySideContext).toBeCloseTo(408, 0)
      expect(sideBySideMetrics.terminal.rect.width, sideBySideContext).toBeGreaterThanOrEqual(319)
      expect(sideBySideMetrics.leftPanel.rect.right, sideBySideContext)
        .toBeLessThanOrEqual(sideBySideMetrics.terminal.rect.left + 1)
      expect(sideBySideMetrics.terminal.rect.right, sideBySideContext)
        .toBeLessThanOrEqual(sideBySideMetrics.rightPanel.rect.left + 1)
      expect(Math.abs(sideBySideMetrics.footer.rect.left - sideBySideMetrics.terminal.rect.left), sideBySideContext)
        .toBeLessThanOrEqual(1)
      expect(Math.abs(sideBySideMetrics.footer.rect.right - sideBySideMetrics.terminal.rect.right), sideBySideContext)
        .toBeLessThanOrEqual(1)
    } finally {
      await restoreCompactShellState(page, originalCompactShellState)
    }

    for (const size of compactSizes) {
      await setWindowCase(electronApp, page, size, size.zoom || 1)
      await resetSurface(page, 'en_us')
      if (size.zoom >= 1.75) {
        const documentWidths = await inspectDocumentBaseline(page)
        for (const node of documentWidths.nodes) {
          expect(node.scrollWidth, JSON.stringify({ size, documentWidths }))
            .toBeLessThanOrEqual(node.clientWidth)
        }
        const originalGeometryState = await captureCompactShellState(page)
        try {
          let splitMetrics
          for (const geometryState of compactGeometryStates) {
            await resetSurface(page, geometryState.language)
            await applyCompactShellState(page, geometryState)
            await expect(page.locator('.layout-wrap-c3 .layout-item')).toHaveCount(3)
            await expect(page.locator('.right-side-panel')).toBeVisible()
            const geometryMetrics = await inspectCompactShellGeometry(page)
            const geometryContext = JSON.stringify({ size, geometryState, geometryMetrics })
            const expectedTerminalWidth = geometryMetrics.viewport.width - 72

            expect(geometryMetrics.terminal.rect.width, geometryContext)
              .toBeGreaterThanOrEqual(expectedTerminalWidth - 1)
            expect(geometryMetrics.terminal.rect.width, geometryContext).toBeGreaterThan(0)
            expect(geometryMetrics.rightPanel.rect.width, geometryContext)
              .toBeLessThanOrEqual(geometryMetrics.viewport.width + 1)
            expect(geometryMetrics.leftPanel.rect.width, geometryContext)
              .toBeLessThanOrEqual(Math.max(0, geometryMetrics.viewport.width - 72) + 1)
            expect(geometryMetrics.leftPanel.rect.width, geometryContext)
              .toBeCloseTo(geometryState.openedSideBar ? expectedTerminalWidth : 0, 0)
            expect(Math.abs(geometryMetrics.footer.rect.left - geometryMetrics.terminal.rect.left), geometryContext)
              .toBeLessThanOrEqual(1)
            expect(Math.abs(geometryMetrics.footer.rect.right - geometryMetrics.terminal.rect.right), geometryContext)
              .toBeLessThanOrEqual(1)
            expect(geometryMetrics.panes.every(pane => pane.width > 0 && pane.height > 0), geometryContext).toBe(true)
            expect(geometryMetrics.overlaps, geometryContext).toEqual([])
            expect(geometryMetrics.pinControl.reachable, geometryContext).toBe(true)
            expect(geometryMetrics.closeControl.reachable, geometryContext).toBe(true)
            for (const name of ['documentElement', 'body', 'root']) {
              expect(geometryMetrics[name].scrollWidth, geometryContext)
                .toBeLessThanOrEqual(geometryMetrics[name].clientWidth)
            }
            splitMetrics = geometryMetrics

            if (geometryState.name === 'dual-pinned-overlay') {
              const pin = page.locator('.right-side-panel-pin')
              const close = page.locator('.right-side-panel-close')
              await pin.click()
              await expect.poll(() => page.evaluate(() => window.store.rightPanelPinned)).toBe(false)
              await pin.click()
              await expect.poll(() => page.evaluate(() => window.store.rightPanelPinned)).toBe(true)
              await close.click()
              await expect(page.locator('.right-side-panel')).toHaveCount(0)
              await page.evaluate(() => { window.store.rightPanelVisible = true })
              await expect(page.locator('.right-side-panel')).toBeVisible()
            }
          }
          const splitContext = JSON.stringify({ size, splitMetrics })
          expect(splitMetrics.terminal.rect.width, splitContext).toBeGreaterThan(0)

          await page.evaluate(() => window.store.openFleetStatus())
          await page.locator('.fleet-status-workspace-active').waitFor()
          const fleetMetrics = await page.locator('.fleet-status-workspace-active').evaluate((workspace) => {
            const rect = workspace.getBoundingClientRect()
            return {
              rect: rect.toJSON(),
              viewport: { width: window.innerWidth, height: window.innerHeight }
            }
          })
          const fleetContext = JSON.stringify({ size, fleetMetrics })
          expect(fleetMetrics.rect.width, fleetContext).toBeGreaterThan(0)
          expect(fleetMetrics.rect.height, fleetContext).toBeGreaterThan(0)
          expect(fleetMetrics.rect.left, fleetContext).toBeGreaterThanOrEqual(0)
          expect(fleetMetrics.rect.right, fleetContext).toBeLessThanOrEqual(fleetMetrics.viewport.width + 1)
          expect(splitMetrics.overlaps, splitContext).toEqual([])

          await page.evaluate(() => window.store.closeFleetStatus())
          await ensureVisualBookmark(page)
          const chromeMetrics = await page.evaluate(() => {
            const describe = element => {
              const rect = element.getBoundingClientRect()
              return { rect: rect.toJSON(), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
            }
            return {
              documentElement: describe(document.documentElement),
              body: describe(document.body),
              root: describe(document.getElementById('container')),
              bookmark: describe(document.querySelector('.sidebar-list')),
              footer: describe(document.querySelector('.main-footer')),
              viewport: { width: window.innerWidth, height: window.innerHeight }
            }
          })
          const chromeContext = JSON.stringify({ size, chromeMetrics })
          for (const name of ['documentElement', 'body', 'root']) {
            expect(chromeMetrics[name].scrollWidth, chromeContext).toBeLessThanOrEqual(chromeMetrics[name].clientWidth)
          }
          expect(chromeMetrics.bookmark.rect.right, chromeContext).toBeLessThanOrEqual(chromeMetrics.viewport.width + 1)
          expect(chromeMetrics.footer.rect.left, chromeContext).toBeGreaterThanOrEqual(0)
          expect(chromeMetrics.footer.rect.right, chromeContext).toBeLessThanOrEqual(chromeMetrics.viewport.width + 1)

          await resetSurface(page, 'en_us')
          await page.evaluate(() => window.store.setLayout('c1'))
          await ensureTwoTerminalTabs(page)
          const terminal = await inspectTerminalInvariant(page)
          assertTerminalInvariant(terminal, { runner: browserName, size, surface: 'compact-terminal-invariant' })
        } finally {
          await restoreCompactShellState(page, originalGeometryState)
        }
      }
      await openWidgets(page)
      const metrics = await page.locator('.setting-tabs-widgets').evaluate(root => {
        const shell = root.querySelector('.widgets-shell')
        const cards = root.querySelector('.widgets-card-list')
        const firstCard = cards.querySelector('.widget-card')
        const style = window.getComputedStyle(root)
        const cardsStyle = window.getComputedStyle(cards)
        const describeWidth = (element) => {
          const elementStyle = window.getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return {
            className: element.className,
            width: rect.width,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            minWidth: elementStyle.minWidth,
            whiteSpace: elementStyle.whiteSpace,
            wordBreak: elementStyle.wordBreak
          }
        }
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
          cardCount: cards.querySelectorAll('.widget-card').length,
          firstCardWidths: [
            firstCard,
            firstCard.querySelector('.widget-card-main'),
            firstCard.querySelector('.widget-card-head'),
            firstCard.querySelector('.widget-card-title'),
            firstCard.querySelector('.widget-card-desc'),
            firstCard.querySelector('.widget-card-meta'),
            ...firstCard.querySelectorAll('.widget-card-meta span')
          ].map(describeWidth)
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

      const batchCard = page.locator('.widget-card[data-widget-id="batch-op"][data-widget-type="frontend"]')
      await batchCard.scrollIntoViewIfNeeded()
      const batchReachability = await batchCard.evaluate((card) => {
        const header = document.querySelector('.setting-header')
        const tabs = document.querySelector('.setting-tabs')
        const widgets = document.querySelector('.setting-tabs-widgets')
        const cards = document.querySelector('.widgets-card-list')
        const describe = element => ({
          rect: element.getBoundingClientRect().toJSON(),
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          overflowY: window.getComputedStyle(element).overflowY,
          position: window.getComputedStyle(element).position
        })
        const cardRect = card.getBoundingClientRect()
        const visibleTop = Math.max(0, cardRect.top)
        const visibleBottom = Math.min(window.innerHeight, cardRect.bottom)
        const hitTarget = visibleBottom > visibleTop
          ? document.elementFromPoint(cardRect.left + Math.min(24, cardRect.width / 2), (visibleTop + visibleBottom) / 2)
          : null
        return {
          card: describe(card),
          header: describe(header),
          tabs: describe(tabs),
          widgets: describe(widgets),
          cards: describe(cards),
          viewportHeight: window.innerHeight,
          pointerReachable: Boolean(hitTarget && card.contains(hitTarget)),
          hitTarget: hitTarget?.className || hitTarget?.tagName || ''
        }
      })
      expect(batchReachability.pointerReachable, JSON.stringify({ size, batchReachability })).toBe(true)

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
    expect(compactChecks).toBe(6)
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
