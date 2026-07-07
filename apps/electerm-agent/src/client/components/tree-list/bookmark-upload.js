/**
 * bookmark import/upload logic
 */

import copy from 'json-deep-copy'
import { uniq, isPlainObject } from 'lodash-es'
import { action } from 'manate'
import uid from '../../common/uid'
import time from '../../common/time'
import { fixBookmarks } from '../../common/db-fix'
import delay from '../../common/wait'
import { parseBookmarkBackup } from '../../common/bookmark-backup'
import message from '../common/message'
import { runBookmarkUploadWithWatchers } from './bookmark-upload-guard'

function fixBookmarksId (bookmarks) {
  return bookmarks.map(item => {
    if (!isPlainObject(item)) {
      return null
    }
    if (!item.id) {
      item.id = uid()
    }
    return item
  }).filter(Boolean)
}
export const bookmarkUpload = action(async (file) => {
  const { store } = window
  const { bookmarks, bookmarkGroups } = store

  const txt = file.fileContent !== undefined
    ? file.fileContent
    : await window.fs.readFile(file.filePath)

  const content = parseBookmarkBackup(txt)
  let bookmarkGroups1 = content.bookmarkGroups || []
  const bookmarks1 = fixBookmarksId(content.bookmarks || [])
  if (!bookmarkGroups1.length && bookmarks1.length) {
    bookmarkGroups1 = [{
      id: uid(),
      title: 'imported_' + time(),
      color: '#0088cc',
      bookmarkGroupIds: [],
      bookmarkIds: bookmarks1.map(b => b.id)
    }]
  }

  const bookmarkGroups0 = copy(bookmarkGroups)
  const bookmarks0 = copy(bookmarks)

  const bmTree = new Map(
    bookmarks0.map(bookmark => [bookmark.id, bookmark])
  )
  const bmgTree = new Map(
    bookmarkGroups0.map(group => [group.id, group])
  )

  const fixed = fixBookmarks(bookmarks1)

  fixed.forEach(bg => {
    if (!bmTree.has(bg.id)) {
      store.bookmarks.push(bg)
    }
  })

  bookmarkGroups1.forEach(bg => {
    if (!bmgTree.has(bg.id)) {
      store.bookmarkGroups.push(bg)
    } else {
      const bg1 = store.bookmarkGroups.find(
        b => b.id === bg.id
      )
      bg1.bookmarkIds = uniq(
        [
          ...(bg1.bookmarkIds || []),
          ...(bg.bookmarkIds || [])
        ]
      )
      bg1.bookmarkGroupIds = uniq(
        [
          ...(bg1.bookmarkGroupIds || []),
          ...(bg.bookmarkGroupIds || [])
        ]
      )
    }
  })

  store.fixBookmarkGroups()

  return false
})

export async function beforeBookmarkUpload (file) {
  const names = [
    'bookmarks',
    'bookmarkGroups'
  ]
  return runBookmarkUploadWithWatchers({
    file,
    upload: bookmarkUpload,
    watchers: names.map(name => window[`watch${name}`]),
    showError: (content) => message.error(content),
    waitAfterUpload: () => delay(1000)
  })
}
