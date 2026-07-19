const path = require('path')
const { test, expect, chromium } = require('@playwright/test')

const projectRoot = path.resolve(__dirname, '../..')
const fixtureRoot = path.join(__dirname, 'fixtures/context-menu-ant6')
const chromeExecutable = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const fixtureSemanticTokens = {
  '--sp-border-strong': '#657083',
  '--sp-highlight-top': 'rgba(255, 255, 255, 0.18)'
}

let viteServer
let fixtureUrl

async function launchFixture (width, height) {
  const browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true,
    args: ['--disable-gpu', '--disable-dev-shm-usage']
  })
  const page = await browser.newPage({ viewport: { width, height } })
  await page.goto(fixtureUrl)
  await page.evaluate(tokens => {
    for (const [name, value] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(name, value)
    }
  }, fixtureSemanticTokens)
  await page.locator('[data-fixture-ready="true"]').waitFor()
  return { browser, page }
}

async function waitForPopupMotion (popup) {
  await expect.poll(async () => {
    return popup.evaluate(element => window.getComputedStyle(element).transform)
  }).toBe('none')
}

async function openMenu (page) {
  await page.getByTestId('menu-trigger').click()
  const popup = page.locator('.shellpilot-context-menu.ant-dropdown').first()
  await expect(popup).toBeVisible()
  await waitForPopupMotion(popup)
  return popup
}

async function openSubmenu (page) {
  const parentMenu = await openMenu(page)
  const submenuTitle = parentMenu.locator('.ant-dropdown-menu-submenu-title')
  await submenuTitle.hover()
  const popup = page.locator(
    '.shellpilot-context-menu.ant-dropdown-menu-submenu-popup'
  ).last()
  await expect(popup).toBeVisible()
  await waitForPopupMotion(popup)
  return { parentMenu, popup, submenuTitle }
}

async function documentHasNoHorizontalOverflow (page) {
  return page.evaluate(() => {
    return document.documentElement.scrollWidth <= window.innerWidth
  })
}

async function inspectMenuDepth (popup) {
  return popup.evaluate((popupElement) => {
    const surface = popupElement.querySelector('.ant-dropdown-menu') || popupElement
    const style = window.getComputedStyle(surface)
    const rootStyle = window.getComputedStyle(document.documentElement)
    const rect = surface.getBoundingClientRect()
    const rootRect = popupElement.getBoundingClientRect()
    const items = [...surface.querySelectorAll('[role="menuitem"]')]
    const menuRect = surface.getBoundingClientRect()
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
    const reachable = item => {
      if (!item) return false
      const itemRect = item.getBoundingClientRect()
      return itemRect.top >= menuRect.top - 1 && itemRect.bottom <= menuRect.bottom + 1
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
      firstReachable: reachable(items[0]),
      lastReachable: reachable(items.at(-1))
    }
  })
}

function assertMenuDepth (metrics) {
  const message = JSON.stringify(metrics)
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

test.beforeAll(async () => {
  const { createServer } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  viteServer = await createServer({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'error',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      fs: {
        allow: [projectRoot]
      }
    }
  })
  await viteServer.listen()
  const address = viteServer.httpServer.address()
  fixtureUrl = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  await viteServer?.close()
})

