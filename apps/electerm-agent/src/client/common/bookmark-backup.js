import copy from 'json-deep-copy'

export const bookmarkBackupFormat = 'AIGShell.bookmarks.backup'
export const bookmarkBackupFormatVersion = 1

const invalidJsonError = '备份文件内容不是有效的 JSON'
const noImportableBookmarksError = '备份文件中没有可导入的服务器连接'
const invalidBookmarkBackupShapeError = '备份文件中的服务器或分组格式不正确'

export function createBookmarkBackup ({
  bookmarks = [],
  bookmarkGroups = [],
  now = new Date().toISOString(),
  version = ''
} = {}) {
  return {
    format: bookmarkBackupFormat,
    formatVersion: bookmarkBackupFormatVersion,
    app: {
      name: 'AIGShell',
      version
    },
    exportedAt: now,
    data: {
      bookmarks: copy(bookmarks || []),
      bookmarkGroups: copy(bookmarkGroups || [])
    }
  }
}

function normalizeBookmarkBackupData (data) {
  if (!Array.isArray(data?.bookmarks) && !Array.isArray(data?.bookmarkGroups)) {
    throw new Error(noImportableBookmarksError)
  }
  if (
    (data.bookmarks !== undefined && !Array.isArray(data.bookmarks)) ||
    (data.bookmarkGroups !== undefined && !Array.isArray(data.bookmarkGroups))
  ) {
    throw new Error(invalidBookmarkBackupShapeError)
  }
  if (
    !isBackupItemList(data.bookmarks) ||
    !isBackupItemList(data.bookmarkGroups)
  ) {
    throw new Error(invalidBookmarkBackupShapeError)
  }
  return {
    bookmarks: data.bookmarks || [],
    bookmarkGroups: data.bookmarkGroups || []
  }
}

function isBackupItemList (items) {
  if (items === undefined) {
    return true
  }
  return items.every(item => {
    return item && typeof item === 'object' && !Array.isArray(item)
  })
}

export function parseBookmarkBackup (text) {
  let content
  try {
    content = typeof text === 'string' ? JSON.parse(text) : text
  } catch (_) {
    throw new Error(invalidJsonError)
  }

  if (Array.isArray(content)) {
    return {
      bookmarks: content,
      bookmarkGroups: []
    }
  }

  if (content?.format === bookmarkBackupFormat && content?.data) {
    return normalizeBookmarkBackupData(content.data)
  }

  return normalizeBookmarkBackupData(content)
}
