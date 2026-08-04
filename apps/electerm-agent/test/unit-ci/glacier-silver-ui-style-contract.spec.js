const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const stylus = require('stylus')

const clientRoot = path.resolve(__dirname, '../../src/client')

function readClient (relativePath) {
  return fs.readFileSync(path.join(clientRoot, relativePath), 'utf8')
}

function compileStylus (relativePath) {
  const filename = path.join(clientRoot, relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  return new Promise((resolve, reject) => {
    stylus(source).set('filename', filename).render((error, css) => {
      if (error) reject(error)
      else resolve(css)
    })
  })
}

const shellStyleFiles = [
  'components/main/aigshell-topbar.styl',
  'components/sidebar/sidebar.styl',
  'components/side-panel-r/right-side-panel.styl',
  'components/tabs/tabs.styl',
  'components/tabs/add-btn.styl',
  'components/footer/footer.styl',
  'components/layout/layout.styl',
  'components/main/wrapper.styl',
  'components/main/term-fullscreen.styl'
]

test('Glacier Silver shell Stylus files compile', async () => {
  for (const file of shellStyleFiles) {
    assert.ok((await compileStylus(file)).length > 0, file)
  }
})

test('top bar is one continuous blue-purple strip with translucent controls', () => {
  const source = readClient('components/main/aigshell-topbar.styl')

  assert.match(
    source,
    /\.aigshell-topbar\r?\n[\s\S]{0,420}background-color #306290\r?\n\s+background-image var\(--sp-topbar-background\)/
  )
  assert.match(source, /\.aigshell-topbar-name\r?\n[\s\S]{0,120}color rgba\(255, 255, 255, \.96\)/)
  assert.match(source, /\.aigshell-topbar-actions\r?\n[\s\S]{0,220}background transparent/)
  assert.match(source, /\.aigshell-topbar-action-group-boundary\r?\n[\s\S]{0,100}rgba\(255, 255, 255, \.22\)/)
  assert.match(
    source,
    /\.aigshell-topbar-action\r?\n[\s\S]{0,260}color rgba\(255, 255, 255, \.9\)[\s\S]{0,160}background rgba\(255, 255, 255, \.08\)[\s\S]{0,120}border 1px solid rgba\(255, 255, 255, \.18\)/
  )
  assert.match(source, /\.window-controls\r?\n[\s\S]{0,180}background transparent/)

  assert.match(source, /height 44px/)
  assert.match(source, /\.aigshell-topbar-action\r?\n\s+height 30px/)
  assert.match(source, /\.window-control-box\r?\n\s+width 46px\r?\n\s+height 44px/)
  assert.match(source, /@media \(max-width: 1760px\)/)
  assert.match(source, /@media \(max-width: 720px\)/)
})

test('shell outer frames use Glacier panels while compact chrome stays flat', () => {
  const sidebar = readClient('components/sidebar/sidebar.styl')
  const rightPanel = readClient('components/side-panel-r/right-side-panel.styl')
  const tabs = readClient('components/tabs/tabs.styl')
  const footer = readClient('components/footer/footer.styl')
  const layout = readClient('components/layout/layout.styl')

  assert.match(sidebar, /\.sidebar-panel\r?\n[\s\S]{0,260}background-color var\(--sp-surface\)\r?\n\s+background-image var\(--sp-panel-background\)/)
  assert.match(sidebar, /\.sidebar\r?\n[\s\S]{0,260}background-color var\(--sp-surface\)\r?\n\s+background-image var\(--sp-panel-background\)/)
  assert.match(sidebar, /\.sidebar \.control-icon-wrap[\s\S]{0,420}background-image var\(--sp-control-background\)/)

  assert.match(rightPanel, /\.right-side-panel\r?\n[\s\S]{0,300}background-color var\(--sp-surface\)\r?\n\s+background-image var\(--sp-panel-background\)/)
  assert.match(rightPanel, /\.right-panel-ai-config-card[\s\S]{0,260}background-image var\(--sp-card-background\)/)

  assert.match(tabs, /\.tabs\r?\n[\s\S]{0,180}background-color var\(--sp-flat-background\)\r?\n\s+background-image none/)
  assert.match(tabs, /\.tab\r?\n[\s\S]{0,360}background-color var\(--sp-flat-background\)[\s\S]{0,100}box-shadow none/)
  assert.match(tabs, /\.layout-workspace-dropdown[\s\S]{0,240}background-image var\(--sp-overlay-background\)[\s\S]{0,240}var\(--sp-shadow-overlay\)/)
  assert.match(footer, /\.main-footer\r?\n[\s\S]{0,180}background-color var\(--sp-flat-background\)\r?\n\s+background-image none/)
  assert.doesNotMatch(footer, /\.main-footer[\s\S]{0,260}var\(--sp-shadow-(?:card|overlay|lg)\)/)
  assert.match(layout, /\.layout-item\r?\n[\s\S]{0,160}background-color var\(--sp-page\)\r?\n\s+background-image var\(--sp-page-background\)/)
})

test('terminal tabs and terminal fullscreen geometry remain dense and material-free', () => {
  const tabs = readClient('components/tabs/tabs.styl')
  const fullscreen = readClient('components/main/term-fullscreen.styl')

  assert.match(
    tabs,
    /\.tabs\.terminal-session-tabs\r?\n\s+background var\(--shellpilot-terminal-background\)[\s\S]{0,180}\.tab\r?\n\s+background var\(--shellpilot-terminal-background\)\r?\n\s+box-shadow none/
  )
  assert.doesNotMatch(
    tabs,
    /\.tabs\.terminal-session-tabs[\s\S]{0,360}var\(--sp-(?:card|panel|overlay)-background\)/
  )
  assert.doesNotMatch(fullscreen, /var\(--sp-(?:card|panel|overlay)-background\)|var\(--sp-shadow-(?:card|overlay|lg)\)/)
  assert.match(fullscreen, /\.term-wrap-1\r?\n\s+left 10px !important\r?\n\s+top 10px !important\r?\n\s+right 10px !important\r?\n\s+bottom 10px !important/)
})

test('latest client shell geometry and responsive breakpoints are preserved', () => {
  const layout = readClient('components/main/aigshell-layout.js')
  const sidebar = readClient('components/sidebar/sidebar.styl')
  const footer = readClient('components/footer/footer.styl')
  const rightPanel = readClient('components/side-panel-r/right-side-panel.styl')

  assert.match(layout, /aigshellTopBarHeight = 44/)
  assert.match(layout, /minRightPanelWidth = 320/)
  assert.match(sidebar, /\.sidebar\r?\n[\s\S]{0,180}top 44px[\s\S]{0,80}width 72px/)
  assert.match(sidebar, /\.sidebar-list\r?\n[\s\S]{0,120}left 72px\r?\n\s+top 44px/)
  assert.match(footer, /\.main-footer\r?\n[\s\S]{0,160}height 36px[\s\S]{0,120}left 72px/)
  assert.match(rightPanel, /\.right-side-panel\r?\n[\s\S]{0,120}right 0\r?\n\s+top 44px\r?\n\s+bottom 0/)
})

test('Glacier material recipes remain centralized in semantic tokens', () => {
  const componentSource = shellStyleFiles
    .map(readClient)
    .join('\n')

  for (const copiedStop of ['#F6FAFC', '#EAF1F6', '#DCE6EE', '#2A3543', '#202A37', '#18212C']) {
    assert.doesNotMatch(componentSource, new RegExp(copiedStop, 'i'), `${copiedStop} must stay in theme tokens`)
  }
  assert.doesNotMatch(componentSource, /(?:radial|linear)-gradient\(/i)
})
