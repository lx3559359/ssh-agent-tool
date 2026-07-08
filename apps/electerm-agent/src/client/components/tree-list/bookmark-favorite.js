export function isBookmarkFavorite (bookmark) {
  return Boolean(bookmark?.favorite || bookmark?.isFavorite)
}

export function toggleBookmarkFavorite (bookmark) {
  return {
    ...bookmark,
    favorite: !isBookmarkFavorite(bookmark)
  }
}
