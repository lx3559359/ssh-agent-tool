export function removeCyclicBookmarkGroupIds (bookmarkGroups) {
  if (!Array.isArray(bookmarkGroups)) {
    return bookmarkGroups
  }
  const groupById = new Map(bookmarkGroups.map(group => [group.id, group]))
  const visit = (group, ancestors = new Set()) => {
    if (!group || !Array.isArray(group.bookmarkGroupIds)) {
      return
    }
    const nextAncestors = new Set([...ancestors, group.id])
    group.bookmarkGroupIds = group.bookmarkGroupIds.filter(id => {
      if (nextAncestors.has(id)) {
        return false
      }
      visit(groupById.get(id), nextAncestors)
      return true
    })
  }
  for (const group of bookmarkGroups) {
    visit(group)
  }
  return bookmarkGroups
}
