import generate from '../uid.js'
import { redactAuditText } from './audit-redaction.js'
import { buildSafetyRequest, operationStates } from './models.js'
import { buildCommandExecution } from './command-execution.js'

const supportedSources = new Set(['quick-command', 'agent'])

function requireFunction (value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`command entrypoint requires ${name}`)
  }
  return value
}

function deferred () {
  let resolveDeferred
  const promise = new Promise(resolve => {
    resolveDeferred = resolve
  })
  return { promise, resolve: resolveDeferred }
}

function safeErrorMessage (error, fallback = '未知错误') {
  return redactAuditText(String(error?.message || fallback))
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
  const createId = options.createId || (() => `command-${Date.now()}-${generate()}`)
  const onStateChange = options.onStateChange || (() => {})
  const onError = options.onError || (() => {})
  let generation = 0
  let live = false
  let pendingRun = null
  let pendingConfirmation = null
  let activeExecution = null

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

  function waitForConfirmation (run, request) {
    const classification = {
      risk: request.risk,
      reversible: request.reversible,
      provider: request.provider,
      requiresConfirmation: request.requiresConfirmation,
      reason: request.reason
    }
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
      pendingConfirmation = null
      updateState({ confirmation: pending.confirmation, busy: true })
      Promise.resolve()
        .then(() => runSafetyCommand(pending.command, pending.runOptions))
        .catch(error => {
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
    const run = pendingRun
    generation += 1
    if (endSession) live = false
    const pending = pendingConfirmation
    pendingConfirmation = null
    if (pending?.resolve && (!run || pending.run === run)) pending.resolve(false)
    updateState({})
    if (run?.operationId) {
      run.operationCancelled = true
      await runner.cancel(run.operationId)
    }
    return Boolean(run)
  }

  function cancelPending () {
    return invalidatePending(false)
  }

  function inputChanged () {
    if (!pendingRun && !pendingConfirmation) return Promise.resolve(false)
    return invalidatePending(false)
  }

  async function cancelActiveExecution (reason, operationId) {
    const execution = activeExecution
    if (!execution || (operationId && execution.id !== operationId)) return false
    activeExecution = null
    tracker.cancelExpectedSubmission(execution.token)
    execution.completion.resolve({
      cancelled: true,
      error: reason || '命令执行已取消。',
      operationId: execution.id
    })
    await runner.cancel(execution.id)
    return true
  }

  async function cancelCurrentExecution (reason = '命令执行已取消。') {
    const pendingCancelled = await invalidatePending(false)
    const executionCancelled = await cancelActiveExecution(reason)
    return pendingCancelled || executionCancelled
  }

  async function invalidateSession () {
    const cancelled = await invalidatePending(true)
    const executionCancelled = await cancelActiveExecution('终端连接已断开，命令执行已取消。')
    return cancelled || executionCancelled
  }

  function hasPending () {
    return Boolean(pendingRun || pendingConfirmation || activeExecution)
  }

  function hasPendingConfirmation () {
    return Boolean(pendingConfirmation)
  }

  function retryConfirmation (run, request) {
    return {
      kind: 'retry',
      command: run.command,
      classification: {
        risk: request.risk,
        reversible: request.reversible,
        provider: request.provider,
        requiresConfirmation: request.requiresConfirmation,
        reason: request.reason
      },
      executeAllowed: true,
      automaticRollback: request.reversible,
      message: '上次安全提交失败，可取消或重新准备后重试。'
    }
  }

  async function armRetry (run, request, error, cancelOperation) {
    if (cancelOperation && run.operationId) {
      try {
        await runner.cancel(run.operationId)
      } catch (cancelError) {
        onError(cancelError)
        const message = `命令提交失败且事务取消失败，禁止重试：${safeErrorMessage(cancelError)}`
        const confirmation = {
          ...retryConfirmation(run, request),
          kind: 'blocked',
          executeAllowed: false,
          message: '无法确认上一事务已停止，已禁止重试以避免重复执行。'
        }
        pendingConfirmation = { confirmation }
        updateState({ confirmation, busy: false, error: message })
        return {
          sent: false,
          retryable: false,
          blocked: true,
          operationId: request.id,
          error: message
        }
      }
    }
    const message = `命令发送失败，命令尚未发送：${safeErrorMessage(error)}`
    const confirmation = retryConfirmation(run, request)
    pendingConfirmation = {
      retry: true,
      command: run.command,
      runOptions: run.runOptions,
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
        await cancelActiveExecution(message, operationId)
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

  async function executeRun (run) {
    const { command, runOptions } = run
    try {
      const source = runOptions.source || 'quick-command'
      if (!supportedSources.has(source)) {
        throw new Error('命令安全事务来源不受支持。')
      }
      const operationId = createId()
      const execution = buildCommandExecution({
        command,
        operationId,
        mode: runOptions.executionMode || 'foreground'
      })
      run.execution = execution
      const request = buildSafetyRequest({
        id: operationId,
        source,
        endpoint: getEndpoint(),
        title: runOptions.title || '终端命令',
        command,
        metadata: {
          ...(runOptions.metadata || {}),
          commandEntrypoint: true,
          execution: execution.metadata
        }
      })
      run.operationId = request.id
      const prepared = await runner.prepare(request)
      if (prepared?.state !== operationStates.awaitingConfirmation) {
        throw new Error(prepared?.error || '无法安全准备执行，命令尚未发送。')
      }
      if (!isCurrent(run)) {
        if (!run.operationCancelled) await runner.cancel(request.id)
        return { sent: false, cancelled: true, operationId: request.id }
      }
      if (request.risk !== 'readonly') {
        const accepted = await waitForConfirmation(run, request)
        if (!accepted || !isCurrent(run)) {
          if (!run.operationCancelled) await runner.cancel(request.id)
          return { sent: false, cancelled: true, operationId: request.id }
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
        await runner.cancel(request.id)
        return { sent: false, cancelled: true, operationId: request.id }
      }
      const submittedCommand = execution.submittedCommand
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
      activeExecution = {
        id: request.id,
        executionId: begun.executionId,
        originalCommand: command,
        submittedCommand,
        token,
        completion
      }
      try {
        if (submitCommand(submittedCommand, token) === false) {
          throw new Error('AttachAddon 拒绝了安全命令提交。')
        }
      } catch (error) {
        activeExecution = null
        tracker.cancelExpectedSubmission(token)
        completion.resolve({
          cancelled: true,
          error: '命令提交失败，命令尚未发送。',
          operationId: request.id
        })
        return armRetry(run, request, error, true)
      }
      updateState({})
      return {
        sent: true,
        operationId: request.id,
        executionId: begun.executionId,
        token,
        request,
        execution,
        completion: completion.promise,
        waitForCompletion: waitOptions => waitForCompletion(
          request.id,
          completion.promise,
          waitOptions
        )
      }
    } finally {
      if (pendingRun === run) pendingRun = null
    }
  }

  function runSafetyCommand (value, runOptions = {}) {
    const command = String(value || '')
    if (!command.trim()) {
      return Promise.reject(new Error('命令不能为空。'))
    }
    if (!live) {
      return Promise.reject(new Error('当前终端会话未连接，命令尚未发送。'))
    }
    if (Object.prototype.hasOwnProperty.call(runOptions, 'submittedCommand')) {
      return Promise.reject(
        new Error('调用方不允许指定实际提交命令。')
      )
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
    if (activeExecution) {
      if (activeExecution.originalCommand === command) {
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
    const run = { command, runOptions, generation }
    run.promise = executeRun(run)
    pendingRun = run
    return run.promise
  }

  async function handleCommandFinished (event = {}) {
    const execution = activeExecution
    if (!execution || event.token !== execution.token ||
      event.command !== execution.submittedCommand) {
      return false
    }
    activeExecution = null
    try {
      const operation = await runner.completeExternalExecution(execution.id, {
        executionId: execution.executionId,
        command: execution.originalCommand,
        exitCode: event.exitCode
      })
      execution.completion.resolve({
        operation,
        operationId: execution.id,
        exitCode: event.exitCode,
        submittedCommand: execution.submittedCommand
      })
      return true
    } catch (error) {
      try {
        await runner.cancel(execution.id)
      } catch (cancelError) {
        onError(cancelError)
      }
      execution.completion.resolve({
        operationId: execution.id,
        error: `安全事务完成失败：${safeErrorMessage(error)}`
      })
      onError(error)
      return false
    }
  }

  return {
    beginSession,
    runSafetyCommand,
    confirmPending,
    cancelPending,
    inputChanged,
    cancelCurrentExecution,
    invalidateSession,
    hasPending,
    hasPendingConfirmation,
    handleCommandFinished
  }
}
