const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(
  path.join(root, 'src/client/components/tabs/no-session.jsx'),
  'utf8'
)
const styles = fs.readFileSync(
  path.join(root, 'src/client/components/tabs/no-session.styl'),
  'utf8'
)

test('disconnected home uses the approved workspace structure', () => {
  assert.match(source, /no-session-heading/)
  assert.match(source, /no-session-actions/)
  assert.match(source, /no-session-recents/)
  assert.match(source, /no-session-start-hint/)
  assert.match(source, /shellpilotHomeStartHint/)
  assert.match(source, /shellpilotHomeStartAction/)
  assert.match(source, /shellpilotHomeNewConnection/)
  assert.match(source, /shellpilotHomeRecentConnections/)
  assert.match(source, /shellpilotTopbarModelApi/)
  assert.match(source, /shellpilot-open-help-center/)
  assert.match(source, /<HistoryPanel sort emptyText=/)
  assert.match(source, /add-new-tab-btn/)
  assert.doesNotMatch(source, /LogoElem/)
})

test('disconnected home is theme-aware and responsive', () => {
  assert.match(styles, /var\(--main\)/)
  assert.match(styles, /var\(--text\)/)
  assert.match(styles, /grid-template-columns repeat\(auto-fit, minmax\(210px, 1fr\)\)/)
  assert.match(styles, /@media \(max-width: 900px\)/)
  assert.match(styles, /@media \(max-width: 560px\)/)
  assert.match(styles, /\.no-session-start-hint/)
  assert.doesNotMatch(styles, /top 320px/)
})
