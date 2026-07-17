const MAX_LOG_LINES = 1000
const MAX_FILE_BYTES = 64 * 1024
const MAX_COMMAND_OUTPUT = 32 * 1024
const unitPattern = /^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,127}$/
const unsafePathCharacters = new Set([';', '&', '|', '`', '$', '<', '>'])

function hasUnsafePathCharacter (value) {
  return [...value].some(character => (
    character.charCodeAt(0) <= 31 || unsafePathCharacters.has(character)
  ))
}

function invalidArgument (message) {
  const error = new Error(message)
  error.code = 'AGENT_ARGUMENT_INVALID'
  throw error
}

function requiredUnit (value, field) {
  const unit = String(value || '').trim()
  if (!unitPattern.test(unit)) {
    invalidArgument(`${field} must be a static service or unit name`)
  }
  return unit
}

function requiredInteger (value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalidArgument(`${field} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function requiredRemotePath (value) {
  const remotePath = String(value || '')
  if (!remotePath.startsWith('/') || remotePath.length > 4096 || hasUnsafePathCharacter(remotePath)) {
    invalidArgument('remotePath must be a static absolute path without shell syntax')
  }
  return remotePath
}

export function validateStructuredArgs (toolName, rawArgs = {}) {
  const args = { ...(rawArgs || {}) }
  switch (toolName) {
    case 'read_service_status':
      return Object.freeze({
        ...args,
        service: requiredUnit(args.service, 'service')
      })
    case 'read_recent_logs':
      return Object.freeze({
        ...args,
        unit: requiredUnit(args.unit, 'unit'),
        limit: requiredInteger(args.limit, 'limit', 1, MAX_LOG_LINES)
      })
    case 'verify_listening_port': {
      const protocol = args.protocol === undefined ? 'tcp' : String(args.protocol)
      if (!['tcp', 'udp'].includes(protocol)) {
        invalidArgument('protocol must be tcp or udp')
      }
      return Object.freeze({
        ...args,
        port: requiredInteger(args.port, 'port', 1, 65535),
        protocol
      })
    }
    case 'read_file_range':
      return Object.freeze({
        ...args,
        remotePath: requiredRemotePath(args.remotePath),
        offset: requiredInteger(args.offset, 'offset', 0, Number.MAX_SAFE_INTEGER),
        length: requiredInteger(args.length, 'length', 1, MAX_FILE_BYTES)
      })
    default: {
      const error = new Error(`Unknown structured Agent tool: ${String(toolName)}`)
      error.code = 'UNKNOWN_AGENT_TOOL'
      throw error
    }
  }
}

export function buildStructuredCommand (toolName, rawArgs = {}) {
  const args = validateStructuredArgs(toolName, rawArgs)
  switch (toolName) {
    case 'read_service_status':
      return `systemctl show --no-pager --property=LoadState,ActiveState,SubState,UnitFileState ${args.service}`
    case 'read_recent_logs':
      return `journalctl --no-pager --unit=${args.unit} --lines=${args.limit} --output=short-iso`
    case 'verify_listening_port':
      return `ss -ln${args.protocol === 'tcp' ? 't' : 'u'}p 'sport = :${args.port}'`
    case 'read_file_range':
      return null
    default:
      return null
  }
}

function boundedOutput (value, limit) {
  const output = String(value ?? '')
  if (output.length <= limit) return { output, truncated: false }
  return {
    output: output.slice(0, limit),
    truncated: true
  }
}

function endpointSnapshot (endpoint) {
  return Object.freeze({ ...(endpoint || {}) })
}

function capturedTimestamp (capturedAt) {
  return typeof capturedAt === 'function' ? capturedAt() : Date.now()
}

export async function executeStructuredAgentTool ({
  toolName,
  args: rawArgs,
  endpoint,
  executeCommand,
  readFile,
  capturedAt
} = {}) {
  const args = validateStructuredArgs(toolName, rawArgs)
  let source
  let outputLimit = MAX_COMMAND_OUTPUT

  if (toolName === 'read_file_range') {
    if (typeof readFile !== 'function') {
      throw new TypeError('readFile is required for read_file_range')
    }
    outputLimit = args.length
    source = await readFile({
      remotePath: args.remotePath,
      offset: args.offset,
      maxBytes: args.length,
      tabId: args.tabId
    })
  } else {
    if (typeof executeCommand !== 'function') {
      throw new TypeError('executeCommand is required for structured command tools')
    }
    source = await executeCommand(buildStructuredCommand(toolName, args), args)
  }

  const bounded = boundedOutput(source?.content ?? source?.output, outputLimit)
  const hasMore = source?.hasMore === true
  const nextValue = source?.nextCursor ?? source?.nextOffset
  return Object.freeze({
    exitCode: Number.isInteger(source?.exitCode) ? source.exitCode : (toolName === 'read_file_range' ? 0 : null),
    truncated: bounded.truncated || source?.truncated === true || hasMore,
    nextCursor: nextValue === undefined || nextValue === null || !hasMore
      ? null
      : String(nextValue),
    capturedAt: capturedTimestamp(capturedAt),
    endpoint: endpointSnapshot(endpoint),
    output: bounded.output
  })
}

export const structuredAgentTools = Object.freeze([
  {
    type: 'function',
    function: {
      name: 'read_service_status',
      description: 'Read bounded systemd service state using a fixed readonly command.',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Static systemd service name.' }
        },
        required: ['service'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_recent_logs',
      description: 'Read a bounded number of recent journal entries using a fixed readonly command.',
      parameters: {
        type: 'object',
        properties: {
          unit: { type: 'string', description: 'Static systemd unit name.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_LOG_LINES }
        },
        required: ['unit', 'limit'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'verify_listening_port',
      description: 'Check one TCP or UDP listening port using a fixed readonly command.',
      parameters: {
        type: 'object',
        properties: {
          port: { type: 'integer', minimum: 1, maximum: 65535 },
          protocol: { type: 'string', enum: ['tcp', 'udp'], default: 'tcp' }
        },
        required: ['port'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file_range',
      description: 'Read one bounded SFTP byte range from a static absolute remote path.',
      parameters: {
        type: 'object',
        properties: {
          remotePath: { type: 'string', description: 'Static absolute remote file path.' },
          offset: { type: 'integer', minimum: 0 },
          length: { type: 'integer', minimum: 1, maximum: MAX_FILE_BYTES }
        },
        required: ['remotePath', 'offset', 'length'],
        additionalProperties: false
      }
    }
  }
])
