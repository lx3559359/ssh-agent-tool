const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/common/bookmark-deletion.js')
).href

async function loadDeletionHelper () {
  try {
    return await import(moduleUrl)
  } catch (error) {
    assert.fail(`bookmark deletion helper must be loadable: ${error.message}`)
  }
}

test('deleting a nested group removes every reference and migrates contents once', async () => {
  const { deleteBookmarkGroupState } = await loadDeletionHelper()
  const groups = [
    {
      id: 'default',
      level: 1,
      bookmarkIds: ['server-default'],
      bookmarkGroupIds: ['parent']
    },
    {
      id: 'parent',
      level: 1,
      bookmarkIds: ['server-target'],
      bookmarkGroupIds: ['target', 'target', 'child']
    },
    {
      id: 'other-parent',
      level: 1,
      bookmarkIds: [],
      bookmarkGroupIds: ['target']
    },
    {
      id: 'target',
      level: 2,
      bookmarkIds: ['server-target', 'server-new', 'server-new'],
      bookmarkGroupIds: ['child', 'child', 'missing', 'parent']
    },
    {
      id: 'child',
      level: 2,
      bookmarkIds: ['server-child'],
      bookmarkGroupIds: []
    }
  ]

  const result = deleteBookmarkGroupState(groups, 'target', 'default')

  assert.deepEqual(result, {
    deleted: true,
    parentGroupId: 'parent'
  })
  assert.deepEqual(groups, [
    {
      id: 'default',
      level: 1,
      bookmarkIds: ['server-default'],
      bookmarkGroupIds: ['parent']
    },
    {
      id: 'parent',
      level: 1,
      bookmarkIds: ['server-target', 'server-new'],
      bookmarkGroupIds: ['child']
    },
    {
      id: 'other-parent',
      level: 1,
      bookmarkIds: [],
      bookmarkGroupIds: []
    },
    {
      id: 'child',
      level: 2,
      bookmarkIds: ['server-child'],
      bookmarkGroupIds: []
    }
  ])
})

test('deleting a top-level group migrates connections and child groups to default', async () => {
  const { deleteBookmarkGroupState } = await loadDeletionHelper()
  const groups = [
    {
      id: 'default',
      level: 1,
      bookmarkIds: ['server-1'],
      bookmarkGroupIds: ['top', 'child']
    },
    {
      id: 'top',
      level: 1,
      bookmarkIds: ['server-1', 'server-2'],
      bookmarkGroupIds: ['child']
    },
    {
      id: 'child',
      level: 2,
      bookmarkIds: [],
      bookmarkGroupIds: []
    }
  ]

  const result = deleteBookmarkGroupState(groups, 'top', 'default')

  assert.deepEqual(result, {
    deleted: true,
    parentGroupId: 'default'
  })
  assert.deepEqual(groups, [
    {
      id: 'default',
      level: 1,
      bookmarkIds: ['server-1', 'server-2'],
      bookmarkGroupIds: ['child']
    },
    {
      id: 'child',
      level: 2,
      bookmarkIds: [],
      bookmarkGroupIds: []
    }
  ])
})

test('default group and unknown groups cannot be deleted', async () => {
  const { deleteBookmarkGroupState } = await loadDeletionHelper()
  const groups = [
    {
      id: 'default',
      level: 1,
      bookmarkIds: ['server-1'],
      bookmarkGroupIds: []
    }
  ]
  const before = structuredClone(groups)

  assert.deepEqual(deleteBookmarkGroupState(groups, 'default', 'default'), {
    deleted: false,
    parentGroupId: null
  })
  assert.deepEqual(deleteBookmarkGroupState(groups, 'missing', 'default'), {
    deleted: false,
    parentGroupId: null
  })
  assert.deepEqual(groups, before)
})

test('mixed batch deletion uses stable store order and shared single-item entries', async () => {
  const { deleteBookmarkSelection } = await loadDeletionHelper()
  const calls = []
  const store = {
    bookmarks: [{ id: 'server-b' }, { id: 'server-a' }],
    bookmarkGroups: [
      { id: 'default' },
      { id: 'parent' },
      { id: 'child' }
    ],
    delBookmark: item => calls.push(['bookmark', item.id]),
    delBookmarkGroup: item => calls.push(['group', item.id])
  }

  const result = deleteBookmarkSelection(
    store,
    ['child', 'server-a', 'default', 'parent', 'server-b', 'server-a'],
    'default'
  )

  assert.deepEqual(result, {
    bookmarkIds: ['server-b', 'server-a'],
    bookmarkGroupIds: ['parent', 'child']
  })
  assert.deepEqual(calls, [
    ['bookmark', 'server-b'],
    ['bookmark', 'server-a'],
    ['group', 'parent'],
    ['group', 'child']
  ])
})

test('batch deletion cancellation makes zero changes', async () => {
  const {
    bookmarkSelectionDeleteConfirmText,
    confirmBookmarkSelectionDeletion
  } = await loadDeletionHelper()
  const calls = []

  const deleted = confirmBookmarkSelectionDeletion(
    ['server-1', 'group-1'],
    message => {
      calls.push(['confirm', message])
      return false
    },
    ids => calls.push(['delete', ids])
  )

  assert.equal(deleted, false)
  assert.match(bookmarkSelectionDeleteConfirmText, /[\u4e00-\u9fff]/)
  assert.deepEqual(calls, [
    ['confirm', bookmarkSelectionDeleteConfirmText]
  ])
})

test('confirmed batch deletion invokes the unified entry once', async () => {
  const { confirmBookmarkSelectionDeletion } = await loadDeletionHelper()
  const calls = []

  const deleted = confirmBookmarkSelectionDeletion(
    ['server-1', 'group-1', 'server-1'],
    () => true,
    ids => calls.push(ids)
  )

  assert.equal(deleted, true)
  assert.deepEqual(calls, [['server-1', 'group-1']])
})

test('store deletion methods delegate to the shared deletion helper', () => {
  const bookmarkSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/bookmark.js'),
    'utf8'
  )
  const groupSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/bookmark-group.js'),
    'utf8'
  )

  assert.match(bookmarkSource, /deleteBookmarkSelection/)
  assert.match(bookmarkSource, /Store\.prototype\.delBookmarkSelection/)
  assert.match(groupSource, /deleteBookmarkGroupState/)
})

test('batch delete UI confirms before using the unified deletion entry', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/bookmark-form/tree-select.jsx'),
    'utf8'
  )

  assert.match(source, /confirmBookmarkSelectionDeletion/)
  assert.match(source, /store\.delBookmarkSelection/)
  assert.doesNotMatch(source, /store\.delItems/)
})
