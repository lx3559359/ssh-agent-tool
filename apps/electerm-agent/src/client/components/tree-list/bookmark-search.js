function normalizeKeyword (keyword = '') {
  return String(keyword).trim().toLowerCase()
}

function normalizeValue (value) {
  if (value === undefined || value === null) {
    return []
  }
  if (Array.isArray(value)) {
    return value.flatMap(normalizeValue)
  }
  return [String(value).toLowerCase()]
}

function matchesAnyField (values, keyword) {
  const lowerKeyword = normalizeKeyword(keyword)
  if (!lowerKeyword) {
    return true
  }
  return values
    .flatMap(normalizeValue)
    .some(value => value.includes(lowerKeyword))
}

export function bookmarkMatchesKeyword (bookmark, keyword) {
  if (!bookmark) {
    return false
  }
  return matchesAnyField([
    bookmark.title,
    bookmark.host,
    bookmark.hostname,
    bookmark.port,
    bookmark.username,
    bookmark.user,
    bookmark.description,
    bookmark.type,
    bookmark.url,
    bookmark.path,
    bookmark.startDirectory,
    bookmark.startDirectoryRemote,
    bookmark.startDirectoryLocal,
    bookmark.tags,
    bookmark.labels
  ], keyword)
}

export function groupMatchesKeyword (group, keyword) {
  if (!group) {
    return false
  }
  return matchesAnyField([
    group.title,
    group.description,
    group.name,
    group.tags,
    group.labels
  ], keyword)
}
