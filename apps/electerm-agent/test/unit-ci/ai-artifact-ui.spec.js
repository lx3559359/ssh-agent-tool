const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function readClient (file) {
  return fs.readFileSync(path.join(root, 'src/client', file), 'utf8')
}

test('main window lazy-loads the artifact workspace behind a recovery boundary', () => {
  const main = readClient('components/main/main.jsx')
  assert.match(
    main,
    /lazy\(\(\)\s*=>\s*import\('\.\.\/artifacts\/entry'\)\)/
  )
  assert.match(main, /mainWorkspaceMode\s*===\s*'artifacts'/)
  assert.match(main, /<LazyModuleBoundary[^>]+shellpilotArtifactWorkspaceModule/)
  assert.match(main, /<ArtifactWorkspace/)
})

test('sidebar exposes one Chinese artifact workspace entry', () => {
  const sidebar = readClient('components/sidebar/index.jsx')
  assert.equal(
    (sidebar.match(/shellpilotSidebarArtifacts/g) || []).length,
    2
  )
  assert.match(sidebar, /FileDoneOutlined/)
  assert.match(sidebar, /store\.openArtifactWorkspace\(\)/)
})

test('artifact workspace provides filters, source preview and responsive layout', () => {
  const workspace = readClient('components/artifacts/artifact-workspace.jsx')
  const list = readClient('components/artifacts/artifact-list.jsx')
  const preview = readClient('components/artifacts/artifact-preview.jsx')
  const styles = readClient('components/artifacts/artifacts.styl')

  assert.match(workspace, /artifact-workspace/)
  assert.match(list, /title|标题/)
  assert.match(list, /server|服务器/)
  assert.match(list, /format|格式/)
  assert.match(preview, /Markdown/)
  assert.match(preview, /shellpilotArtifactFormatCsv/)
  assert.match(preview, /shellpilotArtifactSaveLocal/)
  assert.match(preview, /shellpilotArtifactOpenExternal/)
  assert.match(styles, /minmax\(220px,\s*300px\)/)
  assert.match(styles, /@media\s*\(max-width:\s*1099px\)/)
  assert.match(styles, /\.artifact-list-panel[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(styles, /\.artifact-preview[\s\S]*var\(--sp-shadow-lg\)/)
  assert.match(styles, /\.artifact-list-item\.active[\s\S]*var\(--sp-shadow-focus\)/)
})
