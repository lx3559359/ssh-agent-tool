import { redactAuditText, redactSensitiveData } from './audit-redaction.js'
import { classifyCommand } from './command-classifier.js'
import { assertSameSessionEndpoint } from './endpoint-guard.js'
import { operationStates } from './models.js'
import {
  buildVerifiedRemoteAction,
  parseRemoteActionMarker
} from './remote-recovery.js'

export const maxAuditPreviewBytes = 64 * 1024

const terminalStates = new Set([
  operationStates.rollbackAvailable,
  operationStates.kept,
  operationStates.restored,
  operationStates.failed,
  operationStates.cancelled
])
const cancellableStates = new Set([
  operationStates.preparing,
  operationStates.recoveryReady,
  operationStates.awaitingConfirmation,
  operationStates.executing,
  operationStates.rollingBack
])
const defaultTimeouts = {
  prepare: 30000,
  execute: 60000,
  rollback: 30000,
  verify: 30000
}

function requireFunction (value, label) {
  if (typeof value !== 'function') throw new Error(`${label} 必须是函数。`)
  return value
}

function bindStoreMethod (store, genericName, operationName) {
  const method = store?.[genericName] || store?.[operationName]
  if (typeof method !== 'function') {
    throw new Error(`事务存储缺少 ${genericName} 方法。`)
  }
  return method.bind(store)
}

function resolveClock (now) {
  const clock = typeof now === 'function' ? now : () => now ?? new Date()
  return () => {
    const value = clock()
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) throw new Error('事务执行器当前时间无效。')
    return date.toISOString()
  }
}

export function redactAndTruncateAuditText (value, maxBytes = maxAuditPreviewBytes) {
  const redacted = redactAuditText(String(value ?? ''))
  const encoder = new TextEncoder()
  const bytes = encoder.encode(redacted)
  if (bytes.byteLength <= maxBytes) return redacted
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let end = maxBytes; end >= Math.max(0, maxBytes - 3); end -= 1) {
    try {
      return decoder.decode(bytes.slice(0, end))
    } catch {}
  }
  return ''
}

function remoteOutput (result) {
  if (typeof result === 'string') return result
  if (!result || typeof result !== 'object') return ''
  return [result.output, result.stdout, result.stderr]
    .filter(value => value !== undefined && value !== null && value !== '')
    .map(String)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join('\n')
}

