import { assertSameSessionEndpoint } from '../../common/safety-transactions/endpoint-guard.js'
import { getDiagnosticTargetName } from './diagnostic-plan.js'

function normalizedKeyPart (value, limit = 160) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, limit)
}

function sameSessionEndpoint (expected, actual) {
  if (!expected || !actual) return false
  try {
    assertSameSessionEndpoint(expected, actual)
    return true
  } catch {
    return false
  }
}

function taskStoreMethod (store, genericName, taskName) {
  const method = store?.[taskName] || store?.[genericName]
  return typeof method === 'function' ? method.bind(store) : null
}

function timestamp (value) {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

export function createAgentDiagnosticKey (target = {}) {
  const requestId = normalizedKeyPart(target.requestId, 128)
  const kind = normalizedKeyPart(target.type || target.kind, 40)
  const name = normalizedKeyPart(getDiagnosticTargetName(target), 160)
  return `diagnostic:${JSON.stringify([requestId, kind, name])}`
}

export async function restoreAgentDiagnosticTask ({
  registry,
  store,
  scopeId,
  endpoint,
  diagnosticKey
} = {}) {
  const expectedKey = String(diagnosticKey || '')
  if (!store || !expectedKey || !endpoint) return null
  const get = taskStoreMethod(store, 'get', 'getTask')
  const list = taskStoreMethod(store, 'list', 'listTasks')
  const expectedScope = String(scopeId || '')
  const liveEntries = typeof registry?.list === 'function'
    ? registry.list().filter(entry => (
      entry?.kind === 'diagnostic' &&
      entry.diagnosticKey === expectedKey &&
      (!expectedScope || entry.scopeId === expectedScope) &&
      sameSessionEndpoint(endpoint, entry.endpoint)
    )).sort((left, right) => (
      timestamp(right.registeredAt) - timestamp(left.registeredAt)
    ))
    : []

  if (get) {
    for (const entry of liveEntries) {
      const task = await get(entry.taskId)
      if (task &&
        task.source === 'server-status' &&
        task.kind === 'diagnostic' &&
        task.metadata?.diagnosticKey === expectedKey &&
        sameSessionEndpoint(endpoint, task.endpoint)) {
        return { task, live: true }
      }
    }
  }

  if (!list) return null
  const tasks = await list()
  const matches = (Array.isArray(tasks) ? tasks : [])
    .filter(task => (
      task &&
      task.source === 'server-status' &&
      task.kind === 'diagnostic' &&
      task.metadata &&
      typeof task.metadata === 'object' &&
      !Array.isArray(task.metadata) &&
      task.metadata.diagnosticKey === expectedKey &&
      sameSessionEndpoint(endpoint, task.endpoint)
    ))
    .sort((left, right) => (
      timestamp(right.updatedAt) - timestamp(left.updatedAt) ||
      timestamp(right.createdAt) - timestamp(left.createdAt)
    ))
  return matches[0] ? { task: matches[0], live: false } : null
}
