import { operationStates } from './models.js'

export const commandOrphanRecoveryStartedAt = new Date().toISOString()

const interruptionMessage = '应用重启后后台任务执行器不可用，远程执行结果未知，事务已标记为中断。'
let startupRecoveryPromise

function timestamp (value, label) {
  const resolved = typeof value === 'function' ? value() : value
  const date = resolved instanceof Date ? resolved : new Date(resolved)
  if (Number.isNaN(date.getTime())) throw new Error(`${label}时间无效。`)
  return date
}

function isPriorBackgroundExecution (operation, startedAt, activeIds) {
  if (!operation || operation.state !== operationStates.executing ||
    operation.metadata?.commandEntrypoint !== true ||
    operation.metadata?.execution?.mode !== 'background' ||
    activeIds.has(String(operation.id))) {
    return false
  }
  const updatedAt = new Date(operation.updatedAt).getTime()
  return Number.isFinite(updatedAt) && updatedAt < startedAt.getTime()
}

export async function recoverOrphanedCommandOperations ({
  store,
  startedAt = commandOrphanRecoveryStartedAt,
  now = () => new Date(),
  activeOperationIds = []
} = {}) {
  if (typeof store?.listOperations !== 'function' ||
    typeof store?.guardedPatchOperation !== 'function') {
    throw new Error('后台命令孤儿恢复缺少事务存储能力。')
  }
  const started = timestamp(startedAt, '应用启动')
  const activeIds = new Set([...activeOperationIds].map(String))
  const operations = await store.listOperations()
  const recovered = []

  for (const operation of operations) {
    if (!isPriorBackgroundExecution(operation, started, activeIds)) continue
    const failedAt = timestamp(now, '孤儿恢复').toISOString()
    try {
      const updated = await store.guardedPatchOperation(
        operation.id,
        current => current.executionId === operation.executionId &&
          current.updatedAt === operation.updatedAt &&
          isPriorBackgroundExecution(current, started, activeIds),
        {
          state: operationStates.failed,
          executionId: undefined,
          error: interruptionMessage,
          failedAt,
          metadata: {
            interrupted: true,
            interruptionReason: 'application-restart'
          }
        }
      )
      recovered.push(updated)
    } catch (error) {
      const current = await store.getOperation?.(operation.id)
      if (current && !isPriorBackgroundExecution(current, started, activeIds)) continue
      throw error
    }
  }
  return recovered
}

export function recoverOrphanedCommandOperationsOnce (options) {
  if (!startupRecoveryPromise) {
    startupRecoveryPromise = recoverOrphanedCommandOperations(options)
      .catch(error => {
        startupRecoveryPromise = undefined
        throw error
      })
  }
  return startupRecoveryPromise
}
