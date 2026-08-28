import { preserveTransferCleanupError } from './transfer-cleanup.js'

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
  release
}) {
  let primaryError
  try {
    primaryError = await captureCancellationError(
      primaryError,
      stopTransport
    )
    primaryError = await captureCancellationError(
      primaryError,
      cancelSafety
    )
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
