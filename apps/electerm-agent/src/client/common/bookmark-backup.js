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
  const content = typeof text === 'string' ? JSON.parse(text) : text

  if (Array.isArray(content)) {
    return {
      bookmarks: content,
      bookmarkGroups: []
    }
  }

  if (content?.format === bookmarkBackupFormat && content?.data) {
    return {
      bookmarks: content.data.bookmarks || [],
      bookmarkGroups: content.data.bookmarkGroups || []
    }
  }

  return {
    bookmarks: content?.bookmarks || [],
    bookmarkGroups: content?.bookmarkGroups || []
  }
}
