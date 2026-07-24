import { defineOperationsTool } from '../../shared/definition.js'

export function defineReadOnlyRunbook ({
  id,
  title,
  description,
  category,
  parameters,
  steps
}) {
  return defineOperationsTool({
    id,
    title,
    description,
    category,
    type: 'script',
    risk: 'read-only',
    parameters,
    steps
  })
}

export function readOnlyStep (
  id,
  title,
  command,
  buildCommand,
  timeoutMs = 60000
) {
  return {
    id,
    title,
    command,
    buildCommand,
    timeoutMs
  }
}
