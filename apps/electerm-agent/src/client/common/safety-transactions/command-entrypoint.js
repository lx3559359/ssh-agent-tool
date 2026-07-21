import generate from '../uid.js'
import { redactAuditText } from './audit-redaction.js'
import { buildSafetyRequest, operationStates } from './models.js'
import { buildCommandExecution } from './command-execution.js'
import {
  consumeInternalCommandRiskDelegation
} from './command-risk-delegation.js'
import { resolveInternalSubmissionHooks } from './command-submission-hooks.js'
import { assertSameSessionEndpoint } from './endpoint-guard.js'
import {
  consumeInternalMaintenanceRecoveryDelegation,
  createInternalMaintenanceRecoveryAuthorization,
  createPersistedMaintenanceRecovery,
  maintenanceRecoveryProvider
} from './maintenance-recovery-delegation.js'
import { createTraceContext } from '../quality/trace-context.js'
import { recordQualityEvent } from '../quality/quality-events.js'

const supportedSources = new Set(['quick-command', 'agent'])

function requireFunction (value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`command entrypoint requires ${name}`)
  }
  return value
}

function deferred () {
  let resolveDeferred
  const promise = new Promise(resolve => { resolveDeferred = resolve })
  return { promise, resolve: resolveDeferred }
}

function safeErrorMessage (error, fallback = '未知错误') {
  return redactAuditText(String(error?.message || fallback))
}

function riskDelegationError () {
  const error = new Error('Agent command risk delegation capability is invalid')
  error.code = 'AGENT_RISK_DELEGATION_INVALID'
  return error
}

function resolveRiskDelegation (command, runOptions) {
  if (runOptions.riskDelegation === undefined) return undefined
  const delegation = consumeInternalCommandRiskDelegation(
    runOptions.riskDelegation
  )
  if (!delegation || runOptions.source !== 'agent' ||
    runOptions.inputOnly === true || delegation.command !== command) {
    throw riskDelegationError()
  }
  return delegation
}

function maintenanceRecoveryError () {
  const error = new Error('Quick command maintenance recovery capability is invalid')
  error.code = 'MAINTENANCE_RECOVERY_CAPABILITY_INVALID'
  return error
}

function resolveMaintenanceRecovery (command, runOptions) {
  if (runOptions.maintenanceRecovery === undefined) return undefined
  const recovery = consumeInternalMaintenanceRecoveryDelegation(
    runOptions.maintenanceRecovery
  )
  if (!recovery || runOptions.source !== 'quick-command' ||
    runOptions.inputOnly === true || recovery.command !== command) {
    throw maintenanceRecoveryError()
  }
  return recovery
}

function rotateMaintenanceRecovery (command, recovery) {
  if (!recovery) return { command, recovery }
  const oldPath = recovery.rollbackPath
  const retryId = String(generate()).replace(/[^A-Za-z0-9_-]/g, '') ||
    String(Date.now())
  const nextPath = oldPath.replace(/\.sh$/, `-retry-${retryId}.sh`)
  if (nextPath === oldPath || !command.includes(oldPath)) {
    throw new Error('ά����������޷��ֻ��ع��ű����ѽ�ֹ���ԡ�')
  }
  const nextCommand = command.replaceAll(oldPath, nextPath)
  return {
    command: nextCommand,
    recovery: Object.freeze({
      ...recovery,
      command: nextCommand,
      rollbackPath: nextPath
    })
  }
}

function createHookState (hooks) {
  if (!hooks) return undefined
  let beforePromise
  let abortPromise
  let abortRequested = false
  let cleaned = false

  async function abortNow () {
    if (cleaned) return
    cleaned = true
    await hooks.onAbort()
  }

  return {
    async beforeSubmit () {
      if (abortRequested) {
        await abortNow()
        throw new Error('命令提交已取消。')
      }
      beforePromise = Promise.resolve().then(() => hooks.beforeSubmit())
      await beforePromise
      if (abortRequested) {
        await abortNow()
        throw new Error('命令提交已取消。')
      }
    },
    abort () {
      abortRequested = true
      if (!abortPromise) {
        abortPromise = Promise.resolve(beforePromise)
          .catch(() => {})
          .then(abortNow)
      }
      return abortPromise
    }
  }
}

