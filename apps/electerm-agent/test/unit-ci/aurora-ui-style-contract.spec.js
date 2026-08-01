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

function assertSelectorUsesRadius (source, selector, token) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  assert.match(
    source,
    new RegExp(`${escaped}[\\s\\S]{0,320}border-radius\\s+var\\(--sp-radius-${token}\\)`),
    `${selector} should use --sp-radius-${token}`
  )
}

const styleFiles = [
  'components/main/aigshell-topbar.styl',
  'components/common/modal.styl',
  'components/sys-menu/sys-menu.styl',
  'components/common/context-menu.styl',
  'components/tabs/no-session.styl',
  'components/sidebar/sidebar.styl',
  'components/tree-list/tree-list.styl',
  'components/side-panel-r/right-side-panel.styl',
  'components/ai/ai.styl',
  'components/terminal/terminal.styl',
  'components/tabs/tabs.styl',
  'components/footer/footer.styl',
  'components/sftp/sftp.styl',
  'components/sidebar/transfer.styl',
  'components/quick-commands/qm.styl',
  'components/fleet-status/fleet-status.styl',
  'components/fleet-status/fleet-service-selector.styl',
  'components/artifacts/artifacts.styl',
  'components/setting-panel/setting-wrap.styl',
  'components/setting-panel/setting.styl',
  'components/setting-panel/list.styl',
  'components/setting-panel/ui-font-picker.styl',
  'components/theme/theme-gallery.styl',
  'components/sidebar/info.styl',
  'components/operations-toolkit/workspace/operations-workspace.styl'
]

test('all Aurora-owned Stylus files compile', async () => {
  for (const file of styleFiles) {
    assert.ok((await compileStylus(file)).length > 0, file)
  }
})

