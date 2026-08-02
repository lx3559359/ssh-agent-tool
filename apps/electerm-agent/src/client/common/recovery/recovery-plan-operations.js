const FAILURE_EVENTS = {
  load: {
    module: 'recovery',
    action: 'load-plan',
    phase: 'failed',
    result: 'ignored',
    messageCode: 'recovery-plan-load-failed'
  },
  dismiss: {
    module: 'recovery',
    action: 'dismiss-plan',
    phase: 'failed',
    result: 'retained',
    messageCode: 'recovery-plan-dismiss-failed'
  }
}

async function recordFailure (recordEvent, event) {
  if (typeof recordEvent !== 'function') return
  try {
    await recordEvent({ ...event })
  } catch (error) {}
}

function dismissalNotAcknowledgedError () {
  const error = new Error('恢复提示未被主进程确认，请重试。')
  error.code = 'RECOVERY_PLAN_DISMISS_NOT_ACKNOWLEDGED'
  return error
}

export async function loadRecoveryPlanOperation ({
  loadPlan,
  buildPlan,
  recordEvent
}) {
  try {
    return {
      plan: buildPlan(await loadPlan()),
      error: null
    }
  } catch (error) {
    await recordFailure(recordEvent, FAILURE_EVENTS.load)
    return { plan: null, error }
  }
}

export async function dismissRecoveryPlanOperation ({
  dismissPlan,
  clearPlan,
  recordEvent
}) {
  try {
    const acknowledged = await dismissPlan()
    if (acknowledged !== true) throw dismissalNotAcknowledgedError()
    clearPlan()
    return { dismissed: true, error: null }
  } catch (error) {
    await recordFailure(recordEvent, FAILURE_EVENTS.dismiss)
    return { dismissed: false, error }
  }
}
