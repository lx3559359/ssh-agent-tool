const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeWindowBounds
} = require('../../src/app/lib/window-bounds')

const displays = [
  {
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    workAreaSize: { width: 1920, height: 1040 }
  }
]

test('moves restored window back on screen when previous position is mostly outside current display', () => {
  const rect = normalizeWindowBounds({
    width: 1200,
    height: 800,
    x: 1870,
    y: 120
  }, displays, {
    minWidth: 590,
    minHeight: 400
  })

  assert.equal(rect.x, 0)
  assert.equal(rect.y, 0)
  assert.equal(rect.width, 1200)
  assert.equal(rect.height, 800)
})

test('keeps restored window on a valid secondary display', () => {
  const rect = normalizeWindowBounds({
    width: 1200,
    height: 800,
    x: 2200,
    y: 80
  }, [
    ...displays,
    {
      workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 }
    }
  ], {
    minWidth: 590,
    minHeight: 400
  })

  assert.equal(rect.x, 2200)
  assert.equal(rect.y, 80)
})
