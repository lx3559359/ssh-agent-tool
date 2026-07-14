const fs = require('fs')
const path = require('path')
const stylus = require('stylus')
const { _electron: electron, test, expect } = require('@playwright/test')

const root = path.resolve(__dirname, '../..')
const fixture = path.join(__dirname, 'fixtures/setting-layout-main.js')
const viewportCases = [
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

test('theme library scrolls locally and keeps its editor reachable at compact zoom-equivalent sizes', async () => {
  const css = (await Promise.all([
    compileStylus('src/client/components/setting-panel/setting-wrap.styl'),
    compileStylus('src/client/components/theme/theme-gallery.styl')
  ])).join('\n')
  const electronApp = await electron.launch({
    executablePath: require('electron'),
    args: [fixture, '--disable-gpu', '--disable-dev-shm-usage']
  })

  try {
    const page = await electronApp.firstWindow()
    const cards = Array.from({ length: 24 }, (_, index) => `
      <article class="sp-theme-card">
        <button class="sp-theme-palette"><i></i><i></i><i></i><i></i></button>
        <div class="sp-theme-card-title"><strong>Theme ${index + 1}</strong><span>Light</span></div>
        <p>Theme description for a long imported theme list.</p>
        <div class="sp-theme-card-actions"><button>View</button><button>Preview</button><button>Apply</button></div>
      </article>
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
          --sp-success: #16865c;
          --sp-radius-card: 8px;
          --sp-radius-control: 5px;
          --sp-shadow-card: none;
        }
        .setting-header { height: var(--sp-setting-header-height); }
        .setting-tabs { height: 44px; }
        .sp-theme-gallery-toolbar input { width: 100%; min-height: 32px; }
        .sp-theme-editor-column { min-height: 180px; }
        .editor-fixture { min-height: 160px; }
        ${css}
      </style>
      <main class="setting-wrap">
        <div class="custom-drawer-content">
          <header class="setting-header"><h2>Settings</h2></header>
          <nav class="setting-tabs">Tabs</nav>
          <section class="setting-tabs-terminal-themes">
            <div class="sp-theme-center">
              <div class="setting-col">
                <aside class="setting-row setting-row-left">
                  <section class="sp-theme-gallery">
                    <div class="sp-theme-gallery-heading"><div><h2>Theme Library</h2><p>UI themes</p></div><button>New theme</button></div>
                    <div class="sp-theme-gallery-toolbar"><input aria-label="Search"><span>All Light Dark</span></div>
                    <div class="sp-theme-card-grid">${cards}</div>
                  </section>
                </aside>
                <article class="setting-row setting-row-right">
                  <div class="setting-col-content">
                    <div class="sp-theme-editor-column"><div class="editor-fixture">Theme editor</div></div>
                  </div>
                </article>
              </div>
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
        const center = document.querySelector('.sp-theme-center')
        const library = document.querySelector('.sp-theme-card-grid')
        const editor = document.querySelector('.sp-theme-editor-column')
        const root = document.querySelector('.setting-wrap')
        center.scrollTop = center.scrollHeight
        const centerRect = center.getBoundingClientRect()
        const editorRect = editor.getBoundingClientRect()
        return {
          libraryClientHeight: library.clientHeight,
          libraryScrollHeight: library.scrollHeight,
          libraryOverflowY: window.getComputedStyle(library).overflowY,
          editorClientHeight: editor.clientHeight,
          editorVisibleAfterScroll: editorRect.top < centerRect.bottom && editorRect.bottom > centerRect.top,
          centerClientHeight: center.clientHeight,
          centerScrollHeight: center.scrollHeight,
          centerOverflowY: window.getComputedStyle(center).overflowY,
          rootClientWidth: root.clientWidth,
          rootScrollWidth: root.scrollWidth
        }
      })

      expect(metrics.libraryClientHeight, JSON.stringify(viewport)).toBeGreaterThan(24)
      expect(metrics.libraryClientHeight, JSON.stringify(viewport)).toBeLessThanOrEqual(240)
      expect(metrics.libraryScrollHeight, JSON.stringify(viewport)).toBeGreaterThan(metrics.libraryClientHeight)
      expect(metrics.libraryOverflowY).toBe('auto')
      expect(metrics.editorClientHeight, JSON.stringify(viewport)).toBeGreaterThan(0)
      expect(metrics.editorVisibleAfterScroll, JSON.stringify(viewport)).toBe(true)
      expect(metrics.centerScrollHeight, JSON.stringify(viewport)).toBeGreaterThan(metrics.centerClientHeight)
      expect(metrics.centerOverflowY).toBe('auto')
      expect(metrics.rootScrollWidth).toBeLessThanOrEqual(metrics.rootClientWidth)
    }
  } finally {
    await electronApp.close()
  }
})
