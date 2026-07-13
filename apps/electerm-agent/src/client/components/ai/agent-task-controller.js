import { redactAuditText } from '../../common/safety-transactions/audit-redaction.js'
import { createTaskRunner } from '../../common/safety-transactions/task-runner.js'
import {
  agentTaskRegistry
} from './agent-task-registry.js'

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
  pollIntervalMs = 200,
  runGlobalAsync = globalThis.window?.pre?.runGlobalAsync
} = {}) {
  if (!String(config.baseURLAI || '').trim() || !String(config.apiKeyAI || '').trim()) {
    throw new Error('请先配置当前 AI 的 API 地址和 API Key。')
  }
  const invoke = requireFunction(runGlobalAsync, 'AIchat 调用器')
  const requestError = (value, fallback) => {
    return sanitizedRequestError(value, fallback, [config.apiKeyAI])
  }
  let sessionId = ''
  let aborted = Boolean(signal?.aborted)
  let abortReject
  let stopRequested = false

  const stopStream = async () => {
    if (!sessionId || stopRequested) return
    stopRequested = true
    try {
      await invoke('stopStream', sessionId)
    } catch {}
  }
  const abortPromise = new Promise((resolve, reject) => {
    abortReject = reject
  })
  const onAbort = () => {
    aborted = true
    stopStream()
    abortReject(cancelledRequestError())
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const raceAbort = promise => Promise.race([Promise.resolve(promise), abortPromise])
  try {
    if (aborted) throw cancelledRequestError()
    const initial = await raceAbort(invoke(
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
    if (aborted || error?.cancelled) throw cancelledRequestError()
    throw requestError(error, 'AI 诊断计划请求失败。')
  } finally {
    signal?.removeEventListener('abort', onAbort)
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
    onEvent: options.onEvent,
    now: options.now
  })

  async function confirmAndRun (plan) {
    let task = await runner.create({
      ...plan,
      title: plan.title || plan.summary,
      purpose: plan.purpose || plan.summary,
      source: plan.source || 'server-status',
      endpoint: plan.endpoint || endpoint
    })
    notifyTaskChange(task)
    task = await runner.confirmPlan(task.id)
    notifyTaskChange(task)
    const controller = new AbortController()
    registry.register({
      taskId: task.id,
      runner,
      controller,
      endpoint: task.endpoint,
      pid
    })
    notifyTaskChange({ ...task })
    try {
      const completed = await runner.run(task.id, { signal: controller.signal })
      notifyTaskChange(completed)
      return completed
    } catch (error) {
      const get = store?.getTask || store?.get
      if (typeof get === 'function') {
        const current = await get.call(store, task.id)
        if (current) notifyTaskChange(current)
        if (error?.cancelled) return current
      }
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
