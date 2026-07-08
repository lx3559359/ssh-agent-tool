const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('custom Windows title bar exposes distinct minimize maximize restore and close controls', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tabs/window-control.jsx'),
    'utf8'
  )

  assert.match(source, /MinusOutlined/)
  assert.match(source, /FullscreenOutlined/)
  assert.match(source, /FullscreenExitOutlined/)
  assert.match(source, /CloseOutlined/)
  assert.match(source, /window-control-minimize/)
  assert.match(source, /window-control-maximize/)
  assert.match(source, /window-control-close/)
  assert.match(source, /runGlobalAsync\('minimize'\)/)
  assert.match(source, /runGlobalAsync\('maximize'\)/)
  assert.match(source, /runGlobalAsync\('unmaximize'\)/)
  assert.match(source, /window\.store\.exit\(\)/)
})
