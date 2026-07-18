function appendNotice (response, notice) {
  const current = String(response || '').trim()
  if (!notice || current.includes(notice)) return current
  return current ? `${current}\n\n${notice}` : notice
}

export async function settleAgentCancellation (activeCancellation) {
  if (!activeCancellation) return null
  try {
    await activeCancellation
    return null
  } catch (error) {
    return error
  }
}

export function buildAgentCancellationUpdate ({
  response = '',
  stoppedText = 'Stopped',
  error
} = {}) {
  if (!error) {
    return {
      response: appendNotice(response, `*(${stoppedText})*`),
      completionStatus: 'cancelled'
    }
  }
  const message = String(error?.message || error || 'unknown cancellation error')
  const warning = '**取消未确认 (Cancellation not confirmed)：** ' +
    `远程操作可能仍在运行 (remote operation may still be running)。${message}`
  return {
    response: appendNotice(response, warning),
    completionStatus: 'partially-completed'
  }
}
