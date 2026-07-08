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

test('toggleSearch clears active decorations before closing', () => {
  const source = readClientSource('components/terminal/term-search.jsx')

  const start = source.indexOf('toggleSearch = () => {')
  const end = source.indexOf('prev = (searchTerm) => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /const isClosing = this\.props\.termSearchOpen/)
  assert.match(body, /if \(isClosing\) \{[\s\S]*?this\.clearSearch\(\)[\s\S]*?\}/)
  assert.match(body, /window\.store\.toggleTerminalSearch\(\)/)
  assert.match(body, /setTimeout\(window\.store\.focus,\s*200\)/)
})

test('search previous and next route to active terminal', () => {
  const source = readClientSource('components/terminal/term-search.jsx')

  const prevStart = source.indexOf('prev = (searchTerm) => {')
  const nextStart = source.indexOf('next = () => {')
  const handleChangeStart = source.indexOf('handleChange = e => {')
  const prevBody = source.slice(prevStart, nextStart)
  const nextBody = source.slice(nextStart, handleChangeStart)

  assert.notEqual(prevStart, -1)
  assert.notEqual(nextStart, -1)
  assert.notEqual(handleChangeStart, -1)
  assert.match(prevBody, /refs\.get\('term-' \+ activeTabId\)/)
  assert.match(prevBody, /\.searchPrev\(/)
  assert.match(prevBody, /searchTerm \?\? this\.props\.termSearch/)
  assert.match(prevBody, /copy\(termSearchOptions\)/)
  assert.match(nextBody, /refs\.get\('term-' \+ this\.props\.activeTabId\)/)
  assert.match(nextBody, /\.searchNext\(/)
  assert.match(nextBody, /this\.props\.termSearch/)
  assert.match(nextBody, /copy\(this\.props\.termSearchOptions\)/)
})

test('terminal search input updates store and searches while typing', () => {
  const source = readClientSource('components/terminal/term-search.jsx')

  const start = source.indexOf('handleChange = e => {')
  const end = source.indexOf('clearSearch = () => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /const v = e\.target\.value/)
  assert.match(body, /window\.store\.termSearch = v/)
  assert.match(body, /this\.prev\(v\)/)
})

test('terminal search clear resets decorations and match state', () => {
  const source = readClientSource('components/terminal/term-search.jsx')

  const start = source.indexOf('clearSearch = () => {')
  const end = source.indexOf('close = () => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /term\?\.searchAddon\.clearDecorations\(\)/)
  assert.match(body, /searchResults:\s*\[\]/)
  assert.match(body, /matchIndex:\s*-1/)
})

test('Enter triggers next search and file manager does not render terminal search', () => {
  const source = readClientSource('components/terminal/term-search.jsx')

  const start = source.indexOf('render () {')
  const body = source.slice(start)

  assert.notEqual(start, -1)
  assert.match(body, /currentTab\.pane === paneMap\.fileManager/)
  assert.match(body, /return null/)
  assert.match(body, /onPressEnter:\s*this\.next/)
  assert.match(body, /selectall:\s*true/)
})

test('terminal clear refreshes active search results after clearing the screen', () => {
  const source = readClientSource('components/terminal/terminal.jsx')

  const start = source.indexOf('onClear = () => {')
  const end = source.indexOf('onReconnect = () => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /window\.store\.termSearchOpen/)
  assert.match(body, /window\.store\.termSearch/)
  assert.match(body, /this\.searchAddon\.clearDecorations\(\)/)
  assert.match(body, /this\.term\.clear\(\)/)
  assert.match(body, /this\.term\.focus\(\)/)
  assert.match(body, /this\.searchAddon\._lineCache\.clear\(\)/)
  assert.match(body, /refsStatic\.get\('term-search'\)\?\.next\(\)/)
})
