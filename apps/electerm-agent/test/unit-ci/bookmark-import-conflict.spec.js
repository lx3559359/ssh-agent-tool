const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadModule () {
  return import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/common/bookmark-import-plan.js'
  )))
}

const localBookmarks = [
  { id: 'local-id', title: 'local', type: 'ssh', host: '10.0.0.1', port: 22, username: 'root', password: 'local-secret' },
  { id: 'identity-local', title: 'identity local', type: 'ssh', host: '10.0.0.2', port: 22, username: 'root' }
]

const incomingBookmarks = [
  { id: 'local-id', title: 'backup', type: 'ssh', host: '10.0.0.9', port: 22, username: 'root', password: 'backup-secret' },
  { id: 'identity-backup', title: 'identity backup', type: 'ssh', host: '10.0.0.2', port: 22, username: 'root' },
  { id: 'new-id', title: 'new', type: 'ssh', host: '10.0.0.3', port: 22, username: 'deploy' }
]

test('keep-local preserves local conflicts and imports new connections', async () => {
  const { buildBookmarkImportPlan } = await loadModule()
  const plan = buildBookmarkImportPlan({
    localBookmarks,
    incomingBookmarks,
    strategy: 'keep-local'
  })

  assert.equal(plan.bookmarks.length, 3)
  assert.equal(plan.bookmarks.find(item => item.id === 'local-id').password, 'local-secret')
  assert.equal(plan.bookmarks.some(item => item.id === 'identity-backup'), false)
  assert.equal(plan.report.added, 1)
  assert.equal(plan.report.skipped, 2)
  assert.equal(plan.report.conflicts.length, 2)
})

test('identical existing items are skipped without asking the user to resolve a conflict', async () => {
  const { buildBookmarkImportPlan } = await loadModule()
  const bookmark = { id: 'same', title: 'same', type: 'ssh', host: '10.0.0.8', port: 22, username: 'root' }
  const group = { id: 'same-group', title: 'same', bookmarkIds: ['same'], bookmarkGroupIds: [] }
  const plan = buildBookmarkImportPlan({
    localBookmarks: [bookmark],
    localBookmarkGroups: [group],
    incomingBookmarks: [bookmark],
    incomingBookmarkGroups: [group]
  })

  assert.equal(plan.report.skipped, 1)
  assert.equal(plan.report.groupSkipped, 1)
  assert.equal(plan.report.conflicts.length, 0)
})

test('overwrite replaces id and connection identity conflicts without duplicates', async () => {
  const { buildBookmarkImportPlan } = await loadModule()
  const plan = buildBookmarkImportPlan({
    localBookmarks,
    incomingBookmarks,
    strategy: 'overwrite'
  })

  assert.equal(plan.bookmarks.length, 3)
  assert.equal(plan.bookmarks.find(item => item.id === 'local-id').password, 'backup-secret')
  assert.equal(plan.bookmarks.find(item => item.id === 'identity-local').title, 'identity backup')
  assert.equal(plan.report.updated, 2)
  assert.equal(plan.report.added, 1)
})

test('duplicate remaps conflicting bookmark and group references', async () => {
  const { buildBookmarkImportPlan } = await loadModule()
  let next = 0
  const plan = buildBookmarkImportPlan({
    localBookmarks,
    localBookmarkGroups: [{ id: 'prod', title: 'Local prod', bookmarkIds: ['local-id'], bookmarkGroupIds: [] }],
    incomingBookmarks: [incomingBookmarks[0]],
    incomingBookmarkGroups: [{ id: 'prod', title: 'Backup prod', bookmarkIds: ['local-id'], bookmarkGroupIds: [] }],
    strategy: 'duplicate',
    idFactory: prefix => `${prefix}-copy-${++next}`
  })

  const duplicate = plan.bookmarks.find(item => item.id === 'bookmark-copy-1')
  const duplicateGroup = plan.bookmarkGroups.find(item => item.id === 'group-copy-2')
  assert.equal(duplicate.title, 'backup')
  assert.deepEqual(duplicateGroup.bookmarkIds, ['bookmark-copy-1'])
  assert.equal(plan.report.duplicated, 1)
  assert.equal(plan.report.groupDuplicated, 1)
})

test('formats a Chinese import summary', async () => {
  const { formatBookmarkImportReport } = await loadModule()
  const text = formatBookmarkImportReport({ added: 2, updated: 1, skipped: 3 })
  assert.match(text, /新增连接 2 个/)
  assert.match(text, /覆盖连接 1 个/)
  assert.match(text, /跳过连接 3 个/)
})