test('real Ant6 runtime preserves semantic menu tokens and grid columns', async () => {
  const { browser, page } = await launchFixture(800, 600)
  try {
    const popup = await openMenu(page)
    const menu = popup.locator('.ant-dropdown-menu')
    const normal = menu.locator('.ant-dropdown-menu-item').filter({
      has: page.getByTestId('normal-label')
    })
    const danger = menu.locator('.ant-dropdown-menu-item-danger')
    const disabled = menu.locator('.ant-dropdown-menu-item-disabled')

    const styles = await page.evaluate(() => {
      const root = document.querySelector('.shellpilot-context-menu.ant-dropdown')
      const menuElement = root.querySelector('.ant-dropdown-menu')
      const normalItem = root.querySelector('[data-testid="normal-label"]')
        .closest('.ant-dropdown-menu-item')
      const dangerItem = root.querySelector('.ant-dropdown-menu-item-danger')
      const disabledItem = root.querySelector('.ant-dropdown-menu-item-disabled')
      const rootStyle = window.getComputedStyle(document.documentElement)
      const resolveColor = (token, property) => {
        const probe = document.createElement('span')
        probe.style[property] = `var(${token})`
        document.body.appendChild(probe)
        const value = window.getComputedStyle(probe)[property]
        probe.remove()
        return value
      }
      return {
        menuBackground: window.getComputedStyle(menuElement).backgroundColor,
        normalColor: window.getComputedStyle(normalItem).color,
        dangerColor: window.getComputedStyle(dangerItem).color,
        disabledColor: window.getComputedStyle(disabledItem).color,
        normalDisplay: window.getComputedStyle(normalItem).display,
        tokens: {
          surfaceElevated: resolveColor('--sp-surface-elevated', 'backgroundColor'),
          text: resolveColor('--sp-text', 'color'),
          danger: resolveColor('--sp-danger', 'color'),
          textDisabled: resolveColor('--sp-text-disabled', 'color'),
          primarySoft: resolveColor('--sp-primary-soft', 'backgroundColor'),
          surfaceElevatedRaw: rootStyle.getPropertyValue('--sp-surface-elevated').trim()
        }
      }
    })
    expect(styles.tokens.surfaceElevatedRaw).not.toBe('')
    expect(styles.menuBackground).toBe(styles.tokens.surfaceElevated)
    expect(styles.normalColor).toBe(styles.tokens.text)
    expect(styles.dangerColor).toBe(styles.tokens.danger)
    expect(styles.disabledColor).toBe(styles.tokens.textDisabled)
    expect(styles.normalDisplay).toBe('grid')
    const depth = await inspectMenuDepth(popup)
    assertMenuDepth(depth)
    expect(depth.firstReachable).toBe(true)
    expect(depth.lastReachable).toBe(true)

    await normal.hover()
    await expect.poll(async () => {
      return normal.evaluate(element => window.getComputedStyle(element).backgroundColor)
    }).toBe(styles.tokens.primarySoft)

    const geometry = await normal.evaluate(element => {
      const icon = element.querySelector('.ant-dropdown-menu-item-icon')
      const label = element.querySelector('.ant-dropdown-menu-item-label')
      const shortcut = element.querySelector('.ant-dropdown-menu-item-extra')
      const iconRect = icon.getBoundingClientRect()
      const labelRect = label.getBoundingClientRect()
      const shortcutRect = shortcut.getBoundingClientRect()
      const labelStyle = window.getComputedStyle(label)
      return {
        iconRight: iconRect.right,
        labelLeft: labelRect.left,
        labelRight: labelRect.right,
        shortcutLeft: shortcutRect.left,
        labelScrollHeight: labelRect.height,
        lineHeight: parseFloat(labelStyle.lineHeight)
      }
    })
    expect(geometry.iconRight).toBeLessThanOrEqual(geometry.labelLeft + 1)
    expect(geometry.labelRight).toBeLessThanOrEqual(geometry.shortcutLeft + 1)
    expect(geometry.labelScrollHeight).toBeGreaterThan(geometry.lineHeight * 1.5)

    const submenuColumns = await popup
      .locator('.ant-dropdown-menu-submenu-title')
      .evaluate(element => {
        const label = element.querySelector('.ant-dropdown-menu-title-content')
        const arrow = element.querySelector('.ant-dropdown-menu-submenu-expand-icon')
        const labelRect = label.getBoundingClientRect()
        const arrowRect = arrow.getBoundingClientRect()
        return {
          display: window.getComputedStyle(element).display,
          labelRight: labelRect.right,
          arrowLeft: arrowRect.left
        }
      })
    expect(submenuColumns.display).toBe('grid')
    expect(submenuColumns.labelRight).toBeLessThanOrEqual(submenuColumns.arrowLeft + 1)
    await expect(danger).toBeVisible()
    await expect(disabled).toBeVisible()
  } finally {
    await browser.close()
  }
})

