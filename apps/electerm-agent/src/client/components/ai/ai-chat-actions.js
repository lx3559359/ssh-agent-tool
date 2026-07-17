import { sanitizeAIChatHistory } from './ai-request-credentials.js'

const DEFAULT_ROLE = '你是中文 SSH 运维助手。'
const DEFAULT_LANGUAGE = '简体中文'

export function buildAIChatRole ({
  roleAI,
  languageAI,
  getLangName
} = {}) {
  const role = String(roleAI || '').trim() || DEFAULT_ROLE
  const lang = String(languageAI || '').trim() ||
    (typeof getLangName === 'function' ? getLangName() : '') ||
    DEFAULT_LANGUAGE
  return `${role}; 请使用${lang}回复`
}

export function getAIChatCopyText (item = {}) {
  const response = String(item.response || '').trim()
  return response || String(item.prompt || '')
}

export function createRetryChatEntry (item = {}, {
  id,
  timestamp
} = {}) {
  const safeItem = sanitizeAIChatHistory([item])[0] || {}
  return {
    ...safeItem,
    id,
    timestamp,
    retryOfId: safeItem.retryOfId || safeItem.id || item.id,
    retryOfTimestamp: safeItem.retryOfTimestamp || safeItem.timestamp || item.timestamp,
    response: '',
    pending: true,
    completionStatus: 'pending',
    isStreaming: false,
    sessionId: null,
    toolCalls: []
  }
}

function getAIChatScopeId (item = {}) {
  return String(item.conversationScopeId || item.sourceTabId || 'global')
}

export function getInterruptedAIChatUpdate (item = {}) {
  if (
    item.pending === true ||
    item.completionStatus !== 'running' ||
    item.sessionId
  ) {
    return null
  }
  const errorText = '**错误：** 上次请求因客户端退出或重启而中断，请重试。'
  const partial = String(item.response || '').trim()
  return {
    pending: false,
    completionStatus: 'failed',
    requestId: '',
    response: partial ? `${partial}\n\n${errorText}` : errorText
  }
}

function isLegacyAIChatEntry (item = {}) {
  return !item.conversationScopeId && !item.sourceTabId
}

export function getAIChatHistoryForScope (history, scopeId) {
  const scope = String(scopeId || 'global')
  return (Array.isArray(history) ? history : [])
    .filter(item => isLegacyAIChatEntry(item) || getAIChatScopeId(item) === scope)
}

export function adoptLegacyAIChatHistoryScope (store, scopeId) {
  if (!store) return false
  const scope = String(scopeId || 'global')
  if (scope === 'global') return false
  const history = Array.isArray(store.aiChatHistory) ? store.aiChatHistory : []
  let changed = false
  const next = history.map(item => {
    if (!isLegacyAIChatEntry(item)) return item
    changed = true
    const migrated = {
      ...item,
      conversationScopeId: scope,
      sourceTabId: scope
    }
    const hasStableAnswer = String(item.response || '').trim() &&
      !item.completionStatus &&
      item.pending !== true &&
      item.isStreaming !== true &&
      !item.sessionId &&
      !item.requestId
    if (hasStableAnswer) migrated.completionStatus = 'completed'
    return migrated
  })
  if (changed) store.aiChatHistory = sanitizeAIChatHistory(next)
  return changed
}

export function clearAIChatContext (store, scopeId) {
  if (!store) {
    return
  }
  if (scopeId === undefined) {
    store.aiChatHistory = []
    return
  }
  const scope = String(scopeId || 'global')
  store.aiChatHistory = (Array.isArray(store.aiChatHistory)
    ? store.aiChatHistory
    : []
  ).filter(item => getAIChatScopeId(item) !== scope)
}

