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
