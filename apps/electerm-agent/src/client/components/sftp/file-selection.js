export function getFileSelectionKey (file = {}) {
  return [
    file.type || '',
    file.path || '',
    file.name || ''
  ].join('\u0000')
}

export function nextSftpSelectionId (
  fileList = [],
  selectedIds = new Set(),
  direction = 'next',
  currentId
) {
  if (!fileList.length) return undefined
  const selected = selectedIds instanceof Set
    ? selectedIds
    : new Set(selectedIds || [])
  const focusedIndex = currentId === undefined
    ? -1
    : fileList.findIndex(file => file.id === currentId)
  const selectedIndices = [...selected]
    .map(id => fileList.findIndex(file => file.id === id))
    .filter(index => index >= 0)
    .sort((left, right) => left - right)
  const baseIndex = focusedIndex >= 0
    ? focusedIndex
    : direction === 'previous'
      ? selectedIndices[0]
      : selectedIndices.at(-1)
  if (baseIndex === undefined) return fileList[0].id
  const offset = direction === 'previous' ? -1 : 1
  const nextIndex = (baseIndex + offset + fileList.length) % fileList.length
  return fileList[nextIndex]?.id
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
