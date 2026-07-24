import { createTrustedOperationId } from '../../../common/safety-transactions/operation-id.js'
import {
  createOperationsTask,
  operationsTaskStatuses,
  transitionOperationsTask
} from './task-model.js'
import { createOutputBuffer } from './output-buffer.js'

const capabilityCacheTtlMs = 5 * 60 * 1000

function endpointKey (endpoint) {
  return `${endpoint.username}@${endpoint.host}:${endpoint.port}`
}

function assertEndpoint (endpoint) {
  for (const key of ['tabId', 'pid', 'host', 'port', 'username']) {
    if (endpoint?.[key] === undefined ||
      endpoint?.[key] === null ||
      endpoint?.[key] === '') {
      throw new Error('SSH 运维任务端点信息不完整')
    }
  }
  return endpointKey(endpoint)
}

function disconnectedError (error) {
  return /disconnect|session|authentication|terminal.*not found/i.test(
    String(error?.message || '')
  )
}

export function createOperationsTaskRunner ({
  channel,
  taskStore,
  discover = async () => ({}),
  maxReadonlyPerEndpoint = 2,
  now = Date.now,
  createTaskId = () => createTrustedOperationId('operations'),
  onTaskChange = () => {}
} = {}) {
  if (!channel?.execute) throw new Error('运维任务执行通道不可用')
  const tasks = new Map()
  const controllers = new Map()
  const completions = new Map()
  const activeCounts = new Map()
  const capabilityCache = new Map()

  function setTask (task) {
    tasks.set(task.id, task)
    onTaskChange(task)
    return task
  }

  async function capabilitiesFor (endpoint, key) {
    const cached = capabilityCache.get(key)
    const timestamp = Number(now())
    if (cached && timestamp - cached.timestamp < capabilityCacheTtlMs) {
      return cached.value
    }
    const value = await discover(endpoint)
    capabilityCache.set(key, { timestamp, value })
    return value
  }

  function run ({ tool, params = {}, endpoint }) {
    if (tool?.risk !== 'read-only') {
      throw new Error('阶段一运维任务仅允许只读工具')
    }
    const key = assertEndpoint(endpoint)
    if ((activeCounts.get(key) || 0) >= maxReadonlyPerEndpoint) {
      throw new Error('当前服务器同时运行的只读任务已达到上限')
    }
    const taskId = createTaskId()
    const controller = new AbortController()
    controllers.set(taskId, controller)
    activeCounts.set(key, (activeCounts.get(key) || 0) + 1)
    let task = setTask(createOperationsTask({
      id: taskId,
      toolId: tool.id,
      endpointKey: key,
      endpoint: { ...endpoint },
      params: structuredClone(params)
    }))

    const completion = (async () => {
      try {
        task = setTask(transitionOperationsTask(
          task,
          operationsTaskStatuses.discovering
        ))
        const capabilities = await capabilitiesFor(endpoint, key)
        task = setTask(transitionOperationsTask(
          task,
          operationsTaskStatuses.running,
          { capabilities }
        ))
        const steps = []
        for (const step of tool.steps) {
          if (controller.signal.aborted) {
            const error = new Error('cancelled')
            error.name = 'AbortError'
            throw error
          }
          const output = createOutputBuffer()
          const command = typeof step.buildCommand === 'function'
            ? step.buildCommand(params, capabilities)
            : step.command
          const result = await channel.execute({
            pid: endpoint.pid,
            taskId: `${taskId}-${step.id}`,
            script: command,
            timeoutMs: step.timeoutMs,
            signal: controller.signal,
            onChunk: chunk => output.append(chunk)
          })
          steps.push({
            id: step.id,
            title: step.title || step.id,
            command,
            output: output.toString(),
            truncated: output.snapshot().truncated,
            exitCode: result.exitCode
          })
          task = setTask({
            ...task,
            steps: structuredClone(steps)
          })
          if (result.exitCode !== 0) {
            task = setTask(transitionOperationsTask(
              task,
              operationsTaskStatuses.partiallyCompleted,
              { steps }
            ))
            taskStore?.save(task)
            return task
          }
        }
        task = setTask(transitionOperationsTask(
          task,
          operationsTaskStatuses.completed,
          { steps }
        ))
        taskStore?.save(task)
        return task
      } catch (error) {
        const status = error?.name === 'AbortError'
          ? operationsTaskStatuses.cancelled
          : error?.name === 'TimeoutError'
            ? operationsTaskStatuses.timedOut
            : disconnectedError(error)
              ? operationsTaskStatuses.disconnected
              : operationsTaskStatuses.failed
        if (!task.completedAt) {
          task = setTask(transitionOperationsTask(task, status, {
            error: String(error?.message || error)
          }))
        }
        taskStore?.save(task)
        return task
      } finally {
        controllers.delete(taskId)
        const remaining = Math.max(0, (activeCounts.get(key) || 1) - 1)
        if (remaining) activeCounts.set(key, remaining)
        else activeCounts.delete(key)
      }
    })()
    completions.set(taskId, completion)
    completion.finally(() => {
      completions.delete(taskId)
    })

    return { taskId, completion }
  }

  return Object.freeze({
    run,
    async cancel (taskId) {
      const controller = controllers.get(taskId)
      if (!controller) return false
      const current = tasks.get(taskId)
      if (current && !current.completedAt) {
        setTask(transitionOperationsTask(
          current,
          operationsTaskStatuses.cancelling
        ))
      }
      const completion = completions.get(taskId)
      controller.abort()
      await completion
      return true
    },
    get: taskId => tasks.get(taskId) || null,
    list: () => Array.from(tasks.values()),
    getActiveCount: key => activeCounts.get(key) || 0
  })
}
