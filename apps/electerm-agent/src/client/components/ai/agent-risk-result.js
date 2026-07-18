export function assertAgentRiskResultReadyForVerification (parsed) {
  if (parsed?.pending !== true && !parsed?.taskId && !parsed?.transferId) return true
  const error = new Error(
    'Risky asynchronous operation is still running; target verification is pending'
  )
  error.code = 'AGENT_ASYNC_OPERATION_PENDING'
  error.verificationFailed = true
  error.remoteState = 'in-progress'
  error.canAutoRetry = false
  throw error
}

export function assertAgentVerificationDeclared (verification) {
  if (Array.isArray(verification) && verification.length > 0) return true
  const error = new Error('Risky Agent operation has no target verification')
  error.code = 'AGENT_TARGET_VERIFICATION_REQUIRED'
  error.verificationFailed = true
  error.remoteState = 'changed-unverified'
  throw error
}
