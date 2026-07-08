const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('removeCyclicBookmarkGroupIds removes nested group references that would create cycles', async () => {
  const {
    removeCyclicBookmarkGroupIds
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-group-tree.js')))

  const bookmarkGroups = [
    { id: 'default', level: 1, bookmarkIds: [], bookmarkGroupIds: ['group-a'] },
    { id: 'group-a', level: 2, bookmarkIds: ['server-1'], bookmarkGroupIds: ['group-b'] },
    { id: 'group-b', level: 2, bookmarkIds: [], bookmarkGroupIds: ['group-a'] }
  ]

  removeCyclicBookmarkGroupIds(bookmarkGroups)

  assert.deepEqual(bookmarkGroups, [
    { id: 'default', level: 1, bookmarkIds: [], bookmarkGroupIds: ['group-a'] },
    { id: 'group-a', level: 2, bookmarkIds: ['server-1'], bookmarkGroupIds: ['group-b'] },
    { id: 'group-b', level: 2, bookmarkIds: [], bookmarkGroupIds: [] }
  ])
})
