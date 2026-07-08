export function removeBookmarkIdFromGroups (bookmarkGroups = [], bookmarkId) {
  if (!bookmarkId) {
    return bookmarkGroups
  }

  for (const group of bookmarkGroups) {
    if (Array.isArray(group.bookmarkIds)) {
      group.bookmarkIds = group.bookmarkIds.filter(id => id !== bookmarkId)
    }
  }

  return bookmarkGroups
}
