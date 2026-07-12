const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function readClient (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client', relativePath), 'utf8')
}

test('ShellPilot top bar and AI panel use theme variables in day and night modes', () => {
  const topbar = readClient('components/main/aigshell-topbar.styl')
  const panel = readClient('components/side-panel-r/right-side-panel.styl')
  const ai = readClient('components/ai/ai.styl')

  assert.match(topbar, /background var\(--main-light\)/)
  assert.match(topbar, /color var\(--text\)/)
  assert.match(panel, /background var\(--main-light\)/)
  assert.match(panel, /color var\(--text\)/)
  assert.match(ai, /\.ai-chat-input[\s\S]*background var\(--main-light\)/)
  assert.match(ai, /\.ai-context-action[\s\S]*color var\(--text\)/)
})

test('top bar has a narrow-window fallback that keeps icon commands available', () => {
  const source = readClient('components/main/aigshell-topbar.styl')

  assert.match(source, /@media \(max-width: 1280px\)/)
  assert.match(source, /\.aigshell-topbar-action-label[\s\S]*display none/)
  assert.match(source, /@media \(max-width: 900px\)/)
})

test('right panel width and SFTP list height are bounded for small windows', () => {
  const layout = readClient('components/main/aigshell-layout.js')
  const panel = readClient('components/side-panel-r/side-panel-r.jsx')
  const sftp = readClient('components/sftp/list-table-ui.jsx')

  assert.match(layout, /minRightPanelWidth = 320/)
  assert.match(layout, /getMaxRightPanelWidth/)
  assert.match(layout, /Math\.max\(0, width - left - right\)/)
  assert.match(panel, /getMaxRightPanelWidth/)
  assert.match(sftp, /Math\.max\(0, height - 42 - 30 - 32 - 90\)/)
})

test('AI panel reports tested model state instead of claiming it is always online', () => {
  const source = readClient('components/side-panel-r/side-panel-r.jsx')
  const style = readClient('components/side-panel-r/right-side-panel.styl')

  assert.match(source, /aiConfigured/)
  assert.match(source, /getAIModelStatus/)
  assert.match(source, /right-panel-model-status/)
  assert.doesNotMatch(source, />在线</)
  assert.match(source, /right-side-panel-content-ai/)
  assert.match(source, /right-panel-ai-config-card/)
  assert.match(source, /right-panel-title-controls/)
  assert.match(style, /\.right-side-panel[\s\S]*display flex/)
  assert.match(style, /\.right-side-panel-content[\s\S]*position static/)
  assert.match(style, /\.right-panel-ai-config-card/)
})
