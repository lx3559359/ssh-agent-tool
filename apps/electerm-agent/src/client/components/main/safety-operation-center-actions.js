import { operationStates } from '../../common/safety-transactions/models.js'
import {
  getLegacySafetyRecord,
  isSafetyOperationRollbackable,
  isSafetyOperationRunning,
  routeSafetyCenterAction
} from './safety-operation-center-model.js'

const legacyAvailableStates = new Set([
  operationStates.rollbackAvailable,
  operationStates.failed
])

function requireFunction (value, label) {
  if (typeof value !== 'function') throw new Error(`安全操作中心缺少 ${label} 能力。`)
  return value
}

function timestamp (now) {
  const value = typeof now === 'function' ? now() : new Date()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('安全操作中心当前时间无效。')
  return date.toISOString()
}

function defaultClaimToken () {
  return globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function staleRecordError () {
  return new Error('安全记录状态已变化，请刷新后重试。')
}

function isGuardRejection (error) {
  return /完整性校验|原子更新/.test(String(error?.message || error))
}

function isLegacyClaimOwner (record, token, action) {
  const claim = record?.metadata?.safetyCenterLegacyClaim
  return record?.state === operationStates.rollingBack &&
    claim?.token === token && claim?.action === action
}

function assertLegacyActionAllowed (record, action) {
  if (!getLegacySafetyRecord(record)) throw staleRecordError()
  if (!legacyAvailableStates.has(record.state)) throw staleRecordError()
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
}

function modernActionAllowed (record, action) {
  if (action === 'rollback') return isSafetyOperationRollbackable(record)
  if (action === 'keep') return record?.state === operationStates.rollbackAvailable
  if (action === 'cancel') return isSafetyOperationRunning(record)
  return false
}

async function executeLegacyAction ({
  latest,
  action,
  guardedPatchOperation,
  resolveLegacyTarget,
  runLegacyAction,
  now,
  createClaimToken
}) {
  assertLegacyActionAllowed(latest, action)
  const token = requireFunction(createClaimToken || defaultClaimToken, 'createClaimToken')()
  const claimedAt = timestamp(now)
  let claimed
  try {
    claimed = await guardedPatchOperation(
      latest.id,
      current => Boolean(
        getLegacySafetyRecord(current) &&
        current.source === latest.source &&
        legacyAvailableStates.has(current.state)
      ),
      current => ({
        state: operationStates.rollingBack,
        error: undefined,
        failedAt: undefined,
        completedAt: undefined,
        metadata: {
          ...current.metadata,
          safetyCenterLegacyClaim: { token, action, claimedAt }
        }
      })
    )
  } catch (error) {
    if (isGuardRejection(error)) throw staleRecordError()
    throw error
  }

  try {
    const target = await resolveLegacyTarget(claimed, action)
    if (!target) throw new Error('未找到端点匹配的活动会话。')
    const result = await runLegacyAction(claimed, action, target)
    if (result === false) throw new Error('旧版 SFTP 恢复未成功。')
    return await guardedPatchOperation(
      claimed.id,
      current => isLegacyClaimOwner(current, token, action),
      current => ({
        state: action === 'rollback'
          ? operationStates.restored
          : operationStates.kept,
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
    try {
      await guardedPatchOperation(
        claimed.id,
        current => isLegacyClaimOwner(current, token, action),
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
      error.stateWriteError = writeError
    }
    throw error
  }
}

export async function executeSafetyCenterAction ({
  record,
  action,
  getOperation,
  guardedPatchOperation,
  resolveLegacyTarget,
  runLegacyAction,
  findModernTerminal,
  taskCapability,
  now,
  createClaimToken
}) {
  if (!record?.id) throw new Error('安全记录无效。')
  if (record.recordType === 'task') {
    return routeSafetyCenterAction({ action, record, taskCapability })
  }

  const latest = await requireFunction(getOperation, 'getOperation')(record.id)
  if (!latest) throw new Error(`未找到安全操作：${record.id}`)
  if (getLegacySafetyRecord(latest)) {
    return executeLegacyAction({
      latest,
      action,
      guardedPatchOperation: requireFunction(guardedPatchOperation, 'guardedPatchOperation'),
      resolveLegacyTarget: requireFunction(resolveLegacyTarget, 'resolveLegacyTarget'),
      runLegacyAction: requireFunction(runLegacyAction, 'runLegacyAction'),
      now,
      createClaimToken
    })
  }

  if (getLegacySafetyRecord(record) || !modernActionAllowed(latest, action)) {
    throw staleRecordError()
  }
  const terminal = requireFunction(findModernTerminal, 'findModernTerminal')(latest)
  if (!terminal) {
    throw new Error('未找到与安全操作端点完全匹配的活动 SSH 终端。')
  }
  return routeSafetyCenterAction({ action, record: latest, terminal })
}
