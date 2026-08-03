import { redactAuditText } from '../../common/safety-transactions/audit-redaction.js'
import { createTaskRunner } from '../../common/safety-transactions/task-runner.js'
import { createTraceContext } from '../../common/quality/trace-context.js'
import {
  agentTaskRegistry
} from './agent-task-registry.js'
import { createAgentRunObserver } from './agent-run-observer.js'

function requireFunction (value, label) {
  if (typeof value !== 'function') throw new Error(`${label} 必须是函数。`)
  return value
}

function sanitizedRequestError (value, fallback, secrets = []) {
  let source = String(value?.message || value || fallback)
  for (const secret of secrets) {
    const text = String(secret || '')
    if (text) source = source.split(text).join('[REDACTED]')
  }
  const message = redactAuditText(source).slice(0, 2000)
  if (!message || message === fallback || /[\u3400-\u9fff]/.test(message)) {
    return new Error(message || fallback)
  }
  return new Error(`${fallback}${message ? `：${message}` : ''}`)
}

function cancelledRequestError () {
  const error = new Error('AI 诊断计划请求已取消。')
  error.cancelled = true
  return error
}

function wait (delay) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, delay)))
}

export async function requestDiagnosticPlanText ({
  prompt,
  config = {},
  signal,
  observer,
  pollIntervalMs = 200,
  runGlobalAsync = globalThis.window?.pre?.runGlobalAsync
} = {}) {
  if (!String(config.baseURLAI || '').trim() || !String(config.apiKeyAI || '').trim()) {
    throw new Error('请先配置当前 AI 的 API 地址和 API Key。')
  }
  if (!String(config.modelAI || '').trim()) {
    throw new Error('请先配置当前 AI 模型。')
  }
  const invoke = requireFunction(runGlobalAsync, 'AIchat 调用器')
  const requestError = (value, fallback) => {
    return sanitizedRequestError(value, fallback, [config.apiKeyAI])
  }
  let sessionId = ''
  let aborted = Boolean(signal?.aborted)
  let abortReject
  const stopPromises = new Map()

  const stopStream = (value = sessionId) => {
    const id = String(value || '')
    if (!id) return Promise.resolve({ stopped: true })
    if (stopPromises.has(id)) return stopPromises.get(id)
    const stopping = Promise.resolve()
      .then(() => invoke('stopStream', id))
      .then(result => {
        if (result === true || result?.stopped === true) return result
        const error = new Error('AI diagnostic stream cancellation was not confirmed.')
        error.code = 'AGENT_CANCELLATION_FAILED'
        throw error
      })
    stopPromises.set(id, stopping)
    return stopping
  }
  const abortPromise = new Promise((resolve, reject) => {
    abortReject = reject
  })
  const onAbort = () => {
    aborted = true
    if (!sessionId) {
      abortReject(cancelledRequestError())
      return
    }
    stopStream().then(
      () => abortReject(cancelledRequestError()),
      abortReject
    )
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const raceAbort = promise => Promise.race([Promise.resolve(promise), abortPromise])
  try {
    observer?.phase?.('plan_request')
    observer?.modelRequest?.()
    if (aborted) throw cancelledRequestError()
    const initialRequest = Promise.resolve().then(() => invoke(
      'AIchat',
      String(prompt || ''),
      config.modelAI,
      `${config.roleAI || '你是 ShellPilot 的中文 SSH 运维助手。'}\n本次请求只能制定只读服务器异常诊断计划，并且只能返回严格 JSON。`,
      config.baseURLAI,
      config.apiPathAI,
      config.apiKeyAI,
      config.proxyAI,
      true,
      config.authHeaderNameAI
    ))
    initialRequest.then(initial => {
      if (aborted && initial?.isStream) {
        stopStream(initial.sessionId).catch(() => {})
      }
    }, () => {})
    const initial = await raceAbort(initialRequest)
    if (initial?.error) {
      throw requestError(initial.error, 'AI 诊断计划请求失败。')
    }
    if (!initial?.isStream) {
      const response = typeof initial === 'string' ? initial : initial?.response
      if (!String(response || '').trim()) throw new Error('AI 未返回诊断计划。')
      return String(response)
    }

    sessionId = String(initial.sessionId || '')
    if (!sessionId) throw new Error('AI 诊断流缺少会话标识。')
    if (aborted) {
      await stopStream(sessionId)
      throw cancelledRequestError()
    }
    let content = String(initial.content || '')
    while (true) {
      if (aborted) throw cancelledRequestError()
      if (pollIntervalMs > 0) await raceAbort(wait(pollIntervalMs))
      const result = await raceAbort(invoke('getStreamContent', sessionId))
      if (result?.error) throw requestError(result.error, 'AI 诊断计划请求失败。')
      content = String(result?.content ?? content)
      if (!result?.hasMore) break
    }
    if (!content.trim()) throw new Error('AI 未返回诊断计划。')
    return content
  } catch (error) {
    try {
      observer?.error?.(error?.cancelled ? 'cancellation' : 'model', error)
    } catch (observerError) {}
    let stopError
    if (sessionId) {
      try {
        await stopStream(sessionId)
      } catch (failure) {
        stopError = failure
      }
    }
    if (aborted || error?.cancelled) {
      if (stopError) throw stopError
      throw cancelledRequestError()
    }
    throw requestError(error, 'AI 诊断计划请求失败。')
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

export function createAgentTaskUiLifecycle (options = {}) {
  const abortGeneration = typeof options.abortGeneration === 'function'
    ? options.abortGeneration
    : () => {}
  const closeView = typeof options.closeView === 'function'
    ? options.closeView
    : () => {}
  return {
    close (phase) {
      const generationCancelled = phase === 'generating'
      if (generationCancelled) abortGeneration()
      closeView()
      return {
        generationCancelled,
        taskCancelled: false
      }
    }
  }
}

export function createAgentTaskController (options = {}) {
  const store = options.store
  const registry = options.registry || agentTaskRegistry
  const runCmd = requireFunction(options.runCmd, 'runCmd')
  const cancelRunCmd = requireFunction(options.cancelRunCmd, 'cancelRunCmd')
  const getCurrentEndpoint = requireFunction(options.getCurrentEndpoint, 'getCurrentEndpoint')
  const endpoint = options.endpoint
  const pid = options.pid ?? endpoint?.pid ?? endpoint?.terminalPid
  const onTaskChange = typeof options.onTaskChange === 'function'
    ? options.onTaskChange
    : () => {}
  const observer = options.observer || createAgentRunObserver({
    context: options.traceContext
  })
  const kind = String(options.kind || 'diagnostic')
  const diagnosticKey = String(options.diagnosticKey || '')
  if (!pid) throw new Error('诊断任务缺少终端 pid。')

  function notifyTaskChange (task) {
    try {
      onTaskChange(task)
    } catch {}
  }

  const runner = createTaskRunner({
    store,
    runRemote: (command, runOptions) => runCmd(pid, command, runOptions),
    cancelRemote: async executionId => {
      const cancelled = await cancelRunCmd(pid, executionId)
      if (cancelled !== true) throw new Error('远程命令已不在运行，无法确认取消结果。')
    },
    getCurrentEndpoint,
    onEvent: event => {
      if (event?.status === 'running') {
        try {
          observer.toolCall?.()
        } catch (error) {}
      }
      try {
        options.onEvent?.(event)
      } catch (error) {}
    },
    now: options.now
  })

  async function confirmAndRun (plan) {
    observer.start?.()
    const {
      traceContext: planTraceContext,
      ...taskPlan
    } = plan
    const parentTrace = options.traceContext || planTraceContext
    const taskTraceContext = createTraceContext({
      ...(parentTrace?.traceId ? { traceId: parentTrace.traceId } : {}),
      ...(taskPlan.id ? { taskId: String(taskPlan.id) } : {}),
      module: 'agent',
      action: 'agent-task'
    })
    const metadata = {
      ...(taskPlan.metadata && typeof taskPlan.metadata === 'object'
        ? taskPlan.metadata
        : {}),
      ...(diagnosticKey ? { diagnosticKey } : {})
    }
    let task = await runner.create({
      ...taskPlan,
      title: taskPlan.title || taskPlan.summary,
      purpose: taskPlan.purpose || taskPlan.summary,
      source: taskPlan.source || 'server-status',
      endpoint: taskPlan.endpoint || endpoint,
      kind,
      ...(Object.keys(metadata).length ? { metadata } : {})
    }, taskTraceContext)
    notifyTaskChange(task)
    task = await runner.confirmPlan(task.id)
    notifyTaskChange(task)
    const controller = new AbortController()
    registry.register({
      taskId: task.id,
      runner,
      controller,
      endpoint: task.endpoint,
      scopeId: options.scopeId,
      kind,
      diagnosticKey,
      pid
    })
    notifyTaskChange({ ...task })
    try {
      observer.phase?.('task_running')
      const completed = await runner.run(task.id, { signal: controller.signal })
      notifyTaskChange(completed)
      observer.finish?.(completed.status || 'completed')
      return completed
    } catch (error) {
      const errorStage = error?.code === 'AGENT_ENDPOINT_CHANGED'
        ? 'endpoint'
        : (error?.cancelled ? 'cancellation' : 'tool_execution')
      observer.error?.(errorStage, error)
      const get = store?.getTask || store?.get
      if (typeof get === 'function') {
        const current = await get.call(store, task.id)
        if (current) notifyTaskChange(current)
        if (error?.cancelled) {
          observer.finish?.('cancelled', error.code)
          return current
        }
      }
      observer.finish?.('failed', error.code)
      throw error
    } finally {
      registry.unregister(task.id)
    }
  }

  return {
    confirmAndRun,
    cancel: id => registry.cancel(id),
    runner
  }
}
