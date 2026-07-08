const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('normalizes terminal resize dimensions to safe positive integers', async () => {
  const {
    normalizeTerminalResizeSize
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/terminal-resize-size.js')))

  assert.deepEqual(normalizeTerminalResizeSize(132, 43), {
    cols: 132,
    rows: 43
  })
  assert.deepEqual(normalizeTerminalResizeSize(120.8, 33.2), {
    cols: 120,
    rows: 33
  })
  assert.deepEqual(normalizeTerminalResizeSize(0, -2), {
    cols: 1,
    rows: 1
  })
  assert.deepEqual(normalizeTerminalResizeSize('80', '24'), {
    cols: 80,
    rows: 24
  })
})