export async function cancelAndClearAIChatContext (store, scopeId, {
  cancelAgent,
  cancelDetachedStream,
  cancelRequest,
  stopStream
} = {}) {
  if (!store) return { cancelled: 0, cleared: 0 }
  const history = Array.isArray(store.aiChatHistory) ? store.aiChatHistory : []
  const scope = scopeId === undefined ? null : String(scopeId || 'global')
  const targets = history.filter(item => scope === null || getAIChatScopeId(item) === scope)
  const active = targets.filter(isActiveAIChatEntry).map(item => ({
    ...item,
    requestId: getAIChatRequestId(item, store),
    sessionId: getAIChatStreamSessionId(item, store)
  }))

  for (const item of active) {
    updateAIChatHistoryEntry(store, item.id, {
      pending: false,
      completionStatus: 'cancelled',
      requestId: ''
    })
    cancelDetachedStream?.(item.id)
    if (item.mode === 'agent') cancelAgent?.(item.id)
  }

  const cancellations = []
  for (const item of active) {
    if (item.requestId && cancelRequest) {
      cancellations.push(Promise.resolve().then(() => cancelRequest(item.requestId)))
    }
    if (item.sessionId && stopStream) {
      cancellations.push(Promise.resolve().then(() => stopStream(item.sessionId)))
    }
  }
  const results = await Promise.allSettled(cancellations)
  for (const result of results) {
    if (result.status === 'rejected') store.onError?.(result.reason)
  }
  clearAIChatContext(store, scopeId)
  return { cancelled: active.length, cleared: targets.length }
}

export function updateAIChatHistoryEntry (
  store,
  id,
  updates = {},
  { sanitized = false } = {}
) {
  if (!store || !id || !updates || typeof updates !== 'object') {
    return false
  }
  const history = Array.isArray(store.aiChatHistory) ? store.aiChatHistory : []
  const index = history.findIndex(item => item.id === id)
  if (index === -1) {
    return false
  }
  const safeUpdates = sanitized
    ? updates
    : sanitizeAIChatHistory([updates])[0] || {}
  const next = [...history]
  next[index] = { ...history[index], ...safeUpdates }
  store.aiChatHistory = next
  return true
}

export function appendAIChatHistory (store, entry, maxHistory = 100) {
  if (!store || !entry) {
    return
  }
  const history = [
    ...(Array.isArray(store.aiChatHistory) ? store.aiChatHistory : []),
    entry
  ]
  const entryScope = getAIChatScopeId(entry)
  const matchingIndexes = history.reduce((indexes, item, index) => {
    if (getAIChatScopeId(item) === entryScope) indexes.push(index)
    return indexes
  }, [])
  const overflow = matchingIndexes.length - maxHistory
  let retainedHistory = history
  if (overflow > 0) {
    const removable = matchingIndexes.filter(index => (
      index !== history.length - 1 && !isActiveAIChatEntry(history[index])
    ))
    const removed = new Set(removable.slice(0, overflow))
    retainedHistory = history.filter((item, index) => !removed.has(index))
  }
  const globalLimit = Math.max(maxHistory, maxHistory * 5)
  const globalOverflow = retainedHistory.length - globalLimit
  if (globalOverflow > 0) {
    const removable = retainedHistory.reduce((indexes, item, index) => {
      if (!isActiveAIChatEntry(item)) indexes.push(index)
      return indexes
    }, [])
    const removed = new Set(removable.slice(0, globalOverflow))
    retainedHistory = retainedHistory.filter((item, index) => !removed.has(index))
  }
  store.aiChatHistory = sanitizeAIChatHistory(
    retainedHistory
  )
}

function isActiveAIChatEntry (item = {}) {
  return item.pending === true || ['pending', 'running'].includes(item.completionStatus)
}

export function getAIChatStreamSessionId (item = {}, store) {
  const latest = store?.aiChatHistory?.find(chat => chat.id === item.id)
  return latest?.sessionId || item.sessionId || ''
}

export function getAIChatRequestId (item = {}, store) {
  const latest = store?.aiChatHistory?.find(chat => chat.id === item.id)
  return latest?.requestId || item.requestId || ''
}
