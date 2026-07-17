import {
  assertSameSessionEndpoint,
  projectEndpoint
} from '../../common/safety-transactions/endpoint-guard.js'

const TAB_SCOPED_AGENT_TOOLS = new Set([
  'read_service_status',
  'read_recent_logs',
  'verify_listening_port',
  'read_file_range',
  'send_terminal_command',
  'get_terminal_output',
  'sftp_list',
  'sftp_stat',
  'sftp_read_file',
  'sftp_del',
  'sftp_upload',
  'sftp_download',
  'sftp_transfer_list',
  'sftp_transfer_history',
  'get_terminal_status',
  'cancel_terminal_command',
  'run_background_command',
  'get_background_task_status',
  'get_background_task_log',
  'cancel_background_task',
  'switch_tab',
  'close_tab'
])

const MAX_AGENT_CONTEXT_CHARS = 92 * 1024
const MAX_AGENT_BASE_CHARS = 32 * 1024
const MAX_AGENT_MESSAGE_CHARS = 16 * 1024
const MAX_AGENT_TOOL_ARGUMENT_CHARS = 4 * 1024
const MAX_AGENT_RUNTIME_MESSAGES = 32

function boundedText (value, maxChars = MAX_AGENT_MESSAGE_CHARS) {
  const text = String(value ?? '')
  if (text.length <= maxChars) return text
  const marker = `\n...[已截断 ${text.length - maxChars} 个字符]...\n`
  const available = Math.max(0, maxChars - marker.length)
  const head = Math.ceil(available / 2)
  return text.slice(0, head) + marker + text.slice(text.length - (available - head))
}

function boundedToolCalls (toolCalls = []) {
  return toolCalls.map(toolCall => {
    const args = String(toolCall?.function?.arguments || '')
    return {
      ...toolCall,
      function: {
        ...(toolCall.function || {}),
        arguments: args.length <= MAX_AGENT_TOOL_ARGUMENT_CHARS
          ? args
          : JSON.stringify({
            truncated: true,
            originalCharacters: args.length
          })
      }
    }
  })
}

function boundedMessage (message = {}) {
  return {
    ...message,
    content: boundedText(message.content),
    ...(Array.isArray(message.tool_calls)
      ? { tool_calls: boundedToolCalls(message.tool_calls) }
      : {})
  }
}

function serializedLength (value) {
  return JSON.stringify(value).length
}

function takeRecentMessages (messages, maxChars, maxMessages = Infinity) {
  const selected = []
  let used = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = boundedMessage(messages[index])
    const size = serializedLength(message)
    if (selected.length && (used + size > maxChars || selected.length >= maxMessages)) break
    if (!selected.length || size <= maxChars) {
      selected.unshift(message)
      used += size
    }
  }
  return selected
}

function groupRuntimeMessages (messages = []) {
  const groups = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message?.role === 'tool') continue
    const group = [message]
    if (message?.role === 'assistant' && message.tool_calls?.length) {
      const ids = new Set(message.tool_calls.map(call => call.id))
      while (
        index + 1 < messages.length &&
        messages[index + 1]?.role === 'tool' &&
        ids.has(messages[index + 1].tool_call_id)
      ) {
        group.push(messages[++index])
      }
    }
    groups.push(group)
  }
  return groups
}

export function boundAgentToolResult (value) {
  let text
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value)
    } catch (error) {
      text = String(value ?? '')
    }
  }
  return boundedText(text)
}

export function buildBoundedAgentMessages (baseMessages = [], runtimeMessages = []) {
  const system = boundedMessage(baseMessages[0] || { role: 'system', content: '' })
  const base = takeRecentMessages(baseMessages.slice(1), MAX_AGENT_BASE_CHARS)
  const fixed = [system, ...base]
  let remainingChars = Math.max(
    MAX_AGENT_MESSAGE_CHARS,
    MAX_AGENT_CONTEXT_CHARS - serializedLength(fixed)
  )
  let remainingMessages = MAX_AGENT_RUNTIME_MESSAGES
  const selectedGroups = []
  const groups = groupRuntimeMessages(runtimeMessages)
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index].map(boundedMessage)
    const size = serializedLength(group)
    if (group.length > remainingMessages || size > remainingChars) break
    selectedGroups.unshift(group)
    remainingChars -= size
    remainingMessages -= group.length
  }
  return [...fixed, ...selectedGroups.flat()]
}