export function createSafetyCommandEntrypoint (options = {}) {
  const runner = options.runner
  const tracker = options.tracker
  const getEndpoint = requireFunction(options.getEndpoint, 'getEndpoint')
  const submitCommand = requireFunction(options.submitCommand, 'submitCommand')
  const inputCommand = requireFunction(options.inputCommand, 'inputCommand')
  const buildConfirmation = requireFunction(
    options.buildConfirmation,
    'buildConfirmation'
  )
  const ensureTrackerReady = options.ensureTrackerReady || (async () => true)
  const createId = options.createId || (() => `command-${Date.now()}-${generate()}`)
  const onStateChange = options.onStateChange || (() => {})
  const onError = options.onError || (() => {})
  let generation = 0
  let live = false
  let pendingRun = null
  let pendingConfirmation = null
  let activeExecution = null
  const detachedExecutions = new Map()
  const completingExecutions = new Map()

  function recordRunEvent (run, phase, result) {
    if (!run?.traceContext || (phase !== 'started' && run.qualityFinished)) return
    if (phase !== 'started') run.qualityFinished = true
    recordQualityEvent(run.traceContext, {
      module: 'ssh',
      action: 'safety-command',
      phase,
      ...(result ? { result } : {})
    })
  }

  function beginSession () {
    generation += 1
    live = true
  }

  function updateState (state = {}) {
    onStateChange({
      confirmation: null,
      busy: false,
      error: '',
      ...state
    })
  }

  function isCurrent (run) {
    return live && pendingRun === run && run.generation === generation
  }

  function isGenerationCurrent (run) {
    return live && run.generation === generation
  }

  async function abortHookState (hookState) {
    if (!hookState) return
    try {
      await hookState.abort()
    } catch (error) {
      onError(error)
    }
  }

  function cancelRunOperation (run) {
    if (!run?.operationId) return Promise.resolve(undefined)
    run.operationCancelled = true
    if (!run.cancelPromise) {
      run.cancelPromise = Promise.resolve().then(() => runner.cancel(run.operationId))
    }
    return run.cancelPromise
  }

  function confirmationClassification (run, request) {
    return {
      risk: request.risk,
      reversible: request.reversible,
      provider: request.provider,
      requiresConfirmation: request.requiresConfirmation,
      reason: request.reason,
      ...(run.riskDelegation
        ? {
            riskContext: run.riskDelegation.riskContext,
            agentRiskReasonCode: run.riskDelegation.classification.reasonCode,
            agentToolName: run.riskDelegation.toolName,
            endpoint: run.riskDelegation.endpoint
          }
        : {})
    }
  }

  function waitForConfirmation (run, request) {
    const classification = confirmationClassification(run, request)
    const built = buildConfirmation(run.command, classification) || {}
    const confirmation = {
      ...built,
      command: run.command,
      classification,
      ...(request.reversible
        ? {}
        : {
            kind: 'nonreversible',
            automaticRollback: false,
            message: '此操作无法自动回滚，确认后仅执行一次。'
          })
    }
    run.confirmation = confirmation
    return new Promise(resolve => {
      pendingConfirmation = { run, confirmation, resolve }
      updateState({ confirmation })
    })
  }

  function confirmPending () {
    const pending = pendingConfirmation
    if (!pending) return false
    if (pending.retry === true) {
      const retryGeneration = generation
      pendingConfirmation = null
      updateState({ confirmation: pending.confirmation, busy: true })
      Promise.resolve()
        .then(() => startSafetyCommand(
          pending.command,
          pending.runOptions,
          pending.riskDelegation,
          pending.maintenanceRecovery
        ))
        .catch(error => {
          if (!live || generation !== retryGeneration) return
          pendingConfirmation = pending
          const message = `命令重试失败，命令尚未发送：${safeErrorMessage(error)}`
          updateState({
            confirmation: pending.confirmation,
            busy: false,
            error: message
          })
          onError(error)
        })
      return true
    }
    if (!isCurrent(pending.run) ||
      pending.confirmation.executeAllowed === false) {
      return false
    }
    pendingConfirmation = null
    updateState({ confirmation: pending.confirmation, busy: true })
    pending.resolve(true)
    return true
  }

  async function invalidatePending (endSession) {
    const pending = pendingConfirmation
    const hadPendingRun = Boolean(pendingRun)
    const run = pendingRun || pending?.run
    generation += 1
    if (endSession) live = false
    pendingConfirmation = null
    if (pending?.resolve) pending.resolve(false)
    updateState({})
    await abortHookState(run?.hookState)
    if (run?.operationId && !run.operationCancelled) {
      await cancelRunOperation(run)
    }
    return hadPendingRun
  }

  function cancelPending () {
    return invalidatePending(false)
  }

  function inputChanged () {
    if (!pendingRun && !pendingConfirmation) return Promise.resolve(false)
    return invalidatePending(false)
  }

  function removeExecution (execution) {
    if (activeExecution === execution) activeExecution = null
    detachedExecutions.delete(execution.id)
  }

  function settleExecution (execution, outcome) {
    if (execution.settled) return false
    execution.settled = true
    execution.completion.resolve(outcome)
    return true
  }

  function findExecution (operationId) {
    if (activeExecution?.id === operationId) return activeExecution
    return detachedExecutions.get(operationId) ||
      completingExecutions.get(operationId)
  }

  async function cancelExecution (execution, reason, interrupt) {
    if (!execution || execution.settled || execution.cancelled) return false
    execution.cancelled = true
    removeExecution(execution)
    tracker.cancelExpectedSubmission(execution.token)
    if (typeof interrupt === 'function') interrupt()
    await abortHookState(execution.hookState)
    settleExecution(execution, {
      cancelled: true,
      error: reason || '命令执行已取消。',
      operationId: execution.id
    })
    recordRunEvent(execution.qualityRun, 'cancelled', 'cancelled')
    if (!execution.cancelPromise) {
      execution.cancelPromise = Promise.resolve()
        .then(() => runner.cancel(execution.id))
    }
    const cancelled = await execution.cancelPromise
    return cancelled !== false
  }

  async function cancelForegroundExecutionById (
    operationId,
    interrupt,
    reason = '命令执行已取消。'
  ) {
    const execution = activeExecution
    if (!operationId || !execution || execution.id !== operationId ||
      execution.mode !== 'foreground' || execution.settled ||
      execution.cancelled) {
      return false
    }
    return cancelExecution(execution, reason, interrupt)
  }

  async function cancelExecutionById (operationId, reason) {
    return cancelExecution(findExecution(operationId), reason)
  }

  async function cancelAllExecutions (reason) {
    const executions = new Set([
      activeExecution,
      ...detachedExecutions.values(),
      ...completingExecutions.values()
    ].filter(Boolean))
    let cancelled = false
    for (const execution of executions) {
      cancelled = await cancelExecution(execution, reason) || cancelled
    }
    return cancelled
  }

  async function cancelCurrentExecution (reason = '命令执行已取消。') {
    const pendingCancelled = await invalidatePending(false)
    const executionCancelled = await cancelAllExecutions(reason)
    return pendingCancelled || executionCancelled
  }

  async function invalidateSession () {
    const cancelled = await invalidatePending(true)
    const executionCancelled = await cancelAllExecutions(
      '终端连接已断开，命令执行已取消。'
    )
    return cancelled || executionCancelled
  }

  function hasPending () {
    return Boolean(
      pendingRun || pendingConfirmation || activeExecution ||
      detachedExecutions.size || completingExecutions.size
    )
  }

  function hasPendingConfirmation () {
    return Boolean(pendingConfirmation)
  }

  function retryConfirmation (run, request) {
    return {
      kind: 'retry',
      command: run.command,
      classification: confirmationClassification(run, request),
      executeAllowed: true,
      automaticRollback: request.reversible,
      message: '上次安全提交失败，可取消或重新准备后重试。'
    }
  }

  function staleRunResult (request) {
    return {
      sent: false,
      cancelled: true,
      operationId: request.id
    }
  }

  function canUseUntrackedReadonlyFallback (run, request, source) {
    return run.runOptions.allowUntrackedReadonlyFallback === true &&
      source === 'quick-command' &&
      request.risk === 'readonly' &&
      request.requiresConfirmation !== true &&
      (run.runOptions.executionMode || 'foreground') === 'foreground' &&
      !run.hookState &&
      !run.riskDelegation &&
      !run.maintenanceRecovery
  }

  async function runUntrackedReadonlyFallback (
    run,
    request,
    executionPlan,
    readinessError
  ) {
    const submittedCommand = executionPlan.submittedCommand
    const token = `untracked-${request.id}`
    if (!isCurrent(run)) return staleRunResult(request)
    if (submitCommand(submittedCommand, token) === false) {
      throw new Error('快捷命令降级发送失败，命令尚未发送。')
    }
    const completion = {
      operationId: request.id,
      command: run.command,
      submittedCommand,
      exitCode: null,
      untracked: true,
      trackerError: safeErrorMessage(readinessError)
    }
    recordRunEvent(run, 'completed', 'completed')
    return {
      sent: true,
      operationId: request.id,
      token,
      request,
      execution: executionPlan,
      untracked: true,
      trackerError: completion.trackerError,
      waitForCompletion: async () => completion
    }
  }

  async function armRetry (run, request, error, cancelOperation) {
    let cancelError
    if (run.operationId) {
      try {
        if (cancelOperation) await cancelRunOperation(run)
        if (run.maintenanceRecovery) {
          if (typeof runner.revokeRecovery !== 'function') {
            throw new Error('��ȫ����ִ������֧�ֳ����ɻع���Ȩ��')
          }
          await runner.revokeRecovery(
            run.operationId,
            '�����ύʧ�ܣ��ɻع���Ȩ�����ݡ�'
          )
        }
      } catch (caught) {
        cancelError = caught
      }
    }
    await abortHookState(run.hookState)
    if (!isGenerationCurrent(run)) return staleRunResult(request)
    if (cancelError) {
      onError(cancelError)
      const message = `命令提交失败且事务取消失败，禁止重试：${safeErrorMessage(cancelError)}`
      const confirmation = {
        ...retryConfirmation(run, request),
        kind: 'blocked',
        executeAllowed: false,
        message: '无法确认上一事务已停止，已禁止重试以避免重复执行。'
      }
      pendingConfirmation = { run, confirmation }
      updateState({ confirmation, busy: false, error: message })
      return {
        sent: false,
        retryable: false,
        blocked: true,
        operationId: request.id,
        error: message
      }
    }
    const message = `命令发送失败，命令尚未发送：${safeErrorMessage(error)}`
    let retry
    try {
      retry = rotateMaintenanceRecovery(run.command, run.maintenanceRecovery)
    } catch (caught) {
      onError(caught)
      const blockedConfirmation = {
        ...retryConfirmation(run, request),
        kind: 'blocked',
        executeAllowed: false,
        message: safeErrorMessage(caught)
      }
      pendingConfirmation = { run, confirmation: blockedConfirmation }
      updateState({
        confirmation: blockedConfirmation,
        busy: false,
        error: message
      })
      return {
        sent: false,
        retryable: false,
        blocked: true,
        operationId: request.id,
        error: message
      }
    }
    const confirmation = {
      ...retryConfirmation(run, request),
      command: retry.command
    }
    pendingConfirmation = {
      retry: true,
      run,
      command: retry.command,
      runOptions: run.runOptions,
      riskDelegation: run.riskDelegation,
      maintenanceRecovery: retry.recovery,
      confirmation
    }
    updateState({ confirmation, busy: false, error: message })
    return {
      sent: false,
      retryable: true,
      operationId: request.id,
      error: message
    }
  }

  async function waitForCompletion (operationId, completion, waitOptions = {}) {
    const timeoutMs = Number(waitOptions.timeoutMs || 0)
    let timeout
    let outcome
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      outcome = await Promise.race([
        completion,
        new Promise(resolve => {
          timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
        })
      ])
      clearTimeout(timeout)
      if (outcome?.timedOut) {
        const message = `等待命令完成超时（${timeoutMs} 毫秒），已停止后续命令。`
        await cancelExecutionById(operationId, message)
        throw new Error(message)
      }
    } else {
      outcome = await completion
    }
    if (outcome?.cancelled || outcome?.error) {
      throw new Error(outcome.error || '命令执行已取消。')
    }
    if (outcome?.exitCode !== 0) {
      throw new Error(`命令执行失败，退出码 ${outcome.exitCode}，已停止后续命令。`)
    }
    return outcome
  }

  async function finalizeExecution (execution, exitCode) {
    if (!execution || execution.settled) {
      throw new Error('后台任务已经进入终态，不能重复完成。')
    }
    if (!Number.isInteger(exitCode) && exitCode !== null) {
      throw new Error('命令退出码无效。')
    }
    if (execution.finalizationPromise) return execution.finalizationPromise
    completingExecutions.set(execution.id, execution)
    const finalizationPromise = (async () => {
      try {
        const operation = await runner.completeExternalExecution(execution.id, {
          executionId: execution.executionId,
          command: execution.originalCommand,
          exitCode
        })
        if (operation === false) {
          if (execution.mode === 'background') return false
          throw new Error('安全事务完成返回失败。')
        }
        if (execution.cancelled || !live || execution.generation !== generation) {
          if (!execution.cancelPromise) {
            execution.cancelPromise = Promise.resolve()
              .then(() => runner.cancel(execution.id))
          }
          await execution.cancelPromise
          settleExecution(execution, {
            cancelled: true,
            error: '终端会话已失效，已忽略迟到的命令完成结果。',
            operationId: execution.id
          })
          recordRunEvent(execution.qualityRun, 'cancelled', 'cancelled')
          return false
        }
        removeExecution(execution)
        tracker.cancelExpectedSubmission(execution.token)
        await abortHookState(execution.hookState)
        settleExecution(execution, {
          operation,
          operationId: execution.id,
          exitCode,
          submittedCommand: execution.submittedCommand
        })
        const failed = (exitCode !== null && exitCode !== 0) ||
          operation?.state === operationStates.failed
        recordRunEvent(
          execution.qualityRun,
          failed ? 'failed' : 'completed',
          failed ? 'failed' : 'completed'
        )
        return true
      } catch (error) {
        if (execution.cancelled) return false
        if (execution.mode === 'background') {
          onError(error)
          return false
        }
        removeExecution(execution)
        tracker.cancelExpectedSubmission(execution.token)
        try {
          await runner.cancel(execution.id)
        } catch (cancelError) {
          onError(cancelError)
        }
        await abortHookState(execution.hookState)
        settleExecution(execution, {
          operationId: execution.id,
          error: `安全事务完成失败：${safeErrorMessage(error)}`
        })
        recordRunEvent(execution.qualityRun, 'failed', 'failed')
        onError(error)
        return false
      } finally {
        completingExecutions.delete(execution.id)
      }
    })()
    execution.finalizationPromise = finalizationPromise
    try {
      return await finalizationPromise
    } finally {
      if (execution.finalizationPromise === finalizationPromise &&
        !execution.settled) {
        execution.finalizationPromise = null
      }
    }
  }

  async function executeRun (run) {
    const { command, runOptions } = run
    try {
      const callerMetadata = { ...(runOptions.metadata || {}) }
      if (Object.hasOwn(callerMetadata, 'maintenanceRecovery')) {
        throw maintenanceRecoveryError()
      }
      const source = runOptions.source || 'quick-command'
      if (!supportedSources.has(source)) {
        throw new Error('命令安全事务来源不受支持。')
      }
      const operationId = run.operationId
      const endpoint = getEndpoint()
      const executionPlan = buildCommandExecution({
        command,
        operationId,
        mode: runOptions.executionMode || 'foreground',
        endpoint
      })
      run.execution = executionPlan
      if (run.riskDelegation) {
        assertSameSessionEndpoint(run.riskDelegation.endpoint, endpoint)
      }
      if (run.maintenanceRecovery) {
        assertSameSessionEndpoint(run.maintenanceRecovery.endpoint, endpoint)
      }
      let request = buildSafetyRequest({
        id: operationId,
        source,
        endpoint,
        title: run.maintenanceRecovery?.title || runOptions.title || '终端命令',
        command,
        metadata: {
          ...callerMetadata,
          commandEntrypoint: true,
          execution: executionPlan.metadata,
          traceId: run.traceContext.traceId,
          ...(run.riskDelegation
            ? {
                agentRiskContext: run.riskDelegation.riskContext,
                agentRiskReasonCode: run.riskDelegation.classification.reasonCode,
                agentToolName: run.riskDelegation.toolName
              }
            : {})
        }
      })
      if (run.riskDelegation && request.risk === 'readonly') {
        request = {
          ...request,
          risk: 'unknown',
          provider: null,
          reversible: false,
          recoveryProvider: null,
          requiresConfirmation: true,
          reason: `Agent policy requires confirmation: ${run.riskDelegation.classification.reasonCode}`
        }
      }
      if (run.maintenanceRecovery) {
        request = {
          ...request,
          risk: 'change',
          provider: maintenanceRecoveryProvider,
          reversible: true,
          recoveryProvider: maintenanceRecoveryProvider,
          requiresConfirmation: true,
          reason: 'Authenticated quick command provides a fixed rollback script.',
          metadata: {
            ...request.metadata,
            maintenanceRecovery: createPersistedMaintenanceRecovery(
              run.maintenanceRecovery,
              request.id
            )
          },
          maintenanceRecoveryAuthorization: createInternalMaintenanceRecoveryAuthorization(
            run.maintenanceRecovery,
            request.id
          )
        }
      }
      run.operationId = request.id
      try {
        await ensureTrackerReady({
          command,
          source,
          executionMode: runOptions.executionMode || 'foreground',
          risk: request.risk
        })
      } catch (error) {
        if (canUseUntrackedReadonlyFallback(run, request, source)) {
          return runUntrackedReadonlyFallback(
            run,
            request,
            executionPlan,
            error
          )
        }
        throw error
      }
      if (!isCurrent(run)) return staleRunResult(request)
      const prepared = await runner.prepare(request)
      if (prepared?.state !== operationStates.awaitingConfirmation) {
        throw new Error(prepared?.error || '无法安全准备执行，命令尚未发送。')
      }
      if (!isCurrent(run)) {
        if (!run.operationCancelled) await cancelRunOperation(run)
        return staleRunResult(request)
      }
      if (request.risk !== 'readonly') {
        const accepted = await waitForConfirmation(run, request)
        if (!accepted || !isCurrent(run)) {
          await abortHookState(run.hookState)
          if (!run.operationCancelled) await cancelRunOperation(run)
          return staleRunResult(request)
        }
      }
      let begun
      try {
        begun = await runner.beginExternalExecution(request.id, {
          confirmed: true,
          allowUnsafe: request.risk !== 'readonly' && !request.reversible
        })
      } catch (error) {
        return armRetry(run, request, error, true)
      }
      if (begun?.state !== operationStates.executing || !begun.executionId) {
        return armRetry(
          run,
          request,
          new Error(begun?.error || '安全事务未进入执行状态。'),
          begun?.state !== operationStates.failed
        )
      }
      if (!isCurrent(run)) {
        await cancelRunOperation(run)
        await abortHookState(run.hookState)
        return staleRunResult(request)
      }
      const submittedCommand = executionPlan.submittedCommand
      const token = tracker.expectExternalSubmission(submittedCommand)
      if (!token || tracker.markExpectedSubmissionReleased(token) !== true) {
        if (token) tracker.cancelExpectedSubmission(token)
        return armRetry(
          run,
          request,
          new Error('无法绑定当前终端命令。'),
          true
        )
      }
      const completion = deferred()
      const execution = {
        id: request.id,
        executionId: begun.executionId,
        originalCommand: command,
        submittedCommand,
        mode: executionPlan.mode,
        token,
        completion,
        generation: run.generation,
        hookState: run.hookState,
        settled: false,
        cancelled: false,
        qualityRun: run
      }
      activeExecution = execution
      try {
        await execution.hookState?.beforeSubmit()
        if (!isCurrent(run) || activeExecution !== execution || execution.cancelled) {
          await cancelExecution(execution, '命令提交前会话已失效。')
          return staleRunResult(request)
        }
        if (submitCommand(submittedCommand, token) === false) {
          throw new Error('AttachAddon 拒绝了安全命令提交。')
        }
      } catch (error) {
        if (execution.cancelled) return staleRunResult(request)
        removeExecution(execution)
        tracker.cancelExpectedSubmission(token)
        await abortHookState(execution.hookState)
        settleExecution(execution, {
          cancelled: true,
          error: '命令提交失败，命令尚未发送。',
          operationId: request.id
        })
        return armRetry(run, request, error, true)
      }
      updateState({})
      const result = {
        sent: true,
        operationId: request.id,
        executionId: begun.executionId,
        token,
        request,
        execution: executionPlan,
        completion: completion.promise,
        waitForCompletion: waitOptions => waitForCompletion(
          request.id,
          completion.promise,
          waitOptions
        )
      }
      if (executionPlan.mode === 'background') {
        result.finalizeBackground = exitCode => finalizeExecution(execution, exitCode)
        result.cancelBackground = reason => cancelExecution(
          execution,
          reason || '后台任务已取消。'
        )
      }
      return result
    } finally {
      run.removeAbortListener?.()
      if (pendingRun === run) pendingRun = null
    }
  }

  function startSafetyCommand (
    value,
    runOptions = {},
    trustedRiskDelegation,
    trustedMaintenanceRecovery
  ) {
    const command = String(value || '')
    let riskDelegation
    let maintenanceRecovery
    try {
      riskDelegation = trustedRiskDelegation === undefined
        ? resolveRiskDelegation(command, runOptions)
        : trustedRiskDelegation
      maintenanceRecovery = trustedMaintenanceRecovery === undefined
        ? resolveMaintenanceRecovery(command, runOptions)
        : trustedMaintenanceRecovery
    } catch (error) {
      return Promise.reject(error)
    }
    if (runOptions.signal?.aborted) {
      const error = new Error('Command safety preparation cancelled')
      error.name = 'AbortError'
      return Promise.reject(error)
    }
    if (!command.trim()) {
      return Promise.reject(new Error('命令不能为空。'))
    }
    if (!live) {
      return Promise.reject(new Error('当前终端会话未连接，命令尚未发送。'))
    }
    for (const forbidden of ['submittedCommand', 'beforeSubmit', 'onAbort']) {
      if (Object.prototype.hasOwnProperty.call(runOptions, forbidden)) {
        return Promise.reject(new Error('调用方不允许指定内部提交命令或安全钩子。'))
      }
    }
    const internalHooks = runOptions.submissionHooks === undefined
      ? undefined
      : resolveInternalSubmissionHooks(runOptions.submissionHooks)
    if (runOptions.submissionHooks !== undefined && !internalHooks) {
      return Promise.reject(new Error('命令提交钩子不是可信内部 capability。'))
    }
    if (runOptions.inputOnly === true) {
      inputCommand(command)
      return Promise.resolve({ inputOnly: true, sent: false, command })
    }
    if (pendingRun) {
      if (pendingRun.command === command) return pendingRun.promise
      return Promise.reject(
        new Error('当前终端已有安全命令等待处理，请先完成或取消。')
      )
    }
    if (pendingConfirmation?.retry) {
      return Promise.reject(
        new Error('当前终端有失败命令等待取消或重试。')
      )
    }
    if (activeExecution || completingExecutions.size) {
      if (activeExecution?.originalCommand === command) {
        return Promise.resolve({
          sent: false,
          duplicate: true,
          operationId: activeExecution.id
        })
      }
      return Promise.reject(
        new Error('当前终端已有安全命令正在执行，请等待完成。')
      )
    }
    if (redactAuditText(command) !== command) {
      return Promise.reject(
        new Error('命令包含疑似凭据，无法安全记录，命令尚未发送。')
      )
    }
    const operationId = createId()
    const traceContext = createTraceContext({
      ...(runOptions.traceContext?.traceId
        ? { traceId: runOptions.traceContext.traceId }
        : {}),
      operationId,
      module: 'ssh',
      action: 'safety-command'
    })
    const run = {
      command,
      runOptions,
      generation,
      hookState: createHookState(internalHooks),
      riskDelegation,
      maintenanceRecovery,
      operationId,
      traceContext,
      qualityFinished: false
    }
    pendingRun = run
    if (runOptions.signal) {
      const onAbort = () => {
        if (pendingRun !== run && pendingConfirmation?.run !== run) return
        Promise.resolve(invalidatePending(false)).catch(onError)
      }
      runOptions.signal.addEventListener('abort', onAbort, { once: true })
      run.removeAbortListener = () => {
        runOptions.signal.removeEventListener('abort', onAbort)
      }
    }
    recordRunEvent(run, 'started')
    run.promise = executeRun(run).then(result => {
      if (result?.cancelled) recordRunEvent(run, 'cancelled', 'cancelled')
      else if (result?.retryable || result?.blocked) recordRunEvent(run, 'failed', 'failed')
      return result
    }, error => {
      recordRunEvent(run, 'failed', 'failed')
      throw error
    })
    return run.promise
  }

  function runSafetyCommand (value, runOptions = {}) {
    return startSafetyCommand(value, runOptions)
  }

  async function handleCommandFinished (event = {}) {
    const execution = activeExecution
    if (!execution || event.token !== execution.token ||
      event.command !== execution.submittedCommand) {
      return false
    }
    if (execution.mode === 'background' && event.exitCode === 0) {
      activeExecution = null
      execution.launched = true
      detachedExecutions.set(execution.id, execution)
      return true
    }
    if (execution.mode === 'foreground') removeExecution(execution)
    return finalizeExecution(execution, event.exitCode)
  }

  return {
    beginSession,
    runSafetyCommand,
    confirmPending,
    cancelPending,
    inputChanged,
    cancelCurrentExecution,
    cancelForegroundExecutionById,
    invalidateSession,
    hasPending,
    hasPendingConfirmation,
    handleCommandFinished
  }
}
