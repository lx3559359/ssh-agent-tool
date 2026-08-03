import {
  agentTools,
  executeToolCall,
  failAgentRiskBatch,
  getAgentToolDescriptor,
  prepareAgentRiskBatch
} from './agent-tools'
import {
  createAgentToolObservation,
  serializeAgentObservationForModel
} from './agent-observation.js'
import { buildAgentSkillPrompt } from './agent-skills'
import { selectAgentSkills } from './agent-skill-selector.js'
import { buildAgentMcpServerPrompt } from './agent-mcp-servers'
import { buildAgentLocalCliPrompt } from './agent-local-cli-tools'
import { buildAgentTaskModePrompt } from './agent-task-mode.js'
import {
  sanitizeAIChatHistory,
  sanitizeAIStoredText
} from './ai-request-credentials.js'
import { updateAIChatHistoryEntry } from './ai-chat-actions'
import { buildAIConversationMessages } from './ai-conversation-context'
import aiAgentCopy from './ai-agent-copy.json'
import { normalizeAsyncResult } from '../../common/async-result.js'
import { createTraceContext } from '../../common/quality/trace-context.js'
import {
  boundAgentToolResult,
  boundAgentToolResultToBudget,
  bindAgentToolArgs,
  buildBoundedAgentMessages,
  cancelAgentRuntimeOperations,
  captureAgentRuntimeEndpoint,
  resolveAgentRuntimeEndpoint
} from './agent-runtime-context.js'
import {
  agentTakeoverRegistry
} from './agent-takeover-registry.js'
import { agentTaskRegistry } from './agent-task-registry.js'
import {
  createAgentRunCancellationController
} from './agent-run-cancellation-controller.js'
import {
  buildAgentCancellationUpdate,
  settleAgentCancellation
} from './agent-cancellation-status.js'
import { buildAgentToolPresentation } from './agent-tool-presentation.js'
import { runValidatedAgentToolCalls } from './agent-tool-call-parser.js'
import { scheduleAgentToolCalls } from './agent-tool-scheduler.js'
import {
  createAgentRunBudget,
  resolveAgentRunLimits
} from './agent-run-budget.js'
import { createAgentRunObserver } from './agent-run-observer.js'
import { createAgentRuntimeServices } from './agent-runtime-services.js'

const MAX_ITERATIONS = 150
const agentRunEncoder = new TextEncoder()
const agentApiTools = Object.freeze(
  agentTools.map(({ type, function: definition }) => ({
    type,
    function: definition
  }))
)

export function cancelAgentRun (chatId) {
  const taskId = String(chatId || '')
  const entry = agentTaskRegistry.get(taskId)
  if (entry?.kind !== 'chat-agent') return Promise.resolve(false)
  return agentTaskRegistry.cancel(taskId)
}

export function isAgentRunActive (chatId) {
  return agentTaskRegistry.get(String(chatId || ''))?.kind === 'chat-agent'
}

export function cancelAgentRunsForScope (sourceTabId) {
  return agentTaskRegistry.cancelByScope(sourceTabId)
}

function buildAgentSystemPrompt (config, skillSelection, services) {
  const { store } = createAgentRuntimeServices(services)
  const lang = config.languageAI || store?.getLangName?.() || '简体中文'
  const baseRole = config.roleAI || '你是一个中文 SSH 运维排查助手。'
  const skillPrompt = buildAgentSkillPrompt({
    catalog: skillSelection?.catalog || [],
    selectedSkills: skillSelection?.selected || []
  })
  const mcpServerPrompt = buildAgentMcpServerPrompt({
    mcpServers: config.mcpServers || store?.config?.mcpServers || []
  })
  const localCliPrompt = buildAgentLocalCliPrompt()
  const taskModePrompt = buildAgentTaskModePrompt()
  return `${baseRole}

${aiAgentCopy.agentPromptRules.join('\n')}

${skillPrompt}

${mcpServerPrompt}

${localCliPrompt}

${taskModePrompt}

服务状态、近期日志、监听端口和文件分段读取时，必须优先使用 read_service_status、read_recent_logs、verify_listening_port 和 read_file_range 结构化工具。只有结构化工具无法表达目标时才使用原始 shell，且 shell 仍由系统风险策略裁决。

可用工具：
- 在终端标签页执行命令并读取输出
- 打开新的本地或 SSH 终端标签页
- 管理连接书签，包括创建、列出和打开连接
- 在标签页之间切换
- 通过 SFTP 传输文件，包括上传、下载、列目录、读取和删除远程文件

请使用${lang}回答。`
}

