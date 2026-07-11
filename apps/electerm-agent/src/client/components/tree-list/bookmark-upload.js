/**
 * bookmark import/upload logic
 */

import { isPlainObject } from 'lodash-es'
import { action } from 'manate'
import uid from '../../common/uid'
import time from '../../common/time'
import { fixBookmarks } from '../../common/db-fix'
import delay from '../../common/wait'
import { parseBookmarkBackupForImport } from '../../common/bookmark-backup'
import {
  bookmarkImportStrategies,
  buildBookmarkImportPlan,
  formatBookmarkImportReport
} from '../../common/bookmark-import-plan'
import message from '../common/message'
import { runBookmarkUploadWithWatchers } from './bookmark-upload-guard'
import { requestBookmarkImportStrategy } from './bookmark-import-strategy-dialog'

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

  const content = await parseBookmarkBackupForImport(txt, {
    requestPassphrase: async () => window.prompt('请输入备份加密密码')
  })
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

  const fixed = fixBookmarks(bookmarks1)
  const planOptions = {
    localBookmarks: bookmarks,
    localBookmarkGroups: bookmarkGroups,
    incomingBookmarks: fixed,
    incomingBookmarkGroups: bookmarkGroups1,
    idFactory: () => uid()
  }
  const preview = buildBookmarkImportPlan({
    ...planOptions,
    strategy: bookmarkImportStrategies.keepLocal
  })
  let strategy = bookmarkImportStrategies.keepLocal
  if (preview.report.conflicts.length) {
    strategy = await requestBookmarkImportStrategy({
      conflictCount: preview.report.conflicts.length
    })
    if (!strategy) {
      message.info('已取消导入，现有连接未发生变化')
      return false
    }
  }
  const plan = buildBookmarkImportPlan({
    ...planOptions,
    strategy
  })

  store.bookmarks.splice(0, store.bookmarks.length, ...plan.bookmarks)
  store.bookmarkGroups.splice(0, store.bookmarkGroups.length, ...plan.bookmarkGroups)

  store.fixBookmarkGroups()
  message.success(`导入完成：${formatBookmarkImportReport(plan.report)}`)

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