test('connection server history and AI surfaces use semantic Aurora depth', () => {
  const home = readClient('components/tabs/no-session.styl')
  const sidebar = readClient('components/sidebar/sidebar.styl')
  const tree = readClient('components/tree-list/tree-list.styl')
  const ai = readClient('components/ai/ai.styl')
  assert.match(home, /\.no-session-action[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(home, /\.no-session-recents[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(sidebar, /\.sidebar-panel[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(tree, /\.tree-item[\s\S]*var\(--sp-primary-soft\)/)
  assert.doesNotMatch(tree, /background\s+#000\b/)
  assert.match(ai, /\.chat-history-item[\s\S]*var\(--sp-shadow-sm\)/)
  assert.match(ai, /\.ai-chat-input[\s\S]*var\(--sp-shadow-md\)/)
})

test('Aurora Lift shared chrome uses the approved radius hierarchy', () => {
  const shared = readClient('css/includes/secondary-ui.styl')
  const topbar = readClient('components/main/aigshell-topbar.styl')
  const modal = readClient('components/common/modal.styl')
  const home = readClient('components/tabs/no-session.styl')
  const panel = readClient('components/side-panel-r/right-side-panel.styl')
  const ai = readClient('components/ai/ai.styl')

  assertSelectorUsesRadius(shared, '.sp-level-1', 'small')
  assertSelectorUsesRadius(shared, '.sp-card', 'card')
  assertSelectorUsesRadius(shared, '.sp-level-3', 'overlay')
  assertSelectorUsesRadius(topbar, '.aigshell-topbar-action', 'control')
  assertSelectorUsesRadius(modal, '.custom-modal-content', 'overlay')
  assertSelectorUsesRadius(modal, '.custom-modal-ok-btn', 'control')
  assertSelectorUsesRadius(home, '.no-session-action', 'card')
  assertSelectorUsesRadius(home, '.no-session-recents', 'panel')
  assertSelectorUsesRadius(panel, '.right-side-panel', 'panel')
  assertSelectorUsesRadius(ai, '.ai-chat-input', 'control')
  assertSelectorUsesRadius(ai, '.agent-tool-readonly-card', 'card')
})

test('terminal frame and SFTP panels use depth while rendered rows stay flat', () => {
  const terminal = readClient('components/terminal/terminal.styl')
  const sftp = readClient('components/sftp/sftp.styl')
  const transfer = readClient('components/sidebar/transfer.styl')
  const commands = readClient('components/quick-commands/qm.styl')
  assertSelectorUsesRadius(terminal, '.terminal-workspace-layer', 'panel')
  assert.match(terminal, /\.terminal-workspace-layer[\s\S]*var\(--sp-shadow-lg\)/)
  assert.doesNotMatch(terminal, /\.(?:xterm|xterm-screen|xterm-viewport)[^{\n]*[\s\S]{0,180}box-shadow/)
  assertSelectorUsesRadius(sftp, '.sftp-section', 'panel')
  assertSelectorUsesRadius(sftp, '.sftp-safety-summary', 'card')
  assert.match(sftp, /\.sftp-section[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(sftp, /\.sftp-item[\s\S]*box-shadow none/)
  assertSelectorUsesRadius(transfer, '.transfer-list-card', 'overlay')
  assert.match(transfer, /\.transfer-list-card[\s\S]*var\(--sp-shadow-lg\)/)
  assertSelectorUsesRadius(commands, '.qm-wrap-tooltip', 'overlay')
  assertSelectorUsesRadius(commands, '.qm-command-param-section', 'card')
  assert.match(commands, /\.qm-wrap-tooltip[\s\S]{0,420}var\(--sp-shadow-lg\)/)
})

test('Fleet and artifact workspaces reserve strong depth for page containers', () => {
  const fleet = readClient('components/fleet-status/fleet-status.styl')
  const drawer = readClient('components/fleet-status/fleet-service-selector.styl')
  const artifacts = readClient('components/artifacts/artifacts.styl')
  assert.match(fleet, /\.fleet-status-toolbar[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(fleet, /\.fleet-status-table-scroll[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(drawer, /\.ant-drawer-content[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(artifacts, /\.artifact-list-panel[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(artifacts, /\.artifact-preview[\s\S]*var\(--sp-shadow-lg\)/)
  assert.doesNotMatch(fleet, /\.fleet-status-table tbody tr\r?\n(?: {2}[^\r\n]*\r?\n)* {2}box-shadow var\(--sp-shadow-lg\)/)
  assert.doesNotMatch(artifacts, /\.artifact-list-item\r?\n(?: {2}[^\r\n]*\r?\n)* {2}box-shadow var\(--sp-shadow-lg\)/)
})

test('settings passwords and logs use grouped surfaces instead of per-field cards', () => {
  const wrap = readClient('components/setting-panel/setting-wrap.styl')
  const setting = readClient('components/setting-panel/setting.styl')
  const info = readClient('components/sidebar/info.styl')
  assert.match(wrap, /\.setting-header[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(setting, /\.sp-setting-section[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(setting, /\.setting-passwords[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(info, /\.info-modal[\s\S]*var\(--sp-shadow-lg\)/)
  assert.doesNotMatch(setting, /\.sp-setting-field[\s\S]{0,180}box-shadow/)
})

test('data and settings workspaces use large selectable cards and rounded controls', () => {
  const fleet = readClient('components/fleet-status/fleet-status.styl')
  const drawer = readClient('components/fleet-status/fleet-service-selector.styl')
  const artifacts = readClient('components/artifacts/artifacts.styl')
  const setting = readClient('components/setting-panel/setting.styl')
  const font = readClient('components/setting-panel/ui-font-picker.styl')
  const theme = readClient('components/theme/theme-gallery.styl')

  assertSelectorUsesRadius(fleet, '.fleet-status-bookmark-count', 'card')
  assert.match(drawer, /\.fleet-service-selector-targets[\s\S]{0,900}li[\s\S]{0,320}border-radius var\(--sp-radius-card\)/)
  assertSelectorUsesRadius(artifacts, '.artifact-document-page', 'card')
  assertSelectorUsesRadius(artifacts, '.artifact-card', 'card')
  assertSelectorUsesRadius(font, '.sp-ui-font-option', 'card')
  assertSelectorUsesRadius(font, '.sp-ui-font-preview', 'card')
  assert.match(font, /\.sp-ui-font-preview[\s\S]{0,420}var\(--sp-shadow-md\)/)
  assertSelectorUsesRadius(theme, '.sp-theme-card', 'card')
  assert.match(theme, /\.sp-theme-card[\s\S]{0,420}var\(--sp-shadow-md\)/)
  assertSelectorUsesRadius(theme, '.sp-theme-preview-scope', 'panel')
  assert.match(setting, /border-radius var\(--sp-radius-control\)/)
  assert.match(setting, /var\(--sp-shadow-sm\)/)
})

test('Operations Toolkit uses Aurora depth while keeping tool and history rows flat', () => {
  const operations = readClient('components/operations-toolkit/workspace/operations-workspace.styl')
  assert.match(operations, /\.operations-toolkit-workspace[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(operations, /\.operations-workspace-head[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(operations, /\.operations-recommended-flow[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(operations, /\.operations-tool-list[\s\S]*box-shadow none/)
  assert.match(operations, /\.operations-history article[\s\S]*box-shadow none/)
})
