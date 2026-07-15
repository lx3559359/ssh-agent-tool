export function createTerminalSafetyCoordinator (options) {
  const {
    controller,
    runner,
    tracker,
    buildRequest,
    onStateChange = () => {},
    onError = () => {}
  } = options
  let generation = 0
  let live = false
  let pendingDecision = null
  let pendingExecution = null
  let release = null
  let releaseSequence = 0

  function updateState (state) {
    onStateChange({
      confirmation: null,
      busy: false,
      error: '',
      ...state
    })
  }

  function isCurrent (pending) {
    return Boolean(pending) && live && pendingDecision === pending &&
      pending.generation === generation
  }

  function finishDecision (pending, result) {
    if (pendingDecision === pending) pendingDecision = null
    updateState({})
    pending.resolve(result)
  }

  async function cancelOperation (id) {
    if (!id) return
    try {
      await runner.cancel(id)
    } catch (error) {
      onError(error)
    }
  }

  function cancelExpected (token) {
    if (token) tracker.cancelExpectedSubmission(token)
  }

  function beginSession () {
    generation += 1
    live = true
    release = null
  }

  async function invalidateSession () {
    generation += 1
    live = false
    const decision = pendingDecision
    const execution = pendingExecution
    const pendingRelease = release
    pendingDecision = null
    pendingExecution = null
    release = null

    if (decision) {
      controller.resolvePending('invalidate')
      decision.resolve({ sendNow: false, clear: false })
    }
    updateState({})

    cancelExpected(execution?.token || pendingRelease?.token)
    const operationIds = new Set([
      decision?.operationId,
      execution?.id,
      pendingRelease?.operationId
    ].filter(Boolean))
    await Promise.all([...operationIds].map(cancelOperation))
  }

  function beforeEnter (command, context) {
    if (pendingDecision) return pendingDecision.promise
    const decision = controller.beforeEnter(command, context)
    if (!decision.confirmation) return decision

    let pendingResolve
    const promise = new Promise(resolve => {
      pendingResolve = resolve
    })
    pendingDecision = {
      confirmation: decision.confirmation,
      generation,
      operationId: '',
      preparing: false,
      promise,
      resolve: pendingResolve
    }
    updateState({ confirmation: decision.confirmation })
    return promise
  }

  async function confirmExecute () {
    const pending = pendingDecision
    const confirmation = pending?.confirmation
    if (!isCurrent(pending) || pending.preparing ||
      !confirmation?.executeAllowed) return false
    pending.preparing = true
    updateState({ confirmation, busy: true })

    if (confirmation.recordable === false) {
      release = {
        token: `terminal-release-${++releaseSequence}`,
        generation,
        operationId: ''
      }
      const result = controller.resolvePending('execute')
      finishDecision(pending, { ...result, releaseToken: release.token })
      return true
    }

    let request
    try {
      request = buildRequest(confirmation)
      pending.operationId = request.id
      const prepared = await runner.prepare(request)
      if (prepared?.state !== 'awaiting-confirmation') {
        throw new Error('恢复准备未进入待确认状态')
      }
      if (!isCurrent(pending)) {
        await cancelOperation(request.id)
        return false
      }

      const begun = await runner.beginExternalExecution(request.id, {
        confirmed: true,
        allowUnsafe: confirmation.kind === 'nonreversible'
      })
      if (begun?.state !== 'executing' || !begun.executionId) {
        throw new Error('外部执行未进入执行状态')
      }
      if (!isCurrent(pending)) {
        await cancelOperation(request.id)
        return false
      }

      const token = tracker.expectSubmission(confirmation.command)
      if (!token) {
        await cancelOperation(request.id)
        if (isCurrent(pending)) {
          pending.preparing = false
          updateState({
            confirmation,
            error: '无法确认当前命令行，命令尚未发送。'
          })
        }
        return false
      }

      pendingExecution = {
        id: request.id,
        executionId: begun.executionId,
        command: confirmation.command,
        reversible: confirmation.automaticRollback,
        token
      }
      release = {
        token,
        generation,
        operationId: request.id
      }
      const result = controller.resolvePending('execute')
      finishDecision(pending, { ...result, releaseToken: token })
      return true
    } catch (error) {
      if (!isCurrent(pending)) {
        await cancelOperation(request?.id)
        return false
      }
      pending.preparing = false
      updateState({
        confirmation,
        error: `未能安全准备执行：${error?.message || '未知错误'}。命令尚未发送。`
      })
      return false
    }
  }

  async function cancelConfirmation () {
    const pending = pendingDecision
    if (!pending) return false
    const result = controller.resolvePending('cancel')
    pendingDecision = null
    updateState({})
    pending.resolve(result)
    await cancelOperation(pending.operationId)
    return true
  }

  async function inputChanged () {
    const pending = pendingDecision
    if (!pending) return false
    const result = controller.resolvePending('invalidate')
    pendingDecision = null
    updateState({})
    pending.resolve(result)
    await cancelOperation(pending.operationId)
    return true
  }

  function consumeRelease (token) {
    const current = release
    release = null
    if (!current || current.token !== token || !live ||
      current.generation !== generation) {
      return false
    }
    if (current.operationId && !tracker.markExpectedSubmissionReleased(token)) {
      cancelExpected(token)
      const execution = pendingExecution
      pendingExecution = null
      cancelOperation(execution?.id || current.operationId)
      return false
    }
    return true
  }

  async function handleCommandFinished (event) {
    const execution = pendingExecution
    if (!execution || event?.token !== execution.token ||
      event.command !== execution.command) {
      return false
    }
    pendingExecution = null
    try {
      await runner.completeExternalExecution(execution.id, {
        executionId: execution.executionId,
        command: event.command,
        exitCode: event.exitCode
      })
      return true
    } catch (error) {
      await cancelOperation(execution.id)
      onError(error)
      return false
    }
  }

  function getPendingExecution () {
    return pendingExecution
  }

  return {
    beginSession,
    invalidateSession,
    beforeEnter,
    confirmExecute,
    cancelConfirmation,
    inputChanged,
    consumeRelease,
    handleCommandFinished,
    getPendingExecution
  }
}