function remoteCode (result) {
  if (!result || typeof result !== 'object') return undefined
  const value = result.code ?? result.exitCode ?? result.rc
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export function createAuditRecord ({ phase, timestamp, code, output }) {
  return {
    phase,
    timestamp,
    code: code === undefined ? null : code,
    preview: redactAndTruncateAuditText(output)
  }
}

function sanitizeError (error, fallback = '安全事务执行失败。') {
  const message = redactAndTruncateAuditText(error?.message || fallback)
  const safeError = new Error(message || fallback)
  if (error?.code !== undefined) safeError.code = error.code
  return safeError
}

function cancellationError () {
  const error = new Error('安全事务已取消。')
  error.cancelled = true
  return error
}

function phaseError (error, audit, cancelled = false) {
  const safeError = cancelled ? cancellationError() : sanitizeError(error)
  safeError.audit = audit
  return safeError
}

function appendAudit (operation, entries) {
  return [...(operation.audit || []), ...entries.filter(Boolean)]
}

function timeoutFor (operation, phase) {
  const value = operation?.[`${phase}TimeoutMs`] ??
    operation?.plan?.[`${phase}TimeoutMs`] ??
    operation?.timeoutMs ??
    defaultTimeouts[phase]
  const timeout = Number(value)
  return Number.isFinite(timeout) && timeout > 0
    ? timeout
    : defaultTimeouts[phase]
}

function persistedPlan (plan) {
  return redactSensitiveData({
    provider: plan.provider,
    summary: plan.summary,
    rollbackCommand: plan.rollbackCommand,
    verifyCommand: plan.verifyCommand,
    allowUnsafeExecute: plan.allowUnsafeExecute,
    rollbackTimeoutMs: plan.rollbackTimeoutMs,
    verifyTimeoutMs: plan.verifyTimeoutMs
  })
}

export function createTransactionRunner (options = {}) {
  const runRemote = requireFunction(options.runRemote, 'runRemote')
  const cancelRemote = requireFunction(options.cancelRemote, 'cancelRemote')
  const getCurrentEndpoint = requireFunction(options.getCurrentEndpoint, 'getCurrentEndpoint')
  const buildRecoveryPlan = requireFunction(options.buildRecoveryPlan, 'buildRecoveryPlan')
  const store = options.store || options
  const save = bindStoreMethod(store, 'save', 'saveOperation')
  const get = bindStoreMethod(store, 'get', 'getOperation')
  const patch = bindStoreMethod(store, 'patch', 'patchOperation')
  const timestamp = resolveClock(options.now)
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
  const queues = new Map()
  const activeExecutions = new Map()
  const cancellationRequests = new Set()
  let executionSequence = 0

  function emit (operationId, status, phase) {
    if (!onEvent) return
    try {
      onEvent({ operationId, status, phase })
    } catch {}
  }

  function serialize (id, work) {
    const previous = queues.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    queues.set(id, current)
    return current.finally(() => {
      if (queues.get(id) === current) queues.delete(id)
    })
  }

  async function transition (operation, state, extra = {}, phase = state) {
    const next = await patch(operation.id, {
      ...extra,
      state,
      updatedAt: timestamp()
    })
    emit(operation.id, state, phase)
    return next
  }

  async function assertCurrentEndpoint (operation) {
    const current = await getCurrentEndpoint(operation)
    assertSameSessionEndpoint(operation.endpoint, current)
  }

  async function runMarkedPhase (operation, command, phase, runOptions = {}) {
    const executionId = `${operation.id}-${phase}-${++executionSequence}`
    const active = { executionId, cancelRequested: false }
    activeExecutions.set(operation.id, active)
    const remoteCommand = runOptions.alreadyMarked
      ? command
      : buildVerifiedRemoteAction(command, phase, operation.id)
    try {
      let result
      try {
        result = await runRemote(remoteCommand, {
          timeoutMs: timeoutFor(operation, phase),
          signal: runOptions.signal,
          executionId,
          phase
        })
      } catch (error) {
        const cancelled = active.cancelRequested || cancellationRequests.has(operation.id)
        const output = error?.output ?? error?.stderr ?? error?.message ?? ''
        const audit = createAuditRecord({
          phase,
          timestamp: timestamp(),
          code: remoteCode(error),
          output
        })
        throw phaseError(error, audit, cancelled)
      }

      const output = remoteOutput(result)
      let code = remoteCode(result)
      try {
        code = parseRemoteActionMarker(output, phase, operation.id)
      } catch (error) {
        if (error.code !== undefined) code = Number(error.code)
        const audit = createAuditRecord({
          phase,
          timestamp: timestamp(),
          code,
          output
        })
        throw phaseError(error, audit)
      }
      return {
        executionId,
        audit: createAuditRecord({
          phase,
          timestamp: timestamp(),
          code,
          output
        })
      }
    } finally {
      if (activeExecutions.get(operation.id) === active) {
        activeExecutions.delete(operation.id)
      }
    }
  }

  async function fail (operation, error, entries = []) {
    const current = await get(operation.id) || operation
    await transition(current, operationStates.failed, {
      audit: appendAudit(current, entries),
      error: sanitizeError(error).message,
      failedAt: timestamp(),
      executionId: undefined
    }, 'failed')
    throw sanitizeError(error)
  }

  async function cancelState (operation, entries = []) {
    return transition(operation, operationStates.cancelled, {
      audit: appendAudit(operation, entries),
      error: cancellationError().message,
      completedAt: timestamp(),
      executionId: undefined
    }, 'cancel')
  }

  function prepare (request = {}) {
    const id = String(request.id || '')
    if (!id) return Promise.reject(new Error('安全事务标识不能为空。'))
    return serialize(id, async () => {
      let operation
      try {
        operation = await save({
          ...request,
          state: operationStates.preparing,
          updatedAt: timestamp()
        })
        emit(id, operationStates.preparing, 'prepare')
        await assertCurrentEndpoint(operation)
        if (cancellationRequests.has(operation.id)) throw cancellationError()
        if (!operation.reversible) {
          return transition(
            operation,
            operationStates.awaitingConfirmation,
            {},
            'prepare'
          )
        }

        const plan = await buildRecoveryPlan(operation)
        if (cancellationRequests.has(operation.id)) throw cancellationError()
        const phase = await runMarkedPhase(
          operation,
          plan.prepareCommand,
          'prepare',
          { signal: request.signal }
        )
        const recoveryReady = await transition(operation, operationStates.recoveryReady, {
          plan: persistedPlan(plan),
          artifacts: redactSensitiveData(plan.artifacts || {}),
          audit: appendAudit(operation, [phase.audit]),
          recoveryReadyAt: timestamp(),
          executionId: undefined
        }, 'prepare')
        return transition(
          recoveryReady,
          operationStates.awaitingConfirmation,
          {},
          'prepare'
        )
      } catch (error) {
        if (!operation) throw sanitizeError(error)
        if (error.cancelled) {
          await cancelState(operation, [error.audit])
          throw cancellationError()
        }
        return fail(operation, error, [error.audit])
      }
    })
  }

  function execute (id, executeOptions = {}) {
    return serialize(String(id), async () => {
      let operation = await get(id)
      if (!operation) throw new Error(`未找到安全事务：${id}`)
      if (operation.state !== operationStates.awaitingConfirmation) {
        throw new Error('安全事务必须处于 awaiting-confirmation 状态才能执行。')
      }
      if (executeOptions.confirmed !== true) {
        throw new Error('必须明确确认后才能执行安全事务。')
      }
      try {
        await assertCurrentEndpoint(operation)
        if (operation.risk === 'blocked') {
          throw new Error('该命令属于明确禁止操作，已拒绝执行。')
        }
        if (operation.reversible) {
          if (!operation.plan || !operation.artifacts || !operation.recoveryReadyAt) {
            throw new Error('可逆事务尚未完成 recovery-ready，已拒绝执行。')
          }
        } else {
          const classifiedProvider = operation.recoveryProvider ||
            classifyCommand(operation.command).provider
          if (classifiedProvider === 'network') {
            throw new Error('网络修改禁止 unsafe 执行，必须使用已验证恢复点。')
          }
          if (executeOptions.allowUnsafe !== true) {
            throw new Error('非可逆或未知操作必须显式允许 unsafe 执行。')
          }
        }

        operation = await transition(operation, operationStates.executing, {}, 'execute')
        if (cancellationRequests.has(operation.id)) {
          throw cancellationError()
        }
        const phase = await runMarkedPhase(
          operation,
          operation.command,
          'execute',
          { signal: executeOptions.signal }
        )
        if (operation.reversible) {
          const verified = await transition(operation, operationStates.verificationPassed, {
            audit: appendAudit(operation, [phase.audit]),
            executionId: undefined
          }, 'execute')
          return transition(
            verified,
            operationStates.rollbackAvailable,
            { completedAt: timestamp() },
            'execute'
          )
        }
        return transition(operation, operationStates.kept, {
          audit: appendAudit(operation, [phase.audit]),
          completedAt: timestamp(),
          executionId: undefined
        }, 'execute')
      } catch (error) {
        if (error.cancelled) {
          await cancelState(operation, [error.audit])
          throw cancellationError()
        }
        if (cancellationRequests.has(operation.id)) {
          await cancelState(operation, [error.audit])
          throw cancellationError()
        }
        if (operation.risk === 'blocked' ||
          /网络修改禁止|recovery-ready/.test(error.message)) {
          return fail(operation, error, [error.audit])
        }
        if (operation.state === operationStates.awaitingConfirmation &&
          /unsafe/.test(error.message)) {
          throw sanitizeError(error)
        }
        return fail(operation, error, [error.audit])
      }
    })
  }

  function rollback (id, rollbackOptions = {}) {
    return serialize(String(id), async () => {
      let operation = await get(id)
      if (!operation) throw new Error(`未找到安全事务：${id}`)
      if (![operationStates.rollbackAvailable, operationStates.failed].includes(operation.state)) {
        throw new Error('当前安全事务状态不允许回滚。')
      }
      if (!operation.plan?.rollbackCommand || !operation.plan?.verifyCommand) {
        throw new Error('安全事务没有可用恢复计划，无法回滚。')
      }
      const audits = []
      try {
        await assertCurrentEndpoint(operation)
        operation = await transition(operation, operationStates.rollingBack, {}, 'rollback')
        if (cancellationRequests.has(operation.id)) {
          throw cancellationError()
        }
        const rollbackPhase = await runMarkedPhase(
          operation,
          operation.plan.rollbackCommand,
          'rollback',
          { alreadyMarked: true, signal: rollbackOptions.signal }
        )
        audits.push(rollbackPhase.audit)
        const verifyPhase = await runMarkedPhase(
          operation,
          operation.plan.verifyCommand,
          'verify',
          { alreadyMarked: true, signal: rollbackOptions.signal }
        )
        audits.push(verifyPhase.audit)
        return transition(operation, operationStates.restored, {
          audit: appendAudit(operation, audits),
          completedAt: timestamp(),
          executionId: undefined
        }, 'verify')
      } catch (error) {
        if (error.cancelled) {
          if (error.audit) audits.push(error.audit)
          await cancelState(operation, audits)
          throw cancellationError()
        }
        if (error.audit) audits.push(error.audit)
        if (cancellationRequests.has(operation.id)) {
          await cancelState(operation, audits)
          throw cancellationError()
        }
        return fail(operation, error, audits)
      }
    })
  }

  function keep (id) {
    return serialize(String(id), async () => {
      const operation = await get(id)
      if (!operation) throw new Error(`未找到安全事务：${id}`)
      if (operation.state !== operationStates.rollbackAvailable) {
        throw new Error('只有 rollback-available 状态可以确认保留。')
      }
      return transition(operation, operationStates.kept, {
        completedAt: timestamp()
      }, 'keep')
    })
  }

  async function cancel (id) {
    const operationId = String(id)
    cancellationRequests.add(operationId)
    const pending = queues.get(operationId)
    const active = activeExecutions.get(operationId)
    let cancellationFailure
    if (active) {
      active.cancelRequested = true
      try {
        await cancelRemote(active.executionId)
      } catch (error) {
        cancellationFailure = sanitizeError(error)
      }
    }

    if (pending) {
      try {
        await pending
      } catch {}
    } else {
      await serialize(operationId, async () => {
        const operation = await get(operationId)
        if (!operation || terminalStates.has(operation.state)) return operation
        if (!cancellableStates.has(operation.state)) return operation
        return cancelState(operation)
      })
    }
    cancellationRequests.delete(operationId)
    const current = await get(operationId)
    if (cancellationFailure && !current) throw cancellationFailure
    return current
  }

  return { prepare, execute, rollback, keep, cancel }
}
