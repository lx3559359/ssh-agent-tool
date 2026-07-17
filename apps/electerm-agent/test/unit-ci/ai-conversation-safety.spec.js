const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const contextPath = path.resolve(
  __dirname,
  '../../src/client/components/ai/ai-conversation-context.js'
)
const scrollPath = path.resolve(
  __dirname,
  '../../src/client/components/ai/ai-chat-scroll.js'
)
const actionsPath = path.resolve(
  __dirname,
  '../../src/client/components/ai/ai-chat-actions.js'
)
const runtimePath = path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-runtime-context.js'
)

test('conversation context is isolated to the current terminal scope', async () => {
  const { buildAIConversationMessages } = await import(pathToFileURL(contextPath))
  const history = [
    { id: 'a', conversationScopeId: 'tab-a', prompt: 'A question', response: 'A answer', completionStatus: 'completed' },
    { id: 'b', conversationScopeId: 'tab-b', prompt: 'B question', response: 'B answer', completionStatus: 'completed' },
    { id: 'current', conversationScopeId: 'tab-b', prompt: 'continue', response: '', completionStatus: 'pending' }
  ]

  assert.deepEqual(buildAIConversationMessages(history, history[2]), [
    { role: 'user', content: 'B question' },
    { role: 'assistant', content: 'B answer' },
    { role: 'user', content: 'continue' }
  ])
})

test('conversation context excludes partial responses and retries from before the original turn', async () => {
  const { buildAIConversationMessages } = await import(pathToFileURL(contextPath))
  const history = [
    { id: 'before', prompt: 'before', response: 'before answer', completionStatus: 'completed' },
    { id: 'partial', prompt: 'partial', response: 'half answer', completionStatus: 'running' },
    { id: 'original', prompt: 'target', response: 'old answer', completionStatus: 'completed' },
    { id: 'after', prompt: 'after', response: 'after answer', completionStatus: 'completed' },
    { id: 'retry', retryOfId: 'original', prompt: 'target', response: '', completionStatus: 'pending' }
  ]

  assert.deepEqual(buildAIConversationMessages(history, history[4]), [
    { role: 'user', content: 'before' },
    { role: 'assistant', content: 'before answer' },
    { role: 'user', content: 'target' }
  ])
})

test('completed retries replace the abandoned branch for later follow-ups', async () => {
  const { buildAIConversationMessages } = await import(pathToFileURL(contextPath))
  const history = [
    { id: 'before', timestamp: 10, conversationScopeId: 'tab-a', prompt: 'before', response: 'before answer', completionStatus: 'completed' },
    { id: 'original', timestamp: 20, conversationScopeId: 'tab-a', prompt: 'target', response: 'old answer', completionStatus: 'completed' },
    { id: 'abandoned', timestamp: 30, conversationScopeId: 'tab-a', prompt: 'old follow-up', response: 'old branch', completionStatus: 'completed' },
    { id: 'retry', timestamp: 40, retryOfId: 'original', retryOfTimestamp: 20, conversationScopeId: 'tab-a', prompt: 'target', response: 'new answer', completionStatus: 'completed' },
    { id: 'current', timestamp: 50, conversationScopeId: 'tab-a', prompt: 'continue', response: '', completionStatus: 'pending' }
  ]

  assert.deepEqual(buildAIConversationMessages(history, history[4]), [
    { role: 'user', content: 'before' },
    { role: 'assistant', content: 'before answer' },
    { role: 'user', content: 'target' },
    { role: 'assistant', content: 'new answer' },
    { role: 'user', content: 'continue' }
  ])
})

