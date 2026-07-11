const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function readClientSource (relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../src/client', relativePath),
    'utf8'
  )
}

test('bookmark upload asks for a conflict strategy and applies one atomic import plan', () => {
  const source = readClientSource('components/tree-list/bookmark-upload.js')

  assert.match(source, /buildBookmarkImportPlan/)
  assert.match(source, /requestBookmarkImportStrategy/)
  assert.match(source, /preview\.report\.conflicts\.length/)
  assert.match(source, /store\.bookmarks\.splice/)
  assert.match(source, /store\.bookmarkGroups\.splice/)
  assert.match(source, /formatBookmarkImportReport/)
})

test('bookmark conflict dialog exposes three clear Chinese strategies', () => {
  const source = readClientSource('components/tree-list/bookmark-import-strategy-dialog.jsx')

  assert.match(source, /保留本地（推荐）/)
  assert.match(source, /使用备份覆盖/)
  assert.match(source, /创建副本/)
  assert.match(source, /取消导入/)
  assert.match(source, /开始导入/)
})
