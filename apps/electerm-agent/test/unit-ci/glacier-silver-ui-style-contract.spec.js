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

function listStylusFiles (directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const absolute = path.join(directory, entry.name)
      return entry.isDirectory()
        ? listStylusFiles(absolute)
        : entry.name.endsWith('.styl') ? [absolute] : []
    })
}

const componentStyleFiles = listStylusFiles(path.join(clientRoot, 'components'))
  .map(filename => path.relative(clientRoot, filename).replaceAll('\\', '/'))
  .sort()

const structuralPrimitiveStyles = new Set([
  'components/common/highlight.styl',
  'components/common/logo.styl',
  'components/icons/ai-icon.styl'
])

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
  'components/incidents/incidents.styl',
  'components/terminal/terminal.styl',
  'components/terminal/terminal-command-safety-modal.styl',
  'components/terminal/term-search.styl',
  'components/sftp/sftp.styl',
  'components/sftp/address-bookmark.styl',
  'components/sftp/transfer-tag.styl',
  'components/sidebar/transfer.styl',
  'components/sidebar/transfer-history.styl',
  'components/file-transfer/transfer.styl',
  'components/operations-toolkit/workspace/operations-workspace.styl',
  'components/quick-commands/qm.styl',
  'components/ssh-tunnel/ssh-tunnel-modal.styl',
  'components/server-status/server-status-modal.styl',
  'components/main/safety-operation-center-modal.styl',
  'components/main/safety-task-progress.styl',
  'components/ai/ai.styl',
  'components/ai/agent-skill-manager.styl',
  'components/ai/agent-task-runner.styl',
  'components/ai/ai-file-change-review-modal.styl',
  'components/setting-panel/setting-wrap.styl',
  'components/setting-panel/setting.styl',
  'components/setting-panel/list.styl',
  'components/setting-panel/ui-font-picker.styl',
  'components/theme/theme-gallery.styl',
  'components/theme/theme-form.styl',
  'components/theme/terminal-theme-list.styl',
  'components/main/help-center-modal.styl',
  'components/main/update-center-modal.styl',
  'components/main/upgrade.styl',
  'components/main/crash-recovery-notice.styl',
  'components/sidebar/info.styl',
  'components/terminal-info/terminal-info.styl',
  'components/footer/cmd-history.styl',
  'components/widgets/widgets.styl',
  'components/auth/login.styl',
  'components/rdp/rdp.styl',
  'components/vnc/vnc.styl',
  'components/spice/spice.styl'
]

test('Glacier Silver shell Stylus files compile', async () => {
  for (const file of shellStyleFiles) {
    assert.ok((await compileStylus(file)).length > 0, file)
  }
})

