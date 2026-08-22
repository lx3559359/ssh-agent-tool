export function collectFolderTransferResults (files, settledResults) {
  const items = []
  const failed = []
  let completedBytes = 0

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const result = settledResults[index]
    const size = Math.max(0, Number(file?.size) || 0)
    if (result?.status === 'fulfilled') {
      completedBytes += Math.max(0, Number(result.value) || size)
      items.push({
        name: String(file?.name || ''),
        size,
        status: 'completed'
      })
      continue
    }
    const error = result?.reason instanceof Error
      ? result.reason
      : new Error(String(result?.reason || '传输失败'))
    items.push({
      name: String(file?.name || ''),
      size,
      status: 'failed',
      error: error.message
    })
    failed.push({ file, error })
  }

  return { items, completedBytes, failed }
}

export function createSkippedFolderResults (skipped = []) {
  return skipped.map(item => {
    const relativePath = String(item?.relativePath || '')
    const name = relativePath.split('/').filter(Boolean).pop() || relativePath
    return {
      name,
      relativePath,
      size: 0,
      status: 'skipped',
      error: String(item?.code || '')
    }
  })
}
