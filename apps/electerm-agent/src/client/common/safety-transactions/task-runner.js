import { redactAuditText, redactSensitiveData } from './audit-redaction.js'
import { classifyCommand } from './command-classifier.js'
import { assertSameSessionEndpoint } from './endpoint-guard.js'
import { finalTaskStatuses, taskStatuses } from './transaction-store.js'
import {
  collectBoundedRemoteOutput,
  createAuditRecord,
  maxAuditPreviewBytes,
  redactAndTruncateAuditText
} from './transaction-runner.js'
import {
  createPlanGrant,
  verifyPlanGrant
} from '../../components/ai/agent-plan-grant.js'

const defaultStepTimeoutMs = 30000
const finalTaskStatusSet = new Set(finalTaskStatuses)

function requireFunction (value, label) {
  if (typeof value !== 'function') throw new Error(`${label} 必须是函数。`)
  return value
}

function bindStoreMethod (store, genericName, taskName) {
  const method = store?.[genericName] || store?.[taskName]
  if (typeof method !== 'function') {
    throw new Error(`任务存储缺少 ${genericName} 方法。`)
  }
  return method.bind(store)
}

function resolveClock (now) {
  const clock = typeof now === 'function' ? now : () => now ?? new Date()
  return () => {
    const value = clock()
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) throw new Error('任务执行器当前时间无效。')
    return date.toISOString()
  }
}

function sanitizeError (error, fallback = '任务执行失败。') {
  const message = redactAndTruncateAuditText(error?.message || fallback)
  const safeError = new Error(message || fallback)
  if (error?.cancelled) safeError.cancelled = true
  if (error?.timedOut) safeError.timedOut = true
  if (error?.cancelRemoteFailure) safeError.cancelRemoteFailure = true
  if (error?.remoteState) safeError.remoteState = error.remoteState
  if (error?.canAutoRetry === false) safeError.canAutoRetry = false
  return safeError
}

function cancelledError () {
  const error = new Error('任务已取消。')
  error.cancelled = true
  return error
}

function timeoutError (timeoutMs) {
  const error = new Error(`只读步骤执行超时（${timeoutMs}ms）。`)
  error.timedOut = true
  return error
}

function normalizeTimeout (value) {
  const timeout = value === undefined ? defaultStepTimeoutMs : Number(value)
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error('任务步骤 timeoutMs 必须是正整数。')
  }
  return timeout
}

export function buildTaskPlanGrantPayload (task) {
  return {
    schemaVersion: 1,
    endpoint: task.endpoint || {},
    goal: String(task.purpose || task.summary || task.title || task.id),
    orderedCalls: task.steps.map(step => ({
      name: 'send_terminal_command',
      args: {
        command: step.command,
        timeoutMs: step.timeoutMs
      }
    })),
    skillBindings: task.skillBindings || [],
    artifactDigests: task.artifactDigests || [],
    impactTargets: task.impactTargets || (task.target ? [task.target] : []),
    resourceImpact: task.resourceImpact || {
      cpu: 'unknown',
      memory: 'unknown',
      disk: 'unknown',
      network: 'unknown',
      duration: 'unknown'
    },
    recovery: task.recovery || null,
    verification: task.verification || []
  }
}

async function assertPlanBinding (task) {
  if (!await verifyPlanGrant(buildTaskPlanGrantPayload(task), task.planGrant)) {
    const error = new Error('任务计划绑定已变更，已拒绝执行；请重新确认。')
    error.code = 'PLAN_BINDING_CHANGED'
    throw error
  }
}

export function validateTaskPlan (plan = {}) {
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error('任务计划必须包含至少一个步骤。')
  }
  const ids = new Set()
  const steps = plan.steps.map((step, index) => {
    const id = String(step?.id || `step-${index + 1}`)
    if (ids.has(id)) throw new Error(`任务步骤标识重复：${id}`)
    ids.add(id)
    const command = String(step?.command || '')
    if (!command.trim()) throw new Error(`任务步骤 ${id} 的命令不能为空。`)
    if (redactSensitiveData(command) !== command) {
      throw new Error(`任务步骤 ${id} 的可执行命令包含疑似敏感凭据，持久化会改变命令；请改用安全的凭据引用后重试。`)
    }
    const classification = classifyCommand(command)
    return {
      ...step,
      id,
      command,
      timeoutMs: normalizeTimeout(step.timeoutMs),
      risk: classification.risk,
      readOnly: classification.risk === 'readonly',
      reason: classification.reason,
      status: 'pending',
      audit: []
    }
  })
  return { ...plan, steps }
}

