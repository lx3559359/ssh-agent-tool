const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('terminal context menu exposes reconnect for SSH sessions', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/terminal/terminal.jsx'),
    'utf8'
  )

  assert.match(source, /key:\s*'onReconnect'/)
  assert.match(source, /label:\s*e\('reload'\)/)
  assert.match(source, /onReconnect\s*=\s*\(\)\s*=>\s*{[\s\S]{0,240}this\.props\.reloadTab\(this\.props\.tab\)/)
})

test('terminal context menu exposes disconnect without closing the tab', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/terminal/terminal.jsx'),
    'utf8'
  )

  assert.match(source, /key:\s*'onDisconnect'/)
  assert.match(source, /label:\s*e\('disconnect'\)/)
  assert.match(source, /onDisconnect\s*=\s*\(\)\s*=>\s*{[\s\S]{0,220}this\.socket\.close\(\)/)
  assert.doesNotMatch(source, /onDisconnect\s*=\s*\(\)\s*=>\s*{[\s\S]{0,220}this\.props\.delTab/)
})
