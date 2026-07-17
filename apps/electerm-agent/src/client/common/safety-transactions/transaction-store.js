import generate from '../uid.js'
import {
  finalOperationStates,
  normalizeOperation,
  operationSources,
  operationStates,
  validateAgentPlanGrantStructure
} from './models.js'
import {
  redactAuditText,
  redactSensitiveData
} from './audit-redaction.js'
import {
  normalizeLegacySafetyOperationRecord,
  readSafetyOperationRecordsForMigration
} from '../safety-operation-records.js'

const operationTable = 'safetyOperations'
const taskTable = 'agentTasks'
const artifactTable = 'agentArtifacts'
const patchQueuesByAdapter = new WeakMap()
const defaultMinimumFreeBytes = 64 * 1024 * 1024
const defaultRecoveryReservationBytes = 8 * 1024 * 1024
const defaultMaximumArtifactBytes = 1024 * 1024

async function defaultArtifactFreeBytes () {
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.()
    const quota = Number(estimate?.quota)
    const usage = Number(estimate?.usage)
    if (Number.isFinite(quota) && Number.isFinite(usage)) {
      return Math.max(0, quota - usage)
    }
  } catch {}
  return Number.POSITIVE_INFINITY
}

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
const completedTaskStatuses = new Set(finalTaskStatuses)

function byteLength (value) {
  return new TextEncoder().encode(String(value ?? '')).byteLength
}

function artifactError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function normalizeArtifactId (value) {
  const id = String(value || '').trim()
  if (!id || id.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(id)) {
    throw artifactError('AGENT_ARTIFACT_ID_INVALID', 'Agent artifact ID is invalid.')
  }
  return id
}

function recordReferences (record = {}) {
  const values = [
    record.artifactReferences,
    record.metadata?.artifactReferences,
    ...((record.steps || []).map(step => step?.artifactReferences))
  ]
  const references = new Set()
  for (const list of values) {
    if (!Array.isArray(list)) continue
    for (const value of list) {
      const id = typeof value === 'string' ? value : value?.id
      if (id) references.add(String(id))
    }
  }
  const bindings = [
    ...(record.skillBindings || []),
    ...(record.riskTransaction?.skillBindings || [])
  ]
  for (const binding of bindings) {
    if (binding?.id && binding?.digest) {
      references.add(`skill-history:${binding.id}:${binding.digest}`)
    }
  }
  return references
}

function taskProtectsArtifacts (task = {}) {
  return !completedTaskStatuses.has(task.status) ||
    task.status === taskStatuses.partiallyCompleted ||
    task.awaitingVerification === true ||
    ['unknown', 'changed-unverified'].includes(task.remoteState)
}

function operationProtectsArtifacts (operation = {}) {
  return !completedOperationStates.has(operation.state) ||
    (operation.state === operationStates.failed && (
      operation.reversible === true ||
      Boolean(operation.recoveryBinding) ||
      Boolean(operation.artifacts)
    ))
}

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

