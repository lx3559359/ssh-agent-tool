function unique (items = []) {
  return [...new Set(items.filter(Boolean))]
}

function errorWithCode (message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function requireGroup (groups, groupId, defaultGroupId) {
  return groups.find(group => group.id === groupId) ||
    groups.find(group => group.id === defaultGroupId) ||
    null
}

export function cloneBookmarkMembership (groups = []) {
  return groups.map(group => ({
    id: group.id,
    bookmarkIds: [...(group.bookmarkIds || [])],
    bookmarkGroupIds: [...(group.bookmarkGroupIds || [])]
  }))
}

export function restoreBookmarkMembership (groups = [], snapshot = []) {
  for (const group of groups) {
    const before = snapshot.find(item => item.id === group.id)
    if (!before) continue
    group.bookmarkIds = [...before.bookmarkIds]
    group.bookmarkGroupIds = [...before.bookmarkGroupIds]
  }
}

export function assignBookmarkToGroup (
  groups = [],
  bookmarkId,
  groupId,
  defaultGroupId = 'default'
) {
  if (!bookmarkId) {
    throw errorWithCode('Bookmark id is required', 'BOOKMARK_ID_REQUIRED')
  }
  const target = requireGroup(groups, groupId, defaultGroupId)
  if (!target) {
    throw errorWithCode('Bookmark group does not exist', 'GROUP_NOT_FOUND')
  }
  let changed = false
  for (const group of groups) {
    const before = group.bookmarkIds || []
    const next = before.filter(id => id !== bookmarkId)
    if (next.length !== before.length) changed = true
    group.bookmarkIds = next
  }
  const nextTarget = unique([...(target.bookmarkIds || []), bookmarkId])
  if (!target.bookmarkIds?.includes(bookmarkId)) changed = true
  target.bookmarkIds = nextTarget
  return { groupId: target.id, changed }
}

export function moveBookmarksToGroup (
  groups = [],
  bookmarkIds = [],
  groupId,
  defaultGroupId = 'default'
) {
  const snapshot = cloneBookmarkMembership(groups)
  try {
    const moved = unique(bookmarkIds).map(bookmarkId =>
      assignBookmarkToGroup(groups, bookmarkId, groupId, defaultGroupId)
    )
    return {
      groupId: moved[0]?.groupId || groupId,
      moved: moved.length
    }
  } catch (error) {
    restoreBookmarkMembership(groups, snapshot)
    throw error
  }
}

export function repairBookmarkMembership (
  bookmarks = [],
  groups = [],
  defaultGroupId = 'default'
) {
  const counters = {
    duplicateMembershipsRemoved: 0,
    staleBookmarkReferencesRemoved: 0,
    staleGroupReferencesRemoved: 0,
    straysAssigned: 0
  }
  const bookmarkIds = new Set(bookmarks.map(item => item.id))
  const groupIds = new Set(groups.map(item => item.id))
  const assigned = new Set()

  for (const group of groups) {
    const validBookmarks = []
    for (const id of unique(group.bookmarkIds)) {
      if (!bookmarkIds.has(id)) {
        counters.staleBookmarkReferencesRemoved++
      } else if (assigned.has(id)) {
        counters.duplicateMembershipsRemoved++
      } else {
        assigned.add(id)
        validBookmarks.push(id)
      }
    }
    group.bookmarkIds = validBookmarks
    const beforeChildren = unique(group.bookmarkGroupIds)
    group.bookmarkGroupIds = beforeChildren.filter(id =>
      id !== group.id && groupIds.has(id)
    )
    counters.staleGroupReferencesRemoved +=
      beforeChildren.length - group.bookmarkGroupIds.length
  }

  const target = requireGroup(groups, defaultGroupId, defaultGroupId)
  if (target) {
    for (const id of bookmarkIds) {
      if (!assigned.has(id)) {
        target.bookmarkIds.push(id)
        counters.straysAssigned++
      }
    }
    target.bookmarkIds = unique(target.bookmarkIds)
  }
  return counters
}

export function createBookmarkGroupInParent (groups = [], input = {}) {
  const title = String(input.title || '').trim()
  if (!title) {
    throw errorWithCode('Group title is required', 'GROUP_TITLE_REQUIRED')
  }
  const parent = input.parentId
    ? groups.find(group => group.id === input.parentId)
    : null
  if (input.parentId && !parent) {
    throw errorWithCode(
      'Parent group does not exist',
      'PARENT_GROUP_NOT_FOUND'
    )
  }
  const siblingIds = new Set(parent?.bookmarkGroupIds || [])
  const duplicate = groups.some(group =>
    group.title === title &&
    (parent
      ? siblingIds.has(group.id)
      : !groups.some(item =>
          (item.bookmarkGroupIds || []).includes(group.id)
        )
    )
  )
  if (duplicate) {
    throw errorWithCode(
      'Duplicate group title',
      'DUPLICATE_GROUP_TITLE'
    )
  }
  const group = {
    id: input.id,
    title,
    bookmarkIds: [],
    bookmarkGroupIds: [],
    color: input.color
  }
  if (parent) {
    group.level = (parent.level || 1) + 1
    parent.bookmarkGroupIds = unique([
      ...(parent.bookmarkGroupIds || []),
      group.id
    ])
  }
  groups.push(group)
  return group
}
