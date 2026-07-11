export const bookmarkSelectionDeleteConfirmText = '确认删除选中的连接和分组？所选连接将永久删除，分组内容会迁移到上级分组或默认分组。此操作不可撤销。'

function unique (items) {
  return [...new Set(items)]
}

export function deleteBookmarkGroupState (
  bookmarkGroups = [],
  groupId,
  defaultGroupId
) {
  if (!groupId || groupId === defaultGroupId) {
    return {
      deleted: false,
      parentGroupId: null
    }
  }

  const groupIndex = bookmarkGroups.findIndex(group => group.id === groupId)
  if (groupIndex === -1) {
    return {
      deleted: false,
      parentGroupId: null
    }
  }

  const deletedGroup = bookmarkGroups[groupIndex]
  const referencedParent = deletedGroup.level === 2
    ? bookmarkGroups.find(group =>
      group.id !== groupId &&
      (group.bookmarkGroupIds || []).includes(groupId)
    )
    : null
  const parentGroup = referencedParent || bookmarkGroups.find(
    group => group.id === defaultGroupId
  )

  if (!parentGroup || parentGroup.id === groupId) {
    return {
      deleted: false,
      parentGroupId: null
    }
  }

  for (const group of bookmarkGroups) {
    if (Array.isArray(group.bookmarkGroupIds)) {
      group.bookmarkGroupIds = group.bookmarkGroupIds.filter(
        id => id !== groupId
      )
    }
  }

  parentGroup.bookmarkIds = unique([
    ...(parentGroup.bookmarkIds || []),
    ...(deletedGroup.bookmarkIds || [])
  ])

  const existingGroupIds = new Set(bookmarkGroups.map(group => group.id))
  const childGroupIds = (deletedGroup.bookmarkGroupIds || []).filter(id =>
    id !== groupId &&
    id !== parentGroup.id &&
    existingGroupIds.has(id)
  )
  parentGroup.bookmarkGroupIds = unique([
    ...(parentGroup.bookmarkGroupIds || []),
    ...childGroupIds
  ])

  bookmarkGroups.splice(groupIndex, 1)

  return {
    deleted: true,
    parentGroupId: parentGroup.id
  }
}

export function deleteBookmarkSelection (
  store,
  selectedIds = [],
  defaultGroupId
) {
  const selected = new Set(selectedIds)
  const bookmarkIds = (store.bookmarks || [])
    .filter(bookmark => selected.has(bookmark.id))
    .map(bookmark => bookmark.id)
  const bookmarkGroupIds = (store.bookmarkGroups || [])
    .filter(group => group.id !== defaultGroupId && selected.has(group.id))
    .map(group => group.id)

  for (const id of bookmarkIds) {
    store.delBookmark({ id })
  }
  for (const id of bookmarkGroupIds) {
    store.delBookmarkGroup({ id })
  }

  return {
    bookmarkIds,
    bookmarkGroupIds
  }
}

export function confirmBookmarkSelectionDeletion (
  selectedIds = [],
  confirmDelete,
  deleteSelection
) {
  const ids = unique(selectedIds)
  if (!ids.length || !confirmDelete(bookmarkSelectionDeleteConfirmText)) {
    return false
  }
  deleteSelection(ids)
  return true
}