function remoteCode (result) {
  if (!result || typeof result !== 'object') return undefined
  const codes = [result.code, result.exitCode, result.rc]
    .filter(value => typeof value === 'number' && Number.isFinite(value))
  return codes.find(value => value !== 0) ?? codes[0]
}

export function createTaskRunner (options = {}) {
  const runRemote = requireFunction(options.runRemote, 'runRemote')
  const cancelRemote = requireFunction(options.cancelRemote, 'cancelRemote')
  const store = options.store || options
  const save = bindStoreMethod(store, 'save', 'saveTask')
  const get = bindStoreMethod(store, 'get', 'getTask')
  const patch = bindStoreMethod(store, 'patch', 'patchTask')
  const timestamp = resolveClock(options.now)
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
  const getCurrentEndpoint = typeof options.getCurrentEndpoint === 'function'
    ? options.getCurrentEndpoint
    : null
  const queues = new Map()
  const activeExecutions = new Map()
  const cancellationRequests = new Set()
  let executionSequence = 0

  function emit (taskId, stepId, status, output = '') {
    if (!onEvent) return
    try {
      onEvent({ taskId, stepId, status, phase: 'readonly', output })
    } catch {}
  }

  function serialize (id, work) {
    const previous = queues.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    queues.set(id, current)
    return current.finally(() => {
      if (queues.get(id) === current) queues.delete(id)
    })
  }

  async function updateStep (task, index, stepPatch, taskPatch = {}) {
    const steps = task.steps.map((step, stepIndex) => {
      return stepIndex === index ? { ...step, ...stepPatch } : step
    })
    return patch(task.id, {
      ...taskPatch,
      steps,
      updatedAt: timestamp()
    })
  }

  async function verifyTaskEndpoint (task, index) {
    if (!getCurrentEndpoint && !task.endpoint) return task
    const stepIndex = index ?? task.steps.findIndex(step => step.status !== 'completed')
    try {
      if (!getCurrentEndpoint) {
        throw new Error('缺少当前服务器端点复核能力，已停止任务。')
      }
      assertSameSessionEndpoint(task.endpoint, await getCurrentEndpoint(task))
      return task
    } catch (error) {
      const failure = sanitizeError(error, '当前 SSH 连接不可用，已停止任务。')
      const completedCount = task.steps.filter(step => step.status === 'completed').length
      const status = completedCount > 0
        ? taskStatuses.partiallyCompleted
        : taskStatuses.failed
      if (stepIndex < 0) {
        await patch(task.id, {
          status,
          error: failure.message,
          completedAt: timestamp(),
          updatedAt: timestamp()
        })
      } else {
        await updateStep(task, stepIndex, {
          status: 'failed',
          error: failure.message
        }, {
          status,
          error: failure.message,
          completedAt: timestamp()
        })
        emit(task.id, task.steps[stepIndex].id, 'failed', failure.message)
      }
      throw failure
    }
  }

  async function cancelExecution (active) {
    try {
      await cancelRemote(active.executionId, {
        maxOutputBytes: maxAuditPreviewBytes,
        phase: 'cancel'
      })
    } catch (error) {
      const failure = sanitizeError(error)
      failure.cancelRemoteFailure = true
      failure.remoteState = error?.remoteState || 'unknown'
      failure.canAutoRetry = false
      return failure
    }
  }

  async function runStepRemote (task, step, signal) {
    const executionId = `${task.id}-readonly-${++executionSequence}`
    const controller = new AbortController()
    let settled = false
    let stopReason = ''
    let rejectControl
    const control = new Promise((resolve, reject) => { rejectControl = reject })
    const active = {
      executionId,
      started: false,
      cancellationPromise: null,
      stop (reason) {
        if (settled) return Promise.resolve(null)
        if (!stopReason) {
          stopReason = reason
          controller.abort()
          const cancellation = this.started
            ? cancelExecution(this)
            : Promise.resolve(null)
          this.cancellationPromise = cancellation.then(failure => {
            rejectControl(failure || (reason === 'timeout'
              ? timeoutError(step.timeoutMs)
              : cancelledError()))
            return failure
          })
        }
        return this.cancellationPromise
      }
    }
    activeExecutions.set(task.id, active)

    const onAbort = () => {
      cancellationRequests.add(task.id)
      active.stop('cancel')
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      active.stop('timeout')
    }, step.timeoutMs)

    try {
      const remote = Promise.resolve().then(() => {
        if (stopReason || signal?.aborted || cancellationRequests.has(task.id)) {
          throw stopReason === 'timeout'
            ? timeoutError(step.timeoutMs)
            : cancelledError()
        }
        active.started = true
        return runRemote(step.command, {
          timeoutMs: step.timeoutMs,
          maxOutputBytes: maxAuditPreviewBytes,
          signal: controller.signal,
          executionId,
          phase: 'readonly'
        })
      })
      const result = await Promise.race([remote, control])
      const code = remoteCode(result)
      const output = (await collectBoundedRemoteOutput(result)).output
      const audit = createAuditRecord({
        phase: 'readonly',
        timestamp: timestamp(),
        code,
        output
      })
      if (stopReason) {
        const cancellationFailure = await active.cancellationPromise
        throw cancellationFailure || (stopReason === 'timeout'
          ? timeoutError(step.timeoutMs)
          : cancelledError())
      }
      if (code === undefined) {
        const error = new Error('只读步骤远程结果缺少有效的显式退出码。')
        error.audit = audit
        throw error
      }
      if (code !== 0) {
        const error = new Error(`只读步骤执行失败，退出码 ${code}。`)
        error.audit = audit
        throw error
      }
      return audit
    } catch (error) {
      const cancellationFailure = stopReason && active.cancellationPromise
        ? await active.cancellationPromise
        : null
      const failure = cancellationFailure ||
        (stopReason === 'timeout' && !error.timedOut
          ? timeoutError(step.timeoutMs)
          : stopReason === 'cancel' && !error.cancelled
            ? cancelledError()
            : error)
      if (!failure.audit) {
        const output = failure === error
          ? (await collectBoundedRemoteOutput(error)).output || error?.message || ''
          : failure.message
        failure.audit = createAuditRecord({
          phase: 'readonly',
          timestamp: timestamp(),
          code: remoteCode(error),
          output
        })
      }
      throw failure
    } finally {
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (activeExecutions.get(task.id) === active) activeExecutions.delete(task.id)
    }
  }

  async function create (plan) {
    const normalized = validateTaskPlan(plan)
    const draft = await save({
      ...normalized,
      status: taskStatuses.draft,
      createdAt: plan.createdAt || timestamp(),
      updatedAt: timestamp()
    })
    return patch(draft.id, {
      status: taskStatuses.awaitingPlanConfirmation,
      updatedAt: timestamp()
    })
  }

  function confirmPlan (id) {
    return serialize(String(id), async () => {
      const task = await get(id)
      if (!task) throw new Error(`未找到 Agent 任务：${id}`)
      if (task.status !== taskStatuses.awaitingPlanConfirmation) {
        throw new Error('任务不在等待计划确认状态。')
      }
      const confirmedAt = timestamp()
      return patch(id, {
        planGrant: await createPlanGrant(buildTaskPlanGrantPayload(task), {
          confirmedBy: 'user',
          now: confirmedAt
        }),
        planConfirmedAt: confirmedAt,
        updatedAt: timestamp()
      })
    })
  }

  function run (id, runOptions = {}) {
    return serialize(String(id), async () => {
      let task = await get(id)
      if (!task) throw new Error(`未找到 Agent 任务：${id}`)
      if (task.status !== taskStatuses.awaitingPlanConfirmation || !task.planGrant) {
        throw new Error('必须先确认计划才能运行任务。')
      }
      try {
        await assertPlanBinding(task)
      } catch (error) {
        const failure = sanitizeError(error, '任务计划完整性校验失败，已拒绝执行。')
        await patch(task.id, {
          status: taskStatuses.awaitingChangeConfirmation,
          reasonCode: 'PLAN_BINDING_CHANGED',
          error: failure.message,
          updatedAt: timestamp()
        })
        throw failure
      }
      task = await verifyTaskEndpoint(task)
      if (runOptions.signal?.aborted || cancellationRequests.has(task.id)) {
        task = await patch(task.id, {
          status: taskStatuses.cancelled,
          completedAt: timestamp(),
          updatedAt: timestamp()
        })
        cancellationRequests.delete(task.id)
        throw cancelledError()
      }
      task = await patch(task.id, {
        status: taskStatuses.runningReadonly,
        startedAt: timestamp(),
        updatedAt: timestamp()
      })

      let completedCount = task.steps.filter(step => step.status === 'completed').length
      for (let index = 0; index < task.steps.length; index += 1) {
        const step = task.steps[index]
        if (step.status === 'completed') continue
        task = await verifyTaskEndpoint(task, index)
        const classification = classifyCommand(step.command)
        if (classification.risk !== 'readonly') {
          const failure = sanitizeError(new Error(
            `只读任务步骤 ${step.id} 的运行时分类为 ${classification.risk}，已拒绝执行。`
          ))
          const status = completedCount > 0
            ? taskStatuses.partiallyCompleted
            : taskStatuses.failed
          task = await updateStep(task, index, {
            risk: classification.risk,
            readOnly: false,
            reason: classification.reason,
            status: 'failed',
            error: failure.message
          }, {
            status,
            error: failure.message,
            completedAt: timestamp()
          })
          emit(task.id, step.id, 'failed', failure.message)
          throw failure
        }
        if (cancellationRequests.has(task.id) || runOptions.signal?.aborted) {
          task = await updateStep(task, index, { status: 'cancelled' }, {
            status: taskStatuses.cancelled,
            completedAt: timestamp()
          })
          emit(task.id, step.id, 'cancelled')
          cancellationRequests.delete(task.id)
          throw cancelledError()
        }

        task = await updateStep(task, index, { status: 'running' })
        emit(task.id, step.id, 'running')
        if (cancellationRequests.has(task.id) || runOptions.signal?.aborted) {
          task = await updateStep(task, index, { status: 'cancelled' }, {
            status: taskStatuses.cancelled,
            completedAt: timestamp()
          })
          emit(task.id, step.id, 'cancelled')
          cancellationRequests.delete(task.id)
          throw cancelledError()
        }
        try {
          const audit = await runStepRemote(task, task.steps[index], runOptions.signal)
          task = await updateStep(task, index, {
            status: 'completed',
            output: audit.preview,
            audit: [...(task.steps[index].audit || []), audit]
          })
          completedCount += 1
          emit(task.id, step.id, 'completed', audit.preview)
        } catch (error) {
          const cancelled = !error.cancelRemoteFailure &&
            (error.cancelled || cancellationRequests.has(task.id) ||
              runOptions.signal?.aborted)
          const stepStatus = cancelled ? 'cancelled' : 'failed'
          const taskStatus = cancelled
            ? taskStatuses.cancelled
            : completedCount > 0
              ? taskStatuses.partiallyCompleted
              : taskStatuses.failed
          task = await updateStep(task, index, {
            status: stepStatus,
            output: error.audit?.preview || redactAuditText(error.message),
            audit: [...(task.steps[index].audit || []), error.audit].filter(Boolean),
            error: sanitizeError(error).message
          }, {
            status: taskStatus,
            completedAt: timestamp(),
            error: sanitizeError(error).message
          })
          emit(task.id, step.id, stepStatus, error.audit?.preview || '')
          if (cancelled) {
            cancellationRequests.delete(task.id)
            throw cancelledError()
          }
          throw sanitizeError(error)
        }
      }
      return patch(task.id, {
        status: taskStatuses.completed,
        completedAt: timestamp(),
        updatedAt: timestamp()
      })
    })
  }

  async function cancel (id) {
    const taskId = String(id)
    cancellationRequests.add(taskId)
    const pending = queues.get(taskId)
    const active = activeExecutions.get(taskId)
    let cancellationFailure
    try {
      if (active) {
        cancellationFailure = await active.stop('cancel')
      }
      if (pending) {
        try {
          await pending
        } catch {}
      } else {
        await serialize(taskId, async () => {
          const task = await get(taskId)
          if (!task || finalTaskStatusSet.has(task.status)) return task
          return patch(taskId, {
            status: taskStatuses.cancelled,
            completedAt: timestamp(),
            updatedAt: timestamp()
          })
        })
      }
      if (cancellationFailure) {
        const task = await get(taskId)
        const steps = task.steps.map(step => {
          if (!['running', 'cancelled'].includes(step.status)) return step
          return {
            ...step,
            status: 'failed',
            error: cancellationFailure.message
          }
        })
        const status = steps.some(step => step.status === 'completed')
          ? taskStatuses.partiallyCompleted
          : taskStatuses.failed
        await patch(taskId, {
          steps,
          status,
          error: cancellationFailure.message,
          completedAt: timestamp(),
          updatedAt: timestamp()
        })
        throw cancellationFailure
      }
      return get(taskId)
    } finally {
      cancellationRequests.delete(taskId)
    }
  }

  return {
    create,
    prepare: create,
    confirmPlan,
    run,
    cancel
  }
}
