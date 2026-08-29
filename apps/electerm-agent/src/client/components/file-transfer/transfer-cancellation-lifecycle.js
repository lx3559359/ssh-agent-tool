import { preserveTransferCleanupError } from './transfer-cleanup.js'

export function isAuthoritativeTransferCancellation (error) {
  return error?.name === 'AbortError' &&
    error?.code === 'PTY_TASK_CANCELLED' &&
    error?.cancelled === true
}

export function transferTerminalUpdateForError (error) {
  if (isAuthoritativeTransferCancellation(error)) {
    return {
      status: 'cancelled',
      error: '',
      skipSourceVerification: true
    }
  }
  return {
    status: 'exception',
    error: String(error?.message || error || 'SFTP transfer failed')
  }
}

async function captureCancellationError (primary, work) {
  try {
    await work?.()
    return primary
  } catch (error) {
    return preserveTransferCleanupError(primary, error)
  }
}

export async function settleTransferCancellation ({
  stopTransport,
  cancelSafety,
  finishTransfer,
  markCancelled,
  markFailed,
  release,
  safetyAlreadyCancelling = false
}) {
  let primaryError
  let transportError
  try {
    primaryError = await captureCancellationError(
      primaryError,
      async () => {
        try {
          await stopTransport?.()
        } catch (error) {
          transportError = error
          throw error
        }
      }
    )
    if (!safetyAlreadyCancelling) {
      primaryError = await captureCancellationError(
        primaryError,
        () => cancelSafety?.({
          externalAlreadyAttempted: true,
          ...(transportError ? { externalError: transportError } : {})
        })
      )
    }
    if (!primaryError) {
      primaryError = await captureCancellationError(
        primaryError,
        finishTransfer
      )
    }
    if (!primaryError) {
      primaryError = await captureCancellationError(
        primaryError,
        markCancelled
      )
    } else {
      primaryError = await captureCancellationError(
        primaryError,
        () => markFailed?.(primaryError)
      )
    }
  } finally {
    primaryError = await captureCancellationError(primaryError, release)
  }
  if (primaryError) throw primaryError
  return true
}

export function createTransferCancellationCoordinator (callbacks) {
  let settlement
  return Object.freeze({
    cancel (options = {}) {
      if (!settlement) {
        settlement = settleTransferCancellation({
          ...callbacks,
          safetyAlreadyCancelling:
            options.safetyAlreadyCancelling === true
        })
      }
      return settlement
    }
  })
}
