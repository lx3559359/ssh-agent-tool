import { sanitizeAIChatHistory } from './ai-request-credentials.js'
import { normalizeAIChatRole } from './ai-role.js'
import { normalizeTraceContext } from '../../common/quality/trace-context.js'
import { recordQualityEvent as writeQualityEvent } from '../../common/quality/quality-events.js'

const DEFAULT_LANGUAGE = '简体中文'

const TRACE_METADATA_FIELDS = [
  'traceContext',
  'operationId',
  'taskId',
  'requestId',
  'sessionId',
  'tabId',
  'module',
  'action'
]

const AGENT_RUN_STATE_TEXT_FIELDS = [
  'status',
  'phase',
  'terminationReason',
  'errorCode',
  'endpointFingerprint'
]
const AGENT_RUN_COUNTER_FIELDS = [
  'elapsedMs',
  'modelRequests',
  'toolCalls'
]
const MAX_AGENT_RUN_COUNTER = 2147483647

function normalizeAgentRunStateText (value) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, 64)
}

function normalizeAgentRunCounter (value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return 0
  return Math.min(MAX_AGENT_RUN_COUNTER, Math.floor(number))
}

export function normalizeAgentRunState (runState) {
  if (!runState || typeof runState !== 'object' || Array.isArray(runState)) {
    return undefined
  }
  const normalized = {}
  for (const field of AGENT_RUN_STATE_TEXT_FIELDS) {
    normalized[field] = normalizeAgentRunStateText(runState[field])
  }
  const sourceBudget = runState.budget &&
    typeof runState.budget === 'object' &&
    !Array.isArray(runState.budget)
    ? runState.budget
    : {}
  normalized.budget = Object.fromEntries(
    AGENT_RUN_COUNTER_FIELDS.map(field => [
      field,
      normalizeAgentRunCounter(sourceBudget[field])
    ])
  )
  return normalized
}

function mergeAgentRunState (current, update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) {
    return normalizeAgentRunState(update)
  }
  return normalizeAgentRunState({
    ...(current && typeof current === 'object' ? current : {}),
    ...update,
    budget: {
      ...(current?.budget && typeof current.budget === 'object'
        ? current.budget
        : {}),
      ...(update.budget && typeof update.budget === 'object'
        ? update.budget
        : {})
    }
  })
}

export function getAIChatTraceId (item = {}) {
  const candidates = [
    item.metadata?.traceId,
    item.traceId,
    item.traceContext?.traceId
  ]
  for (const traceId of candidates) {
    const normalized = normalizeTraceContext({ traceId }).traceId
    if (normalized) return normalized
  }
  return ''
}

function normalizeAIChatTraceStorage (item = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item
  const traceId = getAIChatTraceId(item)
  const hasTopLevelTrace = Object.hasOwn(item, 'traceId') ||
    Object.hasOwn(item, 'traceContext')
  const sourceMetadata = item.metadata &&
    typeof item.metadata === 'object' &&
    !Array.isArray(item.metadata)
    ? item.metadata
    : {}
  const metadata = { ...sourceMetadata }
  let metadataChanged = false
  for (const field of TRACE_METADATA_FIELDS) {
    if (Object.hasOwn(metadata, field)) {
      delete metadata[field]
      metadataChanged = true
    }
  }
  if (traceId) {
    if (metadata.traceId !== traceId) metadataChanged = true
    metadata.traceId = traceId
  } else if (Object.hasOwn(metadata, 'traceId')) {
    delete metadata.traceId
    metadataChanged = true
  }
  if (!hasTopLevelTrace && !metadataChanged) return item

  const normalized = { ...item }
  delete normalized.traceId
  delete normalized.traceContext
  if (Object.keys(metadata).length) {
    normalized.metadata = metadata
  } else {
    delete normalized.metadata
  }
  return normalized
}

function normalizeAIChatText (value) {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'object') {
    for (const field of ['content', 'text', 'message', 'value']) {
      if (typeof value[field] === 'string') return value[field]
    }
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return ''
}

