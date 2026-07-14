const fs = require('fs')
const path = require('path')
const stylus = require('stylus')
const { _electron: electron, test, expect } = require('@playwright/test')

const root = path.resolve(__dirname, '../..')
const fixture = path.join(__dirname, 'fixtures/setting-layout-main.js')
const viewportCases = [
  { width: 472, height: 320 },
  { width: 393, height: 267 }
]
const actionViewportCases = [
  { width: 590, height: 400 },
  { width: 472, height: 320 },
  { width: 393, height: 267 }
]

function compileStylus (relativePath) {
  const filename = path.join(root, relativePath)
  return new Promise((resolve, reject) => {
    stylus.render(
      fs.readFileSync(filename, 'utf8'),
      { filename },
      (error, css) => error ? reject(error) : resolve(css)
    )
  })
}

test('bookmark editor remains reachable in zoom-equivalent low viewports', async () => {
  const css = (await Promise.all([
    compileStylus('src/client/components/setting-panel/setting-wrap.styl'),
    compileStylus('src/client/components/setting-panel/list.styl'),
    compileStylus('src/client/components/tree-list/tree-list.styl')
  ])).join('\n')
  const electronApp = await electron.launch({
    executablePath: require('electron'),
    args: [fixture, '--disable-gpu', '--disable-dev-shm-usage']
  })

  try {
    const page = await electronApp.firstWindow()
    await page.setContent(`
      <style>
        * { box-sizing: border-box; }
        html, body, .setting-wrap, .custom-drawer-content { width: 100%; height: 100%; margin: 0; }
        .setting-header { height: var(--sp-setting-header-height); }
        .setting-tabs { height: 44px; }
        .tree-list-virtual-spacer { height: 400px; }
        .editor-fixture { height: 300px; }
        ${css}
      </style>
      <main class="setting-wrap">
        <div class="custom-drawer-content">
          <header class="setting-header">Settings</header>
          <nav class="setting-tabs">Tabs</nav>
          <section class="setting-tabs-bookmarks">
            <div class="setting-col">
              <aside class="setting-row setting-row-left">
                <div class="model-bookmark-tree-wrap">
                  <div class="tree-list">
                    <div class="tree-list-header">Bookmarks</div>
                    <div class="item-list-wrap">
                      <div class="tree-list-virtual-spacer"></div>
                    </div>
                  </div>
                </div>
              </aside>
              <article class="setting-row setting-row-right">
                <div class="setting-col-content">
                  <div class="editor-fixture">Bookmark editor</div>
                </div>
              </article>
            </div>
          </section>
        </div>
      </main>
    `)

    for (const viewport of viewportCases) {
      await electronApp.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height)
      }, viewport)
      await page.waitForFunction(
        size => window.innerWidth === size.width && window.innerHeight === size.height,
        viewport
      )
      const metrics = await page.evaluate(() => {
        const tab = document.querySelector('.setting-tabs-bookmarks')
        const left = document.querySelector('.setting-row-left')
        const right = document.querySelector('.setting-row-right')
        const list = document.querySelector('.item-list-wrap')
        const root = document.querySelector('.setting-wrap')
        return {
          leftHeight: left.clientHeight,
          rightHeight: right.clientHeight,
          tabClientHeight: tab.clientHeight,
          tabScrollHeight: tab.scrollHeight,
          tabOverflowY: window.getComputedStyle(tab).overflowY,
          listClientHeight: list.clientHeight,
          listScrollHeight: list.scrollHeight,
          listOverflowY: window.getComputedStyle(list).overflowY,
          rootClientWidth: root.clientWidth,
          rootScrollWidth: root.scrollWidth
        }
      })

      expect(metrics.leftHeight, JSON.stringify(viewport)).toBeGreaterThanOrEqual(132)
      expect(metrics.rightHeight, JSON.stringify(viewport)).toBeGreaterThanOrEqual(160)
      expect(metrics.tabScrollHeight, JSON.stringify(viewport)).toBeGreaterThan(metrics.tabClientHeight)
      expect(metrics.tabOverflowY).toBe('auto')
      expect(metrics.listScrollHeight, JSON.stringify(viewport)).toBeGreaterThan(metrics.listClientHeight)
      expect(metrics.listOverflowY).toBe('auto')
      expect(metrics.rootScrollWidth).toBeLessThanOrEqual(metrics.rootClientWidth)
    }
  } finally {
    await electronApp.close()
  }
})

