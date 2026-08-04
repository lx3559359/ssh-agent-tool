const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('keeps the operations primary action readable in every theme', () => {
  const styles = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/operations-toolkit/workspace/operations-workspace.styl'
  ), 'utf8')
  const actionStyles = styles.match(
    /\.operations-run-actions\r?\n[\s\S]+?(?=\r?\n\.operations-no-task)/
  )?.[0] || ''

  assert.match(
    actionStyles,
    /> span\r?\n\s+color\s+var\(--text-dark\)/
  )
  assert.match(
    actionStyles,
    /\.ant-btn-primary[\s\S]*?color\s+#fff/
  )
})

test('uses panel depth and action cards while keeping operations history flat', () => {
  const styles = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/operations-toolkit/workspace/operations-workspace.styl'
  ), 'utf8')
  assert.match(styles, /\.operations-toolkit-workspace[\s\S]*border-radius\s+var\(--sp-radius-panel\)/)
  assert.match(styles, /\.operations-toolkit-workspace[\s\S]{0,520}box-shadow\s+(?:inset[^\r\n]+,\s*)?var\(--sp-shadow-panel\)/)
  assert.match(styles, /\.operations-tool-list[\s\S]{0,820}> button[\s\S]{0,420}background-image var\(--sp-card-background\)[\s\S]{0,180}border-radius var\(--sp-radius-card\)[\s\S]{0,180}var\(--sp-shadow-card\)/)
  assert.doesNotMatch(styles, /\.operations-tool-list[\s\S]{0,260}> button[\s\S]{0,260}box-shadow none/)
  assert.match(styles, /\.operations-tool-detail[\s\S]{0,420}var\(--sp-shadow-panel\)/)
  assert.match(styles, /\.operations-history article[\s\S]{0,260}background var\(--sp-flat-background\)[\s\S]{0,120}box-shadow none/)
})

test('operations catalogs reflow and short windows scroll inside the workspace', () => {
  const styles = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/operations-toolkit/workspace/operations-workspace.styl'
  ), 'utf8')

  assert.match(styles, /\.operations-tool-list[\s\S]*grid-template-columns\s+repeat\(auto-fit,\s*minmax\(/)
  assert.match(styles, /\.operations-toolkit-workspace \.qm-list-wrap[\s\S]*repeat\(auto-fit,\s*minmax\(/)
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.operations-diagnostic[\s\S]*flex-direction column/)
  assert.match(styles, /@media \(max-height: 620px\)[\s\S]*\.operations-workspace-body[\s\S]*overflow-y auto/)
  assert.match(styles, /@media \(max-height: 620px\)[\s\S]*min-height 0/)
})

test('operations subpanels expose named selection, records, and parameter help semantics', () => {
  const catalog = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/operations-toolkit/workspace/tool-catalog.jsx'
  ), 'utf8')
  const taskPanel = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/operations-toolkit/workspace/task-panel.jsx'
  ), 'utf8')
  const resultViewer = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/operations-toolkit/workspace/result-viewer.jsx'
  ), 'utf8')
  const parameterForm = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/operations-toolkit/workspace/parameter-form.jsx'
  ), 'utf8')

  assert.ok((catalog.match(/role='listbox'/g) || []).length >= 2)
  assert.ok((catalog.match(/role='option'/g) || []).length >= 2)
  assert.match(catalog, /aria-selected=/)
  assert.match(catalog, /handleListboxOptionKeyDown/)
  assert.match(catalog, /aria-label=\{searchPlaceholder/)
  assert.match(taskPanel, /aria-labelledby='operations-task-panel-title'/)
  assert.match(resultViewer, /role='list'/)
  assert.match(resultViewer, /role='listitem'/)
  assert.match(parameterForm, /aria-describedby=\{helpId\}/)
  assert.match(parameterForm, /id=\{helpId\}/)
})