function normalizeAIChatToolCall (toolCall, index) {
  if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
    return null
  }
  const normalized = {
    ...toolCall,
    id: normalizeAIChatText(toolCall.id) || `legacy-tool-${index}`,
    name: normalizeAIChatText(toolCall.name),
    status: normalizeAIChatText(toolCall.status) || 'failed',
    args: toolCall.args && typeof toolCall.args === 'object' && !Array.isArray(toolCall.args)
      ? toolCall.args
      : {},
    result: normalizeAIChatText(toolCall.result)
  }
  if (toolCall.presentation && typeof toolCall.presentation === 'object') {
    normalized.presentation = {
      ...toolCall.presentation,
      command: normalizeAIChatText(toolCall.presentation.command),
      target: normalizeAIChatText(toolCall.presentation.target),
      output: normalizeAIChatText(toolCall.presentation.output),
      error: normalizeAIChatText(toolCall.presentation.error)
    }
  } else {
    delete normalized.presentation
  }
  return normalized
}

export function normalizeAIChatHistoryItem (item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const id = normalizeAIChatText(item.id)
  if (!id) return null
  const normalized = {
    ...item,
    id,
    prompt: normalizeAIChatText(item.prompt),
    displayPrompt: normalizeAIChatText(item.displayPrompt),
    response: normalizeAIChatText(item.response),
    toolCalls: (Array.isArray(item.toolCalls) ? item.toolCalls : [])
      .map(normalizeAIChatToolCall)
      .filter(Boolean),
    artifactIds: (Array.isArray(item.artifactIds) ? item.artifactIds : [])
      .map(normalizeAIChatText)
      .filter(Boolean)
  }
  if (Object.hasOwn(item, 'runState')) {
    const runState = normalizeAgentRunState(item.runState)
    if (runState) normalized.runState = runState
    else delete normalized.runState
  }
  return normalizeAIChatTraceStorage(normalized)
}

function normalizeAIChatHistoryForStorage (history = []) {
  return sanitizeAIChatHistory(history)
    .map(normalizeAIChatHistoryItem)
    .filter(Boolean)
}

export function buildAIChatRole ({
  roleAI,
  languageAI,
  getLangName
} = {}) {
  const role = normalizeAIChatRole(roleAI)
  const lang = String(languageAI || '').trim() ||
    (typeof getLangName === 'function' ? getLangName() : '') ||
    DEFAULT_LANGUAGE
  const languagePrompt = `请使用${lang}回复`
  return role ? `${role}; ${languagePrompt}` : languagePrompt
}

export function getAIChatCopyText (item = {}) {
  const response = String(item.response || '').trim()
  return response || String(item.prompt || '')
}