test('retry branches prefer the exact retry id when timestamps collide', async () => {
  const { buildAIConversationMessages } = await import(pathToFileURL(contextPath))
  const history = [
    { id: 'before', timestamp: 10, conversationScopeId: 'tab-a', prompt: 'before', response: 'before answer', completionStatus: 'completed' },
    { id: 'same-time', timestamp: 20, conversationScopeId: 'tab-a', prompt: 'keep me', response: 'keep answer', completionStatus: 'completed' },
    { id: 'original', timestamp: 20, conversationScopeId: 'tab-a', prompt: 'target', response: 'old answer', completionStatus: 'completed' },
    { id: 'retry', timestamp: 30, retryOfId: 'original', retryOfTimestamp: 20, conversationScopeId: 'tab-a', prompt: 'target', response: 'new answer', completionStatus: 'completed' },
    { id: 'current', timestamp: 40, conversationScopeId: 'tab-a', prompt: 'continue', completionStatus: 'pending' }
  ]

  assert.deepEqual(buildAIConversationMessages(history, history[4]), [
    { role: 'user', content: 'before' },
    { role: 'assistant', content: 'before answer' },
    { role: 'user', content: 'keep me' },
    { role: 'assistant', content: 'keep answer' },
    { role: 'user', content: 'target' },
    { role: 'assistant', content: 'new answer' },
    { role: 'user', content: 'continue' }
  ])
})

test('repeated retries keep the original branch root stable', async () => {
  const { createRetryChatEntry } = await import(pathToFileURL(actionsPath))
  const firstRetry = createRetryChatEntry({
    id: 'original',
    timestamp: 20,
    prompt: 'target'
  }, { id: 'retry-1', timestamp: 40 })
  const secondRetry = createRetryChatEntry(firstRetry, {
    id: 'retry-2',
    timestamp: 60
  })

  assert.equal(secondRetry.retryOfId, 'original')
  assert.equal(secondRetry.retryOfTimestamp, 20)
})

test('legacy history remains visible but is not sent as ambiguous context', async () => {
  const { buildAIConversationMessages } = await import(pathToFileURL(contextPath))
  const history = [
    { id: 'legacy', prompt: 'old question', response: 'partial or complete is unknown' },
    { id: 'current', conversationScopeId: 'tab-a', prompt: 'new question', completionStatus: 'pending' }
  ]

  assert.deepEqual(buildAIConversationMessages(history, history[1]), [
    { role: 'user', content: 'new question' }
  ])
})

test('Agent tab-scoped tools stay bound to the tab that started the conversation', async () => {
  const { bindAgentToolArgs } = await import(pathToFileURL(runtimePath))
  const agentTools = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
    'utf8'
  )

  assert.deepEqual(
    bindAgentToolArgs('send_terminal_command', { command: 'uptime' }, { sourceTabId: 'tab-a' }),
    { command: 'uptime', tabId: 'tab-a' }
  )
  assert.deepEqual(
    bindAgentToolArgs('send_terminal_command', { command: 'uptime', tabId: 'tab-b' }, { sourceTabId: 'tab-a' }),
    { command: 'uptime', tabId: 'tab-a' }
  )
  assert.deepEqual(
    bindAgentToolArgs('list_tabs', {}, { sourceTabId: 'tab-a' }),
    {}
  )
  assert.match(agentTools, /bindAgentToolArgs\(toolName,\s*rawArgs,\s*runtime\)/)
})

