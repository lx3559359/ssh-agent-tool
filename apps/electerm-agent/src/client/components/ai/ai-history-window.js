export const AI_HISTORY_PAGE_SIZE = 24

export function clampAIHistoryWindow (visibleCount, total) {
  const length = Math.max(0, Number(total) || 0)
  if (!length) return 0
  const count = Number(visibleCount)
  if (!Number.isFinite(count) || count <= 0) {
    return Math.min(AI_HISTORY_PAGE_SIZE, length)
  }
  return Math.min(Math.max(1, Math.floor(count)), length)
}

export function getVisibleAIHistory (history = [], visibleCount = AI_HISTORY_PAGE_SIZE) {
  const list = Array.isArray(history) ? history : []
  const count = clampAIHistoryWindow(visibleCount, list.length)
  return count ? list.slice(-count) : []
}

export function expandAIHistoryWindow (
  visibleCount,
  total,
  pageSize = AI_HISTORY_PAGE_SIZE
) {
  const current = clampAIHistoryWindow(visibleCount, total)
  const size = Math.max(1, Number(pageSize) || AI_HISTORY_PAGE_SIZE)
  return Math.min(Math.max(0, Number(total) || 0), current + size)
}
