import generate from '../uid.js'
import { redactAuditText } from './audit-redaction.js'
import { buildSafetyRequest, operationStates } from './models.js'

const supportedSources = new Set(['quick-command', 'agent'])

function requireFunction (value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`command entrypoint requires ${name}`)
  }
  return value
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
    return new Promise(resolve => {
      pendingConfirmation = { run, confirmation, resolve }
      updateState({ confirmation })
    })
  }

  function confirmPending () {
    const pending = pendingConfirmation
    if (!pending || !isCurrent(pending.run) ||
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
    if (pending && (!run || pending.run === run)) pending.resolve(false)
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
    if (!pendingRun) return Promise.resolve(false)
    return invalidatePending(false)
  }

  async function invalidateSession () {
    const cancelled = await invalidatePending(true)
    const execution = activeExecution
    activeExecution = null
    if (execution) {
      tracker.cancelExpectedSubmission(execution.token)
      await runner.cancel(execution.id)
    }
    return cancelled || Boolean(execution)
  }

  function hasPending () {
    return Boolean(pendingRun || activeExecution)
  }

  function hasPendingConfirmation () {
    return Boolean(pendingConfirmation)
  }

  async function executeRun (run) {
    const { command, runOptions } = run
    try {
      const source = runOptions.source || 'quick-command'
      if (!supportedSources.has(source)) {
        throw new Error('命令安全事务来源不受支持。')
      }
      const request = buildSafetyRequest({
        id: createId(),
        source,
        endpoint: getEndpoint(),
        title: runOptions.title || '终端命令',
        command,
        metadata: {
          ...(runOptions.metadata || {}),
          commandEntrypoint: true
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
      const begun = await runner.beginExternalExecution(request.id, {
        confirmed: true,
        allowUnsafe: request.risk !== 'readonly' && !request.reversible
      })
      if (begun?.state !== operationStates.executing || !begun.executionId) {
        throw new Error(begun?.error || '安全事务未进入执行状态，命令尚未发送。')
      }
      if (!isCurrent(run)) {
        await runner.cancel(request.id)
        return { sent: false, cancelled: true, operationId: request.id }
      }
      const token = tracker.expectExternalSubmission(command)
      if (!token || tracker.markExpectedSubmissionReleased(token) !== true) {
        if (token) tracker.cancelExpectedSubmission(token)
        await runner.cancel(request.id)
        throw new Error('无法绑定当前终端命令，命令尚未发送。')
      }
      activeExecution = {
        id: request.id,
        executionId: begun.executionId,
        command,
        token
      }
      try {
        if (submitCommand(command, token) === false) {
          throw new Error('AttachAddon 拒绝了安全命令提交。')
        }
      } catch (error) {
        activeExecution = null
        tracker.cancelExpectedSubmission(token)
        await runner.cancel(request.id)
        throw new Error(`命令提交失败，命令尚未发送：${error?.message || '未知错误'}`)
      }
      updateState({})
      return {
        sent: true,
        operationId: request.id,
        executionId: begun.executionId,
        token,
        request
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
    if (activeExecution) {
      if (activeExecution.command === command) {
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
      event.command !== execution.command) {
      return false
    }
    activeExecution = null
    try {
      await runner.completeExternalExecution(execution.id, {
        executionId: execution.executionId,
        command: event.command,
        exitCode: event.exitCode
      })
      return true
    } catch (error) {
      try {
        await runner.cancel(execution.id)
      } catch (cancelError) {
        onError(cancelError)
      }
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
    invalidateSession,
    hasPending,
    hasPendingConfirmation,
    handleCommandFinished
  }
}
