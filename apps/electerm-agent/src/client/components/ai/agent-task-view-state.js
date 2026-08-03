export function getAgentTaskViewState ({ phase, task, error } = {}) {
  if (task) {
    if (['failed', 'partially-completed'].includes(task.status)) {
      return {
        kind: 'task',
        task,
        severity: 'error',
        showEvidence: true
      }
    }
    return { kind: 'task', task }
  }
  if (phase === 'run-error') {
    return {
      kind: 'error',
      message: String(error || ''),
      retryable: true
    }
  }
  return { kind: 'creating' }
}
