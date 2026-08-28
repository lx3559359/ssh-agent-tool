function addCleanupError (primaryError, error) {
  if (!primaryError || !Object.isExtensible(primaryError)) return
  const errors = Array.isArray(primaryError.cleanupErrors)
    ? [...primaryError.cleanupErrors, error]
    : [error]
  primaryError.cleanupErrors = Object.freeze(errors)
}

export async function cleanupPreparedSftpTransfer ({
  sftpEntry,
  safetyOperationIds = [],
  transferId,
  primaryError
} = {}) {
  let cleanupError
  const operationIds = [...new Set(
    (Array.isArray(safetyOperationIds)
      ? safetyOperationIds
      : [safetyOperationIds])
      .map(value => String(value || ''))
      .filter(Boolean)
  )]
  for (const operationId of operationIds) {
    try {
      await sftpEntry?.cancelTransferSafetyOperation?.(operationId)
    } catch (error) {
      cleanupError ||= error
      if (cleanupError !== error) addCleanupError(cleanupError, error)
      if (primaryError) addCleanupError(primaryError, error)
    }
  }
  try {
    await sftpEntry?.releasePreparedTransferFileSession?.(transferId)
  } catch (error) {
    cleanupError ||= error
    if (cleanupError !== error) addCleanupError(cleanupError, error)
    if (primaryError) addCleanupError(primaryError, error)
  }
  if (primaryError) throw primaryError
  if (cleanupError) throw cleanupError
  return true
}
