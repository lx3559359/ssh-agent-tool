function stateFor (preparation = {}) {
  const state = preparation.riskBatch || preparation.riskState || {
    completedCalls: new Set(),
    terminal: false,
    settling: null
  }
  if (!preparation.riskBatch) preparation.riskState = state
  if (!(state.completedCalls instanceof Set)) state.completedCalls = new Set()
  return state
}

function callCount (preparation, state) {
  return preparation.riskBatch?.transaction?.calls?.length ||
    preparation.riskTransaction?.calls?.length ||
    state.transaction?.calls?.length || 1
}

export function isAgentAsyncRiskResult (result) {
  return result?.pending === true || Boolean(result?.taskId || result?.transferId)
}

export async function completeAgentRiskPreparation ({
  preparation,
  verify,
  settle
} = {}) {
  if (!preparation?.riskTaskId) {
    if (preparation?.delegatedSafetyConfirmation === true) {
      return {
        passed: true,
        verification: await verify?.()
      }
    }
    return { passed: true }
  }
  const state = stateFor(preparation)
  if (state.terminal) return { passed: false, terminal: true }
  const index = Number.isSafeInteger(preparation.riskCallIndex)
    ? preparation.riskCallIndex
    : 0
  state.completedCalls.add(index)
  const total = callCount(preparation, state)
  const dispatched = preparation.riskBatch ? state.cursor >= total : true
  if (state.completedCalls.size < total || !dispatched) {
    return { passed: true, pending: true }
  }
  if (state.settling) return state.settling
  state.settling = Promise.resolve()
    .then(() => verify?.())
    .then(async verification => {
      await settle?.({
        taskId: preparation.riskTaskId,
        status: 'completed',
        remoteState: 'verified',
        canAutoRetry: false
      })
      state.terminal = true
      return { passed: true, verification }
    })
    .catch(async error => {
      await settle?.({
        taskId: preparation.riskTaskId,
        status: 'partially-completed',
        error,
        remoteState: 'changed-unverified',
        canAutoRetry: false
      })
      state.terminal = true
      error.verificationFailed = true
      error.canAutoRetry = false
      throw error
    })
  return state.settling
}

export async function failAgentRiskPreparation ({
  preparation,
  error,
  dispatched = true,
  status,
  remoteState,
  settle
} = {}) {
  if (!preparation?.riskTaskId) return null
  const state = stateFor(preparation)
  if (state.terminal) return null
  state.terminal = true
  const resolvedStatus = status || (dispatched ? 'partially-completed' : 'failed')
  const resolvedRemoteState = remoteState || (dispatched ? 'unknown' : 'not-dispatched')
  await settle?.({
    taskId: preparation.riskTaskId,
    status: resolvedStatus,
    error,
    remoteState: resolvedRemoteState,
    canAutoRetry: false
  })
  return { status: resolvedStatus, remoteState: resolvedRemoteState }
}

export function createAgentRiskTerminalHandler ({
  preparation,
  verify,
  settle
} = {}) {
  let terminalPromise = null
  return outcome => {
    if (terminalPromise) return terminalPromise
    const status = String(outcome?.status || '')
    if (status === 'completed' || status === 'success') {
      terminalPromise = completeAgentRiskPreparation({ preparation, verify, settle })
    } else {
      const cancelled = status === 'cancelled'
      const knownFailed = status === 'failed' || status === 'exception'
      terminalPromise = failAgentRiskPreparation({
        preparation,
        error: outcome?.error || outcome?.message || 'Asynchronous Agent operation did not complete successfully.',
        dispatched: true,
        status: cancelled ? 'cancelled' : 'partially-completed',
        remoteState: cancelled
          ? (outcome?.remoteState || 'unknown')
          : knownFailed ? 'known-failed' : 'unknown',
        settle
      })
    }
    return terminalPromise
  }
}
