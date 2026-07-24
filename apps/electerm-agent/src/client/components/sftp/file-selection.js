export function getFileSelectionKey (file = {}) {
  return [
    file.type || '',
    file.path || '',
    file.name || ''
  ].join('\u0000')
}

export function reconcileSelectedFileIds (
  previousFiles = [],
  nextFiles = [],
  selectedIds = new Set()
) {
  const ids = selectedIds instanceof Set
    ? selectedIds
    : new Set(selectedIds || [])
  if (!ids.size) {
    return new Set()
  }

  const selectedKeys = new Set(
    previousFiles
      .filter(file => ids.has(file.id))
      .map(getFileSelectionKey)
  )

  return new Set(
    nextFiles
      .filter(file => selectedKeys.has(getFileSelectionKey(file)))
      .map(file => file.id)
  )
}
