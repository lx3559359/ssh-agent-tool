const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('terminal Ctrl+C without selection is passed through to the terminal', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/terminal/terminal.jsx'),
    'utf8'
  )

  const start = source.indexOf('copyShortcut = (e) => {')
  const end = source.indexOf('searchShortcut = (e) => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /const sel = this\.term\.getSelection\(\)/)
  assert.match(body, /return false/)
  assert.match(body, /return true/)
})
