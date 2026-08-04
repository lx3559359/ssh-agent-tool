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
  'components/main/term-fullscreen.styl',
  'components/common/modal.styl',
  'components/common/drawer.styl',
  'components/common/context-menu.styl',
  'components/common/message.styl',
  'components/common/notification.styl',
  'components/common/input-confirm-common.styl',
  'components/common/drag-handle.styl',
  'components/common/remote-float-control.styl',
  'components/common/lazy-module-boundary.styl',
  'components/common/markdown.styl',
  'components/sys-menu/sys-menu.styl',
  'components/tabs/no-session.styl',
  'components/tabs/quick-connect.styl',
  'components/bookmark-form/bookmark-form.styl',
  'components/bookmark-form/common/bookmark-group-picker.styl',
  'components/bookmark-form/common/color-picker.styl',
  'components/tree-list/tree-list.styl',
  'components/tree-list/bookmark-import-strategy-dialog.styl',
  'components/session/session.styl',
  'components/ssh-config/ssh-config.styl',
  'components/fleet-status/fleet-status.styl',
  'components/fleet-status/fleet-service-selector.styl',
  'components/artifacts/artifacts.styl',
  'components/incidents/incidents.styl'
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

test('shared modal drawer and menu shells use overlay material with flat rows', () => {
  const modal = readClient('components/common/modal.styl')
  const drawer = readClient('components/common/drawer.styl')
  const contextMenu = readClient('components/common/context-menu.styl')
  const systemMenu = readClient('components/sys-menu/sys-menu.styl')

  assert.match(modal, /\.custom-modal-content[\s\S]{0,300}background-image var\(--sp-overlay-background\)[\s\S]{0,220}var\(--sp-shadow-overlay\)/)
  assert.match(drawer, /\.custom-drawer-content-wrapper[\s\S]{0,300}background-image var\(--sp-overlay-background\)[\s\S]{0,220}var\(--sp-shadow-overlay\)/)
  assert.match(contextMenu, /\.ant-dropdown-menu[\s\S]{0,520}background-image var\(--sp-overlay-background\)[\s\S]{0,260}var\(--sp-shadow-overlay\)/)
  assert.match(contextMenu, /\.ant-dropdown-menu-item,[\s\S]{0,260}box-shadow none/)
  assert.match(systemMenu, /\.context-menu[\s\S]{0,360}background-image var\(--sp-overlay-background\)[\s\S]{0,220}var\(--sp-shadow-overlay\)/)
  assert.match(systemMenu, /\.context-item[\s\S]{0,300}box-shadow none/)
  assert.match(systemMenu, /\.sub-context-menu-item[\s\S]{0,220}box-shadow none/)
})

test('messages notifications and lazy failures use card material', () => {
  const message = readClient('components/common/message.styl')
  const notification = readClient('components/common/notification.styl')
  const lazy = readClient('components/common/lazy-module-boundary.styl')

  assert.match(message, /\.message-item[\s\S]{0,300}background-image var\(--sp-card-background\)[\s\S]{0,180}border-radius var\(--sp-radius-card\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
  assert.match(notification, /\.notification[\s\S]{0,300}background-image var\(--sp-card-background\)[\s\S]{0,220}var\(--sp-shadow-card\)/)
  assert.match(lazy, /\.lazy-module-error[\s\S]{0,420}background-image var\(--sp-card-background\)[\s\S]{0,220}var\(--sp-shadow-card\)/)
})

test('shared compact controls expose semantic focus and reduced motion states', () => {
  const modal = readClient('components/common/modal.styl')
  const confirm = readClient('components/common/input-confirm-common.styl')
  const drag = readClient('components/common/drag-handle.styl')
  const remote = readClient('components/common/remote-float-control.styl')
  const message = readClient('components/common/message.styl')

  assert.match(modal, /\.custom-modal-close[\s\S]{0,620}&:focus-visible[\s\S]{0,180}box-shadow var\(--sp-shadow-focus\)/)
  assert.match(modal, /\.custom-modal-ok-btn,[\s\S]{0,460}&:focus-visible[\s\S]{0,180}var\(--sp-shadow-focus\)/)
  assert.match(confirm, /\.input-confirm[\s\S]{0,360}var\(--sp-control-background\)[\s\S]{0,260}var\(--sp-shadow-focus\)/)
  assert.match(remote, /\.remote-float-btn[\s\S]{0,360}var\(--sp-control-background\)[\s\S]{0,360}&:focus-visible[\s\S]{0,180}var\(--sp-shadow-focus\)/)
  assert.match(drag, /&\.dragging\r?\n\s+background var\(--sp-primary\)/)
  assert.match(message, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,160}animation none/)
  assert.match(remote, /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,160}transition none/)
})

test('markdown code and tables stay flat inside cardized panels', () => {
  const markdown = readClient('components/common/markdown.styl')

  assert.match(markdown, /code[\s\S]{0,220}background var\(--sp-flat-background\)[\s\S]{0,120}box-shadow none/)
  assert.match(markdown, /pre[\s\S]{0,300}background var\(--sp-flat-background\)[\s\S]{0,120}box-shadow none/)
  assert.match(markdown, /table[\s\S]{0,300}background var\(--sp-flat-background\)[\s\S]{0,120}box-shadow none/)
  assert.doesNotMatch(markdown, /var\(--sp-(?:card|panel|overlay)-background\)/)
})