test('Agent runtime context keeps the current request and bounds tool output', async () => {
  const {
    boundAgentToolResult,
    buildBoundedAgentMessages
  } = await import(pathToFileURL(runtimePath))
  const hugeResult = `result-start-${'x'.repeat(128 * 1024)}-result-end`
  const boundedResult = boundAgentToolResult(hugeResult)
  const circularResult = {}
  circularResult.self = circularResult
  const baseMessages = [
    { role: 'system', content: 'system rules' },
    { role: 'user', content: 'current request must survive' }
  ]
  const runtimeMessages = []
  for (let index = 0; index < 80; index += 1) {
    runtimeMessages.push({
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: `call-${index}`,
        type: 'function',
        function: { name: 'sftp_read_file', arguments: '{}' }
      }]
    })
    runtimeMessages.push({
      role: 'tool',
      tool_call_id: `call-${index}`,
      content: boundedResult
    })
  }

  const messages = buildBoundedAgentMessages(baseMessages, runtimeMessages)
  const serialized = JSON.stringify(messages)
  assert.match(boundedResult, /^result-start-/)
  assert.match(boundedResult, /-result-end$/)
  assert.ok(boundedResult.length < hugeResult.length)
  assert.equal(boundAgentToolResult(circularResult), '[object Object]')
  assert.match(serialized, /current request must survive/)
  assert.ok(serialized.length <= 100 * 1024)
  assert.equal(messages.at(-2).role, 'assistant')
  assert.equal(messages.at(-1).role, 'tool')
  assert.equal(messages.at(-2).tool_calls[0].id, messages.at(-1).tool_call_id)

  const agent = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
    'utf8'
  )
  assert.match(agent, /callBackendAIchatWithTools\(\s*buildBoundedAgentMessages\(/)
  assert.match(
    agent,
    /boundAgentToolResult\(\s*sanitizeAIStoredText\(boundAgentToolResult\(toolResult\)\)\s*\)/
  )
})

test('Agent SFTP reads use a bounded chunk instead of loading the whole file', () => {
  const handler = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/mcp-handler.js'),
    'utf8'
  )
  assert.match(
    handler,
    /mcpSftpReadFile[\s\S]{0,1200}sftp\.readFileChunk\(remotePath,\s*\{[\s\S]{0,180}maxBytes/
  )
  assert.doesNotMatch(
    handler,
    /mcpSftpReadFile[\s\S]{0,700}sftp\.readFile\(remotePath\)/
  )
})

test('Agent SFTP read tool exposes offset and bounded maxBytes pagination', () => {
  const tools = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
    'utf8'
  )
  const readTool = tools.slice(
    tools.indexOf("name: 'sftp_read_file'"),
    tools.indexOf("name: 'sftp_del'")
  )

  assert.match(readTool, /offset:\s*\{[\s\S]*?type:\s*'integer'[\s\S]*?minimum:\s*0/)
  assert.match(readTool, /maxBytes:\s*\{[\s\S]*?type:\s*'integer'[\s\S]*?maximum:\s*64 \* 1024/)
})

test('AI history unmount pauses polling without cancelling active work', () => {
  const historyItem = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'),
    'utf8'
  )
  const effectStart = historyItem.indexOf('useEffect(() => {')
  const effectEnd = historyItem.indexOf('\n  async function handleStop', effectStart)
  const lifecycle = historyItem.slice(effectStart, effectEnd)

  assert.match(lifecycle, /completionStatus === 'running'[\s\S]*?resumeStreamSession/)
  assert.doesNotMatch(lifecycle, /AIChatCancel|stopAIStreamSafely|cancelCurrent\?\./)
})

test('Agent runs remain explicitly cancellable after the chat panel remounts', () => {
  const agent = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
    'utf8'
  )
  const historyItem = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'),
    'utf8'
  )

  assert.match(agent, /agentTaskRegistry/)
  assert.match(agent, /export function cancelAgentRun/)
  assert.match(agent, /agentTaskRegistry\.register\(/)
  assert.match(historyItem, /cancelAgentRun\(item\.id\)/)
})

test('AI request failure keeps already received partial output visible', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'),
    'utf8'
  )
  assert.match(source, /buildAIRequestFailureText\s*\(error,\s*existingResponse/)
  assert.match(source, /existingResponse[\s\S]*?errorText/)
})

