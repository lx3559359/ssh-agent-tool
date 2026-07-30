const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/bookmark-membership.js'
)).href

test('assignBookmarkToGroup keeps exactly one real group membership', async () => {
  const { assignBookmarkToGroup } = await import(moduleUrl)
  const groups = [
    { id: 'default', bookmarkIds: ['server-1'], bookmarkGroupIds: ['prod'] },
    { id: 'prod', bookmarkIds: ['server-1'], bookmarkGroupIds: [] }
  ]

  const result = assignBookmarkToGroup(groups, 'server-1', 'prod', 'default')

  assert.deepEqual(result, { groupId: 'prod', changed: true })
  assert.deepEqual(groups[0].bookmarkIds, [])
  assert.deepEqual(groups[1].bookmarkIds, ['server-1'])
})

test('repairBookmarkMembership removes stale and duplicate references and assigns strays', async () => {
  const { repairBookmarkMembership } = await import(moduleUrl)
  const bookmarks = [{ id: 'server-1' }, { id: 'server-2' }]
  const groups = [
    {
      id: 'default',
      bookmarkIds: ['missing', 'server-1'],
      bookmarkGroupIds: ['prod', 'missing-group']
    },
    { id: 'prod', bookmarkIds: ['server-1'], bookmarkGroupIds: [] }
  ]

  const result = repairBookmarkMembership(bookmarks, groups, 'default')

  assert.deepEqual(groups[0].bookmarkIds, ['server-1', 'server-2'])
  assert.deepEqual(groups[0].bookmarkGroupIds, ['prod'])
  assert.deepEqual(groups[1].bookmarkIds, [])
  assert.deepEqual(result, {
    duplicateMembershipsRemoved: 1,
    staleBookmarkReferencesRemoved: 1,
    staleGroupReferencesRemoved: 1,
    straysAssigned: 1
  })
})

test('createBookmarkGroupInParent rejects same-level duplicates and creates nested groups', async () => {
  const { createBookmarkGroupInParent } = await import(moduleUrl)
  const groups = [
    {
      id: 'default',
      title: '未分组',
      bookmarkIds: [],
      bookmarkGroupIds: []
    },
    {
      id: 'prod',
      title: '生产环境',
      bookmarkIds: [],
      bookmarkGroupIds: []
    }
  ]

  assert.throws(
    () => createBookmarkGroupInParent(groups, {
      id: 'duplicate',
      title: ' 生产环境 ',
      parentId: null
    }),
    error => error.code === 'DUPLICATE_GROUP_TITLE'
  )

  const group = createBookmarkGroupInParent(groups, {
    id: 'web',
    title: ' Web服务器 ',
    parentId: 'prod',
    color: '#0088cc'
  })

  assert.equal(group.title, 'Web服务器')
  assert.equal(group.level, 2)
  assert.deepEqual(
    groups.find(item => item.id === 'prod').bookmarkGroupIds,
    ['web']
  )
})
