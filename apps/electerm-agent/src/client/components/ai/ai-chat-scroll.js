const DEFAULT_BOTTOM_THRESHOLD = 48

export function isAIHistoryNearBottom (element = {}, threshold = DEFAULT_BOTTOM_THRESHOLD) {
  const scrollTop = Number(element.scrollTop) || 0
  const clientHeight = Number(element.clientHeight) || 0
  const scrollHeight = Number(element.scrollHeight) || 0
  return scrollHeight - scrollTop - clientHeight <= threshold
}