test('conversation context keeps a bounded copy of the latest oversized turn', async () => {
  const { buildAIConversationMessages } = await import(pathToFileURL(contextPath))
  const oversizedPrompt = `prompt-start-${'a'.repeat(64 * 1024)}-prompt-end`
  const oversizedResponse = `response-start-${'b'.repeat(64 * 1024)}-response-end`
  const history = [
    { id: 'huge-1', conversationScopeId: 'tab-a', prompt: 'older question', response: 'older answer', completionStatus: 'completed' },
    { id: 'huge-2', conversationScopeId: 'tab-a', prompt: oversizedPrompt, response: oversizedResponse, completionStatus: 'completed' },
    { id: 'current', conversationScopeId: 'tab-a', prompt: '继续', completionStatus: 'pending' }
  ]
  const startedAt = performance.now()
  const messages = buildAIConversationMessages(history, history[2])

  assert.deepEqual(messages.map(item => item.role), [
    'user',
    'assistant',
    'user'
  ])
  assert.match(messages[0].content, /^prompt-start-/)
  assert.match(messages[0].content, /-prompt-end$/)
  assert.match(messages[1].content, /^response-start-/)
  assert.match(messages[1].content, /-response-end$/)
  assert.equal(messages[2].content, '继续')
  assert.ok(
    messages[0].content.length + messages[1].content.length <= 24000,
    'the bounded previous turn must stay within the history budget'
  )
  assert.doesNotMatch(JSON.stringify(messages), /older question|older answer/)
  assert.ok(
    performance.now() - startedAt < 1000,
    'oversized bounded history should not block the renderer'
  )
})

test('conversation context sanitizes a long single-line current prompt without blocking', async () => {
  const { buildAIConversationMessages } = await import(pathToFileURL(contextPath))
  const prompt = 'a'.repeat(64 * 1024)
  const startedAt = performance.now()
  const messages = buildAIConversationMessages([], {
    id: 'current-long',
    conversationScopeId: 'tab-a',
    prompt,
    completionStatus: 'pending'
  })

  assert.equal(messages[0].content, prompt)
  assert.ok(
    performance.now() - startedAt < 1000,
    'a long pasted log line should not block the renderer'
  )
})

test('conversation context sanitizes a direct current item before sending it', async () => {
  const { buildAIConversationMessages } = await import(pathToFileURL(contextPath))
  const messages = buildAIConversationMessages([], {
    id: 'current',
    prompt: 'check this\nAuthorization: Bearer direct-secret-value'
  })

  assert.match(messages[0].content, /check this/)
  assert.doesNotMatch(messages[0].content, /direct-secret-value/)
})

test('history scrolling only stays pinned while the reader is near the bottom', async () => {
  const { isAIHistoryNearBottom } = await import(pathToFileURL(scrollPath))

  assert.equal(isAIHistoryNearBottom({ scrollTop: 940, clientHeight: 500, scrollHeight: 1460 }), true)
  assert.equal(isAIHistoryNearBottom({ scrollTop: 300, clientHeight: 500, scrollHeight: 1460 }), false)
})

test('chat entries persist scope display text and explicit completion state', () => {
  const chat = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat.jsx'),
    'utf8'
  )
  const historyItem = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'),
    'utf8'
  )
  const agent = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
    'utf8'
  )

  assert.match(chat, /displayPrompt:\s*userPrompt/)
  assert.match(chat, /const\s+conversationScopeId\s*=\s*String\(\s*props\.conversationScopeId\s*\|\|\s*props\.activeTabId\s*\|\|\s*'global'\s*\)/)
  assert.match(chat, /conversationScopeId,/)
  assert.match(chat, /sourceTabId:\s*String\(props\.activeTabId/)
  assert.match(chat, /completionStatus:\s*'pending'/)
  assert.match(historyItem, /completionStatus:\s*streamResponse\.hasMore\s*\?\s*'running'\s*:\s*'completed'/)
  assert.match(historyItem, /const\s+visiblePrompt\s*=\s*item\.displayPrompt\s*\|\|\s*prompt/)
  assert.match(agent, /completionStatus:\s*'completed'/)
  assert.match(agent, /completionStatus:\s*'cancelled'/)
})

