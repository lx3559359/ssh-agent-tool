import generate from '../uid.js'
import {
  finalOperationStates,
  normalizeOperation,
  operationSources,
  operationStates
} from './models.js'
import { redactSensitiveData } from './audit-redaction.js'
import {
  normalizeLegacySafetyOperationRecord,
  readSafetyOperationRecordsForMigration
} from '../safety-operation-records.js'
import { normalizeTraceContext } from '../quality/trace-context.js'
import { recordQualityEvent as emitQualityEvent } from '../quality/quality-events.js'

const operationTable = 'safetyOperations'
const taskTable = 'agentTasks'
const patchQueuesByAdapter = new WeakMap()
const traceContextFields = [
  'traceId',
  'operationId',
  'taskId',
  'requestId',
  'sessionId',
  'tabId',
  'module',
  'action'
]

export const legacyMigrationMarkerId = 'safetyOperations:legacy-migration:v1'
export const safetyTransactionUpdatedEvent = 'shellpilot-safety-transaction-updated'

export function emitSafetyTransactionUpdated (change = {}, eventTarget = globalThis.window) {
  const detail = {
    recordType: change.recordType === 'task' ? 'task' : 'operation',
    id: String(change.id || ''),
    action: String(change.action || 'patch')
  }
  if (!detail.id || typeof eventTarget?.dispatchEvent !== 'function') return detail
  try {
    eventTarget.dispatchEvent(new CustomEvent(safetyTransactionUpdatedEvent, { detail }))
  } catch {}
  return detail
}

export const taskStatuses = Object.freeze({
  draft: 'draft',
  awaitingPlanConfirmation: 'awaiting-plan-confirmation',
  runningReadonly: 'running-readonly',
  awaitingChangeConfirmation: 'awaiting-change-confirmation',
  runningChange: 'running-change',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  partiallyCompleted: 'partially-completed'
})

export const finalTaskStatuses = Object.freeze([
  taskStatuses.completed,
  taskStatuses.failed,
  taskStatuses.cancelled,
  taskStatuses.partiallyCompleted
])

const validTaskStatuses = new Set(Object.values(taskStatuses))
const validOperationSources = new Set(operationSources)
const completedOperationStates = new Set(finalOperationStates)

const defaultAdapter = {
  async update (...args) {
    const { update } = await import('../db.js')
    return update(...args)
  },
  async findOne (...args) {
    const { findOne } = await import('../db.js')
    return findOne(...args)
  },
  async find (...args) {
    const { find } = await import('../db.js')
    return find(...args)
  },
  async getData (...args) {
    const { getData } = await import('../db.js')
    return getData(...args)
  },
  async remove (...args) {
    const { remove } = await import('../db.js')
    return remove(...args)
  }
}

async function getDefaultLegacyStorage () {
  if (!('window' in globalThis)) return null
  return import('../safe-local-storage.js')
}

function resolveNow (clock) {
  const value = clock()
  const now = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(now.getTime())) throw new Error('当前时间无效')
  return now
}

