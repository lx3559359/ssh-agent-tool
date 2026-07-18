import {
  assertSameSessionEndpoint
} from '../../common/safety-transactions/endpoint-guard.js'
import { agentTaskRegistry } from './agent-task-registry.js'
import {
  agentTakeoverRegistry
} from './agent-takeover-registry.js'

export const AGENT_TAKEOVER_LIFECYCLE_EVENT = 'shellpilot:agent-takeover-lifecycle'

const supportedEvents = new Set([
  'disconnect',
  'reconnect-start',
  'tab-close',
  'endpoint-change',
  'app-before-quit',
  'manual-stop'
])

function sameEndpoint (expected, actual) {
  try {
    assertSameSessionEndpoint(expected, actual)
    return true
  } catch {
    return false
  }
}

function matchingRecords (event, registry) {
  const records = registry.snapshot()
  if (event.type === 'app-before-quit') return records
  if (event.endpoint) {
    const exact = records.filter(record => sameEndpoint(
      record.endpoint,
      event.endpoint
    ))
    if (exact.length) return exact
  }
  const tabId = String(event.tabId || event.endpoint?.tabId || '')
  return tabId
    ? records.filter(record => String(record.endpoint.tabId) === tabId)
    : []
}

function requestTaskCancellation (event, taskRegistry) {
  if (event.type === 'app-before-quit') return taskRegistry.cancelAll()
  if (event.endpoint) {
    const exactTasks = taskRegistry.listByEndpoint(event.endpoint)
    if (exactTasks.length) return taskRegistry.cancelByEndpoint(event.endpoint)
  }
  const tabId = String(event.tabId || event.endpoint?.tabId || '')
  return tabId ? taskRegistry.cancelByScope(tabId) : Promise.resolve([])
}

export async function handleAgentTakeoverLifecycleEvent (
  event = {},
  dependencies = {}
) {
  if (!supportedEvents.has(event.type)) {
    return { revoked: 0, cancelled: 0, errors: [] }
  }
  const takeoverRegistry = dependencies.takeoverRegistry || agentTakeoverRegistry
  const taskRegistry = dependencies.taskRegistry || agentTaskRegistry
  const records = matchingRecords(event, takeoverRegistry)
  const cancellation = requestTaskCancellation(event, taskRegistry)

  for (const record of records) {
    if (record.state !== 'stopping') {
      takeoverRegistry.stop(record.endpoint)
    }
  }

  let cancelled = []
  const errors = []
  try {
    cancelled = await cancellation
  } catch (error) {
    errors.push(error)
  } finally {
    for (const record of records) {
      takeoverRegistry.disable(record.endpoint, event.type)
    }
  }

  return {
    revoked: records.length,
    cancelled: cancelled.length,
    errors
  }
}

export function emitAgentTakeoverLifecycleEvent (detail = {}, target = window) {
  if (!target?.dispatchEvent || !supportedEvents.has(detail.type)) return false
  const CustomEventConstructor = target.CustomEvent || globalThis.CustomEvent
  let event
  if (typeof CustomEventConstructor === 'function') {
    event = new CustomEventConstructor(
      AGENT_TAKEOVER_LIFECYCLE_EVENT,
      { detail }
    )
  } else {
    event = new Event(AGENT_TAKEOVER_LIFECYCLE_EVENT)
    Object.defineProperty(event, 'detail', { value: detail })
  }
  target.dispatchEvent(event)
  return true
}

export function installAgentTakeoverLifecycle (options = {}) {
  const target = options.target || window
  const onError = typeof options.onError === 'function'
    ? options.onError
    : () => {}
  const listener = event => {
    handleAgentTakeoverLifecycleEvent(event.detail).catch(onError)
  }
  const beforeUnload = () => {
    handleAgentTakeoverLifecycleEvent({ type: 'app-before-quit' }).catch(onError)
  }
  target.addEventListener(AGENT_TAKEOVER_LIFECYCLE_EVENT, listener)
  target.addEventListener('beforeunload', beforeUnload)
  return () => {
    target.removeEventListener(AGENT_TAKEOVER_LIFECYCLE_EVENT, listener)
    target.removeEventListener('beforeunload', beforeUnload)
  }
}

export function stopAgentTakeover (endpoint) {
  return handleAgentTakeoverLifecycleEvent({
    type: 'manual-stop',
    endpoint,
    tabId: endpoint?.tabId
  })
}
