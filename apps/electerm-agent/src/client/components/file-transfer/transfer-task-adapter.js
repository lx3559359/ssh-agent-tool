import {
  patchOperationTask,
  saveOperationTask
} from '../../common/operation-tasks/task-store.js'
import {
  operationTaskKinds,
  operationTaskStatuses
} from '../../common/operation-tasks/models.js'

const progressInterval = 2000
const progressBytes = 4 * 1024 * 1024

function toTime (value) {
  const time = value instanceof Date ? value.getTime() : Number(value)
  return Number.isFinite(time) ? time : Date.now()
}

export function getTransferPrimaryAction (task = {}) {
  if ([
    operationTaskStatuses.paused,
    operationTaskStatuses.interrupted
  ].includes(task.status)) {
    return 'resume'
  }
  if ([
    operationTaskStatuses.pausing,
    operationTaskStatuses.resuming
  ].includes(task.status)) {
    return 'waiting'
  }
  if (task.status === operationTaskStatuses.running) return 'pause'
  return null
}

export function createTransferTaskAdapter ({
  saveTask = saveOperationTask,
  patchTask = patchOperationTask,
  clock = Date.now
} = {}) {
  const progressSnapshots = new Map()

  async function start (id, task = {}) {
    progressSnapshots.delete(id)
    await saveTask({
      ...task,
      id,
      kind: operationTaskKinds.sftpTransfer,
      status: operationTaskStatuses.queued
    })
    return patchTask(id, {
      status: operationTaskStatuses.running
    })
  }

  async function onProgress (id, progress = {}) {
    const now = toTime(clock())
    const transferred = Math.max(0, Number(progress.transferred) || 0)
    const previous = progressSnapshots.get(id)
    if (
      previous &&
      now - previous.time < progressInterval &&
      transferred - previous.transferred < progressBytes
    ) {
      return false
    }
    progressSnapshots.set(id, { time: now, transferred })
    await patchTask(id, {
      progress: {
        transferred,
        total: Math.max(0, Number(progress.total) || 0),
        speed: Math.max(0, Number(progress.speed) || 0),
        etaSeconds: Math.max(0, Number(progress.etaSeconds) || 0)
      }
    })
    return true
  }

  function requestPause (id) {
    return patchTask(id, {
      status: operationTaskStatuses.pausing
    })
  }

  function onPaused (id, checkpoint) {
    return patchTask(id, {
      status: operationTaskStatuses.paused,
      metadata: { checkpoint }
    })
  }

  async function onResume (id) {
    await patchTask(id, {
      status: operationTaskStatuses.resuming
    })
    return patchTask(id, {
      status: operationTaskStatuses.running
    })
  }

  function onInterrupted (id, reason = 'client-interrupted') {
    return patchTask(id, {
      status: operationTaskStatuses.interrupted,
      metadata: { interruptionReason: reason }
    })
  }

  function onCompleted (id, progress) {
    return patchTask(id, {
      status: operationTaskStatuses.completed,
      ...(progress ? { progress } : {})
    })
  }

  function onFailed (id, error) {
    return patchTask(id, {
      status: operationTaskStatuses.failed,
      metadata: {
        error: String(error?.message || error || '')
      }
    })
  }

  function onCancelled (id) {
    return patchTask(id, {
      status: operationTaskStatuses.cancelled
    })
  }

  return {
    start,
    onProgress,
    requestPause,
    onPaused,
    onResume,
    onInterrupted,
    onCompleted,
    onFailed,
    onCancelled
  }
}
