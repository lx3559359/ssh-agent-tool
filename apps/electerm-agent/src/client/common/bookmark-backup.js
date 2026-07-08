import copy from 'json-deep-copy'

export const bookmarkBackupFormat = 'AIGShell.bookmarks.backup'
export const bookmarkBackupFormatVersion = 1

const credentialKeys = new Set([
  'password',
  'privateKey',
  'passphrase',
  'certificate',
  'proxyPassword'
])

const invalidJsonError = '备份文件内容不是有效的 JSON'
const noImportableBookmarksError = '备份文件中没有可导入的服务器连接'
const invalidBookmarkBackupShapeError = '备份文件中的服务器或分组格式不正确'
const unsupportedBookmarkBackupVersionError = '备份文件版本过新，请升级 AIGShell 后再导入'

export function createBookmarkBackup ({
  bookmarks = [],
  bookmarkGroups = [],
  now = new Date().toISOString(),
  version = '',
  includeCredentials = true
} = {}) {
  const backupBookmarks = includeCredentials
    ? copy(bookmarks || [])
    : stripCredentials(bookmarks || [])
  return {
    format: bookmarkBackupFormat,
    formatVersion: bookmarkBackupFormatVersion,
    app: {
      name: 'AIGShell',
      version
    },
    exportedAt: now,
    data: {
      bookmarks: backupBookmarks,
      bookmarkGroups: copy(bookmarkGroups || [])
    }
  }
}

function sanitizeProxyUrl (value) {
  if (typeof value !== 'string' || !value.includes('@')) {
    return value
  }
  try {
    const url = new URL(value)
    url.password = ''
    return url.toString()
  } catch (_) {
    return value.replace(/:\/\/([^:@/]+):[^@/]*@/, '://$1@')
  }
}

function stripCredentials (value) {
  if (Array.isArray(value)) {
    return value.map(stripCredentials)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.keys(value).reduce((result, key) => {
    if (credentialKeys.has(key)) {
      return result
    }
    const nextValue = key === 'proxy'
      ? sanitizeProxyUrl(value[key])
      : stripCredentials(value[key])
    result[key] = nextValue
    return result
  }, {})
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
    !isBackupBookmarkList(data.bookmarks) ||
    !isBackupGroupList(data.bookmarkGroups) ||
    hasDuplicatedBackupId(data.bookmarks) ||
    hasDuplicatedBackupId(data.bookmarkGroups) ||
    hasDanglingBackupGroupRefs(data.bookmarks, data.bookmarkGroups) ||
    hasDangerousBackupKey(data.bookmarks) ||
    hasDangerousBackupKey(data.bookmarkGroups)
  ) {
    throw new Error(invalidBookmarkBackupShapeError)
  }
  if (!(data.bookmarks || []).length) {
    throw new Error(noImportableBookmarksError)
  }
  return {
    bookmarks: data.bookmarks || [],
    bookmarkGroups: data.bookmarkGroups || []
  }
}

function hasNonEmptyString (item, key) {
  return typeof item[key] === 'string' && Boolean(item[key].trim())
}

function hasOptionalStringArray (item, key) {
  if (item[key] === undefined) {
    return true
  }
  return Array.isArray(item[key]) &&
    item[key].every(value => typeof value === 'string' && Boolean(value.trim()))
}

function isPlainBackupObject (item) {
  return item &&
    typeof item === 'object' &&
    !Array.isArray(item)
}

function hasDuplicatedBackupId (items) {
  if (!Array.isArray(items)) {
    return false
  }
  const seen = new Set()
  return items.some(item => {
    if (!isPlainBackupObject(item) || !hasNonEmptyString(item, 'id')) {
      return false
    }
    const id = item.id.trim()
    if (seen.has(id)) {
      return true
    }
    seen.add(id)
    return false
  })
}

function buildBackupIdSet (items) {
  return new Set((items || [])
    .filter(item => isPlainBackupObject(item) && hasNonEmptyString(item, 'id'))
    .map(item => item.id.trim()))
}

function hasDanglingBackupGroupRefs (bookmarks, bookmarkGroups) {
  if (!Array.isArray(bookmarkGroups)) {
    return false
  }
  const bookmarkIds = buildBackupIdSet(bookmarks)
  const groupIds = buildBackupIdSet(bookmarkGroups)
  return bookmarkGroups.some(group => {
    return (group.bookmarkIds || []).some(id => !bookmarkIds.has(id.trim())) ||
      (group.bookmarkGroupIds || []).some(id => !groupIds.has(id.trim()))
  })
}

const dangerousBackupKeys = new Set([
  '__proto__',
  'constructor',
  'prototype'
])

function hasDangerousBackupKey (item) {
  if (!item || typeof item !== 'object') {
    return false
  }
  if (Array.isArray(item)) {
    return item.some(hasDangerousBackupKey)
  }
  return Object.keys(item).some(key => {
    return dangerousBackupKeys.has(key) ||
      hasDangerousBackupKey(item[key])
  })
}

function isBackupBookmarkList (items) {
  if (items === undefined) {
    return true
  }
  return items.every(item => {
    return (
      isPlainBackupObject(item) &&
      (
        hasNonEmptyString(item, 'id') ||
        hasNonEmptyString(item, 'host')
      )
    )
  })
}

function isBackupGroupList (items) {
  if (items === undefined) {
    return true
  }
  return items.every(item => {
    return (
      isPlainBackupObject(item) &&
      hasNonEmptyString(item, 'id') &&
      hasOptionalStringArray(item, 'bookmarkIds') &&
      hasOptionalStringArray(item, 'bookmarkGroupIds')
    )
  })
}

export function parseBookmarkBackup (text) {
  let content
  try {
    content = typeof text === 'string' ? JSON.parse(text.replace(/^\uFEFF/, '')) : text
  } catch (_) {
    throw new Error(invalidJsonError)
  }

  if (Array.isArray(content)) {
    return normalizeBookmarkBackupData({
      bookmarks: content,
      bookmarkGroups: []
    })
  }

  if (content?.format === bookmarkBackupFormat && content?.data) {
    if ((content.formatVersion || 1) > bookmarkBackupFormatVersion) {
      throw new Error(unsupportedBookmarkBackupVersionError)
    }
    return normalizeBookmarkBackupData(content.data)
  }

  return normalizeBookmarkBackupData(content)
}
