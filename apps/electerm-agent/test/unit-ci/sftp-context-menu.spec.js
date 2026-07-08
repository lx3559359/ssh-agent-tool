const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/sftp/context-menu-utils.js')
).href
const fileItemSource = require('node:fs').readFileSync(
  path.resolve(__dirname, '../../src/client/components/sftp/file-item.jsx'),
  'utf8'
)

function createItems (count) {
  return Array.from({ length: count }, (_, index) => ({
    key: `item-${index + 1}`,
    label: `菜单 ${index + 1}`
  }))
}

test('sftp context menu keeps all items when there is enough viewport space', async () => {
  const { splitOverflowMenu } = await import(moduleUrl)
  const items = createItems(5)

  assert.deepEqual(
    splitOverflowMenu({ items, clientY: 80, windowHeight: 600 }),
    items
  )
})

test('sftp context menu uses a readable chinese more submenu when it would overflow', async () => {
  const { splitOverflowMenu } = await import(moduleUrl)
  const items = createItems(10)
  const result = splitOverflowMenu({ items, clientY: 520, windowHeight: 600 })
  const more = result[result.length - 1]

  assert.equal(result.length, 6)
  assert.equal(more.key, 'more-submenu')
  assert.equal(more.label, '更多')
  assert.deepEqual(more.children, items.slice(5))
  assert.deepEqual(result.slice(0, 5), items.slice(0, 5))
})

test('sftp context menu does not create an overflow submenu for short menus', async () => {
  const { splitOverflowMenu } = await import(moduleUrl)
  const items = createItems(6)

  assert.deepEqual(
    splitOverflowMenu({ items, clientY: 590, windowHeight: 600 }),
    items
  )
})

test('sftp file context menu exposes AI file reference for editable files', () => {
  assert.match(fileItemSource, /func:\s*'askAiAboutFile'/)
  assert.match(fileItemSource, /text:\s*'AI 引用文件'/)
  assert.match(fileItemSource, /buildSftpFileContextPrompt/)
  assert.match(fileItemSource, /fetchEditorText\(filePath,\s*type\)/)
})
