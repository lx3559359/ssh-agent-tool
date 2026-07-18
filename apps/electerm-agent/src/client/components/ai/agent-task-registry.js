import { assertSameSessionEndpoint } from '../../common/safety-transactions/endpoint-guard.js'
import {
  taskStatuses
} from '../../common/safety-transactions/transaction-store.js'

const runningTaskStatuses = new Set([
  taskStatuses.runningReadonly,
  taskStatuses.runningChange
])

function taskStoreMethod (store, genericName, taskName) {
  const method = store?.[genericName] || store?.[taskName]
  if (typeof method !== 'function') {
    throw new Error(`任务存储缺少 ${taskName} 方法。`)
  }
  return method.bind(store)
}

export function createAgentTaskRegistry () {
  const entries = new Map()
  const listeners = new Set()
  const cancellations = new Map()

  function notify (change) {
    for (const listener of listeners) {
      try {
        listener(change)
      } catch {}
    }
  }

  function register (options = {}) {
    const taskId = String(options.taskId || '')
    if (!taskId || typeof options.runner?.cancel !== 'function') {
      throw new Error('注册 Agent 任务需要 taskId 和可取消 runner。')
    }
    if (entries.has(taskId)) throw new Error(`Agent 任务已注册：${taskId}`)
    const scopeId = String(options.scopeId || options.endpoint?.tabId || '')
    const endpoint = options.endpoint
    const conflicting = [...entries.values()].find(entry => {
      if (endpoint && entry.endpoint) {
        try {
          assertSameSessionEndpoint(entry.endpoint, endpoint)
          return true
        } catch {
          return false
        }
      }
      return !endpoint && !entry.endpoint && scopeId && entry.scopeId === scopeId
    })
    if (conflicting) {
      const error = new Error('当前 SSH 会话已有 Agent 任务正在运行。')
      error.code = 'AI_AGENT_SESSION_BUSY'
      error.taskId = conflicting.taskId
      throw error
    }
    const entry = {
      taskId,
      runner: options.runner,
      controller: options.controller,
      endpoint,
      scopeId,
      kind: String(options.kind || 'diagnostic'),
      pid: options.pid,
      registeredAt: new Date().toISOString()
    }
    entries.set(taskId, entry)
    notify({ type: 'registered', taskId, entry })
    return entry
  }

  function unregister (id) {
    const taskId = String(id || '')
    const entry = entries.get(taskId)
    if (!entry) return false
    entries.delete(taskId)
    notify({ type: 'unregistered', taskId, entry })
    return true
  }

  function canCancel (task = {}) {
    if (!runningTaskStatuses.has(task.status)) return false
    const entry = entries.get(String(task.id || ''))
    if (!entry) return false
    try {
      assertSameSessionEndpoint(entry.endpoint, task.endpoint)
      return true
    } catch {
      return false
    }
  }

  async function cancel (id) {
    const taskId = String(id || '')
    if (cancellations.has(taskId)) return cancellations.get(taskId)
    const entry = entries.get(taskId)
    if (!entry) throw new Error('任务取消能力不可用，执行器可能已结束。')
    const cancellation = (async () => {
      entry.controller?.abort?.()
      try {
        return await entry.runner.cancel(taskId)
      } finally {
        unregister(taskId)
      }
    })()
    cancellations.set(taskId, cancellation)
    try {
      return await cancellation
    } finally {
      cancellations.delete(taskId)
    }
  }

  function matchesEndpoint (entry, endpoint) {
    if (!entry?.endpoint || !endpoint) return false
    try {
      assertSameSessionEndpoint(entry.endpoint, endpoint)
      return true
    } catch {
      return false
    }
  }

  function listByEndpoint (endpoint) {
    return [...entries.values()].filter(entry => matchesEndpoint(entry, endpoint))
  }

  function listByScope (scopeId) {
    const expected = String(scopeId || '')
    return expected
      ? [...entries.values()].filter(entry => entry.scopeId === expected)
      : []
  }

  function cancelEntries (matches) {
    return Promise.all(matches.map(entry => cancel(entry.taskId)))
  }

  function cancelByEndpoint (endpoint) {
    return cancelEntries(listByEndpoint(endpoint))
  }

  function cancelByScope (scopeId) {
    return cancelEntries(listByScope(scopeId))
  }

  function cancelAll () {
    return cancelEntries([...entries.values()])
  }

  function subscribe (listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    register,
    unregister,
    has: id => entries.has(String(id || '')),
    get: id => entries.get(String(id || '')),
    list: () => [...entries.values()],
    listByEndpoint,
    listByScope,
    isEndpointBusy: endpoint => listByEndpoint(endpoint).length > 0,
    isScopeBusy: scopeId => listByScope(scopeId).length > 0,
    canCancel,
    cancel,
    cancelByEndpoint,
    cancelByScope,
    cancelAll,
    subscribe,
    get size () {
      return entries.size
    }
  }
}

export async function recoverOrphanedAgentTasks ({
  store,
  registry,
  now = () => new Date()
} = {}) {
  const list = taskStoreMethod(store, 'list', 'listTasks')
  const patch = taskStoreMethod(store, 'patch', 'patchTask')
  const tasks = await list()
  const recovered = []
  const timestamp = () => {
    const value = typeof now === 'function' ? now() : now
    const date = value instanceof Date ? value : new Date(value)
    return date.toISOString()
  }

  for (const task of tasks) {
    if (task.source !== 'server-status' ||
      !runningTaskStatuses.has(task.status) || registry?.has(task.id)) continue
    const error = '任务已中断：执行器不可用（应用已重启）。'
    const steps = (task.steps || []).map(step => {
      if (step.status !== 'running') return step
      return { ...step, status: 'failed', error }
    })
    const completed = steps.some(step => step.status === 'completed')
    const updated = await patch(task.id, {
      steps,
      status: completed ? taskStatuses.partiallyCompleted : taskStatuses.failed,
      error,
      completedAt: timestamp(),
      updatedAt: timestamp()
    })
    recovered.push(updated)
  }
  return recovered
}

export function installSafetyTaskCapability (store, registry) {
  if (!store || !registry) throw new Error('注册任务取消能力需要 store 和 registry。')
  const capability = {
    canCancel: task => registry.canCancel(task),
    cancel: id => registry.cancel(id)
  }
  store.safetyTaskCapability = capability
  return capability
}

export const agentTaskRegistry = createAgentTaskRegistry()