export function bindAgentToolArgs (toolName, args = {}, runtime = {}) {
  const safeArgs = { ...(args || {}) }
  if (
    TAB_SCOPED_AGENT_TOOLS.has(toolName) &&
    runtime.sourceTabId
  ) {
    safeArgs.tabId = runtime.sourceTabId
  }
  return safeArgs
}

function takeoverRequiredError (cause) {
  const error = new Error('AI takeover requires a complete active SSH session')
  error.code = 'AI_TAKEOVER_REQUIRED'
  if (cause) error.cause = cause
  return error
}

export function resolveAgentRuntimeEndpoint (sourceTabId, options = {}) {
  const tabId = String(sourceTabId || '').trim()
  if (!tabId || tabId === 'global') return null
  const refs = options.refs || (
    typeof window === 'undefined' ? undefined : window.refs
  )
  const terminal = refs?.get?.('term-' + tabId)
  if (
    !terminal ||
    terminal.isSsh?.() !== true ||
    typeof terminal.getTerminalSafetyEndpoint !== 'function'
  ) {
    return null
  }
  try {
    const endpoint = projectEndpoint(terminal.getTerminalSafetyEndpoint())
    return String(endpoint.tabId) === tabId ? endpoint : null
  } catch (_) {
    return null
  }
}

export function resolveAgentExecutionEndpoint ({
  descriptor,
  runtime = {}
} = {}) {
  if (descriptor?.scope === 'conversation') return null
  try {
    const candidate = typeof runtime.resolveEndpoint === 'function'
      ? runtime.resolveEndpoint()
      : runtime.endpoint
    const current = projectEndpoint(candidate)
    if (runtime.endpoint) {
      assertSameSessionEndpoint(projectEndpoint(runtime.endpoint), current)
    }
    return current
  } catch (error) {
    throw takeoverRequiredError(error)
  }
}

export function assertAgentRuntimeActive (runtime = {}) {
  if (!runtime.signal?.aborted) {
    return
  }
  const error = new Error('Agent request cancelled')
  error.name = 'AbortError'
  throw error
}

export function registerAgentCancellation (runtime = {}, cancel) {
  if (typeof cancel !== 'function') return () => {}
  const cancellations = runtime.cancellations || new Set()
  runtime.cancellations = cancellations
  let active = true
  let cancellation
  const wrappedCancel = () => {
    if (!active) return cancellation || Promise.resolve()
    active = false
    cancellations.delete(wrappedCancel)
    try {
      cancellation = Promise.resolve(cancel())
    } catch (error) {
      cancellation = Promise.reject(error)
    }
    return cancellation
  }
  cancellations.add(wrappedCancel)
  if (runtime.signal?.aborted) {
    wrappedCancel().catch(error => {
      if (typeof runtime.reportCancellationFailure === 'function') {
        runtime.reportCancellationFailure(error)
      } else {
        const errors = runtime.cancellationErrors || []
        errors.push(error)
        runtime.cancellationErrors = errors
      }
    })
  }
  return () => {
    active = false
    cancellations.delete(wrappedCancel)
  }
}

export function registerDeferredAgentCancellation (
  runtime = {},
  resourcePromise,
  cancelResource
) {
  if (typeof cancelResource !== 'function') return () => {}
  const resource = Promise.resolve(resourcePromise)
  return registerAgentCancellation(runtime, async () => {
    let value
    try {
      value = await resource
    } catch {
      return undefined
    }
    return cancelResource(value)
  })
}

export async function cancelAgentRuntimeOperations (runtime = {}) {
  const pending = []
  if (typeof runtime.cancelActiveTool === 'function') {
    try {
      pending.push(Promise.resolve(runtime.cancelActiveTool()))
    } catch (error) {
      pending.push(Promise.reject(error))
    }
  }
  runtime.cancelActiveTool = null
  for (const cancel of [...(runtime.cancellations || [])]) {
    pending.push(cancel())
  }
  const settled = await Promise.allSettled(pending)
  const errors = settled
    .filter(result => result.status === 'rejected')
    .map(result => result.reason)
    .concat(runtime.cancellationErrors || [])
  runtime.cancellationErrors = []
  if (errors.length) {
    const error = new AggregateError(errors, 'One or more Agent operations could not be cancelled')
    error.code = 'AGENT_CANCELLATION_FAILED'
    if (errors.some(item => item?.remoteState === 'unknown')) {
      error.remoteState = 'unknown'
      error.canAutoRetry = false
    }
    throw error
  }
  return settled.map(result => result.value)
}
