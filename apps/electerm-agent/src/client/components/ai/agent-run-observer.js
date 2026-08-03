import { recordQualityEvent } from '../../common/quality/quality-events.js'
import { normalizeTraceContext } from '../../common/quality/trace-context.js'

const STABLE_FIELD_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]*$/

function stableField (value, fallback = undefined) {
  const text = typeof value === 'string' ? value.trim().slice(0, 64) : ''
  return text && STABLE_FIELD_PATTERN.test(text) ? text : fallback
}

function safeNow (now) {
  try {
    const value = Number(now())
    return Number.isFinite(value) && value >= 0 ? value : 0
  } catch (error) {
    return 0
  }
}

export function createAgentEndpointFingerprint ({ token } = {}) {
  const source = String(
    token || globalThis.crypto?.randomUUID?.() || Math.random()
  )
  let hash = 2166136261
  for (const character of source) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return 'endpoint-' + (hash >>> 0).toString(16).padStart(8, '0')
}

export function createAgentRunObserver ({
  context = {},
  token,
  now = Date.now,
  writeEvent = recordQualityEvent,
  reportError
} = {}) {
  const safeContext = normalizeTraceContext(context)
  const endpointFingerprint = createAgentEndpointFingerprint({ token })
  const startedAt = safeNow(now)
  let phase = 'created'
  let status = 'created'
  let modelRequests = 0
  let toolCalls = 0
  let terminal = false
  let started = false
  let writeFailureReported = false

  function reportWriteFailure () {
    if (writeFailureReported || typeof reportError !== 'function') return
    writeFailureReported = true
    const diagnostic = new Error('Agent observer write failed')
    diagnostic.code = 'AGENT_OBSERVER_WRITE_FAILED'
    try {
      Promise.resolve(reportError(diagnostic)).catch(() => false)
    } catch {
      return false
    }
  }

  function durationMs () {
    return Math.max(0, Math.round(safeNow(now) - startedAt))
  }

  function emit (event = {}) {
    const safeEvent = {
      module: 'agent',
      action: 'run',
      phase,
      status,
      endpointFingerprint,
      durationMs: durationMs(),
      modelRequests,
      toolCalls,
      ...event
    }
    try {
      Promise.resolve(writeEvent(safeContext, safeEvent)).then(
        accepted => {
          if (accepted === false) reportWriteFailure()
        },
        reportWriteFailure
      )
    } catch (error) {
      reportWriteFailure()
    }
    return safeEvent
  }

  function setPhase (nextPhase, nextStatus = 'running', event = {}) {
    if (terminal) return false
    phase = stableField(nextPhase, 'unknown')
    status = stableField(nextStatus, 'running')
    emit(event)
    return true
  }

  function start () {
    if (started || terminal) return false
    started = true
    return setPhase('started', 'running', { result: 'pending' })
  }

  function modelRequest () {
    if (terminal) return false
    modelRequests += 1
    return setPhase('model_request')
  }

  function toolCall () {
    if (terminal) return false
    toolCalls += 1
    return setPhase('tool_execution')
  }

  function metric (name, value) {
    if (terminal) return false
    const metric = stableField(name)
    const numericValue = Number(value)
    if (!metric || !Number.isFinite(numericValue) || numericValue < 0) {
      return false
    }
    emit({ metric, value: Math.round(numericValue) })
    return true
  }

  function budgetExceeded (error = {}) {
    return setPhase('budget_exceeded', 'failed', {
      result: 'failed',
      reasonCode: stableField(error.code, 'AGENT_BUDGET_EXCEEDED'),
      errorStage: 'budget',
      budgetType: stableField(error.budgetType, 'unknown')
    })
  }

  function cancellation (nextStatus, reasonCode) {
    const normalized = stableField(nextStatus, 'cancelling')
    return setPhase(normalized, normalized, {
      ...(normalized === 'cancel_failed'
        ? { errorStage: 'cancellation', result: 'failed' }
        : {}),
      ...(reasonCode
        ? { reasonCode: stableField(reasonCode, 'AGENT_CANCELLATION_FAILED') }
        : {})
    })
  }

  function error (errorStage, value = {}) {
    return setPhase('error', 'failed', {
      result: 'failed',
      errorStage: stableField(errorStage, 'unknown'),
      reasonCode: stableField(value.code, 'AGENT_ERROR')
    })
  }

  function finish (nextStatus = 'completed', reasonCode) {
    if (terminal) return false
    phase = stableField(nextStatus, 'completed')
    status = phase
    terminal = true
    emit({
      result: phase === 'completed' ? 'completed' : phase,
      ...(reasonCode
        ? { reasonCode: stableField(reasonCode, 'AGENT_FINISHED') }
        : {})
    })
    return true
  }

  function snapshot () {
    return Object.freeze({
      status,
      phase,
      durationMs: durationMs(),
      modelRequests,
      toolCalls,
      endpointFingerprint,
      terminal
    })
  }

  return Object.freeze({
    start,
    phase: setPhase,
    modelRequest,
    toolCall,
    metric,
    budgetExceeded,
    cancellation,
    error,
    finish,
    snapshot
  })
}