function normalizeTask (task = {}, clock) {
  const status = task.status || taskStatuses.draft
  if (!validTaskStatuses.has(status)) throw new Error('Agent 任务状态不受支持')
  if (task.planGrant !== undefined && !validateAgentPlanGrantStructure(task.planGrant)) {
    throw new Error('Agent 任务计划授权结构无效')
  }
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
  }, { now: resolveNow(clock), allowLegacyId: true })
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
  const getFreeBytes = typeof options.getFreeBytes === 'function'
    ? options.getFreeBytes
    : defaultArtifactFreeBytes
  const minimumFreeBytes = Number.isSafeInteger(options.minimumFreeBytes) &&
    options.minimumFreeBytes >= 0
    ? options.minimumFreeBytes
    : defaultMinimumFreeBytes
  const recoveryReservationBytes = Number.isSafeInteger(
    options.defaultRecoveryReservationBytes
  ) && options.defaultRecoveryReservationBytes >= 0
    ? options.defaultRecoveryReservationBytes
    : defaultRecoveryReservationBytes
  const maximumArtifactBytes = Number.isSafeInteger(options.maximumArtifactBytes) &&
    options.maximumArtifactBytes > 0
    ? options.maximumArtifactBytes
    : defaultMaximumArtifactBytes

  function notifyChange (recordType, id, action) {
    try {
      onChange({ recordType, id: String(id), action })
    } catch {}
  }

  async function assertArtifactCapacity (estimatedBytes = 0, label = 'Agent evidence') {
    const bytes = Number.isSafeInteger(estimatedBytes) && estimatedBytes >= 0
      ? estimatedBytes
      : 0
    const available = Number(await getFreeBytes())
    if (!Number.isFinite(available)) return { availableBytes: available, requiredBytes: bytes }
    const required = bytes + minimumFreeBytes
    if (available < required) {
      throw artifactError(
        'AGENT_STORAGE_INSUFFICIENT',
        `Insufficient free space for ${label}: ${available} bytes available; ` +
        `${required} bytes required including the safety reserve.`
      )
    }
    return { availableBytes: available, requiredBytes: required }
  }

  function normalizeArtifact (artifact = {}) {
    const now = resolveNow(clock)
    const safeEvidence = redactSensitiveData(artifact.evidence ?? '')
    const safeSummary = redactAuditText(artifact.summary ?? '')
    const serializedEvidence = typeof safeEvidence === 'string'
      ? safeEvidence
      : JSON.stringify(safeEvidence)
    const evidenceBytes = byteLength(serializedEvidence)
    if (evidenceBytes > maximumArtifactBytes) {
      throw artifactError(
        'AGENT_ARTIFACT_TOO_LARGE',
        `Agent evidence exceeds the ${maximumArtifactBytes}-byte persistence limit.`
      )
    }
    const defaultExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const expiresAt = toTimestamp(artifact.expiresAt, defaultExpiry, 'Artifact expiry')
    return {
      id: normalizeArtifactId(artifact.id),
      schemaVersion: 1,
      kind: String(artifact.kind || 'evidence').slice(0, 64),
      summary: safeSummary,
      evidence: safeEvidence,
      evidenceBytes,
      createdAt: toTimestamp(artifact.createdAt, now, 'Artifact creation'),
      updatedAt: toTimestamp(artifact.updatedAt, now, 'Artifact update'),
      expiresAt
    }
  }

  async function getMigrationMarker () {
    if (typeof adapter.getData === 'function') {
      return adapter.getData(legacyMigrationMarkerId, true)
    }
    const record = await adapter.findOne('data', legacyMigrationMarkerId, true)
    return record?.value || record
  }

  async function saveOperation (operation) {
    const item = normalizeOperation({
      ...operation,
      id: operation?.id || generate()
    }, { now: resolveNow(clock) })
    if (item.state === operationStates.preparing &&
      item.risk === 'change' && item.reversible === true) {
      const estimatedBytes = Number.isSafeInteger(item.metadata?.estimatedRecoveryBytes)
        ? item.metadata.estimatedRecoveryBytes
        : recoveryReservationBytes
      await assertArtifactCapacity(estimatedBytes, 'a new recovery point')
    }
    await adapter.update(item.id, item, operationTable, true, true)
    notifyChange('operation', item.id, 'save')
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
      return item
    })
  }

  async function removeOperation (id) {
    await adapter.remove(operationTable, id, true)
    notifyChange('operation', id, 'remove')
  }

  async function saveTask (task = {}) {
    const item = normalizeTask(task, clock)
    if (Number.isSafeInteger(task.artifactReservationBytes) &&
      task.artifactReservationBytes > 0) {
      await assertArtifactCapacity(
        task.artifactReservationBytes,
        'full Agent output capture'
      )
    }
    await adapter.update(item.id, item, taskTable, true, true)
    notifyChange('task', item.id, 'save')
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
      return item
    })
  }

  async function saveArtifact (artifact = {}) {
    const item = normalizeArtifact(artifact)
    await assertArtifactCapacity(item.evidenceBytes, `${item.kind} Agent evidence`)
    await adapter.update(item.id, item, artifactTable, true, true)
    return item
  }

  async function getArtifact (id) {
    return adapter.findOne(artifactTable, normalizeArtifactId(id), true)
  }

  async function listArtifacts () {
    const artifacts = await adapter.find(artifactTable, true)
    return artifacts.sort((left, right) => String(left.id).localeCompare(String(right.id)))
  }

  async function protectedArtifactReferences () {
    const [tasks, operations] = await Promise.all([
      listTasks(),
      listOperations()
    ])
    const references = new Set()
    for (const task of tasks) {
      if (!taskProtectsArtifacts(task)) continue
      for (const reference of recordReferences(task)) references.add(reference)
    }
    for (const operation of operations) {
      if (!operationProtectsArtifacts(operation)) continue
      for (const reference of recordReferences(operation)) references.add(reference)
    }
    return [...references].sort()
  }

  async function cleanupArtifacts ({ expiresBefore } = {}) {
    const cutoff = expiresBefore === undefined
      ? resolveNow(clock)
      : new Date(expiresBefore)
    if (Number.isNaN(cutoff.getTime())) {
      throw artifactError('AGENT_ARTIFACT_EXPIRY_INVALID', 'Artifact cleanup expiry is invalid.')
    }
    const [artifacts, protectedReferences] = await Promise.all([
      listArtifacts(),
      protectedArtifactReferences()
    ])
    const protectedIds = new Set(protectedReferences)
    const removed = []
    const retained = []
    for (const artifact of artifacts) {
      const expiresAt = new Date(artifact.expiresAt)
      if (Number.isNaN(expiresAt.getTime()) || expiresAt > cutoff) continue
      const summary = { id: String(artifact.id), kind: String(artifact.kind || 'evidence') }
      if (protectedIds.has(artifact.id)) {
        retained.push(summary)
        continue
      }
      await adapter.remove(artifactTable, artifact.id, true)
      removed.push(summary)
    }
    return { removed, retained }
  }

  return {
    saveOperation,
    getOperation,
    listOperations,
    patchOperation,
    guardedPatchOperation,
    removeOperation,
    saveTask,
    getTask,
    listTasks,
    patchTask,
    saveArtifact,
    getArtifact,
    listArtifacts,
    protectedArtifactReferences,
    cleanupArtifacts,
    assertArtifactCapacity
  }
}

