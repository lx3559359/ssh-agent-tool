import { assertSameSessionEndpoint } from '../../common/safety-transactions/endpoint-guard.js'
import {
  assertAgentExecutionAllowed,
  executeAgentToolWithGate
} from './agent-takeover-gate.js'
import {
  classifyAgentCall,
  getAgentToolDescriptor
} from './agent-tool-policy.js'

function policyError (classification) {
  const unauditable = classification.outcome === 'unauditable'
  const error = new Error(unauditable
    ? 'Agent tool call cannot be audited safely'
    : 'Agent tool call is blocked by system policy')
  error.code = unauditable
    ? 'AGENT_TOOL_UNAUDITABLE'
    : 'AGENT_TOOL_BLOCKED'
  error.classification = classification
  return error
}

export async function executeAgentTool ({
  toolName,
  args = {},
  expandedContent,
  descriptor,
  endpoint,
  resolveEndpoint,
  registry,
  assertTakeover = assertAgentExecutionAllowed,
  resolveDescriptor = getAgentToolDescriptor,
  classifyCall = classifyAgentCall,
  prepareRisky,
  execute
} = {}) {
  if (typeof execute !== 'function') {
    throw new TypeError('Agent tool executor must be a function')
  }
  const resolvedDescriptor = descriptor || resolveDescriptor(toolName)
  const currentEndpoint = typeof resolveEndpoint === 'function'
    ? resolveEndpoint()
    : endpoint
  assertTakeover({
    descriptor: resolvedDescriptor,
    endpoint: currentEndpoint,
    registry
  })
  if (resolvedDescriptor.scope !== 'conversation' && endpoint) {
    assertSameSessionEndpoint(endpoint, currentEndpoint)
  }
  const classification = classifyCall({
    descriptor: resolvedDescriptor,
    args,
    expandedContent
  })
  if (classification.outcome === 'blocked' ||
    classification.outcome === 'unauditable') {
    throw policyError(classification)
  }
  const risky = classification.outcome === 'risky'
  return executeAgentToolWithGate({
    descriptor: resolvedDescriptor,
    endpoint: currentEndpoint,
    resolveEndpoint,
    registry,
    risk: risky,
    prepare: risky && typeof prepareRisky === 'function'
      ? () => prepareRisky({
          classification,
          endpoint: currentEndpoint,
          descriptor: resolvedDescriptor,
          args,
          expandedContent
        })
      : undefined,
    execute
  })
}
