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

const styleFiles = [
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
  'components/fleet-status/fleet-status.styl',
  'components/fleet-status/fleet-service-selector.styl',
  'components/artifacts/artifacts.styl',
  'components/setting-panel/setting-wrap.styl',
  'components/setting-panel/setting.styl',
  'components/setting-panel/list.styl',
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

test('terminal frame and SFTP panels use depth while rendered rows stay flat', () => {
  const terminal = readClient('components/terminal/terminal.styl')
  const sftp = readClient('components/sftp/sftp.styl')
  const transfer = readClient('components/sidebar/transfer.styl')
  assert.match(terminal, /\.terminal-workspace-layer[\s\S]*var\(--sp-shadow-lg\)/)
  assert.doesNotMatch(terminal, /\.(?:xterm|xterm-screen|xterm-viewport)[^{\n]*[\s\S]{0,180}box-shadow/)
  assert.match(sftp, /\.sftp-section[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(sftp, /\.sftp-item[\s\S]*box-shadow none/)
  assert.match(transfer, /\.transfer-list-card[\s\S]*var\(--sp-shadow-lg\)/)
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

test('Operations Toolkit uses Aurora depth while keeping tool and history rows flat', () => {
  const operations = readClient('components/operations-toolkit/workspace/operations-workspace.styl')
  assert.match(operations, /\.operations-toolkit-workspace[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(operations, /\.operations-workspace-head[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(operations, /\.operations-recommended-flow[\s\S]*var\(--sp-shadow-md\)/)
  assert.match(operations, /\.operations-tool-list[\s\S]*box-shadow none/)
  assert.match(operations, /\.operations-history article[\s\S]*box-shadow none/)
})
