export function normalizeBookmarkGroupTitle (title) {
  return String(title || '').trim()
}

export function prepareBookmarkGroupCreation ({
  id,
  title,
  color,
  parentId,
  bookmarkGroups = []
}) {
  const normalizedTitle = normalizeBookmarkGroupTitle(title)
  if (!normalizedTitle) {
    return null
  }

  const group = {
    id,
    title: normalizedTitle,
    bookmarkIds: []
  }
  if (parentId) {
    group.level = 2
  }
  if (color) {
    group.color = color
  }

  if (parentId) {
    const parent = bookmarkGroups.find(group => group.id === parentId)
    if (!parent) {
      return null
    }
    const currentIds = Array.isArray(parent.bookmarkGroupIds)
      ? parent.bookmarkGroupIds
      : []
    const bookmarkGroupIds = currentIds.includes(id)
      ? [...currentIds]
      : [...currentIds, id]
    return {
      group,
      parent: { group: parent, bookmarkGroupIds }
    }
  }

  return { group, parent: null }
}

export function prepareBookmarkGroupEdit ({
  bookmarkGroups = [],
  id,
  title,
  color
}) {
  const normalizedTitle = normalizeBookmarkGroupTitle(title)
  if (!normalizedTitle) {
    return { status: 'invalid' }
  }

  const group = bookmarkGroups.find(item => item.id === id)
  if (!group) {
    return { status: 'missing' }
  }

  return {
    status: 'ready',
    group,
    title: normalizedTitle,
    color
  }
}
