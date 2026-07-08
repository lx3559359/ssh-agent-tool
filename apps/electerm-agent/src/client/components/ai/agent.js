import { agentTools, executeToolCall } from './agent-tools'
import { buildAgentSkillPrompt } from './agent-skills'
import { buildAgentMcpServerPrompt } from './agent-mcp-servers'
import { buildAgentLocalCliPrompt } from './agent-local-cli-tools'
import aiAgentCopy from './ai-agent-copy.json'

const MAX_ITERATIONS = 150

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
  return `${baseRole}

${aiAgentCopy.agentPromptRules.join('\n')}

${skillPrompt}

${mcpServerPrompt}

${localCliPrompt}

可用工具：
- 在终端标签页执行命令并读取输出
- 打开新的本地或 SSH 终端标签页
- 管理连接书签，包括创建、列出和打开连接
- 在标签页之间切换
- 通过 SFTP 传输文件，包括上传、下载、列目录、读取和删除远程文件

请使用${lang}回答。`
}

function updateChatEntry (chatEntry, updates) {
  const index = window.store.aiChatHistory.findIndex(i => i.id === chatEntry.id)
  if (index !== -1) {
    Object.assign(window.store.aiChatHistory[index], updates)
    window.store.aiChatHistory = [...window.store.aiChatHistory]
  }
}

async function callBackendAIchatWithTools (messages, config) {
  return window.pre.runGlobalAsync(
    'AIchatWithTools',
    messages,
    config.modelAI,
    config.baseURLAI,
    config.apiPathAI,
    config.apiKeyAI,
    config.proxyAI,
    agentTools,
    config.authHeaderNameAI
  )
}

export async function runAgentLoop (chatEntry, config, abortRef, setIsStreaming) {
  window.store.agentRunning = true
  try {
    const messages = [
      { role: 'system', content: buildAgentSystemPrompt(config) },
      { role: 'user', content: chatEntry.prompt }
    ]
    const toolCallsLog = []
    let accumulatedContent = ''

    setIsStreaming(true)
    updateChatEntry(chatEntry, {
      toolCalls: [],
      response: ''
    })

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (abortRef && abortRef.current) {
        setIsStreaming(false)
        updateChatEntry(chatEntry, {
          response: accumulatedContent + `\n\n*(${aiAgentCopy.stoppedText})*`
        })
        return
      }

      const result = await callBackendAIchatWithTools(messages, config)

      if (result.error) {
        setIsStreaming(false)
        updateChatEntry(chatEntry, {
          response: accumulatedContent + `\n\n**${aiAgentCopy.errorLabel}:** ${result.error}`
        })
        return
      }

      const assistantMessage = result.message
      if (!assistantMessage) {
        setIsStreaming(false)
        updateChatEntry(chatEntry, {
          response: accumulatedContent || aiAgentCopy.noResponseText
        })
        return
      }

      messages.push(assistantMessage)

      if (assistantMessage.content) {
        accumulatedContent += (accumulatedContent ? '\n\n' : '') + assistantMessage.content
        updateChatEntry(chatEntry, {
          response: accumulatedContent
        })
      }

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        setIsStreaming(false)
        updateChatEntry(chatEntry, {
          response: accumulatedContent
        })
        return
      }

      for (const toolCall of assistantMessage.tool_calls) {
        if (abortRef && abortRef.current) {
          setIsStreaming(false)
          updateChatEntry(chatEntry, {
            response: accumulatedContent + `\n\n*(${aiAgentCopy.stoppedText})*`
          })
          return
        }

        let args
        try {
          args = JSON.parse(toolCall.function.arguments)
        } catch {
          args = {}
        }

        const toolEntry = {
          id: toolCall.id,
          name: toolCall.function.name,
          args,
          status: 'running',
          result: null
        }
        toolCallsLog.push(toolEntry)
        updateChatEntry(chatEntry, {
          toolCalls: [...toolCallsLog]
        })

        let toolResult
        try {
          toolResult = await executeToolCall(toolCall.function.name, args)
          toolEntry.status = 'completed'
          toolEntry.result = toolResult
        } catch (err) {
          toolEntry.status = 'error'
          toolEntry.result = err.message
        }

        updateChatEntry(chatEntry, {
          toolCalls: [...toolCallsLog]
        })

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolEntry.result
        })
      }
    }

    setIsStreaming(false)
    updateChatEntry(chatEntry, {
      response: accumulatedContent + `\n\n*(${aiAgentCopy.maxIterationsText})*`
    })
  } finally {
    window.store.agentRunning = false
  }
}
