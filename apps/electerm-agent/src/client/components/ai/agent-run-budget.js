const KIB = 1024
const MIB = KIB * KIB
const MINUTE_MS = 60 * 1000

export const DEFAULT_AGENT_LIMIT_CONFIG = Object.freeze({
  maxDurationMinutes: 60,
  maxModelRequests: 100,
  maxToolCalls: 256,
  maxToolCallsPerTurn: 32,
  maxModelResponseMiB: 8,
  maxToolArgumentKiB: 256,
  maxToolResultMiB: 8
})

export const MAX_AGENT_LIMIT_CONFIG = Object.freeze({
  maxDurationMinutes: 1440,
  maxModelRequests: 1000,
  maxToolCalls: 4096,
  maxToolCallsPerTurn: 128,
  maxModelResponseMiB: 64,
  maxToolArgumentKiB: 1024,
  maxToolResultMiB: 64
})

export const DEFAULT_AGENT_RUN_LIMITS = Object.freeze({
  maxDurationMs: DEFAULT_AGENT_LIMIT_CONFIG.maxDurationMinutes * MINUTE_MS,
  maxModelRequests: DEFAULT_AGENT_LIMIT_CONFIG.maxModelRequests,
  maxToolCalls: DEFAULT_AGENT_LIMIT_CONFIG.maxToolCalls,
  maxToolCallsPerTurn: DEFAULT_AGENT_LIMIT_CONFIG.maxToolCallsPerTurn,
  maxModelResponseBytes: DEFAULT_AGENT_LIMIT_CONFIG.maxModelResponseMiB * MIB,
  maxToolArgumentBytes: DEFAULT_AGENT_LIMIT_CONFIG.maxToolArgumentKiB * KIB,
  maxToolResultBytes: DEFAULT_AGENT_LIMIT_CONFIG.maxToolResultMiB * MIB
})

function normalizeLimit (value, fallback, maximum) {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maximum
    ? value
    : fallback
}

export function normalizeAgentLimitConfig (config = {}) {
  const source = config && typeof config === 'object' ? config : {}
  return Object.freeze(Object.fromEntries(
    Object.entries(DEFAULT_AGENT_LIMIT_CONFIG).map(([key, fallback]) => [
      key,
      normalizeLimit(source[key], fallback, MAX_AGENT_LIMIT_CONFIG[key])
    ])
  ))
}

export function resolveAgentRunLimits (config = {}) {
  const normalized = normalizeAgentLimitConfig(config)
  return Object.freeze({
    maxDurationMs: normalized.maxDurationMinutes * MINUTE_MS,
    maxModelRequests: normalized.maxModelRequests,
    maxToolCalls: normalized.maxToolCalls,
    maxToolCallsPerTurn: normalized.maxToolCallsPerTurn,
    maxModelResponseBytes: normalized.maxModelResponseMiB * MIB,
    maxToolArgumentBytes: normalized.maxToolArgumentKiB * KIB,
    maxToolResultBytes: normalized.maxToolResultMiB * MIB
  })
}

export class AgentBudgetError extends Error {
  constructor (budgetType, { limit, actual } = {}) {
    super(`Agent ${budgetType} budget exceeded`)
    this.name = 'AgentBudgetError'
    this.code = 'AGENT_BUDGET_EXCEEDED'
    this.budgetType = budgetType
    this.limit = limit
    this.actual = actual
  }
}

function assertByteCount (value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Agent budget byte count must be a non-negative integer')
  }
}

function assertReservationCount (value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('Agent budget reservation must be a positive integer')
  }
}

export function createAgentRunBudget (limitConfig = {}, {
  now = () => Date.now(),
  setTimeout: schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: cancelTimer = handle => globalThis.clearTimeout(handle)
} = {}) {
  const limits = resolveAgentRunLimits(limitConfig)
  const startedAt = now()
  const deadlineAt = startedAt + limits.maxDurationMs
  let modelRequests = 0
  let toolCalls = 0
  let timerHandle
  let deadlineError
  let disposed = false
  let deadlineStarted = false

  function exceed (budgetType, limit, actual) {
    throw new AgentBudgetError(budgetType, { limit, actual })
  }

  function assertTime () {
    if (deadlineError) throw deadlineError
    const current = now()
    if (current >= deadlineAt) {
      deadlineError = new AgentBudgetError('duration', {
        limit: limits.maxDurationMs,
        actual: Math.max(0, current - startedAt)
      })
      throw deadlineError
    }
  }

  function reserveModelRequest (count = 1) {
    assertTime()
    assertReservationCount(count)
    const next = modelRequests + count
    if (next > limits.maxModelRequests) {
      exceed('model_requests', limits.maxModelRequests, next)
    }
    modelRequests = next
    return modelRequests
  }

  function reserveToolCalls (count = 1) {
    assertTime()
    assertReservationCount(count)
    if (count > limits.maxToolCallsPerTurn) {
      exceed('tool_calls_per_turn', limits.maxToolCallsPerTurn, count)
    }
    const next = toolCalls + count
    if (next > limits.maxToolCalls) {
      exceed('tool_calls', limits.maxToolCalls, next)
    }
    toolCalls = next
    return toolCalls
  }

  function assertBytes (budgetType, bytes, limit) {
    assertTime()
    assertByteCount(bytes)
    if (bytes > limit) exceed(budgetType, limit, bytes)
    return bytes
  }

  function startDeadline (onExceeded) {
    if (disposed || deadlineStarted) return
    deadlineStarted = true
    const remaining = Math.max(0, deadlineAt - now())
    timerHandle = schedule(() => {
      if (disposed || deadlineError) return
      deadlineError = new AgentBudgetError('duration', {
        limit: limits.maxDurationMs,
        actual: Math.max(limits.maxDurationMs, now() - startedAt)
      })
      onExceeded?.(deadlineError)
    }, remaining)
  }

  function snapshot () {
    return Object.freeze({
      elapsedMs: Math.max(0, now() - startedAt),
      modelRequests,
      toolCalls,
      limits
    })
  }

  function dispose () {
    if (disposed) return
    disposed = true
    if (timerHandle !== undefined) cancelTimer(timerHandle)
  }

  return Object.freeze({
    limits,
    reserveModelRequest,
    reserveToolCalls,
    assertToolArguments: bytes => (
      assertBytes('tool_arguments', bytes, limits.maxToolArgumentBytes)
    ),
    assertModelResponse: bytes => (
      assertBytes('model_response', bytes, limits.maxModelResponseBytes)
    ),
    assertToolResult: bytes => (
      assertBytes('tool_result', bytes, limits.maxToolResultBytes)
    ),
    assertTime,
    startDeadline,
    snapshot,
    dispose
  })
}
