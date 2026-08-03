const statusMeta = Object.freeze({
  creating: Object.freeze({
    titleKey: 'shellpilotAgentTaskStateCreating',
    severity: 'info'
  }),
  running: Object.freeze({
    titleKey: 'shellpilotAgentTaskStateRunning',
    severity: 'info'
  }),
  cancelling: Object.freeze({
    titleKey: 'shellpilotAgentTaskStateCancelling',
    severity: 'warning'
  }),
  cancel_failed: Object.freeze({
    titleKey: 'shellpilotAgentTaskStateCancelFailed',
    severity: 'error'
  }),
  budget_exceeded: Object.freeze({
    titleKey: 'shellpilotAgentTaskStateBudgetExceeded',
    severity: 'warning'
  }),
  endpoint_changed: Object.freeze({
    titleKey: 'shellpilotAgentTaskStateEndpointChanged',
    severity: 'error'
  }),
  failed: Object.freeze({
    titleKey: 'shellpilotAgentTaskStateFailed',
    severity: 'error'
  }),
  orphan: Object.freeze({
    titleKey: 'shellpilotAgentTaskStateOrphaned',
    severity: 'error'
  }),
  cancelled: Object.freeze({
    titleKey: 'shellpilotAgentTaskStateCancelled',
    severity: 'warning'
  }),
  finished: Object.freeze({
    titleKey: 'shellpilotAgentTaskStateFinished',
    severity: 'success'
  })
})

const retryableStatuses = new Set([
  'budget_exceeded',
  'endpoint_changed',
  'failed',
  'orphan',
  'cancelled',
  'finished'
])

function counter (value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

function taskTermination (task, runState) {
  return String(
    task?.terminationReason ||
    runState?.terminationReason ||
    ''
  )
}

function taskErrorCode (task, runState) {
  return String(task?.errorCode || runState?.errorCode || '')
}

function isOrphaned (task, terminationReason, errorCode) {
  return terminationReason === 'orphaned' ||
    errorCode === 'AGENT_TASK_ORPHANED'
}

function resolveStatus ({ phase, task, cancelling, runState }) {
  const terminationReason = taskTermination(task, runState)
  const errorCode = taskErrorCode(task, runState)
  if (cancelling || phase === 'cancelling') return 'cancelling'
  if (phase === 'cancel_failed' || terminationReason === 'cancel_failed') {
    return 'cancel_failed'
  }
  if (terminationReason === 'budget_exceeded' || phase === 'budget_exceeded') {
    return 'budget_exceeded'
  }
  if (terminationReason === 'endpoint_changed' ||
    phase === 'endpoint_changed' ||
    errorCode === 'AGENT_ENDPOINT_CHANGED') {
    return 'endpoint_changed'
  }
  if (isOrphaned(task, terminationReason, errorCode)) return 'orphan'
  if (task?.status === 'completed') return 'finished'
  if (task?.status === 'cancelled') return 'cancelled'
  if (['failed', 'partially-completed'].includes(task?.status)) return 'failed'
  if (task && ['running-readonly', 'running-change'].includes(task.status)) {
    return 'running'
  }
  if (!task && ['run-error', 'error'].includes(phase)) return 'failed'
  return task ? 'running' : 'creating'
}

export function getAgentTaskViewState ({
  phase,
  task,
  error,
  cancelling = false,
  runState
} = {}) {
  const effectiveRunState = runState || task?.runState || task?.metadata?.runState || {}
  const status = resolveStatus({
    phase,
    task,
    cancelling,
    runState: effectiveRunState
  })
  const meta = statusMeta[status]
  const budget = effectiveRunState.budget || task?.budget || {}
  const showEvidence = Boolean(task)
  const terminationReason = taskTermination(task, effectiveRunState)
  const errorCode = taskErrorCode(task, effectiveRunState)
  return Object.freeze({
    kind: task ? 'task' : status === 'failed' ? 'error' : 'creating',
    status,
    titleKey: meta.titleKey,
    severity: meta.severity,
    canCancel: status === 'running' || status === 'cancel_failed' ||
      (status === 'creating' && phase === 'generating'),
    canRetry: retryableStatuses.has(status),
    canClose: true,
    showEvidence,
    phase: String(effectiveRunState.phase || phase || status),
    elapsedMs: counter(effectiveRunState.durationMs ?? budget.elapsedMs),
    modelRequests: counter(effectiveRunState.modelRequests ?? budget.modelRequests),
    toolCalls: counter(effectiveRunState.toolCalls ?? budget.toolCalls),
    endpointFingerprint: String(
      effectiveRunState.endpointFingerprint ||
      task?.endpointFingerprint ||
      ''
    ).slice(0, 64),
    terminationReason,
    errorCode,
    message: String(error || task?.error || '')
  })
}
