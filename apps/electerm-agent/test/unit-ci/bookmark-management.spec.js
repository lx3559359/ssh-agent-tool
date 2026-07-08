const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/common/bookmark-management.js')
).href

test('removeBookmarkIdFromGroups removes a deleted server from every group', async () => {
  const {
    removeBookmarkIdFromGroups
  } = await import(moduleUrl)

  const groups = [
    {
      id: 'default',
      title: 'Default',
      bookmarkIds: ['server-1', 'server-2'],
      bookmarkGroupIds: ['prod']
    },
    {
      id: 'prod',
      title: 'Production',
      bookmarkIds: ['server-3', 'server-1']
    },
    {
      id: 'empty',
      title: 'Empty'
    }
  ]

  removeBookmarkIdFromGroups(groups, 'server-1')

  assert.deepEqual(groups, [
    {
      id: 'default',
      title: 'Default',
      bookmarkIds: ['server-2'],
      bookmarkGroupIds: ['prod']
    },
    {
      id: 'prod',
      title: 'Production',
      bookmarkIds: ['server-3']
    },
    {
      id: 'empty',
      title: 'Empty'
    }
  ])
})

test('bookmark deletion entry points use the shared delete helper', () => {
  const treeListSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tree-list/tree-list.jsx'),
    'utf8'
  )
  const mcpHandlerSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/mcp-handler.js'),
    'utf8'
  )

  assert.match(treeListSource, /store\.delBookmark\(item\)/)
  assert.match(mcpHandlerSource, /store\.delBookmark\(\{\s*id:\s*args\.id\s*\}\)/)
})