function persistAgentChatEntry (chatEntry, updates, services) {
  const { store } = createAgentRuntimeServices(services)
  updateAIChatHistoryEntry(store, chatEntry.id, updates)
}

function createRuntimeSkillClient (services) {
  const { pre } = createAgentRuntimeServices(services)
  const invoke = async (method, ...args) => {
    const result = await pre.runGlobalAsync(method, ...args)
    if (result?.ok) return result.value
    const error = new Error(
      result?.error?.message || 'Agent Skill operation failed.'
    )
    error.code = result?.error?.code || 'SKILL_IPC_ERROR'
    error.validation = result?.error?.validation
    throw error
  }
  return Object.freeze({
    listAgentSkills: () => invoke('listAgentSkills'),
    getAgentSkillMetadata: id => invoke('getAgentSkillMetadata', id),
    readAgentSkillFile: (id, relativePath) => (
      invoke('readAgentSkillFile', id, relativePath)
    )
  })
}

async function callBackendAIchatWithTools (
  messages,
  config,
  requestId,
  traceContext,
  runtimeLimits,
  services
) {
  const { pre } = createAgentRuntimeServices(services)
  return pre.runGlobalAsync(
    'AIchatWithTools',
    messages,
    config.modelAI,
    config.baseURLAI,
    config.apiPathAI,
    config.apiKeyAI,
    config.proxyAI,
    agentApiTools,
    config.authHeaderNameAI,
    requestId,
    traceContext,
    {
      maxContentLengthBytes: runtimeLimits.maxModelResponseBytes
    }
  )
}

function createAgentAbortError () {
  const error = new Error('Agent request cancelled')
  error.name = 'AbortError'
  return error
}

function measureAgentValueBytes (value) {
  let text
  try {
    text = JSON.stringify(value)
  } catch (error) {
    text = String(value ?? '')
  }
  return agentRunEncoder.encode(text ?? '').length
}

function isAgentBudgetError (error) {
  return error?.code === 'AGENT_BUDGET_EXCEEDED'
}

function getAgentErrorStage (error, fallback = 'tool_execution') {
  const code = String(error?.code || '')
  if (code.includes('ENDPOINT') || code === 'AI_TAKEOVER_REQUIRED') return 'endpoint'
  if (code.includes('ARGUMENT')) return 'tool_arguments'
  if (code.includes('POLICY') || code.includes('RISK')) return 'tool_policy'
  if (code.includes('CANCEL')) return 'cancellation'
  return fallback
}

function getAgentBudgetExceededText (services) {
  const key = 'shellpilotAiAgentBudgetExceeded'
  const translated = createAgentRuntimeServices(services).translate(key)
  return translated && translated !== key
    ? translated
    : aiAgentCopy.budgetExceededText
}

