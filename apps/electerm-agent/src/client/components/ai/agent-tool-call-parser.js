import { validateAgentJsonSchema } from './agent-json-schema.js'

function unknownAgentTool (name) {
  const error = new Error(`Unknown Agent tool: ${name}`)
  error.code = 'UNKNOWN_AGENT_TOOL'
  throw error
}

function deepFreeze (value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function argumentBytes (text) {
  return new TextEncoder().encode(text).byteLength
}

export function parseAgentToolCall (toolCall = {}, {
  resolveDescriptor = unknownAgentTool,
  maxArgumentBytes = 256 * 1024
} = {}) {
  const name = String(toolCall?.function?.name || '')
  const source = toolCall?.function?.arguments
  const text = source === undefined || source === '' ? '{}' : String(source)
  if (argumentBytes(text) > maxArgumentBytes) {
    const error = new Error('Agent tool arguments exceed the byte limit')
    error.code = 'AGENT_TOOL_ARGUMENTS_TOO_LARGE'
    throw error
  }

  let args
  try {
    args = JSON.parse(text)
  } catch (cause) {
    const error = new Error('Agent tool arguments are not valid JSON')
    error.code = 'AGENT_TOOL_ARGUMENTS_INVALID_JSON'
    error.cause = cause
    throw error
  }

  const descriptor = resolveDescriptor(name)
  validateAgentJsonSchema(
    descriptor.function?.parameters || { type: 'object' },
    args
  )
  deepFreeze(args)
  return Object.freeze({
    id: String(toolCall.id || ''),
    name,
    args,
    descriptor
  })
}