test('every visible component style compiles and participates in the semantic surface system', async () => {
  for (const file of componentStyleFiles) {
    assert.ok((await compileStylus(file)).length > 0, `${file} must compile`)
    if (!structuralPrimitiveStyles.has(file)) {
      assert.match(readClient(file), /var\(--sp-/, `${file} must reference a ShellPilot semantic token`)
    }
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
  assert.match(rightPanel, /\.right-side-panel[\s\S]{0,360}var\(--sp-shadow-panel\)/)
  assert.match(rightPanel, /\.right-panel-ai-config-card[\s\S]{0,260}background-image var\(--sp-card-background\)/)
  assert.match(rightPanel, /\.right-panel-ai-model-select[\s\S]{0,620}background-image var\(--sp-control-background\) !important/)

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
  assert.match(tree, /\.tree-list-action-toolbar,[\s\S]{0,420}background-image var\(--sp-card-background\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
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
  assert.match(fleet, /\.fleet-status-toolbar[\s\S]{0,420}background-image var\(--sp-card-background\)[\s\S]{0,180}border-radius var\(--sp-radius-toolbar\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
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
  assert.match(artifacts, /\.artifact-list-panel[\s\S]{0,360}var\(--sp-shadow-panel\)/)
  assert.match(artifacts, /\.artifact-preview[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(artifacts, /\.artifact-preview[\s\S]{0,420}var\(--sp-shadow-panel\)/)
  assert.match(artifacts, /\.artifact-list-filters[\s\S]{0,360}background-image var\(--sp-card-background\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
  assert.match(artifacts, /\.artifact-list-item[\s\S]{0,360}background var\(--sp-flat-background\)/)
  assert.match(artifacts, /\.artifact-list-item[\s\S]{0,260}box-shadow none/)
  assert.match(artifacts, /\.artifact-card[\s\S]{0,420}background-image var\(--sp-card-background\)/)

  assert.match(incidents, /\.incident-workspace[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(incidents, /\.incident-workspace[\s\S]{0,520}var\(--sp-shadow-panel\)/)
  assert.match(incidents, /\.incident-list-toolbar[\s\S]{0,420}background-image var\(--sp-card-background\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
  assert.match(incidents, /\.incident-home-summary[\s\S]{0,320}background-image var\(--sp-card-background\)/)
  assert.match(incidents, /\.incident-list-panel[\s\S]{0,260}background-image var\(--sp-panel-background\)/)
  assert.match(incidents, /\.incident-detail-panel[\s\S]{0,260}background-image var\(--sp-panel-background\)/)
  assert.match(incidents, /\.incident-list-item[\s\S]{0,360}background var\(--sp-flat-background\)/)
  assert.match(incidents, /\.incident-list-item[\s\S]{0,260}box-shadow none/)
  assert.match(incidents, /\.incident-note[\s\S]{0,260}background var\(--sp-flat-background\)[\s\S]{0,120}box-shadow none/)
})

test('terminal SFTP and transfer shells use material while rendered data stays flat', () => {
  const terminal = readClient('components/terminal/terminal.styl')
  const termSearch = readClient('components/terminal/term-search.styl')
  const sftp = readClient('components/sftp/sftp.styl')
  const transferPopover = readClient('components/sidebar/transfer.styl')
  const transfer = readClient('components/file-transfer/transfer.styl')

  assert.match(terminal, /\.terminal-workspace-layer[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(terminal, /\.terminal-normal-buffer[\s\S]{0,360}background-image var\(--sp-overlay-background\)/)
  assert.match(terminal, /\.term-wrap\r?\n[\s\S]{0,100}background shellPilotTerminalBackground/)
  assert.match(termSearch, /\.term-search-wrap[\s\S]{0,320}background-image var\(--sp-overlay-background\)/)

  assert.match(sftp, /\.sftp-section[\s\S]{0,320}background-image var\(--sp-panel-background\)/)
  assert.match(sftp, /\.sftp-safety-summary[\s\S]{0,360}background-image var\(--sp-card-background\)/)
  assert.match(sftp, /\.sftp-item[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(sftp, /\.sftp-safety-record[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)

  assert.match(transferPopover, /\.ant-popover-inner[\s\S]{0,420}background-image var\(--sp-overlay-background\)/)
  assert.match(transfer, /\.transports-dd[\s\S]{0,320}background-image var\(--sp-panel-background\)/)
  assert.match(transfer, /\.sftp-transport[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
})

test('operations and quick-command shells use material while history and output stay flat', () => {
  const operations = readClient('components/operations-toolkit/workspace/operations-workspace.styl')
  const quickCommands = readClient('components/quick-commands/qm.styl')

  assert.match(operations, /\.operations-toolkit-workspace[\s\S]{0,420}background-image var\(--sp-panel-background\)/)
  assert.match(operations, /\.operations-workspace-head[\s\S]{0,360}background-image var\(--sp-control-background\)/)
  assert.match(operations, /\.operations-recommended-flow[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(operations, /\.operations-tool-detail[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(operations, /\.operations-history article[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.doesNotMatch(operations, /\.operations-virtual-log[\s\S]{0,420}var\(--sp-(?:card|panel|overlay)-background\)/)

  assert.match(quickCommands, /\.qm-wrap-tooltip[\s\S]{0,420}background-image var\(--sp-overlay-background\)/)
  assert.match(quickCommands, /\.qm-command-modal[\s\S]{0,560}background-image var\(--sp-overlay-background\)/)
  assert.match(quickCommands, /\.qm-command-param-section[\s\S]{0,360}background-image var\(--sp-card-background\)/)
  assert.match(quickCommands, /\.qm-item[\s\S]{0,520}background-image var\(--sp-card-background\)[\s\S]{0,240}var\(--sp-shadow-card\)/)
})

test('tunnel server and safety shells lift summaries while diagnostics and task rows stay flat', () => {
  const tunnel = readClient('components/ssh-tunnel/ssh-tunnel-modal.styl')
  const server = readClient('components/server-status/server-status-modal.styl')
  const safety = readClient('components/main/safety-operation-center-modal.styl')
  const progress = readClient('components/main/safety-task-progress.styl')

  assert.match(tunnel, /\.ssh-tunnel-modal[\s\S]{0,360}\.ant-modal-content[\s\S]{0,320}background-image var\(--sp-overlay-background\)/)
  assert.match(tunnel, /\.ssh-tunnel-editor,[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(tunnel, /\.ssh-tunnel-history-item[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)

  assert.match(server, /\.server-status-modal[\s\S]{0,360}\.ant-modal-content[\s\S]{0,320}background-image var\(--sp-overlay-background\)/)
  assert.match(server, /\.server-status-summary[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(server, /\.server-status-section[\s\S]{0,420}background-image var\(--sp-panel-background\)/)
  assert.match(server, /\.server-status-row[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(server, /\.server-status-pre[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)

  assert.match(safety, /\.safety-operation-center-modal[\s\S]{0,360}\.ant-modal-content[\s\S]{0,320}background-image var\(--sp-overlay-background\)/)
  assert.match(safety, /\.safety-center-summary[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(safety, /\.safety-center-record[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(safety, /\.safety-center-audit-output[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(progress, /\.safety-task-progress[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(progress, /\.safety-task-progress-step[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(progress, /\.safety-task-progress-output[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
})

test('AI chat and configuration use material shells with flat generated output', () => {
  const ai = readClient('components/ai/ai.styl')
  const chat = readClient('components/ai/ai-chat.jsx')

  assert.match(ai, /\.ai-chat-container[\s\S]{0,320}background-image var\(--sp-panel-background\)/)
  assert.match(ai, /\.ai-chat-unconfigured[\s\S]{0,360}background-image var\(--sp-card-background\)/)
  assert.match(ai, /\.chat-history-item[\s\S]{0,520}\.ant-alert[\s\S]{0,320}background-image var\(--sp-card-background\)/)
  assert.match(ai, /\.ai-generated-artifact[\s\S]{0,360}background-image var\(--sp-card-background\)/)
  assert.match(ai, /\.ai-composer-surface[\s\S]{0,420}background-image var\(--sp-control-background\)/)
  assert.match(ai, /\.ai-mode-segmented[\s\S]{0,420}color var\(--sp-text\)/)
  assert.match(chat, /<Segmented\s+className='ai-mode-segmented'/)
  assert.match(ai, /\.ai-attachment-chip[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(ai, /\.agent-tool-call-card,[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(ai, /\.agent-tool-pre[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(ai, /\.agent-readonly-command[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(ai, /\.agent-readonly-output[\s\S]{0,300}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(ai, /\.sp-ai-config-form[\s\S]{0,420}background-image var\(--sp-panel-background\)/)
  assert.match(ai, /\.sp-ai-provider-guide[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(ai, /\.sp-ai-provider-item[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(ai, /\.send-to-ai-icon\.disabled[\s\S]{0,100}cursor not-allowed/)
  assert.match(ai, /\.agent-send-disabled[\s\S]{0,100}cursor not-allowed/)
})

test('AI task skill and file-review overlays keep logs editors and diffs flat', () => {
  const skills = readClient('components/ai/agent-skill-manager.styl')
  const tasks = readClient('components/ai/agent-task-runner.styl')
  const review = readClient('components/ai/ai-file-change-review-modal.styl')

  assert.match(skills, /\.agent-skill-manager-actions[\s\S]{0,360}background-image var\(--sp-control-background\)/)
  assert.match(skills, /\.agent-skill-manager-list[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(skills, /\.agent-skill-editor-files,[\s\S]{0,420}background-image var\(--sp-panel-background\)/)
  assert.match(skills, /\.ant-list-item[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(skills, /\.agent-skill-draft-summary[\s\S]{0,420}background-image var\(--sp-card-background\)/)

  assert.match(tasks, /\.agent-task-runner-modal[\s\S]{0,360}\.ant-modal-content[\s\S]{0,320}background-image var\(--sp-overlay-background\)/)
  assert.match(tasks, /\.agent-task-summary[\s\S]{0,360}background-image var\(--sp-card-background\)/)
  assert.match(tasks, /\.agent-task-step[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(tasks, /\.agent-task-step > pre[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(tasks, /\.agent-task-output pre[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)

  assert.match(review, /\.ai-file-change-review-body[\s\S]{0,420}background-image var\(--sp-panel-background\)/)
  assert.match(review, /\.ai-file-change-review-list[\s\S]{0,360}background-image var\(--sp-control-background\)/)
  assert.match(review, /button[\s\S]{0,420}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(review, /\.ai-file-change-review-diff[\s\S]{0,420}background var\(--sp-flat-background\)[\s\S]{0,520}pre[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
})

test('settings and theme editing use grouped silver material instead of per-field cards', () => {
  const wrap = readClient('components/setting-panel/setting-wrap.styl')
  const setting = readClient('components/setting-panel/setting.styl')
  const font = readClient('components/setting-panel/ui-font-picker.styl')
  const theme = readClient('components/theme/theme-gallery.styl')

  assert.match(wrap, /\.setting-wrap[\s\S]{0,320}background-image var\(--sp-page-background\)/)
  assert.match(wrap, /\.setting-header[\s\S]{0,420}background-image var\(--sp-panel-background\)/)
  assert.match(wrap, /\.setting-search-results[\s\S]{0,420}background-image var\(--sp-overlay-background\)/)
  assert.match(wrap, /\.setting-row-left[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(setting, /\.sp-setting-section[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(setting, /\.setting-passwords[\s\S]{0,420}background-image var\(--sp-panel-background\)/)
  assert.match(setting, /\.sp-sync-config-form[\s\S]{0,420}background-image var\(--sp-panel-background\)/)
  assert.doesNotMatch(setting, /\.sp-setting-field[\s\S]{0,220}(?:background-image var\(--sp-card-background\)|box-shadow var\(--sp-shadow-card\))/)

  assert.match(font, /\.sp-ui-font-option[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(font, /\.sp-ui-font-preview[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(font, /code[\s\S]{0,260}background var\(--sp-flat-background\)[\s\S]{0,160}box-shadow none/)
  assert.match(theme, /\.sp-theme-card[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(theme, /\.sp-theme-preview-scope[\s\S]{0,420}background-image var\(--sp-panel-background\)/)
  assert.match(theme, /\.sp-theme-preview-card[\s\S]{0,420}background-image var\(--sp-card-background\)/)
})

test('support widget and authentication shells share Glacier material while rows stay flat', () => {
  const help = readClient('components/main/help-center-modal.styl')
  const update = readClient('components/main/update-center-modal.styl')
  const upgrade = readClient('components/main/upgrade.styl')
  const recovery = readClient('components/main/crash-recovery-notice.styl')
  const info = readClient('components/sidebar/info.styl')
  const terminalInfo = readClient('components/terminal-info/terminal-info.styl')
  const history = readClient('components/footer/cmd-history.styl')
  const widgets = readClient('components/widgets/widgets.styl')
  const login = readClient('components/auth/login.styl')

  assert.match(help, /\.shellpilot-help-center[\s\S]{0,360}\.custom-modal-content[\s\S]{0,300}background-image var\(--sp-overlay-background\)/)
  assert.match(help, /\.shellpilot-help-heading[\s\S]{0,360}background-image var\(--sp-card-background\)/)
  assert.match(update, /\.update-center-modal[\s\S]{0,360}\.custom-modal-content[\s\S]{0,300}background-image var\(--sp-overlay-background\)/)
  assert.match(update, /\.update-center-summary[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(update, /\.update-center-changelog[\s\S]{0,320}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(upgrade, /\.upgrade-panel[\s\S]{0,420}background-image var\(--sp-overlay-background\)/)
  assert.match(upgrade, /\.markdown-wrap[\s\S]{0,300}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(recovery, /\.crash-recovery-notice[\s\S]{0,520}background-image var\(--sp-overlay-background\)/)
  assert.match(info, /\.info-modal \.custom-modal-content[\s\S]{0,360}background-image var\(--sp-overlay-background\)/)
  assert.match(info, /\.info-modal pre[\s\S]{0,360}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(terminalInfo, /\.info-panel-wrap[\s\S]{0,420}background-image var\(--sp-panel-background\)/)
  assert.match(terminalInfo, /tbody tr[\s\S]{0,220}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(history, /\.cmd-history-popover-content[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(history, /\.cmd-history-item[\s\S]{0,320}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(widgets, /\.widgets-shell[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(widgets, /\.widget-card[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(widgets, /\.widget-form-hero[\s\S]{0,420}background-image var\(--sp-card-background\)/)
  assert.match(widgets, /\.widget-instances-list[\s\S]{0,420}\.item-list-unit[\s\S]{0,260}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none/)
  assert.match(login, /\.login-wrap[\s\S]{0,360}background-image var\(--sp-page-background\)/)
  assert.match(login, /> \.pd3\.aligncenter[\s\S]{0,420}background-image var\(--sp-card-background\)/)
})

test('remote client chrome uses semantic surfaces without decorating pixel canvases', () => {
  const rdp = readClient('components/rdp/rdp.styl')
  const vnc = readClient('components/vnc/vnc.styl')
  const spice = readClient('components/spice/spice.styl')

  assert.match(rdp, /\.rdp-session-wrap[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(vnc, /\.vnc-session-wrap[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  assert.match(spice, /\.spice-session-wrap[\s\S]{0,360}background-image var\(--sp-panel-background\)/)
  for (const [name, source] of [['rdp', rdp], ['vnc', vnc], ['spice', spice]]) {
    assert.match(source, /canvas[\s\S]{0,260}background var\(--sp-flat-background\)[\s\S]{0,180}box-shadow none[\s\S]{0,120}filter none/, name)
  }
})

test('Glacier material recipes remain centralized in semantic tokens', () => {
  const componentSource = componentStyleFiles
    .map(readClient)
    .join('\n')

  for (const copiedStop of ['#F6FAFC', '#EAF1F6', '#DCE6EE', '#2A3543', '#202A37', '#18212C']) {
    assert.doesNotMatch(componentSource, new RegExp(copiedStop, 'i'), `${copiedStop} must stay in theme tokens`)
  }
  assert.doesNotMatch(componentSource, /radial-gradient\(110% 90% at 15% 0%/i)
})
