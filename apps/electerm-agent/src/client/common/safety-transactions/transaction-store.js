import generate from '../uid.js'
import {
  normalizeOperation,
  operationSources,
  operationStates
} from './models.js'
import { redactSensitiveData } from './audit-redaction.js'
import {
  normalizeSafetyOperationRecord,
  readSafetyOperationRecordsForMigration
} from '../safety-operation-records.js'

const operationTable = 'safetyOperations'
const taskTable = 'agentTasks'

export const legacyMigrationMarkerId = 'safetyOperations:legacy-migration:v1'

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

const validTaskStatuses = new Set(Object.values(taskStatuses))
const validOperationSources = new Set(operationSources)
const completedOperationStates = new Set([
  operationStates.kept,
  operationStates.restored,
  operationStates.failed,
  operationStates.cancelled
])

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

function normalizeTask (task = {}, clock) {
  const status = task.status || taskStatuses.draft
  if (!validTaskStatuses.has(status)) throw new Error('Agent 任务状态不受支持')
  const now = resolveNow(clock)
  const safeTask = redactSensitiveData(task)
  return {
    ...safeTask,
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
  return merged
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

function legacyId (record, source) {
  if (record.id) return String(record.id)
  return `legacy:${source}:${stableHash({
    source,
    createdAt: record.createdAt || '',
    target: record.target || record.sourcePath || record.rollbackPath || record.path || '',
    host: record.host || '',
    title: record.title || ''
  })}`
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
  const id = legacyId(record, source)
  const normalizedLegacy = normalizeSafetyOperationRecord({ ...record, id }, { source })
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
  return normalizeOperation({
    id,
    source,
    command: record.command,
    title: normalizedLegacy.title,
    endpoint,
    state: legacyState(normalizedLegacy),
    createdAt: normalizedLegacy.createdAt,
    updatedAt: normalizedLegacy.updatedAt || normalizedLegacy.createdAt,
    metadata
  }, { now: resolveNow(clock) })
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

  async function saveOperation (operation) {
    const item = normalizeOperation({
      ...operation,
      id: operation?.id || generate()
    }, { now: resolveNow(clock) })
    await adapter.update(item.id, item, operationTable, true, true)
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
    let storedOperations = await adapter.find(operationTable, true)

    if (legacyOperations.length) {
      const storedById = new Map(storedOperations.map(record => [record.id, record]))
      for (const legacy of legacyOperations) {
        const stored = storedById.get(legacy.id)
        const preferred = chooseOperation(stored, legacy)
        if (preferred === legacy && !sameMigrationRecord(stored, legacy)) {
          await adapter.update(legacy.id, legacy, operationTable, true, true)
        }
        const verified = await adapter.findOne(operationTable, legacy.id, true)
        const expected = preferred === legacy ? legacy : stored
        if (!verified || (expected === legacy && !sameMigrationRecord(verified, legacy))) {
          throw new Error(`旧安全记录迁移回读验证失败：${legacy.id}`)
        }
        storedById.set(legacy.id, verified)
      }

      await adapter.update(legacyMigrationMarkerId, {
        schemaVersion: 1,
        migratedIds: legacyOperations.map(record => record.id).sort(),
        updatedAt: resolveNow(clock).toISOString()
      }, 'data', true, true)
      storedOperations = await adapter.find(operationTable, true)
    }

    return mergeOperations(storedOperations, legacyOperations)
  }

  async function patchOperation (id, patch = {}) {
    const current = await getOperation(id)
    if (!current) throw new Error(`未找到安全操作：${id}`)
    const item = normalizeOperation({
      ...mergePatch(current, patch),
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: nextUpdatedAt(current.updatedAt, patch.updatedAt, clock)
    }, { now: resolveNow(clock) })
    await adapter.update(item.id, item, operationTable, true, true)
    return item
  }

  async function removeOperation (id) {
    await adapter.remove(operationTable, id, true)
  }

  async function saveTask (task = {}) {
    const item = normalizeTask(task, clock)
    await adapter.update(item.id, item, taskTable, true, true)
    return item
  }

  async function getTask (id) {
    return adapter.findOne(taskTable, id, true)
  }

  async function listTasks () {
    return adapter.find(taskTable, true)
  }

  async function patchTask (id, patch = {}) {
    const current = await getTask(id)
    if (!current) throw new Error(`未找到 Agent 任务：${id}`)
    const item = normalizeTask({
      ...mergePatch(current, patch),
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: nextUpdatedAt(current.updatedAt, patch.updatedAt, clock)
    }, clock)
    await adapter.update(item.id, item, taskTable, true, true)
    return item
  }

  return {
    saveOperation,
    getOperation,
    listOperations,
    patchOperation,
    removeOperation,
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
export const removeOperation = (...args) => defaultStore.removeOperation(...args)
export const saveTask = (...args) => defaultStore.saveTask(...args)
export const getTask = (...args) => defaultStore.getTask(...args)
export const listTasks = (...args) => defaultStore.listTasks(...args)
export const patchTask = (...args) => defaultStore.patchTask(...args)
