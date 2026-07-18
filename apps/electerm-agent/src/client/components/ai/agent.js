import {
  agentTools,
  executeToolCall,
  failAgentRiskBatch,
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
  buildBoundedAgentMessages,
  cancelAgentRuntimeOperations,
  resolveAgentRuntimeEndpoint
} from './agent-runtime-context.js'
import {
  agentTakeoverRegistry
} from './agent-takeover-registry.js'
import { agentTaskRegistry } from './agent-task-registry.js'
import {
  buildAgentCancellationUpdate,
  settleAgentCancellation
} from './agent-cancellation-status.js'
import { buildAgentToolPresentation } from './agent-tool-presentation.js'

const MAX_ITERATIONS = 150
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

function buildAgentSystemPrompt (config, skillSelection) {
  const lang = config.languageAI || window.store.getLangName() || '简体中文'
  const baseRole = config.roleAI || '你是一个中文 SSH 运维排查助手。'
  const skillPrompt = buildAgentSkillPrompt({
    catalog: skillSelection?.catalog || [],
    selectedSkills: skillSelection?.selected || []
  })
  const mcpServerPrompt = buildAgentMcpServerPrompt({
    mcpServers: config.mcpServers || window.store.config?.mcpServers || []
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

function updateChatEntry (chatEntry, updates) {
  updateAIChatHistoryEntry(window.store, chatEntry.id, updates)
}

async function callBackendAIchatWithTools (messages, config, requestId, traceContext) {
  return window.pre.runGlobalAsync(
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
    traceContext
  )
}

function createAgentAbortError () {
  const error = new Error('Agent request cancelled')
  error.name = 'AbortError'
  return error
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

export async function runAgentLoop (chatEntry, config, abortRef, setIsStreaming, history = [], traceContext, onQualityTerminal) {
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
  const controller = new AbortController()
  let activeBackendRequestId = ''
  let activeCancellation
  let cancellationFailure
  const taskId = String(chatEntry.id || '')
  const sourceTabId = String(chatEntry.sourceTabId || '')
  const taskScopeId = String(
    sourceTabId || chatEntry.conversationScopeId || 'global'
  )
  const resolveEndpoint = () => resolveAgentRuntimeEndpoint(sourceTabId)
  const agentRuntime = {
    goal: String(chatEntry.prompt || 'Agent SSH task'),
    selectedSkillBindings: [],
    selectedSkillArtifactDigests: [],
    sourceTabId,
    traceContext: parentTrace,
    endpoint: resolveEndpoint(),
    resolveEndpoint,
    takeoverRegistry: agentTakeoverRegistry,
    signal: controller.signal,
    cancelActiveTool: null,
    cancellations: new Set(),
    reportCancellationFailure: error => {
      cancellationFailure = error
    }
  }

  function cancelCurrent () {
    if (activeCancellation) return activeCancellation
    activeCancellation = (async () => {
      abortRef.current = true
      controller.abort()
      const operationCancellation = cancelAgentRuntimeOperations(agentRuntime)
      let backendCancellation = Promise.resolve()
      if (activeBackendRequestId) {
        backendCancellation = window.pre
          .runGlobalAsync('AIAgentCancel', activeBackendRequestId)
          .catch(() => {})
      }
      await backendCancellation
      try {
        return await operationCancellation
      } catch (error) {
        cancellationFailure = error
        throw error
      }
    })()
    return activeCancellation
  }
  abortRef.cancelCurrent = cancelCurrent
  try {
    agentTaskRegistry.register({
      taskId,
      endpoint: agentRuntime.endpoint,
      scopeId: taskScopeId,
      kind: 'chat-agent',
      controller,
      runner: {
        cancel: async () => {
          await cancelCurrent()
          return { id: taskId, status: 'cancelling' }
        }
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
    return lockedResult
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
    const current = window.store.aiChatHistory?.find(item => (
      item.id === chatEntry.id
    ))
    const terminalAlreadyRecorded = !current ||
      current.completionStatus === 'cancelled'
    setIsStreaming(false)
    updateChatEntry(chatEntry, buildAgentCancellationUpdate({
      response: accumulatedContent,
      stoppedText: aiAgentCopy.stoppedText,
      error: cancellationFailure && sanitizeAIStoredText(
        cancellationFailure?.message || cancellationFailure
      )
    }))
    if (!terminalAlreadyRecorded) finishQuality('cancelled', 'cancelled')
  }

  try {
    setIsStreaming(true)
    updateChatEntry(chatEntry, {
      toolCalls: [],
      response: '',
      completionStatus: 'running',
      ...(parentTrace
        ? { metadata: { traceId: parentTrace.traceId } }
        : {})
    })
    const skillSelection = await selectAgentSkills({ prompt: chatEntry.prompt })
    if (skillSelection.requiresUserChoice) {
      const failure = skillSelection.failure || {}
      const message = `${failure.message || 'The requested Skill could not be loaded.'} ` +
        '请明确选择：修复/启用该 Skill 后重试，或移除 $skill-id 并确认使用通用 Agent 继续。'
      setIsStreaming(false)
      updateChatEntry(chatEntry, {
        response: message,
        completionStatus: 'failed'
      })
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
      { role: 'system', content: buildAgentSystemPrompt(config, skillSelection) },
      ...buildAIConversationMessages(history, chatEntry)
    ]
    const runtimeMessages = []
    const toolCallsLog = []

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (abortRef && abortRef.current) {
        await markCancelled()
        return
      }

      activeBackendRequestId = `agent-${chatEntry.id}-${iteration}-${Date.now()}`
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
          requestTraceContext
        ),
        controller.signal
      )
      activeBackendRequestId = ''
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
          completionStatus: 'completed'
        })
        finishQuality('completed', 'completed')
        return
      }

      await prepareAgentRiskBatch(assistantMessage.tool_calls, agentRuntime)

      for (const toolCall of assistantMessage.tool_calls) {
        if (abortRef && abortRef.current) {
          await markCancelled()
          return
        }

        let args
        try {
          args = JSON.parse(toolCall.function.arguments)
        } catch {
          args = {}
        }

        const safeArgs = sanitizeAIChatHistory([{ args }])[0]?.args || {}
        const toolEntry = {
          id: toolCall.id,
          name: toolCall.function.name,
          args: safeArgs,
          status: 'running',
          result: null,
          presentation: buildAgentToolPresentation(
            toolCall.function.name,
            args,
            null,
            { endpoint: agentRuntime.endpoint }
          )
        }
        toolCallsLog.push(toolEntry)
        updateChatEntry(chatEntry, {
          toolCalls: [...toolCallsLog]
        })

        let toolResult
        try {
          toolResult = await waitForAgentOperation(
            executeToolCall(toolCall.function.name, args, agentRuntime),
            controller.signal
          )
          if (abortRef && abortRef.current) {
            await markCancelled()
            return
          }
          toolEntry.presentation = buildAgentToolPresentation(
            toolCall.function.name,
            args,
            toolResult,
            { endpoint: agentRuntime.endpoint }
          )
          const observation = await createAgentToolObservation(
            toolCall.function.name,
            toolResult,
            agentRuntime
          )
          toolEntry.status = 'completed'
          toolEntry.result = boundAgentToolResult(JSON.stringify(observation))
          toolResult = serializeAgentObservationForModel(observation)
        } catch (err) {
          if (abortRef && abortRef.current) {
            await markCancelled()
            return
          }
          await failAgentRiskBatch(agentRuntime, err, {
            toolName: toolCall.function.name,
            args
          })
          toolEntry.status = 'error'
          toolEntry.presentation = buildAgentToolPresentation(
            toolCall.function.name,
            args,
            { error: sanitizeAIStoredText(err.message) },
            { endpoint: agentRuntime.endpoint }
          )
          const observation = await createAgentToolObservation(
            toolCall.function.name,
            {
              error: true,
              data: sanitizeAIStoredText(err.message)
            },
            agentRuntime
          )
          toolEntry.result = boundAgentToolResult(JSON.stringify(observation))
          toolResult = serializeAgentObservationForModel(observation)
        }

        updateChatEntry(chatEntry, {
          toolCalls: [...toolCallsLog]
        })

        runtimeMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolEntry.status === 'completed'
            ? toolResult
            : toolEntry.result
        })
      }
    }

    setIsStreaming(false)
    updateChatEntry(chatEntry, {
      response: accumulatedContent + `\n\n*(${aiAgentCopy.maxIterationsText})*`,
      completionStatus: 'failed'
    })
    finishQuality('failed', 'failed')
  } catch (error) {
    if (controller.signal.aborted || abortRef.current || error?.name === 'AbortError') {
      await markCancelled()
      return
    }
    const safeError = sanitizeAIStoredText(error?.message || error)
    setIsStreaming(false)
    updateChatEntry(chatEntry, {
      response: accumulatedContent + `\n\n**${aiAgentCopy.errorLabel}:** ${safeError}`,
      completionStatus: 'failed'
    })
    finishQuality('failed', 'failed')
    return { ok: false, data: null, error: safeError }
  } finally {
    agentRuntime.cancellations.clear()
    if (abortRef.cancelCurrent === cancelCurrent) {
      delete abortRef.cancelCurrent
    }
    agentTaskRegistry.unregister(taskId)
  }
}
