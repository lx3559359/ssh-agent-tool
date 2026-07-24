export const operationsTaskStatuses = Object.freeze({
  created: 'created',
  discovering: 'discovering',
  ready: 'ready',
  running: 'running',
  verifying: 'verifying',
  completed: 'completed',
  cancelling: 'cancelling',
  cancelled: 'cancelled',
  timedOut: 'timed-out',
  failed: 'failed',
  disconnected: 'disconnected',
  partiallyCompleted: 'partially-completed'
})

export const finalOperationsTaskStatuses = Object.freeze(new Set([
  operationsTaskStatuses.completed,
  operationsTaskStatuses.cancelled,
  operationsTaskStatuses.timedOut,
  operationsTaskStatuses.failed,
  operationsTaskStatuses.disconnected,
  operationsTaskStatuses.partiallyCompleted
]))

const statusValues = new Set(Object.values(operationsTaskStatuses))

export function createOperationsTask ({
  id,
  toolId,
  endpointKey,
  createdAt = Date.now(),
  ...rest
} = {}) {
  if (!id || !toolId || !endpointKey) {
    throw new Error('运维任务缺少标识、工具或端点')
  }
  return Object.freeze({
    id,
    toolId,
    endpointKey,
    status: operationsTaskStatuses.created,
    createdAt,
    updatedAt: createdAt,
    steps: [],
    ...rest
  })
}

export function transitionOperationsTask (
  task,
  status,
  patch = {},
  now = Date.now
) {
  if (!statusValues.has(status)) throw new Error('运维任务状态无效')
  if (finalOperationsTaskStatuses.has(task.status)) {
    throw new Error('运维任务已进入终态，不能继续迁移')
  }
  const updatedAt = Number(now())
  return Object.freeze({
    ...task,
    ...patch,
    status,
    updatedAt,
    ...(finalOperationsTaskStatuses.has(status)
      ? { completedAt: updatedAt }
      : {})
  })
}