test('chat cancellation invalidates late polling and request failures stay visible', () => {
  const historyItem = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'),
    'utf8'
  )

  assert.match(historyItem, /requestEpochRef\.current\s*\+=\s*1/)
  assert.match(historyItem, /completionStatus:\s*'failed'/)
  assert.match(historyItem, /response:\s*buildAIRequestFailureText/)
  assert.match(historyItem, /setIsStreaming\(true\)[\s\S]*runGlobalAsync\(\s*'AIchat'/)
  assert.match(historyItem, /runGlobalAsync\(\s*'AIChatCancel',\s*initialRequestId/)
})

test('Agent cancellation remains effective while a tool confirmation is open', async () => {
  const {
    assertAgentRuntimeActive,
    cancelAgentRuntimeOperations,
    registerAgentCancellation
  } = await import(pathToFileURL(runtimePath))
  const controller = new AbortController()
  const cancelled = []
  const runtime = { signal: controller.signal }
  registerAgentCancellation(runtime, () => cancelled.push('transfer'))
  controller.abort()
  cancelAgentRuntimeOperations(runtime)

  assert.throws(
    () => assertAgentRuntimeActive(runtime),
    error => error?.name === 'AbortError'
  )
  assert.deepEqual(cancelled, ['transfer'])

  const tools = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
    'utf8'
  )
  for (const toolName of ['send_terminal_command', 'run_local_cli', 'run_background_command']) {
    const toolBranch = new RegExp(
      `case '${toolName}':[\\s\\S]*?confirmAgentToolExecution\\([\\s\\S]*?\\)\\r?\\n\\s*assertAgentRuntimeActive\\(runtime\\)`,
      'm'
    )
    assert.match(tools, toolBranch)
  }
  assert.match(tools, /case 'sftp_del':[\s\S]*?mcpSftpDel\(args,\s*\{\s*signal:\s*runtime\.signal\s*\}\)/)
  assert.match(tools, /case 'sftp_upload':[\s\S]*?registerAgentTransferCancellation/)
  assert.match(tools, /case 'sftp_download':[\s\S]*?registerAgentTransferCancellation/)
  assert.match(tools, /case 'run_local_cli':[\s\S]*?cancelLocalCli/)
  assert.match(tools, /case 'run_background_command':[\s\S]*?mcpCancelBackgroundTask/)

  const sftpEntry = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/sftp/sftp-entry.jsx'),
    'utf8'
  )
  assert.match(sftpEntry, /deleteRemoteFilesWithSafety\s*=\s*async\s*\(files,\s*options\s*=\s*\{\}\)/)
  assert.match(sftpEntry, /if\s*\(options\.signal\?\.aborted\)[\s\S]*?sftpSafetyRunner\.cancel/)
})

test('chat and Agent errors are sanitized before global notification or history storage', () => {
  const historyItem = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'),
    'utf8'
  )
  const agent = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
    'utf8'
  )

  assert.match(historyItem, /const\s+safeError\s*=\s*sanitizeAIStoredText/)
  assert.match(historyItem, /onError\(new Error\(safeError\)\)/)
  assert.doesNotMatch(historyItem, /onError\(new Error\(String\(error\)\)\)/)
  assert.match(agent, /const\s+safeAgentError\s*=\s*sanitizeAIStoredText/)
})

test('Agent retry is blocked while another Agent run owns the lock', () => {
  const historyItem = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'),
    'utf8'
  )
  const agent = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
    'utf8'
  )

  assert.match(historyItem, /mode\s*===\s*'agent'\s*&&\s*agentRunning/)
  assert.match(historyItem, /if\s*\(retryDisabled\)/)
  assert.match(agent, /AI_AGENT_SESSION_BUSY/)
  assert.doesNotMatch(agent, /window\.store\.agentRunning/)
})

test('long chat history avoids rerendering every unchanged message', () => {
  const historyItem = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'),
    'utf8'
  )
  const styles = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai.styl'),
    'utf8'
  )

  assert.match(historyItem, /export\s+default\s+memo\(function\s+AIChatHistoryItem/)
  assert.match(styles, /\.chat-history-item[\s\S]*?content-visibility\s+auto/)
})
