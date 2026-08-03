import { buildAgentCancellationUpdate } from './agent-cancellation-status.js'
import { sanitizeAIStoredText } from './ai-request-credentials.js'
import {
  cancelAIChatEntryLifecycle,
  getAIChatHistoryForScope,
  getAIChatRequestId,
  getAIChatStreamSessionId,
  updateAIChatHistoryEntry
} from './ai-chat-actions.js'

const activeStatuses = new Set(['pending', 'running', 'stopping'])
const cancellations = new Map()

function isActiveRun (item = {}) {
  return item.pending === true || activeStatuses.has(item.completionStatus)
}

function currentEntry (store, id) {
  return store?.aiChatHistory?.find(item => item?.id === id) || null
}

export function getActiveScopedAIChatRun (history, scopeId) {
  const active = getAIChatHistoryForScope(history, scopeId)
    .filter(isActiveRun)
  return active.at(-1) || null
}

async function settleOperations (operations) {
  const results = await Promise.allSettled(operations)
  return results.find(result => result.status === 'rejected')?.reason
}

async function cancelRunOnce ({
  store,
  item,
  cancelAgent,
  cancelDetachedStream,
  cancelRequest,
  recordQualityEvent,
  stopStream,
  stoppedText = 'Stopped by user'
} = {}) {
  const id = String(item?.id || '')
  const current = currentEntry(store, id)
  if (!current || !isActiveRun(current)) {
    return { cancelled: false, reason: 'inactive' }
  }

  const requestId = getAIChatRequestId(current, store)
  const sessionId = getAIChatStreamSessionId(current, store)
  updateAIChatHistoryEntry(store, id, {
    pending: false,
    completionStatus: 'stopping',
    ...(current.mode === 'agent'
      ? {
          runState: {
            status: 'cancelling',
            phase: 'cancelling',
            terminationReason: '',
            errorCode: ''
          }
        }
      : {})
  })

  let cancellationError
  if (current.mode === 'agent') {
    try {
      await cancelAgent?.(id)
    } catch (error) {
      cancellationError = error
    }
  } else {
    cancelDetachedStream?.(id)
    const operations = []
    if (requestId && cancelRequest) {
      operations.push(Promise.resolve().then(() => cancelRequest(requestId)))
    }
    if (sessionId && stopStream) {
      operations.push(Promise.resolve().then(() => stopStream(sessionId)))
    }
    cancellationError = await settleOperations(operations)
  }

  const latest = currentEntry(store, id)
  if (!latest || latest.completionStatus === 'completed') {
    return { cancelled: false, reason: 'completed' }
  }
  if (!isActiveRun(latest)) {
    return {
      cancelled: latest.completionStatus === 'cancelled',
      reason: latest.completionStatus
    }
  }

  cancelAIChatEntryLifecycle(store, latest, { recordQualityEvent })
  const finalEntry = currentEntry(store, id) || latest
  updateAIChatHistoryEntry(store, id, {
    ...buildAgentCancellationUpdate({
      response: finalEntry.response,
      stoppedText,
      error: cancellationError && sanitizeAIStoredText(
        cancellationError?.message || cancellationError
      )
    }),
    ...(current.mode === 'agent'
      ? {
          runState: {
            status: cancellationError ? 'cancel_failed' : 'cancelled',
            phase: cancellationError ? 'cancel_failed' : 'cancelled',
            terminationReason: cancellationError ? 'cancel_failed' : 'cancelled',
            errorCode: cancellationError
              ? String(cancellationError?.code || 'AGENT_CANCELLATION_FAILED')
              : ''
          }
        }
      : {})
  })

  return {
    cancelled: !cancellationError,
    reason: cancellationError ? 'unconfirmed' : 'cancelled',
    error: cancellationError
  }
}

export function cancelScopedAIChatRun (options = {}) {
  const id = String(options.item?.id || '')
  if (!id) return Promise.resolve({ cancelled: false, reason: 'missing-run' })
  if (cancellations.has(id)) return cancellations.get(id)

  const cancellation = cancelRunOnce(options)
  cancellations.set(id, cancellation)
  const cleanup = () => {
    if (cancellations.get(id) === cancellation) {
      cancellations.delete(id)
    }
  }
  cancellation.then(cleanup, cleanup)
  return cancellation
}
