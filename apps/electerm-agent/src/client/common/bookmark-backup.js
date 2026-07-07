import copy from 'json-deep-copy'

export const bookmarkBackupFormat = 'AIGShell.bookmarks.backup'
export const bookmarkBackupFormatVersion = 1

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

export function parseBookmarkBackup (text) {
  let content
  try {
    content = typeof text === 'string' ? JSON.parse(text) : text
  } catch (_) {
    throw new Error('备份文件内容不是有效的 JSON')
  }

  if (Array.isArray(content)) {
    return {
      bookmarks: content,
      bookmarkGroups: []
    }
  }

  if (content?.format === bookmarkBackupFormat && content?.data) {
    if (!Array.isArray(content.data.bookmarks) && !Array.isArray(content.data.bookmarkGroups)) {
      throw new Error('备份文件中没有可导入的服务器连接')
    }
    return {
      bookmarks: content.data.bookmarks || [],
      bookmarkGroups: content.data.bookmarkGroups || []
    }
  }

  if (!Array.isArray(content?.bookmarks) && !Array.isArray(content?.bookmarkGroups)) {
    throw new Error('备份文件中没有可导入的服务器连接')
  }

  return {
    bookmarks: content?.bookmarks || [],
    bookmarkGroups: content?.bookmarkGroups || []
  }
}
