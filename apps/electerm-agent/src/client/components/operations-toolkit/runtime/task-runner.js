import { createTrustedOperationId } from '../../../common/safety-transactions/operation-id.js'
import {
  createOperationsTask,
  normalizeOperationsRuntimeIdentity,
  operationsTaskStatuses,
  transitionOperationsTask
} from './task-model.js'
import { createOutputBuffer } from './output-buffer.js'
import {
  assertOperationsResourceConfirmation
} from '../shared/resource-confirmation.js'

function endpointKey (endpoint) {
  const username = endpoint.connectionUsername || endpoint.username
  return `${username}@${endpoint.host}:${endpoint.port}`
}

function normalizeTaskEndpoint (providedEndpoint = {}) {
  const connectionUsername = String(
    providedEndpoint.connectionUsername || providedEndpoint.username || ''
  ).trim()
  const username = String(providedEndpoint.username || connectionUsername).trim()
  const endpoint = {
    ...providedEndpoint,
    username: connectionUsername,
    connectionUsername,
    sessionType: String(providedEndpoint.sessionType || '').toLowerCase(),
    port: Number(providedEndpoint.port)
  }
  for (const key of [
    'tabId', 'pid', 'terminalPid', 'sessionType', 'host', 'port',
    'username', 'connectionUsername', 'hostKeyFingerprint'
  ]) {
    if (endpoint?.[key] === undefined ||
      endpoint?.[key] === null ||
      endpoint?.[key] === '') {
      throw new Error('SSH 运维任务端点信息不完整')
    }
  }
  if (username !== connectionUsername) {
    throw new Error('SSH 运维任务登录用户端点不一致')
  }
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 ||
    endpoint.port > 65535) {
    throw new Error('SSH 运维任务端口无效')
  }
  if (endpoint.sessionType !== 'ssh') {
    throw new Error('SSH 运维任务端点会话类型无效')
  }
  return endpoint
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
  createTaskId = () => createTrustedOperationId('operations'),
  onTaskChange = () => {}
} = {}) {
  if (typeof channel?.acquire !== 'function') {
    throw new Error('运维任务执行通道不可用')
  }
  const tasks = new Map()
  const controllers = new Map()
  const completions = new Map()
  const activeCounts = new Map()
  const sensitiveCounts = new Map()
  const consumedConfirmations = new Set()

  function setTask (task) {
    tasks.set(task.id, task)
    onTaskChange(task)
    return task
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
    const taskEndpoint = normalizeTaskEndpoint(endpoint)
    const key = endpointKey(taskEndpoint)
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
        endpoint: { ...taskEndpoint },
        params: structuredClone(params)
      }))
    } catch (error) {
      if (taskId) controllers.delete(taskId)
      releaseEndpointSlot(countMap, key)
      throw error
    }

    const completion = (async () => {
      let lease
      try {
        task = setTask(transitionOperationsTask(
          task,
          operationsTaskStatuses.discovering
        ))
        lease = await channel.acquire({
          endpoint: taskEndpoint,
          taskId,
          signal: controller.signal
        })
        if (typeof lease?.execute !== 'function' ||
          typeof lease?.release !== 'function') {
          throw new Error('PTY 运维任务租约不可用')
        }
        const onIdentity = identity => {
          const runtimeIdentity = normalizeOperationsRuntimeIdentity(identity)
          if (task.runtimeIdentity && (
            task.runtimeIdentity.effectiveUid !== runtimeIdentity.effectiveUid ||
            task.runtimeIdentity.effectiveUsername !==
              runtimeIdentity.effectiveUsername
          )) {
            throw new Error('当前 Shell 有效身份在任务执行期间发生变化')
          }
          if (!task.runtimeIdentity) {
            task = setTask({ ...task, runtimeIdentity })
          }
          return runtimeIdentity
        }
        const execute = async options => {
          const result = await lease.execute(options)
          onIdentity(result?.identity)
          return result
        }
        if (controller.signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        const capabilities = await discover(taskEndpoint, {
          taskId,
          signal: controller.signal,
          execute,
          onIdentity
        })
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
          const result = await execute({
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
            break
          }
        }
        if (!task.completedAt) {
          task = setTask(transitionOperationsTask(
            task,
            operationsTaskStatuses.completed,
            { steps }
          ))
        }
      } catch (error) {
        const cancellationUnknown = error?.name === 'CancellationUnknownError'
        const status = cancellationUnknown
          ? operationsTaskStatuses.cancellationUnknown
          : error?.name === 'AbortError'
            ? operationsTaskStatuses.cancelled
            : error?.name === 'TimeoutError'
              ? operationsTaskStatuses.timedOut
              : disconnectedError(error)
                ? operationsTaskStatuses.disconnected
                : operationsTaskStatuses.failed
        if (!task.completedAt) {
          task = setTask(transitionOperationsTask(task, status, {
            error: String(error?.message || error),
            ...(cancellationUnknown
              ? { terminalRecoveryRequired: true }
              : {})
          }))
        }
      } finally {
        if (lease) {
          try {
            const released = await lease.release()
            if (released === false) {
              task = setTask({ ...task, terminalRecoveryRequired: true })
            }
          } catch (error) {
            task = setTask({
              ...task,
              terminalRecoveryRequired: true,
              releaseError: String(error?.message || error)
            })
          }
        }
        if (task.completedAt) taskStore?.save(task)
        controllers.delete(taskId)
        releaseEndpointSlot(countMap, key)
      }
      return task
    })()
    completions.set(taskId, completion)
    completion.finally(() => {
      completions.delete(taskId)
    })

    return { taskId, completion }
  }

  return Object.freeze({
    run,
    async discover (providedEndpoint) {
      const endpoint = normalizeTaskEndpoint(providedEndpoint)
      const taskId = createTaskId()
      const controller = new AbortController()
      let lease
      try {
        lease = await channel.acquire({ endpoint, taskId, signal: controller.signal })
        const execute = async options => {
          const result = await lease.execute(options)
          normalizeOperationsRuntimeIdentity(result?.identity)
          return result
        }
        return await discover(endpoint, {
          taskId,
          signal: controller.signal,
          execute,
          onIdentity: normalizeOperationsRuntimeIdentity
        })
      } finally {
        await lease?.release()
      }
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
      return completion ? await completion : tasks.get(taskId) || false
    },
    get: taskId => tasks.get(taskId) || null,
    list: () => Array.from(tasks.values()),
    getActiveCount: key => activeCounts.get(key) || 0,
    getSensitiveActiveCount: key => sensitiveCounts.get(key) || 0
  })
}
