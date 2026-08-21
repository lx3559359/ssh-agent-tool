import { createTrustedOperationId } from '../../../common/safety-transactions/operation-id.js'
import {
  createOperationsTask,
  operationsTaskStatuses,
  transitionOperationsTask
} from './task-model.js'
import { createOutputBuffer } from './output-buffer.js'
import {
  assertOperationsResourceConfirmation
} from '../shared/resource-confirmation.js'

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
  const sensitiveCounts = new Map()
  const consumedConfirmations = new Set()
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

  function releaseEndpointSlot (countMap, key) {
    const remaining = Math.max(0, (countMap.get(key) || 1) - 1)
    if (remaining) countMap.set(key, remaining)
    else countMap.delete(key)
  }

  function run ({ tool, params = {}, endpoint, confirmation }) {
    const resourceSensitive = tool?.risk === 'resource-sensitive'
    if (tool?.risk !== 'read-only' && !resourceSensitive) {
      throw new Error('运维任务只允许只读或资源敏感诊断工具')
    }
    const key = assertEndpoint(endpoint)
    if (resourceSensitive) {
      if ((sensitiveCounts.get(key) || 0) >= 1) {
        throw new Error('当前服务器已有资源敏感任务正在运行')
      }
      assertOperationsResourceConfirmation({
        confirmation,
        toolId: tool.id,
        endpointKey: key,
        params,
        consumedNonces: consumedConfirmations
      })
      sensitiveCounts.set(key, (sensitiveCounts.get(key) || 0) + 1)
    } else {
      if ((activeCounts.get(key) || 0) >= maxReadonlyPerEndpoint) {
        throw new Error('当前服务器同时运行的只读任务已达到上限')
      }
      activeCounts.set(key, (activeCounts.get(key) || 0) + 1)
    }
    const countMap = resourceSensitive ? sensitiveCounts : activeCounts
    let taskId
    let controller
    let task
    try {
      taskId = createTaskId()
      controller = new AbortController()
      controllers.set(taskId, controller)
      task = setTask(createOperationsTask({
        id: taskId,
        toolId: tool.id,
        endpointKey: key,
        endpoint: { ...endpoint },
        params: structuredClone(params)
      }))
    } catch (error) {
      if (taskId) controllers.delete(taskId)
      releaseEndpointSlot(countMap, key)
      throw error
    }

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
          const stepRecord = {
            id: step.id,
            title: step.title || step.id,
            command,
            output: '',
            truncated: false,
            exitCode: null,
            status: 'running'
          }
          steps.push(stepRecord)
          task = setTask({
            ...task,
            activeStepId: step.id,
            steps: structuredClone(steps)
          })
          const result = await channel.execute({
            pid: endpoint.pid,
            taskId: `${taskId}-${step.id}`,
            script: command,
            timeoutMs: step.timeoutMs,
            signal: controller.signal,
            onChunk: chunk => {
              output.append(chunk)
              const snapshot = output.snapshot()
              stepRecord.output = snapshot.lines.join('\n')
              stepRecord.truncated = snapshot.truncated
              task = setTask({
                ...task,
                steps: structuredClone(steps)
              })
            }
          })
          stepRecord.output = output.toString()
          stepRecord.truncated = output.snapshot().truncated
          stepRecord.exitCode = result.exitCode
          stepRecord.status = result.exitCode === 0 ? 'completed' : 'failed'
          task = setTask({
            ...task,
            activeStepId: '',
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
        releaseEndpointSlot(countMap, key)
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
    async discover (endpoint) {
      const key = assertEndpoint(endpoint)
      return capabilitiesFor(endpoint, key)
    },
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
    getActiveCount: key => activeCounts.get(key) || 0,
    getSensitiveActiveCount: key => sensitiveCounts.get(key) || 0
  })
}
