const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

test('bookmark group store exposes shared save, move, create and repair entries', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/store/bookmark-group.js'),
    'utf8'
  )

  assert.match(source, /Store\.prototype\.saveBookmarkInGroup/)
  assert.match(source, /Store\.prototype\.moveBookmarksToGroup/)
  assert.match(source, /Store\.prototype\.createBookmarkGroup/)
  assert.match(source, /repairBookmarkMembership/)
  assert.match(source, /cloneBookmarkMembership/)
  assert.match(source, /restoreBookmarkMembership/)
})

test('group picker supports nested selection and inline creation', () => {
  const source = fs.readFileSync(
    path.join(
      root,
      'src/client/components/bookmark-form/common/bookmark-group-picker.jsx'
    ),
    'utf8'
  )

  assert.match(source, /formatBookmarkGroups/)
  assert.match(source, /treeDefaultExpandAll/)
  assert.match(source, /store\.createBookmarkGroup/)
  assert.match(source, /shellpilotCreateServerGroup/)
  assert.match(source, /shellpilotParentGroup/)
})

test('quick connection saves through the shared group entry', () => {
  const source = fs.readFileSync(
    path.join(
      root,
      'src/client/components/tabs/quick-connect-wizard.jsx'
    ),
    'utf8'
  )

  assert.match(source, /BookmarkGroupPicker/)
  assert.match(source, /selectedGroupId/)
  assert.match(source, /store\.saveBookmarkInGroup/)
  assert.doesNotMatch(
    source,
    /store\.addItem\(buildQuickConnectBookmark/
  )
})

test('history saving uses an editable form and the shared group entry', () => {
  const modal = fs.readFileSync(
    path.join(
      root,
      'src/client/components/bookmark-form/bookmark-from-history-modal.jsx'
    ),
    'utf8'
  )
  const item = fs.readFileSync(
    path.join(root, 'src/client/components/sidebar/history-item.jsx'),
    'utf8'
  )

  assert.match(modal, /BookmarkGroupPicker/)
  assert.match(modal, /store\.saveBookmarkInGroup/)
  assert.match(modal, /shellpilotAuthenticationNeedsCompletion/)
  assert.doesNotMatch(modal, /bookmark-json-preview/)
  assert.match(item, /Dropdown/)
  assert.match(item, /shellpilotSaveHistoryAsServer/)
  assert.match(item, /shellpilotHistoryAlreadySaved/)
})
