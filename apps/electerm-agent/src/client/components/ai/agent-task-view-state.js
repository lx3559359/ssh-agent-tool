export function getAgentTaskViewState ({ phase, task, error } = {}) {
  if (task) return { kind: 'task', task }
  if (phase === 'run-error') {
    return {
      kind: 'error',
      message: String(error || ''),
      retryable: true
    }
  }
  return { kind: 'creating' }
}