export function createRetryChatEntry (item = {}, {
  id,
  timestamp
} = {}) {
  const safeItem = normalizeAIChatHistoryForStorage([item])[0] || {}
  const retry = {
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
  delete retry.runState
  return retry
}

function getAIChatScopeId (item = {}) {
  return String(item.conversationScopeId || item.sourceTabId || 'global')
}

export function getInterruptedAIChatUpdate (item = {}, {
  includeSession = false
} = {}) {
  if (
    item.pending === true ||
    !['running', 'stopping'].includes(item.completionStatus) ||
    (!includeSession && item.sessionId)
  ) {
    return null
  }
  const errorText = '**错误：** 上次请求因客户端退出或重启而中断，请重试。'
  const partial = String(item.response || '').trim()
  const update = {
    pending: false,
    completionStatus: 'failed',
    requestId: '',
    response: partial ? `${partial}\n\n${errorText}` : errorText
  }
  if (item.mode === 'agent' && item.runState) {
    update.runState = {
      status: 'failed',
      phase: 'interrupted',
      terminationReason: 'interrupted',
      errorCode: 'AGENT_RUN_INTERRUPTED'
    }
  }
  if (includeSession) {
    update.sessionId = null
    update.isStreaming = false
  }
  return update
}

export function recoverInterruptedAIChatEntry (store, item = {}, {
  recordQualityEvent = writeQualityEvent,
  includeSession = false
} = {}) {
  if (!store || !item?.id) return false
  const current = store.aiChatHistory?.find(entry => entry?.id === item.id) || item
  const interruptedUpdate = getInterruptedAIChatUpdate(current, {
    includeSession
  })
  if (!interruptedUpdate) return false
  const traceId = getAIChatTraceId(current)
  const agent = current.mode === 'agent'
  const context = normalizeTraceContext({
    traceId,
    ...(agent
      ? { taskId: String(current.id) }
      : { requestId: current.requestId }),
    sessionId: current.sessionId,
    module: 'ai',
    action: agent ? 'agent' : 'chat'
  })
  if (!updateAIChatHistoryEntry(store, current.id, interruptedUpdate)) {
    return false
  }
  if (context.traceId) {
    try {
      Promise.resolve(recordQualityEvent(context, {
        module: 'ai',
        action: agent ? 'agent' : 'chat',
        phase: 'interrupted',
        result: 'interrupted'
      })).catch(() => {})
    } catch {}
  }
  return true
}

export function normalizeAIChatHistoryOnStartup (history = [], options = {}) {
  const store = {
    aiChatHistory: normalizeAIChatHistoryForStorage(history)
  }
  for (const item of [...store.aiChatHistory]) {
    recoverInterruptedAIChatEntry(store, item, {
      ...options,
      includeSession: true
    })
  }
  return store.aiChatHistory
}

function isLegacyAIChatEntry (item = {}) {
  return !item.conversationScopeId && !item.sourceTabId
}

export function getAIChatHistoryForScope (history, scopeId) {
  const scope = String(scopeId || 'global')
  return normalizeAIChatHistoryForStorage(history)
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
  if (changed) store.aiChatHistory = normalizeAIChatHistoryForStorage(next)
  return changed
}

export function cancelAIChatEntryLifecycle (store, item = {}, {
  recordQualityEvent = writeQualityEvent
} = {}) {
  if (!store || !item?.id) return false
  const current = store.aiChatHistory?.find(entry => entry?.id === item.id)
  if (!current || !isActiveAIChatEntry(current)) return false
  const traceId = getAIChatTraceId(current)
  const agent = current.mode === 'agent'
  const requestId = getAIChatRequestId(current, store)
  const sessionId = getAIChatStreamSessionId(current, store)
  const context = normalizeTraceContext({
    traceId,
    ...(agent
      ? { taskId: String(current.id) }
      : requestId ? { requestId } : {}),
    ...(sessionId ? { sessionId } : {}),
    module: 'ai',
    action: agent ? 'agent' : 'chat'
  })
  if (!updateAIChatHistoryEntry(store, current.id, {
    pending: false,
    completionStatus: 'cancelled',
    requestId: ''
  })) {
    return false
  }
  if (context.traceId) {
    try {
      Promise.resolve(recordQualityEvent(context, {
        module: 'ai',
        action: agent ? 'agent' : 'chat',
        phase: 'cancelled',
        result: 'cancelled'
      })).catch(() => {})
    } catch {}
  }
  return true
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
  )
    .filter(item => getAIChatScopeId(item) !== scope)
    .map(normalizeAIChatTraceStorage)
}

export async function cancelAndClearAIChatContext (store, scopeId, {
  cancelAgent,
  cancelDetachedStream,
  cancelRequest,
  recordQualityEvent = writeQualityEvent,
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
    cancelAIChatEntryLifecycle(store, item, { recordQualityEvent })
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
  const index = history.findIndex(item => item?.id === id)
  if (index === -1) {
    return false
  }
  const safeUpdates = sanitized
    ? updates
    : sanitizeAIChatHistory([updates])[0] || {}
  const next = [...history]
  const merged = { ...history[index], ...safeUpdates }
  if (Object.hasOwn(safeUpdates, 'runState')) {
    const runState = mergeAgentRunState(history[index].runState, safeUpdates.runState)
    if (runState) merged.runState = runState
    else delete merged.runState
  }
  if (history[index].metadata || safeUpdates.metadata) {
    merged.metadata = {
      ...(history[index].metadata || {}),
      ...(safeUpdates.metadata || {})
    }
  }
  next[index] = normalizeAIChatHistoryItem(merged)
  store.aiChatHistory = next.map(normalizeAIChatTraceStorage)
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
  store.aiChatHistory = normalizeAIChatHistoryForStorage(retainedHistory)
}

function isActiveAIChatEntry (item = {}) {
  return item.pending === true ||
    ['pending', 'running', 'stopping'].includes(item.completionStatus)
}

export function getAIChatStreamSessionId (item = {}, store) {
  const latest = store?.aiChatHistory?.find(chat => chat?.id === item.id)
  return latest?.sessionId || item.sessionId || ''
}

export function getAIChatRequestId (item = {}, store) {
  const latest = store?.aiChatHistory?.find(chat => chat?.id === item.id)
  return latest?.requestId || item.requestId || ''
}
