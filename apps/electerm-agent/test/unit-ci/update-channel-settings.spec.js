const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readSource (file) {
  return fs.readFileSync(path.resolve(__dirname, file), 'utf8')
}

test('update channel defaults to stable in main and renderer settings', () => {
  const mainDefaults = readSource('../../src/app/common/default-setting.js')
  const rendererDefaults = readSource('../../src/client/common/default-setting.js')

  for (const source of [mainDefaults, rendererDefaults]) {
    assert.match(source, /updateChannel:\s*'stable'/)
    assert.match(source, /updateSource:\s*'auto'/)
  }
})

test('common settings page exposes stable and beta update channels', () => {
  const source = readSource('../../src/client/components/setting-panel/setting-common.jsx')

  assert.match(source, /updateChannel/)
  assert.match(source, /\u66f4\u65b0\u901a\u9053/)
  assert.match(source, /\u7a33\u5b9a\u7248/)
  assert.match(source, /\u6d4b\u8bd5\u7248/)
  assert.match(source, /value='stable'/)
  assert.match(source, /value='beta'/)
  assert.match(source, /renderUpdateSource/)
  assert.match(source, /更新源/)
  assert.match(source, /value='auto'/)
  assert.match(source, /value='modelscope'/)
  assert.match(source, /value='github'/)
})
