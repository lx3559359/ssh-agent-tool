import {
  patchOperationTask,
  saveOperationTask
} from '../../common/operation-tasks/task-store.js'
import {
  operationTaskKinds,
  operationTaskStatuses
} from '../../common/operation-tasks/models.js'

function taskKey (session = {}, entry = {}) {
  return [
    session.pid,
    entry.definition?.id || entry.id,
    Number(entry.startedAt) || 0
  ].map(value => String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_')).join('-')
}

function taskId (session, entry) {
  return `ssh-tunnel-${taskKey(session, entry)}`
}

function healthStatus (state) {
  if (state === 'session-lost') return operationTaskStatuses.interrupted
  if (['failed', 'port-conflict'].includes(state)) {
    return operationTaskStatuses.failed
  }
  return operationTaskStatuses.running
}

function safeEvents (entry = {}) {
  return (Array.isArray(entry.events) ? entry.events : [])
    .slice(-50)
    .map(event => ({
      at: Number(event.at) || Date.now(),
      state: String(event.state || ''),
      code: String(event.code || '').slice(0, 120),
      message: String(event.message || '').slice(0, 240)
    }))
}

function runtimeMetadata (entry = {}) {
  return {
    health: entry.state || 'starting',
    reconnectAttempt: Number(entry.reconnectAttempt) || 0,
    lastTestAt: entry.lastTestAt || null,
    lastTest: entry.lastTest || null,
    events: safeEvents(entry)
  }
}

function sameRuntimeMetadata (metadata = {}, entry = {}) {
  const current = runtimeMetadata(entry)
  return metadata.health === current.health &&
    Number(metadata.reconnectAttempt) === current.reconnectAttempt &&
    (metadata.lastTestAt || null) === current.lastTestAt &&
    JSON.stringify(metadata.lastTest || null) === JSON.stringify(current.lastTest) &&
    JSON.stringify(metadata.events || []) === JSON.stringify(current.events)
}

export function createSshTunnelOperationTaskTracker ({
  saveTask = saveOperationTask,
  patchTask = patchOperationTask
} = {}) {
  const current = new Map()

  async function replace (id, next) {
    const saved = await saveTask(next)
    current.set(id, saved || next)
    return saved || next
  }

  async function patch (id, changes) {
    const saved = await patchTask(id, changes)
    current.set(id, saved || {
      ...current.get(id),
      ...changes,
      metadata: {
        ...current.get(id)?.metadata,
        ...changes.metadata
      }
    })
    return current.get(id)
  }

  async function ensure (session, entry) {
    const id = taskId(session, entry)
    if (current.has(id)) return id
    await replace(id, {
      id,
      kind: operationTaskKinds.sshTunnel,
      status: operationTaskStatuses.running,
      title: entry.definition?.name || 'SSH 隧道',
      endpoint: {
        host: session.host,
        port: session.port,
        username: session.username
      },
      metadata: {
        runtimeKey: taskKey(session, entry),
        tunnelId: entry.definition?.id || entry.id,
        definition: entry.definition || {},
        startedAt: entry.startedAt,
        ...runtimeMetadata(entry)
      }
    })
    return id
  }

  async function syncOne (session, entry) {
    const id = await ensure(session, entry)
    const previous = current.get(id)
    const nextStatus = healthStatus(entry.state)
    if (previous.status === operationTaskStatuses.interrupted &&
      nextStatus === operationTaskStatuses.running) {
      await patch(id, { status: operationTaskStatuses.resuming })
      await patch(id, {
        status: operationTaskStatuses.running,
        metadata: runtimeMetadata(entry)
      })
      return
    }
    if (previous.status !== nextStatus) {
      await patch(id, {
        status: nextStatus,
        metadata: runtimeMetadata(entry)
      })
      return
    }
    if (sameRuntimeMetadata(previous.metadata, entry)) return
    await patch(id, {
      metadata: runtimeMetadata(entry)
    })
  }

  async function sync (session, entries = []) {
    await Promise.all((Array.isArray(entries) ? entries : []).map(entry => {
      return syncOne(session, entry)
    }))
  }

  async function stopped (session, entry) {
    const id = await ensure(session, entry)
    const previous = current.get(id)
    return replace(id, {
      ...previous,
      status: operationTaskStatuses.completed,
      metadata: {
        ...previous.metadata,
        health: 'stopped',
        events: safeEvents(entry)
      },
      updatedAt: undefined
    })
  }

  return {
    sync,
    stopped
  }
}

export const sshTunnelOperationTaskTracker =
  createSshTunnelOperationTaskTracker()
