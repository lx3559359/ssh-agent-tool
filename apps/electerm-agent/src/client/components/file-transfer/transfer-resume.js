const sourceFingerprintKeys = [
  'size',
  'mtimeMs',
  'firstSha256',
  'lastSha256'
]

export function validateTransferResume ({
  checkpoint,
  source,
  target
}) {
  const offset = Number(checkpoint?.offset)
  if (!Number.isSafeInteger(offset) || offset <= 0) {
    return {
      ok: false,
      code: 'TRANSFER_CHECKPOINT_INVALID'
    }
  }
  if (sourceFingerprintKeys.some(key => (
    checkpoint.source?.[key] !== source?.[key]
  ))) {
    return {
      ok: false,
      code: 'TRANSFER_SOURCE_CHANGED'
    }
  }
  if (
    Number(target?.size) !== offset ||
    target?.boundarySha256 !== checkpoint.target?.boundarySha256
  ) {
    return {
      ok: false,
      code: 'TRANSFER_PARTIAL_CHANGED'
    }
  }
  return {
    ok: true,
    offset
  }
}
