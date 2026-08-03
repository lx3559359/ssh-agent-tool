const TERMINAL_STATUS_META = Object.freeze({
  budget_exceeded: Object.freeze({
    labelKey: 'shellpilotAiAgentStatusBudgetExceeded',
    tone: 'warning'
  }),
  endpoint_changed: Object.freeze({
    labelKey: 'shellpilotAiAgentStatusEndpointChanged',
    tone: 'error'
  }),
  cancel_failed: Object.freeze({
    labelKey: 'shellpilotAiAgentStatusCancelFailed',
    tone: 'error'
  }),
  cancelled: Object.freeze({
    labelKey: 'shellpilotAiAgentStatusCancelled',
    tone: 'neutral'
  }),
  failed: Object.freeze({
    labelKey: 'shellpilotAiAgentStatusFailed',
    tone: 'error'
  }),
  completed: Object.freeze({
    labelKey: 'shellpilotAiAgentStatusFinished',
    tone: 'success'
  }),
  finished: Object.freeze({
    labelKey: 'shellpilotAiAgentStatusFinished',
    tone: 'success'
  })
})

function counter (value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

export function buildAgentRunStatusView (item = {}) {
  if (item.mode !== 'agent' || !item.runState) return null
  const runState = item.runState
  const status = TERMINAL_STATUS_META[runState.terminationReason]
    ? runState.terminationReason
    : runState.phase === 'budget_exceeded'
      ? 'budget_exceeded'
      : TERMINAL_STATUS_META[runState.status]
        ? runState.status
        : ''
  const meta = TERMINAL_STATUS_META[status]
  if (!meta) return null
  return Object.freeze({
    status,
    labelKey: meta.labelKey,
    tone: meta.tone,
    endpointFingerprint: String(runState.endpointFingerprint || '').slice(0, 64),
    elapsedMs: counter(runState.budget?.elapsedMs),
    modelRequests: counter(runState.budget?.modelRequests),
    toolCalls: counter(runState.budget?.toolCalls)
  })
}