const defaultStore = createTransactionStore()

export const saveOperation = (...args) => defaultStore.saveOperation(...args)
export const getOperation = (...args) => defaultStore.getOperation(...args)
export const listOperations = (...args) => defaultStore.listOperations(...args)
export const patchOperation = (...args) => defaultStore.patchOperation(...args)
export const guardedPatchOperation = (...args) => defaultStore.guardedPatchOperation(...args)
export const removeOperation = (...args) => defaultStore.removeOperation(...args)
export const saveTask = (...args) => defaultStore.saveTask(...args)
export const getTask = (...args) => defaultStore.getTask(...args)
export const listTasks = (...args) => defaultStore.listTasks(...args)
export const patchTask = (...args) => defaultStore.patchTask(...args)
export const saveArtifact = (...args) => defaultStore.saveArtifact(...args)
export const getArtifact = (...args) => defaultStore.getArtifact(...args)
export const listArtifacts = (...args) => defaultStore.listArtifacts(...args)
export const protectedArtifactReferences = (...args) => (
  defaultStore.protectedArtifactReferences(...args)
)
export const cleanupArtifacts = (...args) => defaultStore.cleanupArtifacts(...args)
export const assertArtifactCapacity = (...args) => (
  defaultStore.assertArtifactCapacity(...args)
)
