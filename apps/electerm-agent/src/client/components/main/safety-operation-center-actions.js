import { operationStates } from '../../common/safety-transactions/models.js'
import {
  getLegacySafetyRecord,
  getLegacyClaimStatus,
  isSafetyOperationRollbackable,
  isSafetyOperationRunning,
  routeSafetyCenterAction
} from './safety-operation-center-model.js'

const legacyAvailableStates = new Set([
  operationStates.rollbackAvailable,
  operationStates.failed
])
export const legacyClaimLeaseMs = 60_000

function requireFunction (value, label) {
  if (typeof value !== 'function') throw new Error(`安全操作中心缺少 ${label} 能力。`)
  return value
}

function currentDate (now) {
  const value = typeof now === 'function' ? now() : new Date()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('安全操作中心当前时间无效。')
  return date
}

function timestamp (now) {
  return currentDate(now).toISOString()
}

function defaultClaimId () {
  return globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function staleRecordError () {
  return new Error('安全记录状态已变化，请刷新后重试。')
}

function isGuardRejection (error) {
  return /完整性校验|原子更新/.test(String(error?.message || error))
}

function isLegacyClaimOwner (record, claimId, action) {
  const claim = record?.metadata?.safetyCenterLegacyClaim
  return record?.state === operationStates.rollingBack &&
    claim?.claimId === claimId && claim?.action === action
}

function legacyTargetIdentity (record) {
  const legacy = getLegacySafetyRecord(record)
  if (!legacy) return null
  return JSON.stringify([
    String(record.id || ''),
    String(record.source || ''),
    String(legacy.id || ''),
    String(legacy.source || record.source || ''),
    String(record.endpoint?.host || legacy.host || ''),
    Number(record.endpoint?.port || legacy.port || 22),
    String(record.endpoint?.username || legacy.username || ''),
    String(legacy.target || ''),
    String(legacy.sourcePath || ''),
    String(legacy.backupPath || ''),
    String(legacy.rollbackPath || legacy.path || '')
  ])
}

function sameLegacyTarget (left, right) {
  const leftIdentity = legacyTargetIdentity(left)
  return Boolean(leftIdentity && leftIdentity === legacyTargetIdentity(right))
}

function expectedLegacyTerminalState (action) {
  return action === 'rollback' ? operationStates.restored : operationStates.kept
}

function isMatchingLegacyTerminal (record, requested, action) {
  return record?.state === expectedLegacyTerminalState(action) &&
    sameLegacyTarget(record, requested)
}

function asError (value) {
  return value instanceof Error ? value : new Error(String(value))
}

function assertLegacyActionAllowed (record, action, now) {
  if (!getLegacySafetyRecord(record)) throw staleRecordError()
  if (record.metadata?.legacyEndpointIncomplete) {
    throw new Error('旧版记录的服务器端点不完整，无法安全恢复。')
  }
  if (record.source === 'sftp' && action !== 'rollback') {
    throw new Error('旧版 SFTP 记录不支持保留动作。')
  }
  if (record.source === 'quick-command' && !['rollback', 'keep'].includes(action)) {
    throw new Error('旧版快捷命令不支持该动作。')
  }
  if (!['sftp', 'quick-command'].includes(record.source)) {
    throw new Error('该旧版记录没有可用的恢复入口。')
  }
  if (legacyAvailableStates.has(record.state)) return
  if (record.state === operationStates.rollingBack) {
    if (getLegacyClaimStatus(record, now) === 'stale') return
    throw new Error('旧版安全操作仍在执行，请稍后刷新。')
  }
  throw staleRecordError()
}

function modernActionAllowed (record, action) {
  if (action === 'rollback') return isSafetyOperationRollbackable(record)
  if (action === 'keep') return record?.state === operationStates.rollbackAvailable
  if (action === 'cancel') return isSafetyOperationRunning(record)
  return false
}

async function executeLegacyAction ({
  requested,
  latest,
  action,
  getOperation,
  guardedPatchOperation,
  resolveLegacyTarget,
  runLegacyAction,
  now,
  createClaimId,
  claimLeaseDuration
}) {
  if (!sameLegacyTarget(latest, requested)) throw staleRecordError()
  if (isMatchingLegacyTerminal(latest, requested, action)) return latest
  const claimTime = currentDate(now)
  assertLegacyActionAllowed(latest, action, claimTime)
  const claimId = requireFunction(createClaimId || defaultClaimId, 'createClaimId')()
  const claimedAt = claimTime.toISOString()
  const duration = Number(claimLeaseDuration)
  const leaseDuration = Number.isFinite(duration) && duration > 0
    ? duration
    : legacyClaimLeaseMs
  const expiresAt = new Date(claimTime.getTime() + leaseDuration).toISOString()
  let claimed
  try {
    claimed = await guardedPatchOperation(
      latest.id,
      current => Boolean(
        getLegacySafetyRecord(current) &&
        sameLegacyTarget(current, latest) &&
        (legacyAvailableStates.has(current.state) ||
          getLegacyClaimStatus(current, claimTime) === 'stale')
      ),
      current => ({
        state: operationStates.rollingBack,
        error: undefined,
        failedAt: undefined,
        completedAt: undefined,
        metadata: {
          ...current.metadata,
          safetyCenterLegacyClaim: { claimId, action, claimedAt, expiresAt }
        }
      })
    )
  } catch (error) {
    if (isGuardRejection(error)) {
      const current = await getOperation(latest.id)
      if (isMatchingLegacyTerminal(current, requested, action)) return current
      throw staleRecordError()
    }
    throw error
  }

  let target
  try {
    target = await resolveLegacyTarget(claimed, action)
    if (!target) throw new Error('未找到端点匹配的活动会话。')
    const result = await runLegacyAction(claimed, action, target)
    if (result === false) throw new Error('旧版 SFTP 恢复未成功。')
  } catch (caught) {
    const error = asError(caught)
    try {
      await guardedPatchOperation(
        claimed.id,
        current => isLegacyClaimOwner(current, claimId, action),
        current => ({
          state: operationStates.failed,
          error: error?.message || String(error),
          failedAt: timestamp(now),
          completedAt: undefined,
          metadata: {
            ...current.metadata,
            safetyCenterLegacyClaim: null
          }
        })
      )
    } catch (writeError) {
      if (!isGuardRejection(writeError)) error.stateWriteError = writeError
    }
    throw error
  }

  try {
    return await guardedPatchOperation(
      claimed.id,
      current => isLegacyClaimOwner(current, claimId, action),
      current => ({
        state: expectedLegacyTerminalState(action),
        completedAt: timestamp(now),
        error: undefined,
        failedAt: undefined,
        metadata: {
          ...current.metadata,
          safetyCenterLegacyClaim: null
        }
      })
    )
  } catch (error) {
    if (!isGuardRejection(error)) throw error
    const current = await getOperation(claimed.id)
    if (isMatchingLegacyTerminal(current, requested, action)) return current
    throw staleRecordError()
  }
}

export async function executeSafetyCenterAction ({
  record,
  action,
  getOperation,
  guardedPatchOperation,
  syncLegacyOperation,
  resolveLegacyTarget,
  runLegacyAction,
  findModernTerminal,
  taskCapability,
  now,
  createClaimId,
  claimLeaseMs: claimLeaseDuration
}) {
  if (!record?.id) throw new Error('安全记录无效。')
  if (record.recordType === 'task') {
    return routeSafetyCenterAction({ action, record, taskCapability })
  }

  const readOperation = requireFunction(getOperation, 'getOperation')
  let latest = await readOperation(record.id)
  if (!latest) throw new Error(`未找到安全操作：${record.id}`)
  if (getLegacySafetyRecord(record) || getLegacySafetyRecord(latest)) {
    if (typeof syncLegacyOperation === 'function') {
      await syncLegacyOperation(record.id)
      latest = await readOperation(record.id)
    }
    if (!latest || !getLegacySafetyRecord(latest)) throw staleRecordError()
    return executeLegacyAction({
      requested: record,
      latest,
      action,
      getOperation: readOperation,
      guardedPatchOperation: requireFunction(guardedPatchOperation, 'guardedPatchOperation'),
      resolveLegacyTarget: requireFunction(resolveLegacyTarget, 'resolveLegacyTarget'),
      runLegacyAction: requireFunction(runLegacyAction, 'runLegacyAction'),
      now,
      createClaimId,
      claimLeaseDuration
    })
  }

  if (!modernActionAllowed(latest, action)) {
    throw staleRecordError()
  }
  const terminal = requireFunction(findModernTerminal, 'findModernTerminal')(latest)
  if (!terminal) {
    throw new Error('未找到与安全操作端点完全匹配的活动 SSH 终端。')
  }
  return routeSafetyCenterAction({ action, record: latest, terminal })
}
