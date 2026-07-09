const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('main process quits the running client after the updater starts the installer', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/lib/ipc.js'),
    'utf8'
  )

  assert.match(source, /m\s*&&\s*m\.quitForUpgrade/)
  assert.match(source, /ShellPilot update requested app quit/)
  assert.match(source, /globalState\.get\('win'\)[\s\S]{0,120}win\s*&&\s*win\.close\(\)/)
})