test('bookmark actions stop overlaying fields in compact settings viewports', async () => {
  const css = (await Promise.all([
    compileStylus('src/client/components/setting-panel/setting-wrap.styl'),
    compileStylus('src/client/components/setting-panel/list.styl'),
    compileStylus('src/client/components/tree-list/tree-list.styl'),
    compileStylus('src/client/components/bookmark-form/bookmark-form.styl')
  ])).join('\n')
  const electronApp = await electron.launch({
    executablePath: require('electron'),
    args: [fixture, '--disable-gpu', '--disable-dev-shm-usage']
  })

  try {
    const page = await electronApp.firstWindow()
    const fields = Array.from({ length: 8 }, (_, index) => `
      <div class="ant-form-item fixture-field" ${index === 7 ? 'data-last-field' : ''}>
        <div class="ant-form-item-label"><label>Connection option ${index + 1} 连接配置字段</label></div>
        <div class="ant-form-item-control"><input value="value-${index + 1}"></div>
      </div>
    `).join('')
    await page.setContent(`
      <style>
        * { box-sizing: border-box; }
        html, body, .setting-wrap, .custom-drawer-content { width: 100%; height: 100%; margin: 0; }
        .setting-wrap {
          --sp-page: #f3f6fa;
          --sp-surface: #fff;
          --sp-surface-subtle: #eef2f7;
          --sp-text: #253249;
          --sp-text-muted: #667085;
          --sp-border: #ccd4df;
          --sp-primary: #2878e6;
          --sp-primary-soft: #e7f0fd;
          --sp-radius-card: 8px;
          --sp-radius-control: 5px;
          --sp-shadow-card: none;
        }
        .setting-header { height: var(--sp-setting-header-height); }
        .setting-tabs { height: 44px; }
        .tree-list-virtual-spacer { height: 400px; }
        .form-title { min-height: 44px; padding: 8px; }
        .fixture-field { min-height: 62px; margin-bottom: 12px; }
        .fixture-field label { display: block; }
        .fixture-field input { width: 100%; min-height: 32px; }
        .sp-card { background: var(--sp-surface); border: 1px solid var(--sp-border); }
        .ant-tabs-nav-wrap > div { width: 860px; white-space: nowrap; }
        .ant-btn { min-height: 32px; padding: 4px 15px; }
        .mg1b { margin-bottom: 8px; }
        ${css}
      </style>
      <main class="setting-wrap">
        <div class="custom-drawer-content">
          <header class="setting-header"><h2>Settings</h2><input><select><option>English</option></select><button>Close</button></header>
          <nav class="setting-tabs">Bookmarks Themes Quick commands Settings</nav>
          <section class="setting-tabs-bookmarks">
            <div class="setting-col">
              <aside class="setting-row setting-row-left">
                <div class="model-bookmark-tree-wrap"><div class="tree-list"><div class="item-list-wrap"><div class="tree-list-virtual-spacer"></div></div></div></div>
              </aside>
              <article class="setting-row setting-row-right">
                <div class="setting-col-content">
                  <div class="form-wrap">
                    <div class="form-title">New bookmark</div>
                    <form class="sp-configuration-form">
                      <div class="sp-configuration-tabs"><div class="ant-tabs-nav"><div class="ant-tabs-nav-wrap"><div>General Proxy Jump hosts Port forwarding Terminal background Advanced</div></div></div></div>
                      <section class="sp-card sp-configuration-section">${fields}</section>
                      <div class="ant-form-item sp-configuration-actions" data-actions>
                        <div class="ant-form-item-control">
                          <p class="sp-configuration-action-row"><button class="ant-btn mg1b">Save and connect 保存并连接</button><button class="ant-btn mg1b">Save and create new 保存并新建</button><button class="ant-btn mg1b">Save 保存</button></p>
                          <p class="sp-configuration-action-row"><button class="ant-btn mg1b">Connect only 仅连接</button><button class="ant-btn mg1b">Test connection 测试连接</button></p>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>
      </main>
    `)

    for (const viewport of actionViewportCases) {
      await electronApp.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height)
      }, viewport)
      await page.waitForFunction(
        size => window.innerWidth === size.width && window.innerHeight === size.height,
        viewport
      )
      const metrics = await page.evaluate(async () => {
        const root = document.querySelector('.setting-wrap')
        const tab = document.querySelector('.setting-tabs-bookmarks')
        const content = document.querySelector('.setting-col-content')
        const form = document.querySelector('.sp-configuration-form')
        const actions = document.querySelector('[data-actions]')
        const lastField = document.querySelector('[data-last-field]')
        const scrollHost = tab.scrollHeight > tab.clientHeight ? tab : content
        const actionPosition = window.getComputedStyle(actions).position
        const paddingBottom = Number.parseFloat(window.getComputedStyle(form).paddingBottom)
        const actionsHeight = actions.getBoundingClientRect().height
        const contentHeight = content.getBoundingClientRect().height
        const allButtonsReachable = []
        for (const button of actions.querySelectorAll('button')) {
          button.scrollIntoView({ block: 'center' })
          await new Promise(resolve => requestAnimationFrame(resolve))
          const buttonRect = button.getBoundingClientRect()
          const hostRect = scrollHost.getBoundingClientRect()
          allButtonsReachable.push(
            buttonRect.top >= hostRect.top - 1 && buttonRect.bottom <= hostRect.bottom + 1
          )
        }
        actions.scrollIntoView({ block: 'end' })
        await new Promise(resolve => requestAnimationFrame(resolve))
        const actionsRect = actions.getBoundingClientRect()
        const lastFieldRect = lastField.getBoundingClientRect()
        return {
          actionPosition,
          paddingBottom,
          actionsHeight,
          contentHeight,
          actionsTallerThanContent: actionsHeight > contentHeight,
          fieldBeforeActionsWithoutOverlap: lastFieldRect.bottom <= actionsRect.top + 1,
          allButtonsReachable,
          scrollHostOverflowY: window.getComputedStyle(scrollHost).overflowY,
          scrollHostClientHeight: scrollHost.clientHeight,
          scrollHostScrollHeight: scrollHost.scrollHeight,
          rootClientWidth: root.clientWidth,
          rootScrollWidth: root.scrollWidth
        }
      })

      expect(metrics.actionPosition, JSON.stringify({ viewport, metrics })).toBe('static')
      expect(metrics.paddingBottom, JSON.stringify({ viewport, metrics })).toBeLessThanOrEqual(16)
      expect(metrics.scrollHostScrollHeight, JSON.stringify({ viewport, metrics })).toBeGreaterThan(metrics.scrollHostClientHeight)
      expect(metrics.scrollHostOverflowY, JSON.stringify({ viewport, metrics })).toBe('auto')
      expect(metrics.fieldBeforeActionsWithoutOverlap, JSON.stringify({ viewport, metrics })).toBe(true)
      expect(metrics.allButtonsReachable, JSON.stringify({ viewport, metrics })).not.toContain(false)
      expect(metrics.rootScrollWidth, JSON.stringify({ viewport, metrics })).toBeLessThanOrEqual(metrics.rootClientWidth)
    }

    const normalViewport = { width: 820, height: 600 }
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height)
    }, normalViewport)
    await page.waitForFunction(
      size => window.innerWidth === size.width && window.innerHeight === size.height,
      normalViewport
    )
    const normalMetrics = await page.evaluate(() => {
      const root = document.querySelector('.setting-wrap')
      const content = document.querySelector('.setting-col-content')
      const actions = document.querySelector('[data-actions]')
      const lastField = document.querySelector('[data-last-field]')
      content.scrollTop = content.scrollHeight
      const contentRect = content.getBoundingClientRect()
      const actionsRect = actions.getBoundingClientRect()
      const lastFieldRect = lastField.getBoundingClientRect()
      return {
        actionPosition: window.getComputedStyle(actions).position,
        actionsHeight: actionsRect.height,
        contentHeight: contentRect.height,
        actionsContained: actionsRect.top >= contentRect.top - 1 && actionsRect.bottom <= contentRect.bottom + 1,
        lastFieldClear: lastFieldRect.bottom <= actionsRect.top + 1,
        rootClientWidth: root.clientWidth,
        rootScrollWidth: root.scrollWidth
      }
    })

    expect(normalMetrics.actionPosition, JSON.stringify(normalMetrics)).toBe('sticky')
    expect(normalMetrics.actionsHeight, JSON.stringify(normalMetrics)).toBeLessThan(normalMetrics.contentHeight)
    expect(normalMetrics.actionsContained, JSON.stringify(normalMetrics)).toBe(true)
    expect(normalMetrics.lastFieldClear, JSON.stringify(normalMetrics)).toBe(true)
    expect(normalMetrics.rootScrollWidth).toBeLessThanOrEqual(normalMetrics.rootClientWidth)
  } finally {
    await electronApp.close()
  }
})
