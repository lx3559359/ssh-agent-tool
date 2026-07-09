const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/tree-list/bookmark-context-menu.js')
).href

test('bookmark context menu exposes common server actions without leaking credentials', async () => {
  const {
    buildBookmarkContextMenuItems,
    formatBookmarkPublicInfo
  } = await import(moduleUrl)

  const bookmark = {
    id: 'server-1',
    title: 'prod-web-01',
    type: 'ssh',
    host: '10.0.1.23',
    port: 22,
    username: 'root',
    password: 'secret',
    privateKey: 'PRIVATE KEY',
    labels: ['prod']
  }
  const items = buildBookmarkContextMenuItems({
    item: bookmark,
    isGroup: false,
    staticList: false
  })
  const keys = items.map(item => item.key)

  assert.deepEqual(keys, [
    'open',
    'edit',
    'toggleFavorite',
    'duplicate',
    'move',
    'viewConnectionInfo',
    'copyPublicInfo',
    'delete'
  ])

  const info = formatBookmarkPublicInfo(bookmark)
  assert.match(info, /prod-web-01/)
  assert.match(info, /ssh/)
  assert.match(info, /10\.0\.1\.23/)
  assert.match(info, /root/)
  assert.match(info, /prod/)
  assert.equal(info.includes('secret'), false)
  assert.equal(info.includes('PRIVATE KEY'), false)
})

test('bookmark group context menu exposes group actions', async () => {
  const {
    buildBookmarkContextMenuItems
  } = await import(moduleUrl)

  const items = buildBookmarkContextMenuItems({
    item: { id: 'group-1', title: '生产环境', bookmarkIds: ['server-1'] },
    isGroup: true,
    staticList: false
  })

  assert.deepEqual(items.map(item => item.key), [
    'openAll',
    'edit',
    'addSubCat',
    'move',
    'delete'
  ])
})

test('bookmark tree rows wire the context menu to row actions', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tree-list/tree-list-row.jsx'),
    'utf8'
  )

  assert.match(source, /Dropdown/)
  assert.match(source, /trigger:\s*\['contextMenu'\]/)
  assert.match(source, /buildBookmarkContextMenuItems/)
  assert.match(source, /viewConnectionInfo/)
  assert.match(source, /copyPublicInfo/)
  assert.match(source, /onContextMenuAction/)
})
