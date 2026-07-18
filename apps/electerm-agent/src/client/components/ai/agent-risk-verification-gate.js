import { assertSameSessionEndpoint } from '../../common/safety-transactions/endpoint-guard.js'
import { assertAgentExecutionAllowed } from './agent-takeover-gate.js'
import { resolveAgentExecutionEndpoint } from './agent-runtime-context.js'

export function assertAgentRiskVerificationAllowed ({
  expectedEndpoint,
  runtime = {},
  descriptor
} = {}) {
  const currentEndpoint = resolveAgentExecutionEndpoint({ descriptor, runtime })
  assertSameSessionEndpoint(expectedEndpoint, currentEndpoint)
  assertAgentExecutionAllowed({
    descriptor,
    endpoint: currentEndpoint,
    registry: runtime.takeoverRegistry
  })
  return currentEndpoint
}
