import { agentTools, executeToolCall } from './agent-tools'
import { buildAgentSkillPrompt } from './agent-skills'
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
import {
  boundAgentToolResult,
  buildBoundedAgentMessages,
  cancelAgentRuntimeOperations,
  resolveAgentRuntimeEndpoint
} from './agent-runtime-context.js'
import {
  agentTakeoverRegistry
} from './agent-takeover-registry.js'

const MAX_ITERATIONS = 150
const activeAgentRuns = new Map()
const agentApiTools = Object.freeze(
  agentTools.map(({ scope, ...tool }) => tool)
)

export function cancelAgentRun (chatId) {
  const cancel = activeAgentRuns.get(String(chatId || ''))
  if (!cancel) return false
  cancel()
  return true
}

export function isAgentRunActive (chatId) {
  return activeAgentRuns.has(String(chatId || ''))
}

function buildAgentSystemPrompt (config) {
  const lang = config.languageAI || window.store.getLangName() || '简体中文'
  const baseRole = config.roleAI || '你是一个中文 SSH 运维排查助手。'
  const skillPrompt = buildAgentSkillPrompt({
    customSkills: config.agentSkills || window.store.config?.agentSkills || []
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

async function callBackendAIchatWithTools (messages, config, requestId) {
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
    requestId
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

export async function runAgentLoop (chatEntry, config, abortRef, setIsStreaming, history = []) {
  if (window.store.agentRunning) {
    const lockedResult = {
      ok: false,
      data: null,
      error: '已有 Agent 任务正在运行，请等待任务结束或先取消当前任务。'
    }
    setIsStreaming(false)
    updateChatEntry(chatEntry, {
      response: `**${aiAgentCopy.errorLabel}:** ${lockedResult.error}`,
      completionStatus: 'failed'
    })
    return lockedResult
  }
  window.store.agentRunning = true
  let accumulatedContent = ''
  const controller = new AbortController()
  let activeBackendRequestId = ''
  const sourceTabId = chatEntry.sourceTabId || chatEntry.conversationScopeId || ''
  const resolveEndpoint = () => resolveAgentRuntimeEndpoint(sourceTabId)
  const agentRuntime = {
    planConfirmed: false,
    sourceTabId,
    endpoint: resolveEndpoint(),
    resolveEndpoint,
    takeoverRegistry: agentTakeoverRegistry,
    signal: controller.signal,
    cancelActiveTool: null,
    cancellations: new Set()
  }

  function cancelCurrent () {
    abortRef.current = true
    controller.abort()
    cancelAgentRuntimeOperations(agentRuntime)
    if (activeBackendRequestId) {
      window.pre.runGlobalAsync('AIAgentCancel', activeBackendRequestId)
        .catch(() => {})
    }
  }
  abortRef.cancelCurrent = cancelCurrent
  activeAgentRuns.set(String(chatEntry.id), cancelCurrent)

  function markCancelled () {
    setIsStreaming(false)
    updateChatEntry(chatEntry, {
      response: accumulatedContent + `\n\n*(${aiAgentCopy.stoppedText})*`,
      completionStatus: 'cancelled'
    })
  }

  try {
    const baseMessages = [
      { role: 'system', content: buildAgentSystemPrompt(config) },
      ...buildAIConversationMessages(history, chatEntry)
    ]
    const runtimeMessages = []
    const toolCallsLog = []
    setIsStreaming(true)
    updateChatEntry(chatEntry, {
      toolCalls: [],
      response: '',
      completionStatus: 'running'
    })

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (abortRef && abortRef.current) {
        markCancelled()
        return
      }

      activeBackendRequestId = `agent-${chatEntry.id}-${iteration}-${Date.now()}`
      const backendResult = await waitForAgentOperation(
        callBackendAIchatWithTools(
          buildBoundedAgentMessages(baseMessages, runtimeMessages),
          config,
          activeBackendRequestId
        ),
        controller.signal
      )
      activeBackendRequestId = ''
      if (abortRef && abortRef.current) {
        markCancelled()
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
        return
      }

      for (const toolCall of assistantMessage.tool_calls) {
        if (abortRef && abortRef.current) {
          markCancelled()
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
          result: null
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
            markCancelled()
            return
          }
          toolEntry.status = 'completed'
          toolEntry.result = boundAgentToolResult(
            sanitizeAIStoredText(boundAgentToolResult(toolResult))
          )
        } catch (err) {
          if (abortRef && abortRef.current) {
            markCancelled()
            return
          }
          toolEntry.status = 'error'
          toolEntry.result = sanitizeAIStoredText(err.message)
        }

        updateChatEntry(chatEntry, {
          toolCalls: [...toolCallsLog]
        })

        runtimeMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolEntry.result
        })
      }
    }

    setIsStreaming(false)
    updateChatEntry(chatEntry, {
      response: accumulatedContent + `\n\n*(${aiAgentCopy.maxIterationsText})*`,
      completionStatus: 'failed'
    })
  } catch (error) {
    if (controller.signal.aborted || abortRef.current || error?.name === 'AbortError') {
      markCancelled()
      return
    }
    const safeError = sanitizeAIStoredText(error?.message || error)
    setIsStreaming(false)
    updateChatEntry(chatEntry, {
      response: accumulatedContent + `\n\n**${aiAgentCopy.errorLabel}:** ${safeError}`,
      completionStatus: 'failed'
    })
    return { ok: false, data: null, error: safeError }
  } finally {
    agentRuntime.cancellations.clear()
    if (abortRef.cancelCurrent === cancelCurrent) {
      delete abortRef.cancelCurrent
    }
    if (activeAgentRuns.get(String(chatEntry.id)) === cancelCurrent) {
      activeAgentRuns.delete(String(chatEntry.id))
    }
    window.store.agentRunning = false
  }
}
