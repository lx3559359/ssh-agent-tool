const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readClientSource (relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../src/client', relativePath),
    'utf8'
  )
}

test('bookmark toolbar exposes new bookmark new group edit import and export actions', () => {
  const source = readClientSource('components/tree-list/bookmark-toolbar.jsx')

  assert.match(source, /onNewBookmark/)
  assert.match(source, /onNewBookmarkGroup/)
  assert.match(source, /handleToggleEdit/)
  assert.match(source, /bookmarkSelectMode = true/)
  assert.match(source, /beforeBookmarkUpload/)
  assert.match(source, /createBookmarkBackup/)
  assert.match(source, /createEncryptedBookmarkBackup/)
  assert.match(source, /includeCredentials:\s*false/)
  assert.match(source, /download\('aigshell-bookmarks-backup-/)
  assert.match(source, /download\('aigshell-bookmarks-no-credentials-/)
  assert.match(source, /download\('aigshell-bookmarks-encrypted-/)
  assert.match(source, /onSshConfigs/)
})

test('bookmark form renders new and edit server modes', () => {
  const source = readClientSource('components/bookmark-form/index.jsx')

  assert.match(source, /const isNew = id\.startsWith\(newBookmarkIdPrefix\)/)
  assert.match(source, /\(\(!isNew \? e\('edit'\) : e\('new'\)\) \+ ' ' \+ e\(settingMap\.bookmarks\)\)/)
  assert.match(source, /renderTypes\(bookmarkType,\s*isNew,\s*keys\)/)
  assert.match(source, /renderForm\(bookmarkType,\s*this\.props\)/)
  assert.match(source, /AIBookmarkForm/)
})

test('tree list creates bookmark groups and sub groups through store operations', () => {
  const source = readClientSource('components/tree-list/tree-list.jsx')

  const newBookmarkStart = source.indexOf('handleNewBookmark = () => {')
  const submitStart = source.indexOf('handleSubmit = () => {')
  const submitSubStart = source.indexOf('handleSubmitSub = () => {')
  const addSubCatStart = source.indexOf('addSubCat = (e, item) => {')
  const openAllStart = source.indexOf('openAll = (item) => {')

  assert.notEqual(newBookmarkStart, -1)
  assert.notEqual(submitStart, -1)
  assert.notEqual(submitSubStart, -1)
  assert.notEqual(addSubCatStart, -1)
  assert.notEqual(openAllStart, -1)

  const newBookmarkBody = source.slice(newBookmarkStart, submitStart)
  const submitBody = source.slice(submitStart, submitSubStart)
  const submitSubBody = source.slice(submitSubStart, addSubCatStart)
  const addSubBody = source.slice(addSubCatStart, openAllStart)

  assert.match(newBookmarkBody, /this\.props\.onClickItem\(getInitItem\(\[\],\s*settingMap\.bookmarks\)\)/)
  assert.match(submitBody, /const newGroup = \{[\s\S]*id: uid\(\)[\s\S]*title: this\.state\.bookmarkGroupTitle[\s\S]*bookmarkIds: \[\]/)
  assert.match(submitBody, /window\.store\.addBookmarkGroup\(newGroup\)/)
  assert.match(submitSubBody, /const newCat = \{[\s\S]*id: uid\(\)[\s\S]*level: 2[\s\S]*bookmarkIds: \[\]/)
  assert.match(submitSubBody, /bookmarkGroups\.unshift\(newCat\)/)
  assert.match(submitSubBody, /cat\.bookmarkGroupIds = \[[\s\S]*newCat\.id[\s\S]*\]/)
  assert.match(addSubBody, /showNewBookmarkGroupForm: true/)
  assert.match(addSubBody, /parentId: item\.id/)
  assert.match(addSubBody, /window\.store\.expandedKeys\.push\(item\.id\)/)
})

test('tree list saves edited bookmark groups', () => {
  const source = readClientSource('components/tree-list/tree-list.jsx')
  const start = source.indexOf('handleSubmitEdit = () => {')
  const end = source.indexOf('onClick = () => {')
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.match(body, /const \{\s*categoryTitle,[\s\S]*categoryColor,[\s\S]*categoryId[\s\S]*\} = this\.state/)
  assert.match(body, /const \{ bookmarkGroups \} = window\.store/)
  assert.match(body, /const obj = bookmarkGroups\.find/)
  assert.match(body, /obj\.title = categoryTitle/)
  assert.match(body, /obj\.color = categoryColor/)
  assert.match(body, /categoryId: ''/)
})

test('bookmark settings page wires tree list and bookmark form together', () => {
  const source = readClientSource('components/setting-panel/tab-bookmarks.jsx')

  assert.match(source, /settingTab !== settingMap\.bookmarks/)
  assert.match(source, /<TreeList[\s\S]*\{\.\.\.treeProps\}[\s\S]*\/>/)
  assert.match(source, /<BookmarkForm[\s\S]*key=\{settingItem\.id\}[\s\S]*\{\.\.\.formProps\}[\s\S]*\/>/)
})
