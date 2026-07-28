import {
  assertOperationTaskTransition,
  isFinalOperationTask,
  normalizeOperationTask,
  operationTaskStatuses
} from './models.js'

const taskTable = 'operationTasks'
const patchQueues = new WeakMap()
export const operationTaskUpdatedEvent = 'shellpilot-operation-task-updated'

function notifyOperationTaskUpdated (task) {
  if (typeof window === 'undefined' ||
    typeof window.dispatchEvent !== 'function' ||
    typeof CustomEvent !== 'function') return
  window.dispatchEvent(new CustomEvent(operationTaskUpdatedEvent, {
    detail: {
      id: task?.id || '',
      kind: task?.kind || '',
      status: task?.status || ''
    }
  }))
}

const defaultAdapter = {
  async update (...args) {
    const { update } = await import('../db.js')
    return update(...args)
  },
  async findOne (...args) {
    const { findOne } = await import('../db.js')
    return findOne(...args)
  },
  async find (...args) {
    const { find } = await import('../db.js')
    return find(...args)
  },
  async remove (...args) {
    const { remove } = await import('../db.js')
    return remove(...args)
  }
}

function mergeTaskPatch (current, patch = {}) {
  return {
    ...current,
    ...patch,
    endpoint: patch.endpoint
      ? { ...current.endpoint, ...patch.endpoint }
      : current.endpoint,
    progress: patch.progress
      ? { ...current.progress, ...patch.progress }
      : current.progress,
    metadata: patch.metadata
      ? { ...current.metadata, ...patch.metadata }
      : current.metadata
  }
}

export async function saveOperationTask (
  task,
  { adapter = defaultAdapter, clock } = {}
) {
  const normalized = normalizeOperationTask(task, clock)
  await adapter.update(
    normalized.id,
    normalized,
    taskTable,
    true,
    true
  )
  notifyOperationTaskUpdated(normalized)
  return normalized
}

export async function findOperationTask (
  id,
  { adapter = defaultAdapter } = {}
) {
  return adapter.findOne(taskTable, String(id || ''), true)
}

export async function listOperationTasks ({
  adapter = defaultAdapter
} = {}) {
  const records = await adapter.find(taskTable, true)
  return (Array.isArray(records) ? records : [])
    .sort((left, right) => {
      return new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime()
    })
}

export function patchOperationTask (
  id,
  patch,
  { adapter = defaultAdapter, clock } = {}
) {
  const key = String(id || '')
  const previous = patchQueues.get(adapter) || Promise.resolve()
  const next = previous.then(async () => {
    const current = await findOperationTask(key, { adapter })
    if (!current) {
      const error = new Error(`未找到任务：${key}`)
      error.code = 'OPERATION_TASK_NOT_FOUND'
      throw error
    }
    if (patch?.status) {
      assertOperationTaskTransition(current.status, patch.status)
    }
    return saveOperationTask(
      {
        ...mergeTaskPatch(current, patch),
        updatedAt: undefined
      },
      { adapter, clock }
    )
  })
  patchQueues.set(adapter, next.catch(() => {}))
  return next
}

export async function markUnfinishedOperationTasksInterrupted ({
  adapter = defaultAdapter,
  clock
} = {}) {
  const records = await listOperationTasks({ adapter })
  const unfinished = records.filter(record => {
    return !isFinalOperationTask(record) &&
      record.status !== operationTaskStatuses.interrupted
  })
  return Promise.all(unfinished.map(record => patchOperationTask(
    record.id,
    {
      status: operationTaskStatuses.interrupted,
      metadata: {
        interruptionReason: 'client-restarted'
      }
    },
    { adapter, clock }
  )))
}

export async function pruneOperationTasks ({
  adapter = defaultAdapter,
  maxFinalRecords = 500
} = {}) {
  const records = await listOperationTasks({ adapter })
  const limit = Math.max(0, Number(maxFinalRecords) || 0)
  const removable = records
    .filter(isFinalOperationTask)
    .slice(limit)
  await Promise.all(removable.map(record => {
    return adapter.remove(taskTable, record.id, true)
  }))
  return removable.length
}

export {
  taskTable as operationTaskTable
}
