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
