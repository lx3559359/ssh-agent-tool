const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const { getRestoreBounds } = require(path.resolve(
  __dirname,
  '../../src/app/lib/window-restore-bounds.js'
))

test('maximize restore falls back to a usable desktop workspace instead of the minimum window size', () => {
  const restored = getRestoreBounds(null, {
    x: 0,
    y: 0,
    width: 1366,
    height: 720
  })

  assert.ok(restored.width >= 1100)
  assert.ok(restored.height >= 640)
  assert.ok(restored.width < 1366)
  assert.ok(restored.height < 720)
})

test('maximize restore keeps the last normal bounds when they are still valid', () => {
  const restored = getRestoreBounds({
    x: 120,
    y: 80,
    width: 1280,
    height: 760
  }, {
    x: 0,
    y: 0,
    width: 1920,
    height: 1032
  })

  assert.deepEqual(restored, {
    x: 120,
    y: 80,
    width: 1280,
    height: 760
  })
})

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

test('main title bar toggles maximize on non-interactive double click', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/aigshell-topbar.jsx'),
    'utf8'
  )

  assert.match(source, /function handleTitleBarDoubleClick/)
  assert.match(source, /closest\(/)
  assert.match(source, /window\.pre\.runGlobalAsync\('maximize'\)/)
  assert.match(source, /window\.pre\.runGlobalAsync\('unmaximize'\)/)
  assert.match(source, /onDoubleClick=\{handleTitleBarDoubleClick\}/)
})
