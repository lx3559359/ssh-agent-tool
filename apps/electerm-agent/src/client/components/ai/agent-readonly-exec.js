import {
  assertSameSessionEndpoint,
  projectEndpoint
} from '../../common/safety-transactions/endpoint-guard.js'
import { createTrustedOperationId } from '../../common/safety-transactions/operation-id.js'
import {
  assertAgentRuntimeActive,
  registerAgentCancellation
} from './agent-runtime-context.js'
import { classifyAgentCall } from './agent-tool-policy.js'

const MAX_AGENT_READONLY_TIMEOUT_MS = 15000
const MAX_AGENT_READONLY_OUTPUT_BYTES = 32 * 1024

async function runCmd (...args) {
  const terminalApis = await import('../terminal/terminal-apis.js')
  return terminalApis.runCmd(...args)
}

async function cancelRunCmd (...args) {
  const terminalApis = await import('../terminal/terminal-apis.js')
  return terminalApis.cancelRunCmd(...args)
}

function rejectedCommandError (classification) {
  const error = new Error('Agent readonly command was rejected by system policy')
  error.code = 'AGENT_READONLY_COMMAND_REJECTED'
  error.classification = classification
  return error
}

function assertBoundEndpoint (expected, actual) {
  try {
    assertSameSessionEndpoint(expected, actual)
  } catch (cause) {
    const error = new Error('The active SSH session endpoint changed')
    error.code = 'SESSION_ENDPOINT_CHANGED'
    error.cause = cause
    throw error
  }
}

function endpointSnapshot (endpoint) {
  return Object.freeze({ ...projectEndpoint(endpoint) })
}

function normalizeAgentBound (value, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return maximum
  return Math.min(maximum, Math.max(1, Math.floor(number)))
}

export function createAgentReadonlyExecutionId () {
  return createTrustedOperationId('agent-readonly')
}

export async function executeAgentReadonlyCommand ({
  command,
  endpoint,
  resolveEndpoint,
  runtime,
  timeoutMs = 15000,
  maxOutputBytes = 32 * 1024,
  run = runCmd,
  cancel = cancelRunCmd,
  now = Date.now,
  createExecutionId = createAgentReadonlyExecutionId
} = {}) {
  const classification = classifyAgentCall({
    toolName: 'run_readonly_command',
    args: { command }
  })
  if (classification.outcome !== 'allowlisted-readonly') {
    throw rejectedCommandError(classification)
  }

  assertAgentRuntimeActive(runtime)
  assertBoundEndpoint(endpoint, resolveEndpoint())

  const capturedEndpoint = endpointSnapshot(endpoint)
  const executionId = createExecutionId()
  const startedAt = now()
  const options = {
    timeoutMs: normalizeAgentBound(
      timeoutMs,
      MAX_AGENT_READONLY_TIMEOUT_MS
    ),
    maxOutputBytes: normalizeAgentBound(
      maxOutputBytes,
      MAX_AGENT_READONLY_OUTPUT_BYTES
    ),
    executionId,
    ...(runtime?.signal ? { signal: runtime.signal } : {})
  }
  let dispatched = false
  const clearCancellation = registerAgentCancellation(runtime, () => {
    if (!dispatched) return undefined
    return cancel(capturedEndpoint.pid, executionId)
  })

  try {
    assertAgentRuntimeActive(runtime)
    dispatched = true
    const raw = await run(
      capturedEndpoint.pid,
      command,
      options
    )
    assertAgentRuntimeActive(runtime)
    assertBoundEndpoint(capturedEndpoint, resolveEndpoint())
    const capturedAt = now()

    return Object.freeze({
      kind: 'readonly-exec-result',
      command,
      executionId,
      endpoint: capturedEndpoint,
      capturedAt,
      durationMs: capturedAt - startedAt,
      exitCode: raw.code,
      signal: raw.signal,
      truncated: raw.truncated === true,
      output: [raw.stdout, raw.stderr].filter(Boolean).join('\n')
    })
  } finally {
    clearCancellation()
  }
}