test('real Ant6 menu fits a 393px window at 200% effective viewport', async () => {
  const { browser, page } = await launchFixture(197, 134)
  try {
    const popup = await openMenu(page)
    const depth = await inspectMenuDepth(popup)
    console.log(`ANT6_HIGH_ZOOM_MENU_DEPTH=${JSON.stringify(depth)}`)
    assertMenuDepth(depth)

    const reachability = await popup.locator('.ant-dropdown-menu').evaluate(menu => {
      const items = [...menu.querySelectorAll('[role="menuitem"]')]
      const pointerReachable = item => {
        const itemRect = item.getBoundingClientRect()
        const menuRect = menu.getBoundingClientRect()
        const visibleTop = Math.max(itemRect.top, menuRect.top)
        const visibleBottom = Math.min(itemRect.bottom, menuRect.bottom)
        if (visibleBottom <= visibleTop) return false
        const x = Math.min(menuRect.right - 1, Math.max(menuRect.left, itemRect.left + itemRect.width / 2))
        const y = visibleTop + (visibleBottom - visibleTop) / 2
        return item.contains(document.elementFromPoint(x, y))
      }
      menu.scrollTop = 0
      const firstReachable = pointerReachable(items[0])
      items.at(-1).scrollIntoView({ block: 'nearest' })
      return {
        itemCount: items.length,
        firstReachable,
        lastReachable: pointerReachable(items.at(-1)),
        scrollTop: menu.scrollTop,
        maxScrollTop: menu.scrollHeight - menu.clientHeight,
        firstHeight: items[0].getBoundingClientRect().height,
        menuHeight: menu.getBoundingClientRect().height
      }
    })
    const context = JSON.stringify(reachability)
    expect(reachability.itemCount, context).toBeGreaterThan(1)
    expect(reachability.firstReachable, context).toBe(true)
    expect(reachability.lastReachable, context).toBe(true)
    expect(reachability.scrollTop, context).toBeGreaterThan(0)
    expect(reachability.scrollTop, context).toBeLessThanOrEqual(reachability.maxScrollTop + 1)
    expect(await documentHasNoHorizontalOverflow(page)).toBe(true)
  } finally {
    await browser.close()
  }
})

for (const viewport of [
  { width: 590, height: 400 },
  { width: 393, height: 267 }
]) {
  test(`real Ant6 SFTP submenu stays reachable at ${viewport.width}px`, async () => {
    const { browser, page } = await launchFixture(
      viewport.width,
      viewport.height
    )
    try {
      const { popup } = await openSubmenu(page)
      const depth = await inspectMenuDepth(popup)
      assertMenuDepth(depth)
      expect(depth.firstReachable).toBe(true)
      const bounds = await popup.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(8)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 8)
      expect(bounds.y).toBeGreaterThanOrEqual(8)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 8)

      const menuScroll = await popup.locator('.ant-dropdown-menu').evaluate(element => {
        const style = window.getComputedStyle(element)
        return {
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          overflowY: style.overflowY
        }
      })
      expect(menuScroll.scrollHeight).toBeGreaterThan(menuScroll.clientHeight)
      expect(['auto', 'scroll']).toContain(menuScroll.overflowY)

      const lastChild = popup.getByTestId('submenu-child-29')
      await lastChild.scrollIntoViewIfNeeded()
      await lastChild.hover()
      await lastChild.evaluate(element => {
        element.closest('.ant-dropdown-menu-item').focus()
      })
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('last-action')).toHaveText('submenu-29')
      expect(await documentHasNoHorizontalOverflow(page)).toBe(true)
    } finally {
      await browser.close()
    }
  })
}

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 590, height: 400 },
  { width: 393, height: 267 }
]) {
  test(`real Ant6 transfer popover keeps its table reachable at ${viewport.width}px`, async () => {
    const { browser, page } = await launchFixture(
      viewport.width,
      viewport.height
    )
    try {
      await page.getByTestId('transfer-trigger').click()
      const popup = page.locator('.shellpilot-transfer-history-popover')
      await expect(popup).toBeVisible()
      await waitForPopupMotion(popup)

      const bounds = await popup.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(8)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 8)
      if (viewport.width === 1600) {
        expect(bounds.width).toBeGreaterThanOrEqual(viewport.width - 64)
      }

      const tableBody = popup.locator('.ant-table-content')
      const horizontal = await tableBody.evaluate(element => {
        const style = window.getComputedStyle(element)
        const initialScrollWidth = element.scrollWidth
        const initialClientWidth = element.clientWidth
        element.scrollLeft = element.scrollWidth
        return {
          clientWidth: initialClientWidth,
          scrollWidth: initialScrollWidth,
          scrollLeft: element.scrollLeft,
          overflowX: style.overflowX
        }
      })
      if (viewport.width < 1600) {
        expect(horizontal.scrollWidth).toBeGreaterThan(horizontal.clientWidth)
        expect(horizontal.scrollLeft).toBeGreaterThan(0)
        expect(['auto', 'scroll']).toContain(horizontal.overflowX)
      } else {
        expect(horizontal.clientWidth).toBeGreaterThanOrEqual(1500)
      }
      expect(await documentHasNoHorizontalOverflow(page)).toBe(true)
    } finally {
      await browser.close()
    }
  })
}