export function waitForAgentOperation (operation, signal) {
  if (!signal) return Promise.resolve(operation)
  if (signal.aborted) return Promise.reject(createAgentAbortError())

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(createAgentAbortError())
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(operation).then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

export async function runAgentLoop (
  chatEntry,
  config,
  abortRef,
  setIsStreaming,
  history = [],
  traceContext,
  onQualityTerminal,
  services = {}
) {
  const serviceOptions = services && typeof services === 'object' ? services : {}
  const runtimeServices = createAgentRuntimeServices(serviceOptions)
  const { store, pre } = runtimeServices
  const updateChatEntry = (entry, updates) => (
    persistAgentChatEntry(entry, updates, runtimeServices)
  )
  const budgetDependencies = serviceOptions.budgetDependencies || (
    serviceOptions.now || serviceOptions.setTimeout || serviceOptions.clearTimeout
      ? serviceOptions
      : undefined
  )
  const runtimeLimits = resolveAgentRunLimits(config.agentLimits)
  const budget = createAgentRunBudget(config.agentLimits, budgetDependencies)
  const parentTrace = traceContext?.traceId
    ? createTraceContext({
      traceId: traceContext.traceId,
      taskId: String(chatEntry.id),
      module: 'ai',
      action: 'agent-run'
    })
    : undefined
  let qualityFinished = false
  const finishQuality = (phase, result) => {
    if (qualityFinished) return
    qualityFinished = true
    onQualityTerminal?.(phase, result)
  }
  let accumulatedContent = ''
  const toolCallsLog = []
  const controller = new AbortController()
  let activeBackendRequestId = ''
  let activeCancellation
  let cancellationFailure
  let budgetFailure
  let currentErrorStage = 'ui_handoff'
  const taskId = String(chatEntry.id || '')
  const sourceTabId = String(chatEntry.sourceTabId || '')
  const taskScopeId = String(
    sourceTabId || chatEntry.conversationScopeId || 'global'
  )
  const resolveEndpoint = () => resolveAgentRuntimeEndpoint(sourceTabId)
  const endpoint = captureAgentRuntimeEndpoint(resolveEndpoint)
  const agentRuntime = {
    goal: String(chatEntry.prompt || 'Agent SSH task'),
    selectedSkillBindings: [],
    selectedSkillArtifactDigests: [],
    createdArtifactIds: new Set(),
    sourceTabId,
    traceContext: parentTrace,
    endpoint,
    resolveEndpoint,
    takeoverRegistry: agentTakeoverRegistry,
    services: runtimeServices,
    signal: controller.signal,
    budget: Object.freeze({
      limits: budget.limits,
      snapshot: budget.snapshot
    }),
    cancelActiveTool: null,
    cancellations: new Set(),
    reportCancellationFailure: error => {
      cancellationFailure = error
    }
  }
  const observer = serviceOptions.observer || createAgentRunObserver({
    context: parentTrace,
    ...(serviceOptions.observerOptions || {})
  })

  function currentRunState () {
    return store?.aiChatHistory?.find(item => item?.id === chatEntry.id)
      ?.runState || {}
  }

  function persistAgentRunState (patch = {}) {
    let observerSnapshot = {}
    try {
      observerSnapshot = observer.snapshot?.() || {}
    } catch (error) {}
    const budgetSnapshot = budget.snapshot()
    const previous = currentRunState()
    const status = String(observerSnapshot.status || previous.status || 'running')
    const phase = String(observerSnapshot.phase || previous.phase || 'started')
    let terminationReason
    if (Object.hasOwn(patch, 'terminationReason')) {
      terminationReason = patch.terminationReason
    } else if (status === 'completed') {
      terminationReason = 'finished'
    } else if (['cancelled', 'cancel_failed'].includes(status)) {
      terminationReason = status
    } else if (status === 'failed') {
      terminationReason = previous.terminationReason || 'failed'
    } else {
      terminationReason = ''
    }
    const errorCode = Object.hasOwn(patch, 'errorCode')
      ? patch.errorCode
      : status === 'running'
        ? ''
        : previous.errorCode || ''
    try {
      updateChatEntry(chatEntry, {
        runState: {
          status,
          phase,
          terminationReason: String(terminationReason || ''),
          errorCode: String(errorCode || ''),
          endpointFingerprint: String(
            observerSnapshot.endpointFingerprint ||
            previous.endpointFingerprint ||
            ''
          ),
          budget: {
            elapsedMs: observerSnapshot.durationMs ?? budgetSnapshot.elapsedMs,
            modelRequests: observerSnapshot.modelRequests ?? budgetSnapshot.modelRequests,
            toolCalls: observerSnapshot.toolCalls ?? budgetSnapshot.toolCalls
          }
        }
      })
    } catch (error) {
      try {
        runtimeServices.reportError(error)
      } catch {}
    }
  }

  function observe (method, args = [], patch = {}) {
    try {
      observer[method]?.(...args)
    } catch (error) {}
    persistAgentRunState(patch)
  }

  function observationErrorPatch (stage, error) {
    return {
      terminationReason: stage === 'endpoint'
        ? 'endpoint_changed'
        : stage === 'budget'
          ? 'budget_exceeded'
          : 'failed',
      errorCode: error?.code || 'AGENT_ERROR'
    }
  }

  const cancellationController = createAgentRunCancellationController({
    abort: () => {
      abortRef.current = true
      controller.abort()
    },
    observer: {
      cancellation: (status, reasonCode) => observe(
        'cancellation',
        [status, reasonCode],
        {
          terminationReason: status === 'cancel_confirmed'
            ? 'cancelled'
            : status === 'cancel_failed'
              ? 'cancel_failed'
              : '',
          errorCode: reasonCode || ''
        }
      )
    }
  })
  cancellationController.register(() => (
    cancelAgentRuntimeOperations(agentRuntime)
  ))
  cancellationController.register(() => {
    if (!activeBackendRequestId) return { cancelled: true }
    return pre.runGlobalAsync('AIAgentCancel', activeBackendRequestId)
  }, {
    confirm: value => value?.cancelled === true
  })

  function cancelCurrent () {
    if (activeCancellation) return activeCancellation
    activeCancellation = cancellationController.cancel().catch(error => {
      cancellationFailure = error
      throw error
    })
    return activeCancellation
  }
  abortRef.cancelCurrent = cancelCurrent
  observe('start')
  try {
    agentTaskRegistry.register({
      taskId,
      endpoint: agentRuntime.endpoint,
      scopeId: taskScopeId,
      kind: 'chat-agent',
      controller,
      runner: {
        cancel: () => cancelCurrent()
      }
    })
  } catch (error) {
    if (abortRef.cancelCurrent === cancelCurrent) {
      delete abortRef.cancelCurrent
    }
    const lockedResult = {
      ok: false,
      data: null,
      error: error?.code === 'AI_AGENT_SESSION_BUSY'
        ? '当前 SSH 会话已有 Agent 任务正在运行，请等待任务结束或先取消当前任务。'
        : sanitizeAIStoredText(error?.message || error)
    }
    setIsStreaming(false)
    updateChatEntry(chatEntry, {
      response: `**${aiAgentCopy.errorLabel}:** ${lockedResult.error}`,
      completionStatus: 'failed'
    })
    finishQuality('failed', 'failed')
    observe('error', ['ui_handoff', error], observationErrorPatch('ui_handoff', error))
    observe('finish', ['failed', error?.code])
    return lockedResult
  }
  function reportCancellationPersistenceError (error) {
    observe('error', ['persistence', error], observationErrorPatch('persistence', error))
    try {
      runtimeServices.reportError(error)
    } catch {}
  }

  function finalizeCancelledToolCalls () {
    const cancellationDetail = cancellationFailure
      ? sanitizeAIStoredText(
        cancellationFailure?.message || cancellationFailure
      )
      : 'Agent request cancelled'
    const cancellationReason = `AbortError: ${cancellationDetail}`
    let changed = false
    for (const toolEntry of toolCallsLog) {
      if (toolEntry.status !== 'running') continue
      toolEntry.status = 'cancelled'
      toolEntry.presentation = buildAgentToolPresentation(
        toolEntry.name,
        toolEntry.args,
        { error: aiAgentCopy.toolCall.cancelledDetail },
        { endpoint: agentRuntime.endpoint }
      )
      toolEntry.result = boundAgentToolResult(JSON.stringify({
        error: true,
        cancelled: true,
        verified: false,
        name: 'AbortError',
        data: cancellationReason
      }))
      changed = true
    }
    if (!changed) return
    try {
      updateChatEntry(chatEntry, {
        toolCalls: [...toolCallsLog]
      })
    } catch (error) {
      reportCancellationPersistenceError(error)
    }
  }

  async function markCancelled () {
    try {
      await failAgentRiskBatch(agentRuntime, createAgentAbortError())
    } catch (error) {
      if (!cancellationFailure) cancellationFailure = error
    }
    const settledError = await settleAgentCancellation(activeCancellation)
    if (settledError && !cancellationFailure) {
      cancellationFailure = settledError
    }
    finalizeCancelledToolCalls()
    const current = store?.aiChatHistory?.find(item => (
      item?.id === chatEntry.id
    ))
    const terminalAlreadyRecorded = !current ||
      current.completionStatus === 'cancelled'
    setIsStreaming(false)
    try {
      updateChatEntry(chatEntry, {
        ...buildAgentCancellationUpdate({
          response: accumulatedContent,
          stoppedText: aiAgentCopy.stoppedText,
          error: cancellationFailure && sanitizeAIStoredText(
            cancellationFailure?.message || cancellationFailure
          )
        }),
        artifactIds: [...agentRuntime.createdArtifactIds]
      })
    } catch (error) {
      reportCancellationPersistenceError(error)
    }
    if (!terminalAlreadyRecorded) finishQuality('cancelled', 'cancelled')
    observe('finish', [
      cancellationFailure ? 'cancel_failed' : 'cancelled',
      cancellationFailure?.code
    ], {
      terminationReason: cancellationFailure ? 'cancel_failed' : 'cancelled',
      errorCode: cancellationFailure?.code || ''
    })
  }

  function finalizeBudgetToolCalls (error, notice) {
    let changed = false
    for (const toolEntry of toolCallsLog) {
      if (toolEntry.status !== 'running') continue
      toolEntry.status = 'error'
      toolEntry.presentation = buildAgentToolPresentation(
        toolEntry.name,
        toolEntry.args,
        { error: notice },
        { endpoint: agentRuntime.endpoint }
      )
      toolEntry.result = boundAgentToolResult(JSON.stringify({
        error: true,
        code: error.code,
        name: error.name,
        budgetType: error.budgetType,
        executed: null,
        completionConfirmed: false,
        data: notice
      }))
      changed = true
    }
    return changed
  }

  async function markBudgetExceeded (error) {
    if (!activeCancellation) cancelCurrent().catch(() => {})
    try {
      await failAgentRiskBatch(agentRuntime, error)
    } catch (cancelError) {
      if (!cancellationFailure) cancellationFailure = cancelError
    }
    const settledError = await settleAgentCancellation(activeCancellation)
    if (settledError && !cancellationFailure) {
      cancellationFailure = settledError
    }
    const notice = getAgentBudgetExceededText(runtimeServices)
    observe('budgetExceeded', [error], {
      terminationReason: 'budget_exceeded',
      errorCode: error.code
    })
    finalizeBudgetToolCalls(error, notice)
    const snapshot = budget.snapshot()
    const response = accumulatedContent
      ? `${accumulatedContent}\n\n**${aiAgentCopy.errorLabel}:** ${notice}`
      : `**${aiAgentCopy.errorLabel}:** ${notice}`
    const result = {
      ok: false,
      data: null,
      error: notice,
      errorCode: error.code,
      budgetType: error.budgetType,
      budget: snapshot
    }
    setIsStreaming(false)
    updateChatEntry(chatEntry, {
      response,
      toolCalls: [...toolCallsLog],
      artifactIds: [...agentRuntime.createdArtifactIds],
      completionStatus: 'failed',
      terminationReason: 'budget_exceeded',
      errorCode: error.code,
      budget: snapshot
    })
    finishQuality('failed', 'failed')
    observe('finish', ['failed', error.code])
    return result
  }

  try {
    budget.startDeadline(error => {
      budgetFailure = error
      cancelCurrent().catch(() => {})
    })
    setIsStreaming(true)
    updateChatEntry(chatEntry, {
      toolCalls: [],
      response: '',
      completionStatus: 'running',
      ...(parentTrace
        ? { metadata: { traceId: parentTrace.traceId } }
        : {})
    })
    const skillSelection = await selectAgentSkills({
      prompt: chatEntry.prompt,
      client: createRuntimeSkillClient(runtimeServices)
    })
    if (skillSelection.requiresUserChoice) {
      const failure = skillSelection.failure || {}
      const message = `${failure.message || 'The requested Skill could not be loaded.'} ` +
        '请明确选择：修复/启用该 Skill 后重试，或移除 $skill-id 并确认使用通用 Agent 继续。'
      setIsStreaming(false)
      updateChatEntry(chatEntry, {
        response: message,
        completionStatus: 'failed'
      })
      observe(
        'error',
        ['ui_handoff', failure],
        observationErrorPatch('ui_handoff', failure)
      )
      observe('finish', [
        'failed',
        failure.code || 'AGENT_SKILL_SELECTION_REQUIRED'
      ])
      finishQuality('failed', 'failed')
      return {
        ok: false,
        data: null,
        error: 'skill-selection-required',
        requiresUserChoice: true,
        failure
      }
    }
    agentRuntime.selectedSkillBindings = skillSelection.skillBindings
    agentRuntime.selectedSkillArtifactDigests = skillSelection.artifactDigests
    const baseMessages = [
      {
        role: 'system',
        content: buildAgentSystemPrompt(config, skillSelection, runtimeServices)
      },
      ...buildAIConversationMessages(history, chatEntry)
    ]
    const runtimeMessages = []
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (abortRef && abortRef.current) {
        await markCancelled()
        return
      }

      currentErrorStage = 'model'
      budget.assertTime()
      budget.reserveModelRequest()
      observe('modelRequest')
      activeBackendRequestId = `agent-${chatEntry.id}-${iteration}-${runtimeServices.now()}`
      const requestTraceContext = createTraceContext({
        ...(parentTrace?.traceId ? { traceId: parentTrace.traceId } : {}),
        requestId: activeBackendRequestId,
        module: 'ai',
        action: 'agent-request'
      })
      const backendResult = await waitForAgentOperation(
        callBackendAIchatWithTools(
          buildBoundedAgentMessages(baseMessages, runtimeMessages),
          config,
          activeBackendRequestId,
          requestTraceContext,
          runtimeLimits,
          runtimeServices
        ),
        controller.signal
      )
      activeBackendRequestId = ''
      budget.assertModelResponse(measureAgentValueBytes(backendResult))
      if (abortRef && abortRef.current) {
        await markCancelled()
        return
      }
      const agentResult = normalizeAsyncResult(backendResult)

      if (!agentResult.ok) {
        const safeAgentError = sanitizeAIStoredText(agentResult.error)
        setIsStreaming(false)
        updateChatEntry(chatEntry, {
          response: accumulatedContent + `\n\n**${aiAgentCopy.errorLabel}:** ${safeAgentError}`,
          completionStatus: 'failed'
        })
        const modelError = {
          code: agentResult.errorCode || 'AGENT_MODEL_REQUEST_FAILED'
        }
        observe('error', ['model', modelError], observationErrorPatch('model', modelError))
        observe('finish', ['failed', modelError.code])
        finishQuality('failed', 'failed')
        return { ...agentResult, error: safeAgentError }
      }

      const result = agentResult.data
      const assistantMessage = result.message
      if (!assistantMessage) {
        setIsStreaming(false)
        updateChatEntry(chatEntry, {
          response: accumulatedContent || aiAgentCopy.noResponseText,
          completionStatus: 'failed'
        })
        const emptyResponseError = { code: 'AGENT_MODEL_RESPONSE_EMPTY' }
        observe(
          'error',
          ['model', emptyResponseError],
          observationErrorPatch('model', emptyResponseError)
        )
        observe('finish', ['failed', emptyResponseError.code])
        finishQuality('failed', 'failed')
        return
      }

      runtimeMessages.push(assistantMessage)

      if (assistantMessage.content) {
        accumulatedContent += (accumulatedContent ? '\n\n' : '') + assistantMessage.content
        updateChatEntry(chatEntry, {
          response: accumulatedContent
        })
      }

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        setIsStreaming(false)
        updateChatEntry(chatEntry, {
          response: accumulatedContent,
          artifactIds: [...agentRuntime.createdArtifactIds],
          completionStatus: 'completed'
        })
        observe('finish', ['completed'])
        finishQuality('completed', 'completed')
        return
      }

      currentErrorStage = 'tool_policy'
      budget.reserveToolCalls(assistantMessage.tool_calls.length)
      await runValidatedAgentToolCalls({
        toolCalls: assistantMessage.tool_calls,
        resolveDescriptor: getAgentToolDescriptor,
        maxArgumentBytes: budget.limits.maxToolArgumentBytes,
        normalize: parsed => Object.freeze({
          ...parsed,
          args: Object.freeze(bindAgentToolArgs(
            parsed.name,
            parsed.args,
            agentRuntime
          ))
        }),
        prepare: parsedCalls => prepareAgentRiskBatch(parsedCalls, agentRuntime),
        onInvalid: (toolCall, error) => {
          observe(
            'error',
            ['tool_arguments', error],
            observationErrorPatch('tool_arguments', error)
          )
          const name = String(toolCall?.function?.name || '')
          const safeError = sanitizeAIStoredText(error?.message || error)
          const failureResult = boundAgentToolResult(JSON.stringify({
            error: true,
            code: error?.code,
            name: 'AgentToolArgumentsError',
            data: safeError,
            executed: false
          }))
          toolCallsLog.push({
            id: toolCall?.id,
            name,
            args: {},
            status: 'error',
            result: failureResult,
            presentation: buildAgentToolPresentation(
              name,
              {},
              { error: safeError },
              { endpoint: agentRuntime.endpoint }
            )
          })
          updateChatEntry(chatEntry, { toolCalls: [...toolCallsLog] })
          runtimeMessages.push({
            role: 'tool',
            tool_call_id: toolCall?.id,
            content: failureResult
          })
        },
        schedule: async (parsedCalls, executeParsed) => {
          const toolEntries = parsedCalls.map(({ id, name, args }) => {
            observe('toolCall')
            const safeArgs = sanitizeAIChatHistory([{ args }])[0]?.args || {}
            return {
              id,
              name,
              args: safeArgs,
              status: 'running',
              result: null,
              presentation: buildAgentToolPresentation(
                name,
                args,
                null,
                { endpoint: agentRuntime.endpoint }
              )
            }
          })
          toolCallsLog.push(...toolEntries)
          updateChatEntry(chatEntry, { toolCalls: [...toolCallsLog] })
          const outcomes = await scheduleAgentToolCalls(
            parsedCalls,
            executeParsed,
            {
              maxParallel: 4,
              signal: controller.signal
            }
          )
          for (let index = 0; index < outcomes.length; index += 1) {
            const outcome = outcomes[index]
            const toolEntry = toolEntries[index]
            toolEntry.status = outcome.status
            toolEntry.result = outcome.result
            toolEntry.presentation = outcome.presentation
            runtimeMessages.push({
              role: 'tool',
              tool_call_id: parsedCalls[index].id,
              content: outcome.modelContent
            })
          }
          updateChatEntry(chatEntry, { toolCalls: [...toolCallsLog] })
          return outcomes.map(outcome => outcome.toolResult)
        },
        execute: async parsed => {
          if (abortRef && abortRef.current) throw createAgentAbortError()
          const { name, args } = parsed
          let status = 'completed'
          let presentation
          let storedResult
          let modelContent
          let toolResult
          try {
            toolResult = await waitForAgentOperation(
              executeToolCall(name, args, agentRuntime, undefined, parsed),
              controller.signal
            )
            if (abortRef && abortRef.current) throw createAgentAbortError()
            const boundedResult = boundAgentToolResultToBudget(
              toolResult,
              budget.limits.maxToolResultBytes
            )
            try {
              budget.assertToolResult(boundedResult.originalBytes)
            } catch (error) {
              if (!isAgentBudgetError(error) || error.budgetType !== 'tool_result') {
                throw error
              }
              toolResult = boundedResult.value
            }
            presentation = buildAgentToolPresentation(
              name,
              args,
              toolResult,
              { endpoint: agentRuntime.endpoint }
            )
            const observation = await createAgentToolObservation(
              name,
              toolResult,
              agentRuntime
            )
            storedResult = boundAgentToolResult(JSON.stringify(observation))
            toolResult = serializeAgentObservationForModel(observation)
            modelContent = toolResult
          } catch (err) {
            if (abortRef && abortRef.current) throw createAgentAbortError()
            if (isAgentBudgetError(err)) throw err
            const stage = getAgentErrorStage(err)
            observe('error', [stage, err], observationErrorPatch(stage, err))
            await failAgentRiskBatch(agentRuntime, err, {
              toolName: name,
              args
            })
            status = 'error'
            presentation = buildAgentToolPresentation(
              name,
              args,
              { error: sanitizeAIStoredText(err.message) },
              { endpoint: agentRuntime.endpoint }
            )
            const observation = await createAgentToolObservation(
              name,
              {
                error: true,
                data: sanitizeAIStoredText(err.message)
              },
              agentRuntime
            )
            storedResult = boundAgentToolResult(JSON.stringify(observation))
            toolResult = serializeAgentObservationForModel(observation)
            modelContent = storedResult
          }
          return {
            status,
            result: storedResult,
            presentation,
            modelContent,
            toolResult
          }
        }
      })
    }

    setIsStreaming(false)
    updateChatEntry(chatEntry, {
      response: accumulatedContent + `\n\n*(${aiAgentCopy.maxIterationsText})*`,
      completionStatus: 'failed'
    })
    const iterationError = { code: 'AGENT_MAX_ITERATIONS' }
    observe('error', ['model', iterationError], observationErrorPatch('model', iterationError))
    observe('finish', ['failed', iterationError.code])
    finishQuality('failed', 'failed')
  } catch (error) {
    const exceeded = budgetFailure || (isAgentBudgetError(error) ? error : null)
    if (exceeded) {
      return markBudgetExceeded(exceeded)
    }
    if (controller.signal.aborted || abortRef.current || error?.name === 'AbortError') {
      await markCancelled()
      return
    }
    const safeError = sanitizeAIStoredText(error?.message || error)
    const stage = getAgentErrorStage(error, currentErrorStage)
    observe('error', [stage, error], observationErrorPatch(stage, error))
    setIsStreaming(false)
    updateChatEntry(chatEntry, {
      response: accumulatedContent + `\n\n**${aiAgentCopy.errorLabel}:** ${safeError}`,
      completionStatus: 'failed'
    })
    finishQuality('failed', 'failed')
    observe('finish', ['failed', error?.code || 'AGENT_ERROR'])
    return { ok: false, data: null, error: safeError }
  } finally {
    budget.dispose()
    agentRuntime.cancellations.clear()
    if (abortRef.cancelCurrent === cancelCurrent) {
      delete abortRef.cancelCurrent
    }
    agentTaskRegistry.unregister(taskId)
  }
}
