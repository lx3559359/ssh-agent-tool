const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadActions () {
  try {
    return await import(pathToFileURL(path.resolve(
      __dirname,
      '../../src/client/components/tree-list/bookmark-group-actions.js'
    )))
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      return {}
    }
    throw error
  }
}

test('normalizeBookmarkGroupTitle trims valid titles and rejects blank input', async () => {
  const actions = await loadActions()
  const normalizeBookmarkGroupTitle = actions.normalizeBookmarkGroupTitle || (() => undefined)

  assert.equal(normalizeBookmarkGroupTitle('  Production  '), 'Production')
  assert.equal(normalizeBookmarkGroupTitle('   '), '')
  assert.equal(normalizeBookmarkGroupTitle(''), '')
})

test('prepareBookmarkGroupCreation rejects empty and whitespace-only titles', async () => {
  const actions = await loadActions()
  const prepareBookmarkGroupCreation = actions.prepareBookmarkGroupCreation || (() => undefined)
  const bookmarkGroups = [{ id: 'parent', bookmarkGroupIds: [] }]

  assert.equal(prepareBookmarkGroupCreation({
    bookmarkGroups,
    id: 'top-empty',
    title: ''
  }), null)
  assert.equal(prepareBookmarkGroupCreation({
    bookmarkGroups,
    parentId: 'parent',
    id: 'child-empty',
    title: '   '
  }), null)
  assert.deepEqual(bookmarkGroups, [{ id: 'parent', bookmarkGroupIds: [] }])
})

test('prepareBookmarkGroupCreation builds a trimmed top-level group without mutating input', async () => {
  const { prepareBookmarkGroupCreation } = await loadActions()
  const bookmarkGroups = []

  const result = prepareBookmarkGroupCreation({
    bookmarkGroups,
    id: 'top-group',
    title: '  Production  ',
    color: '#123456'
  })

  assert.deepEqual(result, {
    group: {
      id: 'top-group',
      title: 'Production',
      bookmarkIds: [],
      color: '#123456'
    },
    parent: null
  })
  assert.deepEqual(bookmarkGroups, [])
})

test('prepareBookmarkGroupCreation rejects a child when its parent is missing', async () => {
  const { prepareBookmarkGroupCreation } = await loadActions()
  const bookmarkGroups = [{ id: 'other-group', bookmarkGroupIds: [] }]

  const result = prepareBookmarkGroupCreation({
    bookmarkGroups,
    parentId: 'missing-parent',
    id: 'orphan',
    title: 'Child'
  })

  assert.equal(result, null)
  assert.deepEqual(bookmarkGroups, [{ id: 'other-group', bookmarkGroupIds: [] }])
})

test('prepareBookmarkGroupCreation builds a child and appends its parent reference once', async () => {
  const { prepareBookmarkGroupCreation } = await loadActions()
  const parent = { id: 'parent', bookmarkGroupIds: ['existing'] }
  const bookmarkGroups = [parent]

  const result = prepareBookmarkGroupCreation({
    bookmarkGroups,
    parentId: 'parent',
    id: 'child',
    title: '  Child  ',
    color: '#abcdef'
  })

  assert.deepEqual(result.group, {
    id: 'child',
    title: 'Child',
    level: 2,
    bookmarkIds: [],
    color: '#abcdef'
  })
  assert.equal(result.parent.group, parent)
  assert.deepEqual(result.parent.bookmarkGroupIds, ['existing', 'child'])
  assert.deepEqual(parent.bookmarkGroupIds, ['existing'])

  const existingReferenceParent = { id: 'parent', bookmarkGroupIds: ['existing', 'child'] }
  const deduped = prepareBookmarkGroupCreation({
    bookmarkGroups: [existingReferenceParent],
    parentId: 'parent',
    id: 'child',
    title: 'Child'
  })
  assert.deepEqual(deduped.parent.bookmarkGroupIds, ['existing', 'child'])
})

test('prepareBookmarkGroupEdit rejects blank titles and prepares a trimmed update', async () => {
  const actions = await loadActions()
  const prepareBookmarkGroupEdit = actions.prepareBookmarkGroupEdit || (() => undefined)
  const group = { id: 'group', title: 'Before', color: '#111111' }
  const bookmarkGroups = [group]

  assert.deepEqual(prepareBookmarkGroupEdit({
    bookmarkGroups,
    id: 'group',
    title: ''
  }), { status: 'invalid' })
  assert.deepEqual(prepareBookmarkGroupEdit({
    bookmarkGroups,
    id: 'group',
    title: '   '
  }), { status: 'invalid' })
  assert.deepEqual(prepareBookmarkGroupEdit({
    bookmarkGroups,
    id: 'missing',
    title: 'Missing'
  }), { status: 'missing' })

  const result = prepareBookmarkGroupEdit({
    bookmarkGroups,
    id: 'group',
    title: '  After  ',
    color: '#222222'
  })

  assert.deepEqual(result, {
    status: 'ready',
    group,
    title: 'After',
    color: '#222222'
  })
  assert.deepEqual(group, { id: 'group', title: 'Before', color: '#111111' })
})
