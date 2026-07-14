const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/tree-list/bookmark-context-menu.js')
).href
const groupModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/common/context-menu-items.js')
).href

function actionKeys (items) {
  return items
    .filter(item => item.type !== 'divider')
    .map(item => item.key)
}

function menuSignature (items) {
  return items.map(item => item.type === 'divider' ? '|' : item.key)
}

function assertNormalizedDividers (items) {
  assert.notEqual(items[0]?.type, 'divider')
  assert.notEqual(items.at(-1)?.type, 'divider')
  for (let index = 1; index < items.length; index++) {
    assert.equal(
      items[index - 1].type === 'divider' && items[index].type === 'divider',
      false,
      'context menu must not contain adjacent dividers'
    )
  }
}

test('compact menu groups skip empty dynamic groups without stray dividers', async () => {
  const { compactMenuGroups } = await import(groupModuleUrl)
  const items = compactMenuGroups([
    [],
    [{ key: 'open' }, false],
    null,
    [],
    [{ key: 'delete' }],
    []
  ])

  assert.deepEqual(menuSignature(items), ['open', '|', 'delete'])
  assertNormalizedDividers(items)
})

test('bookmark context menu exposes common server actions without leaking credentials', async () => {
  const {
    buildBookmarkContextMenuItems,
    formatBookmarkPublicInfo,
    formatBookmarkSshCommand
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
  const keys = actionKeys(items)

  assert.deepEqual(keys, [
    'open',
    'testConnection',
    'edit',
    'toggleFavorite',
    'duplicate',
    'move',
    'viewConnectionInfo',
    'exportConnection',
    'copyPublicInfo',
    'copySshCommand',
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

  const command = formatBookmarkSshCommand(bookmark)
  assert.equal(command, 'ssh -i "PRIVATE KEY" -p 22 root@10.0.1.23')
  assert.equal(command.includes('secret'), false)
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

  assert.deepEqual(actionKeys(items), [
    'openAll',
    'edit',
    'addSubCat',
    'move',
    'delete'
  ])
})

test('sidebar bookmark context menu exposes direct connection management actions', async () => {
  const {
    buildBookmarkContextMenuItems
  } = await import(moduleUrl)

  const items = buildBookmarkContextMenuItems({
    item: {
      id: 'server-1',
      title: 'prod-web-01',
      type: 'ssh',
      host: '10.0.1.23',
      port: 22,
      username: 'root'
    },
    isGroup: false,
    staticList: true
  })

  assert.deepEqual(actionKeys(items), [
    'open',
    'testConnection',
    'edit',
    'viewConnectionInfo',
    'exportConnection',
    'copyPublicInfo',
    'copySshCommand',
    'delete'
  ])
})

test('bookmark context menus add normalized visual groups without changing baseline actions', async () => {
  const { buildBookmarkContextMenuItems } = await import(moduleUrl)
  const cases = [
    {
      args: {
        item: { id: 'server-1', type: 'ssh' },
        isGroup: false,
        staticList: false
      },
      signature: [
        'open', 'testConnection', '|',
        'edit', 'toggleFavorite', 'duplicate', 'move', '|',
        'viewConnectionInfo', 'exportConnection', 'copyPublicInfo', 'copySshCommand', '|',
        'delete'
      ]
    },
    {
      args: {
        item: { id: 'server-1', type: 'telnet' },
        isGroup: false,
        staticList: true
      },
      signature: [
        'open', 'testConnection', '|',
        'edit', '|',
        'viewConnectionInfo', 'exportConnection', 'copyPublicInfo', 'copySshCommand', '|',
        'delete'
      ]
    },
    {
      args: {
        item: { id: 'group-1' },
        isGroup: true,
        staticList: false
      },
      signature: ['openAll', '|', 'edit', 'addSubCat', 'move', '|', 'delete']
    },
    {
      args: {
        item: { id: 'group-1' },
        isGroup: true,
        staticList: true
      },
      signature: ['openAll']
    },
    {
      args: {
        item: { id: 'default' },
        isGroup: true,
        staticList: false
      },
      signature: []
    }
  ]

  for (const { args, signature } of cases) {
    const items = buildBookmarkContextMenuItems(args)
    assert.deepEqual(menuSignature(items), signature)
    assertNormalizedDividers(items)
    assert.equal(items.filter(item => item.type === 'divider').some(item => 'key' in item), false)
  }
})

test('bookmark delete is the only dangerous action and disabled state is preserved', async () => {
  const { buildBookmarkContextMenuItems } = await import(moduleUrl)
  const items = buildBookmarkContextMenuItems({
    item: { id: 'server-1', type: 'telnet' },
    isGroup: false,
    staticList: true
  })

  assert.deepEqual(
    items.filter(item => item.danger).map(item => item.key),
    ['delete']
  )
  assert.equal(items.find(item => item.key === 'copySshCommand').disabled, true)
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
  assert.match(source, /testConnection/)
  assert.match(source, /exportConnection/)
  assert.match(source, /copyPublicInfo/)
  assert.match(source, /copySshCommand/)
  assert.match(source, /formatBookmarkSshCommand/)
  assert.match(source, /onContextMenuAction/)
  assert.match(source, /overlayClassName:\s*'shellpilot-context-menu'/)
})
