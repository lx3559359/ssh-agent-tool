const contentByChatId = new Map()
const MAX_ENTRIES = 10
const ENTRY_TTL_MS = 30 * 60 * 1000

function pruneAIContentRegistry () {
  const now = Date.now()
  for (const [chatId, entry] of contentByChatId) {
    if (now - entry.createdAt > ENTRY_TTL_MS) {
      contentByChatId.delete(chatId)
    }
  }
  while (contentByChatId.size > MAX_ENTRIES) {
    contentByChatId.delete(contentByChatId.keys().next().value)
  }
}

export function registerAIContentParts (chatId, parts = []) {
  const id = String(chatId || '')
  const value = Array.isArray(parts) ? parts.filter(Boolean) : []
  if (!id || !value.length) return
  pruneAIContentRegistry()
  contentByChatId.set(id, {
    createdAt: Date.now(),
    parts: value
  })
}

export function getAIContentParts (chatId) {
  pruneAIContentRegistry()
  return contentByChatId.get(String(chatId || ''))?.parts || []
}

export function clearAIContentParts (chatId) {
  contentByChatId.delete(String(chatId || ''))
}

export function applyAIContentPartsToMessages (messages, chatId) {
  const parts = getAIContentParts(chatId)
  if (!parts.length) return messages
  const next = messages.map(message => ({ ...message }))
  for (let index = next.length - 1; index >= 0; index--) {
    if (next[index].role !== 'user') continue
    const text = String(next[index].content || '')
    next[index].content = [
      { type: 'text', text },
      ...parts
    ]
    break
  }
  return next
}
