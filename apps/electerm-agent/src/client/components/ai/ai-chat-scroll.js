const DEFAULT_BOTTOM_THRESHOLD = 48

function getItemSignature (item = {}) {
  const prompt = String(item.displayPrompt || item.prompt || '')
  const response = String(item.response || '')
  return [
    item.id || '',
    prompt.length,
    prompt.slice(-32),
    response.length,
    response.slice(-32),
    item.completionStatus || ''
  ].join('|')
}

export function isAIHistoryNearBottom (element = {}, threshold = DEFAULT_BOTTOM_THRESHOLD) {
  const scrollTop = Number(element.scrollTop) || 0
  const clientHeight = Number(element.clientHeight) || 0
  const scrollHeight = Number(element.scrollHeight) || 0
  return scrollHeight - scrollTop - clientHeight <= threshold
}

export function createAIHistorySnapshot (history = []) {
  return (Array.isArray(history) ? history : [])
    .filter(item => item?.id)
    .map(item => ({
      id: String(item.id),
      signature: typeof item.signature === 'string'
        ? item.signature
        : getItemSignature(item)
    }))
}

export function getAIHistoryChangedItemIds (previous = [], next = []) {
  const previousSignatures = new Map(
    createAIHistorySnapshot(previous).map(item => [item.id, item.signature])
  )
  return createAIHistorySnapshot(next)
    .filter(item => previousSignatures.get(item.id) !== item.signature)
    .map(item => item.id)
}

export function mergeUnreadAIHistoryIds (current = [], changed = [], isNearBottom = false) {
  if (isNearBottom) return []
  return [...new Set([
    ...(Array.isArray(current) ? current : []),
    ...(Array.isArray(changed) ? changed : [])
  ].filter(Boolean))]
}