test('home actions and recent connections follow card outer and flat row hierarchy', () => {
  const home = readClient('components/tabs/no-session.styl')

  assert.match(home, /\.no-sessions[\s\S]{0,180}background-image var\(--sp-page-background\)/)
  assert.match(home, /\.no-session-action\.ant-btn[\s\S]{0,420}background-image var\(--sp-card-background\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
  assert.match(home, /\.no-session-action-primary\.ant-btn[\s\S]{0,220}linear-gradient\(135deg, var\(--sp-primary\), var\(--sp-primary-2\)\)/)
  assert.match(home, /\.no-session-recents[\s\S]{0,300}background-image var\(--sp-panel-background\)[\s\S]{0,180}var\(--sp-shadow-lg\)/)
  assert.match(home, /\.no-session-history[\s\S]{0,900}\.item-list-unit[\s\S]{0,300}background var\(--sp-flat-background\)[\s\S]{0,120}box-shadow none/)
})

test('connection forms use grouped material while tree session and ssh config rows stay flat', () => {
  const quickConnect = readClient('components/tabs/quick-connect.styl')
  const bookmark = readClient('components/bookmark-form/bookmark-form.styl')
  const tree = readClient('components/tree-list/tree-list.styl')
  const session = readClient('components/session/session.styl')
  const sshConfig = readClient('components/ssh-config/ssh-config.styl')

  assert.match(quickConnect, /\.quick-connect-wizard-summary[\s\S]{0,320}background-image var\(--sp-card-background\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
  assert.match(bookmark, /\.sp-configuration-section[\s\S]{0,300}background-image var\(--sp-card-background\)/)
  assert.match(tree, /\.tree-sort-dropdown[\s\S]{0,300}background-image var\(--sp-overlay-background\)/)
  assert.match(tree, /\.tree-item[\s\S]{0,260}box-shadow none/)
  assert.match(tree, /\.connection-inventory-row[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,120}box-shadow none/)
  assert.match(session, /\.sessions[\s\S]{0,160}background var\(--sp-flat-background\)/)
  assert.doesNotMatch(session, /\.session-wrap[\s\S]{0,220}var\(--sp-shadow-(?:card|panel|overlay|lg)\)/)
  assert.match(sshConfig, /\.ssh-config-list[\s\S]{0,260}\.item-list-unit[\s\S]{0,180}box-shadow none/)
})

test('fleet cards and panels contain flat table rows', () => {
  const fleet = readClient('components/fleet-status/fleet-status.styl')
  const selector = readClient('components/fleet-status/fleet-service-selector.styl')

  assert.match(fleet, /\.fleet-status-workspace[\s\S]{0,320}background-image var\(--sp-page-background\)/)
  assert.match(fleet, /\.fleet-status-bookmark-count[\s\S]{0,340}background-image var\(--sp-card-background\)/)
  assert.match(fleet, /\.fleet-status-toolbar[\s\S]{0,360}background-image var\(--sp-card-background\)/)
  assert.match(fleet, /\.fleet-status-table-scroll[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(fleet, /\.fleet-status-table[\s\S]{0,320}tbody tr[\s\S]{0,80}box-shadow none/)
  assert.doesNotMatch(fleet, /tbody tr[\s\S]{0,220}var\(--sp-(?:card|panel|overlay)-background\)/)

  assert.match(selector, /\.ant-drawer-content[\s\S]{0,320}background-image var\(--sp-panel-background\)/)
  assert.match(selector, /\.fleet-service-selector-targets[\s\S]{0,900}li[\s\S]{0,360}background-image var\(--sp-card-background\)/)
  assert.match(selector, /\.fleet-service-selector-table[\s\S]{0,320}tbody tr[\s\S]{0,80}box-shadow none/)
})

test('artifact and incident panes use panels while activity rows remain flat', () => {
  const artifacts = readClient('components/artifacts/artifacts.styl')
  const incidents = readClient('components/incidents/incidents.styl')

  assert.match(artifacts, /\.artifact-workspace[\s\S]{0,300}background-image var\(--sp-page-background\)/)
  assert.match(artifacts, /\.artifact-list-panel[\s\S]{0,300}background-image var\(--sp-panel-background\)/)
  assert.match(artifacts, /\.artifact-preview[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(artifacts, /\.artifact-list-item[\s\S]{0,360}background var\(--sp-flat-background\)/)
  assert.match(artifacts, /\.artifact-list-item[\s\S]{0,260}box-shadow none/)
  assert.match(artifacts, /\.artifact-card[\s\S]{0,420}background-image var\(--sp-card-background\)/)

  assert.match(incidents, /\.incident-workspace[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(incidents, /\.incident-home-summary[\s\S]{0,320}background-image var\(--sp-card-background\)/)
  assert.match(incidents, /\.incident-list-panel[\s\S]{0,260}background-image var\(--sp-panel-background\)/)
  assert.match(incidents, /\.incident-detail-panel[\s\S]{0,260}background-image var\(--sp-panel-background\)/)
  assert.match(incidents, /\.incident-list-item[\s\S]{0,360}background var\(--sp-flat-background\)/)
  assert.match(incidents, /\.incident-list-item[\s\S]{0,260}box-shadow none/)
  assert.match(incidents, /\.incident-note[\s\S]{0,260}background var\(--sp-flat-background\)[\s\S]{0,120}box-shadow none/)
})

test('Glacier material recipes remain centralized in semantic tokens', () => {
  const componentSource = shellStyleFiles
    .map(readClient)
    .join('\n')

  for (const copiedStop of ['#F6FAFC', '#EAF1F6', '#DCE6EE', '#2A3543', '#202A37', '#18212C']) {
    assert.doesNotMatch(componentSource, new RegExp(copiedStop, 'i'), `${copiedStop} must stay in theme tokens`)
  }
  assert.doesNotMatch(componentSource, /radial-gradient\(110% 90% at 15% 0%/i)
})
