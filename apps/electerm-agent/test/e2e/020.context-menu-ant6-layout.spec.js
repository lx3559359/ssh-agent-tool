const path = require('path')
const { test, expect, chromium } = require('@playwright/test')

const projectRoot = path.resolve(__dirname, '../..')
const fixtureRoot = path.join(__dirname, 'fixtures/context-menu-ant6')
const chromeExecutable = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

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
      return {
        menuBackground: window.getComputedStyle(menuElement).backgroundColor,
        normalColor: window.getComputedStyle(normalItem).color,
        dangerColor: window.getComputedStyle(dangerItem).color,
        disabledColor: window.getComputedStyle(disabledItem).color,
        normalDisplay: window.getComputedStyle(normalItem).display
      }
    })
    expect(styles).toEqual({
      menuBackground: 'rgb(34, 34, 34)',
      normalColor: 'rgb(242, 244, 247)',
      dangerColor: 'rgb(255, 136, 150)',
      disabledColor: 'rgb(136, 146, 164)',
      normalDisplay: 'grid'
    })

    await normal.hover()
    await expect.poll(async () => {
      return normal.evaluate(element => window.getComputedStyle(element).backgroundColor)
    }).toBe('rgb(49, 58, 74)')

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