function toTimestamp (value, fallback, label) {
  const date = value === undefined || value === null || value === ''
    ? fallback
    : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${label}时间无效`)
  return date.toISOString()
}

function nextUpdatedAt (current, requested, clock) {
  const previousTime = new Date(current).getTime()
  if (Number.isNaN(previousTime)) throw new Error('原更新时间无效')
  const now = resolveNow(clock)
  const requestedTime = requested === undefined || requested === null || requested === ''
    ? now.getTime()
    : new Date(requested).getTime()
  if (Number.isNaN(requestedTime)) throw new Error('更新时间无效')
  return new Date(Math.max(now.getTime(), requestedTime, previousTime + 1)).toISOString()
}

function assertTaskCommandsPersistable (task) {
  if (!Array.isArray(task.steps)) return
  for (const step of task.steps) {
    if (typeof step?.command !== 'string') continue
    if (redactSensitiveData(step.command) !== step.command) {
      throw new Error(`任务步骤 ${String(step.id || '')} 的可执行命令包含疑似敏感凭据，已拒绝持久化；请改用安全的凭据引用。`)
    }
  }
}

function preserveTaskCommands (task, safeTask) {
  if (!Array.isArray(task.steps) || !Array.isArray(safeTask.steps)) {
    return safeTask.steps
  }
  return safeTask.steps.map((safeStep, index) => {
    const originalStep = task.steps[index]
    return originalStep && Object.hasOwn(originalStep, 'command')
      ? { ...safeStep, command: originalStep.command }
      : safeStep
  })
}

function stripInternalTraceFields (record = {}) {
  const safeRecord = { ...record }
  delete safeRecord.traceContext
  for (const field of traceContextFields) delete safeRecord[field]

  if (record.metadata && typeof record.metadata === 'object' &&
    !Array.isArray(record.metadata)) {
    const metadata = { ...record.metadata }
    delete metadata.traceContext
    for (const field of traceContextFields) {
      if (field !== 'traceId') delete metadata[field]
    }
    const { traceId } = normalizeTraceContext({ traceId: metadata.traceId })
    if (traceId) metadata.traceId = traceId
    else delete metadata.traceId
    safeRecord.metadata = metadata
  }
  return safeRecord
}

function normalizeTask (task = {}, clock) {
  task = stripInternalTraceFields(task)
  const status = task.status || taskStatuses.draft
  if (!validTaskStatuses.has(status)) throw new Error('Agent 任务状态不受支持')
  const now = resolveNow(clock)
  assertTaskCommandsPersistable(task)
  const safeTask = redactSensitiveData(task)
  const safeSteps = preserveTaskCommands(task, safeTask)
  return {
    ...safeTask,
    ...(safeSteps === undefined ? {} : { steps: safeSteps }),
    id: String(task.id || generate()),
    schemaVersion: 1,
    status,
    createdAt: toTimestamp(task.createdAt, now, '创建'),
    updatedAt: toTimestamp(task.updatedAt, now, '更新')
  }
}

function mergePatch (current, patch) {
  const merged = {
    ...current,
    ...patch
  }
  if (patch.endpoint) {
    merged.endpoint = {
      ...current.endpoint,
      ...patch.endpoint
    }
  }
  if (patch.metadata) {
    merged.metadata = {
      ...current.metadata,
      ...patch.metadata
    }
  }
  return stripInternalTraceFields(merged)
}

function withTraceMetadata (record = {}, traceContext) {
  const safeRecord = stripInternalTraceFields(record)
  const parent = normalizeTraceContext(traceContext)
  const traceId = parent.traceId || safeRecord.metadata?.traceId
  if (!traceId) return safeRecord
  return {
    ...safeRecord,
    metadata: {
      ...(safeRecord.metadata || {}),
      traceId
    }
  }
}

function safelyRecordQualityEvent (recordEvent, context, event) {
  try {
    Promise.resolve(recordEvent(context, event)).catch(() => {})
  } catch {}
}

function operationQualityEvent (current, previousState) {
  if (!current?.metadata?.traceId || current.state === previousState) return null
  if (current.state === operationStates.rollingBack) {
    return { action: 'rollback', phase: 'started' }
  }
  if (current.state === operationStates.restored) {
    return { action: 'rollback', phase: 'completed', result: 'completed' }
  }
  if (current.state === operationStates.rollbackAvailable) {
    if (previousState === operationStates.rollingBack) {
      return { action: 'rollback', phase: 'cancelled', result: 'cancelled' }
    }
    return { action: 'safety-operation', phase: 'completed', result: 'completed' }
  }
  if (
    current.state === operationStates.kept &&
    previousState === operationStates.executing
  ) {
    return { action: 'safety-operation', phase: 'completed', result: 'completed' }
  }
  if (current.state === operationStates.cancelled) {
    const action = previousState === operationStates.rollingBack
      ? 'rollback'
      : 'safety-operation'
    return { action, phase: 'cancelled', result: 'cancelled' }
  }
  if (current.state === operationStates.failed) {
    const action = previousState === operationStates.rollingBack
      ? 'rollback'
      : 'safety-operation'
    return { action, phase: 'failed', result: 'failed' }
  }
  return null
}

function taskQualityEvent (current, previousStatus) {
  if (!current?.metadata?.traceId || current.status === previousStatus) return null
  if (current.status === taskStatuses.completed) {
    return { phase: 'completed', result: 'completed' }
  }
  if (current.status === taskStatuses.cancelled) {
    return { phase: 'cancelled', result: 'cancelled' }
  }
  if ([taskStatuses.failed, taskStatuses.partiallyCompleted].includes(current.status)) {
    return { phase: 'failed', result: 'failed' }
  }
  return null
}

function stableSerialize (value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => {
      return `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    }).join(',')}}`
  }
  return JSON.stringify(value)
}

function stableHash (value) {
  const text = stableSerialize(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function fingerprintLegacyRecords (records) {
  return stableHash(records.map(record => stableSerialize(record)).sort())
}

function legacyState (record) {
  const status = record.status || ''
  const rollbackStatus = record.rollbackStatus || ''
  if (status === 'restored' || rollbackStatus === 'completed') return operationStates.restored
  if (status === 'kept' || rollbackStatus === 'kept') return operationStates.kept
  if (status === 'failed' || rollbackStatus === 'failed') return operationStates.failed
  if (status === 'cancelled') return operationStates.cancelled
  return operationStates.rollbackAvailable
}

function normalizeLegacyOperation (record, clock) {
  const inferredSource = record.source || (record.rollbackPath || record.path ? 'quick-command' : 'sftp')
  const source = validOperationSources.has(inferredSource) ? inferredSource : 'sftp'
  const normalizedLegacy = normalizeLegacySafetyOperationRecord(record, { source })
  const id = normalizedLegacy.id
  const endpointIncomplete = !normalizedLegacy.host || !normalizedLegacy.username
  const endpoint = {
    tabId: normalizedLegacy.tabId,
    host: normalizedLegacy.host || 'legacy.invalid',
    port: normalizedLegacy.port || 22,
    username: normalizedLegacy.username || 'legacy',
    title: normalizedLegacy.serverTitle
  }
  const metadata = {
    ...(record.metadata || {}),
    legacy: true,
    legacyEndpointIncomplete: endpointIncomplete,
    legacyRecord: normalizedLegacy
  }
  return normalizeOperation(stripInternalTraceFields({
    id,
    source,
    command: record.command,
    title: normalizedLegacy.title,
    endpoint,
    state: legacyState(normalizedLegacy),
    createdAt: normalizedLegacy.createdAt,
    updatedAt: normalizedLegacy.updatedAt || normalizedLegacy.createdAt,
    metadata
  }), { now: resolveNow(clock), allowLegacyId: true })
}

function recordTime (record) {
  const value = new Date(record.updatedAt || record.createdAt).getTime()
  return Number.isNaN(value) ? -1 : value
}

function chooseOperation (stored, legacy) {
  if (!stored) return legacy
  const storedCompleted = completedOperationStates.has(stored.state)
  const legacyCompleted = completedOperationStates.has(legacy.state)
  if (storedCompleted && legacy.state === operationStates.rollbackAvailable) return stored
  if (legacyCompleted && stored.state === operationStates.rollbackAvailable) return legacy
  return recordTime(legacy) > recordTime(stored) ? legacy : stored
}

function sameMigrationRecord (actual, expected) {
  return stableSerialize(actual) === stableSerialize(expected)
}

function mergeOperations (stored, legacy) {
  const records = new Map(stored.map(record => [record.id, record]))
  for (const record of legacy) {
    records.set(record.id, chooseOperation(records.get(record.id), record))
  }
  return [...records.values()].sort((left, right) => {
    return recordTime(right) - recordTime(left)
  })
}

function enqueuePatch (adapter, table, id, work) {
  let queues = patchQueuesByAdapter.get(adapter)
  if (!queues) {
    queues = new Map()
    patchQueuesByAdapter.set(adapter, queues)
  }
  const key = `${table}:${id}`
  const previous = queues.get(key) || Promise.resolve()
  const current = previous.catch(() => {}).then(work)
  queues.set(key, current)
  return current.finally(() => {
    if (queues.get(key) === current) queues.delete(key)
  })
}

function operationIntegrityError () {
  const error = new Error('安全事务完整性校验失败，已拒绝原子更新。')
  error.code = 'SAFETY_OPERATION_INTEGRITY'
  error.integrityFailure = true
  return error
}

export function createTransactionStore (options = {}) {
  const adapter = options.adapter || options.db || defaultAdapter
  const getLegacyStorage = async () => options.legacyStorage || getDefaultLegacyStorage()
  const readLegacyRecords = options.readLegacyRecords || (async () => {
    const storage = await getLegacyStorage()
    return storage
      ? readSafetyOperationRecordsForMigration(storage)
      : { records: [] }
  })
  const clock = typeof options.now === 'function'
    ? options.now
    : () => options.now || new Date()
  const onChange = typeof options.onChange === 'function'
    ? options.onChange
    : emitSafetyTransactionUpdated
  const recordEvent = typeof options.recordQualityEvent === 'function'
    ? options.recordQualityEvent
    : emitQualityEvent

  function notifyChange (recordType, id, action) {
    try {
      onChange({ recordType, id: String(id), action })
    } catch {}
  }

  async function getMigrationMarker () {
    if (typeof adapter.getData === 'function') {
      return adapter.getData(legacyMigrationMarkerId, true)
    }
    const record = await adapter.findOne('data', legacyMigrationMarkerId, true)
    return record?.value || record
  }

  function recordOperationEvent (operation, event) {
    if (!event) return
    safelyRecordQualityEvent(recordEvent, {
      traceId: operation.metadata?.traceId,
      operationId: operation.id,
      module: 'safety',
      action: event.action
    }, {
      module: 'safety',
      ...event
    })
  }

  function recordTaskEvent (task, event) {
    if (!event) return
    safelyRecordQualityEvent(recordEvent, {
      traceId: task.metadata?.traceId,
      taskId: task.id,
      module: 'agent',
      action: 'agent-task'
    }, {
      module: 'agent',
      action: 'agent-task',
      ...event
    })
  }

  async function saveOperation (operation, traceContext) {
    const item = normalizeOperation({
      ...withTraceMetadata(operation, traceContext),
      id: operation?.id || generate()
    }, { now: resolveNow(clock) })
    await adapter.update(item.id, item, operationTable, true, true)
    notifyChange('operation', item.id, 'save')
    if (item.metadata?.traceId) {
      recordOperationEvent(item, {
        action: 'safety-operation',
        phase: 'started'
      })
    }
    return item
  }

  async function getOperation (id) {
    return adapter.findOne(operationTable, id, true)
  }

  async function listOperations () {
    const legacyResult = await readLegacyRecords() || []
    const rawLegacyRecords = Array.isArray(legacyResult)
      ? legacyResult
      : legacyResult.records || []
    const legacyOperations = rawLegacyRecords.map(record => {
      return normalizeLegacyOperation(record, clock)
    })
    const legacyCount = rawLegacyRecords.length
    const legacyFingerprint = fingerprintLegacyRecords(rawLegacyRecords)
    const [initialStoredOperations, migrationMarker] = await Promise.all([
      adapter.find(operationTable, true),
      getMigrationMarker()
    ])
    let storedOperations = initialStoredOperations

    if (legacyOperations.length) {
      const markerMatches = migrationMarker?.legacyCount === legacyCount &&
        migrationMarker?.legacyFingerprint === legacyFingerprint
      if (markerMatches) return mergeOperations(storedOperations, legacyOperations)

      const storedById = new Map(storedOperations.map(record => [record.id, record]))
      const expectedById = new Map()
      for (const legacy of legacyOperations) {
        const stored = storedById.get(legacy.id)
        const preferred = chooseOperation(stored, legacy)
        expectedById.set(legacy.id, preferred)
        if (preferred === legacy && !sameMigrationRecord(stored, legacy)) {
          await adapter.update(legacy.id, legacy, operationTable, true, true)
        }
      }

      storedOperations = await adapter.find(operationTable, true)
      const verifiedById = new Map(storedOperations.map(record => [record.id, record]))
      for (const [id, expected] of expectedById) {
        const verified = verifiedById.get(id)
        if (!verified || !sameMigrationRecord(verified, expected)) {
          throw new Error(`旧安全记录迁移批量验证失败：${id}`)
        }
      }

      await adapter.update(legacyMigrationMarkerId, {
        schemaVersion: 1,
        legacyCount,
        legacyFingerprint,
        migratedIds: [...new Set(legacyOperations.map(record => record.id))].sort(),
        updatedAt: resolveNow(clock).toISOString()
      }, 'data', true, true)
    }

    return mergeOperations(storedOperations, legacyOperations)
  }

  async function patchOperation (id, patch = {}) {
    return enqueuePatch(adapter, operationTable, id, async () => {
      const current = await getOperation(id)
      if (!current) throw new Error(`未找到安全操作：${id}`)
      const item = normalizeOperation({
        ...mergePatch(current, patch),
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: nextUpdatedAt(current.updatedAt, patch.updatedAt, clock)
      }, { now: resolveNow(clock) })
      await adapter.update(item.id, item, operationTable, true, true)
      notifyChange('operation', item.id, 'patch')
      recordOperationEvent(item, operationQualityEvent(item, current.state))
      return item
    })
  }

  async function guardedPatchOperation (id, predicate, patch = {}) {
    if (typeof predicate !== 'function') throw operationIntegrityError()
    return enqueuePatch(adapter, operationTable, id, async () => {
      const current = await getOperation(id)
      if (!current) throw new Error(`未找到安全操作：${id}`)
      let accepted
      try {
        accepted = await predicate(current)
      } catch {
        throw operationIntegrityError()
      }
      if (accepted !== true) throw operationIntegrityError()
      const resolvedPatch = typeof patch === 'function'
        ? await patch(current)
        : patch
      const item = normalizeOperation({
        ...mergePatch(current, resolvedPatch),
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: nextUpdatedAt(current.updatedAt, resolvedPatch?.updatedAt, clock)
      }, { now: resolveNow(clock) })
      await adapter.update(item.id, item, operationTable, true, true)
      notifyChange('operation', item.id, 'patch')
      recordOperationEvent(item, operationQualityEvent(item, current.state))
      return item
    })
  }

  async function removeOperation (id) {
    await adapter.remove(operationTable, id, true)
    notifyChange('operation', id, 'remove')
  }

  async function saveTask (task = {}, traceContext) {
    const item = normalizeTask(withTraceMetadata(task, traceContext), clock)
    await adapter.update(item.id, item, taskTable, true, true)
    notifyChange('task', item.id, 'save')
    if (item.metadata?.traceId) {
      recordTaskEvent(item, { phase: 'started' })
    }
    return item
  }

  async function getTask (id) {
    return adapter.findOne(taskTable, id, true)
  }

  async function listTasks () {
    return adapter.find(taskTable, true)
  }

  async function patchTask (id, patch = {}) {
    return enqueuePatch(adapter, taskTable, id, async () => {
      const current = await getTask(id)
      if (!current) throw new Error(`未找到 Agent 任务：${id}`)
      const item = normalizeTask({
        ...mergePatch(current, patch),
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: nextUpdatedAt(current.updatedAt, patch.updatedAt, clock)
      }, clock)
      await adapter.update(item.id, item, taskTable, true, true)
      notifyChange('task', item.id, 'patch')
      recordTaskEvent(item, taskQualityEvent(item, current.status))
      return item
    })
  }

  async function attachTraceToOperation (id, traceContext) {
    const { traceId } = normalizeTraceContext(traceContext)
    if (!traceId) return getOperation(id)
    return patchOperation(id, { metadata: { traceId } })
  }

  return {
    saveOperation,
    getOperation,
    listOperations,
    patchOperation,
    guardedPatchOperation,
    removeOperation,
    attachTraceToOperation,
    saveTask,
    getTask,
    listTasks,
    patchTask
  }
}

const defaultStore = createTransactionStore()

export const saveOperation = (...args) => defaultStore.saveOperation(...args)
export const getOperation = (...args) => defaultStore.getOperation(...args)
export const listOperations = (...args) => defaultStore.listOperations(...args)
export const patchOperation = (...args) => defaultStore.patchOperation(...args)
export const guardedPatchOperation = (...args) => defaultStore.guardedPatchOperation(...args)
export const removeOperation = (...args) => defaultStore.removeOperation(...args)
export const attachTraceToOperation = (...args) => defaultStore.attachTraceToOperation(...args)
export const saveTask = (...args) => defaultStore.saveTask(...args)
export const getTask = (...args) => defaultStore.getTask(...args)
export const listTasks = (...args) => defaultStore.listTasks(...args)
export const patchTask = (...args) => defaultStore.patchTask(...args)
