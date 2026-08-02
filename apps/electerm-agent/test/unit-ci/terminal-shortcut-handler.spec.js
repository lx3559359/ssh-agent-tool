const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readClientSource (relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../src/client', relativePath),
    'utf8'
  )
}

test('terminal Ctrl+C without selection is passed through to the terminal', () => {
  const source = readClientSource('components/terminal/terminal.jsx')

  const start = source.indexOf('copyShortcut = (e) => {')
  const end = source.indexOf('searchShortcut = (e) => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /const sel = this\.term\.getSelection\(\)/)
  assert.match(body, /return false/)
  assert.match(body, /return true/)
})

test('terminal Ctrl+L is reserved for remote shell clear screen', () => {
  const source = readClientSource('components/shortcuts/shortcuts-defaults.js')

  const start = source.indexOf("name: 'terminal_clear'")
  const end = source.indexOf("name: 'terminal_copy'")
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /shortcut: 'ctrl\+shift\+l'/)
  assert.doesNotMatch(body, /shortcut: 'ctrl\+l/)
})

test('session pane keyboard navigation stays outside terminal input handling', () => {
  const source = readClientSource('components/session/session.jsx')
  const start = source.indexOf('handlePaneTabKeyDown =')
  const end = source.indexOf('onChangePane =', start)
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /ArrowLeft/)
  assert.match(body, /ArrowRight/)
  assert.match(body, /Home/)
  assert.match(body, /End/)
  assert.match(body, /this\.onChangePane\(types\[nextIndex\]\)/)
  assert.doesNotMatch(body, /term\.|write\(|sendData|dispatchEvent/)

  const controlsStart = source.indexOf('renderPaneControl =')
  const controlsEnd = source.indexOf('renderSftpPathFollowControl =', controlsStart)
  const controls = source.slice(controlsStart, controlsEnd)
  assert.match(controls, /const types = \[[\s\S]*paneMap\.terminal[\s\S]*\]/)
  assert.match(controls, /controls\.push[\s\S]*types\.push\(paneMap\.fileManager\)/)
})
