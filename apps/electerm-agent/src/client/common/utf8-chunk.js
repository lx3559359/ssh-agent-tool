function isContinuationByte (byte) {
  return (byte & 0xc0) === 0x80
}

function getSequenceLength (byte) {
  if ((byte & 0x80) === 0) return 1
  if ((byte & 0xe0) === 0xc0) return 2
  if ((byte & 0xf0) === 0xe0) return 3
  if ((byte & 0xf8) === 0xf0) return 4
  return 1
}

export function decodeUtf8Chunk (input, {
  offset = 0,
  totalBytes = 0,
  hasMore = false
} = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || [])
  const baseOffset = Math.max(0, Number(offset) || 0)
  let start = 0
  while (start < bytes.length && isContinuationByte(bytes[start])) start += 1

  let end = bytes.length
  if (hasMore && end > start) {
    let lead = end - 1
    while (lead >= start && isContinuationByte(bytes[lead])) lead -= 1
    if (lead >= start && end - lead < getSequenceLength(bytes[lead])) end = lead
  }

  const actualOffset = baseOffset + start
  const nextOffset = baseOffset + end
  const total = Math.max(nextOffset, Number(totalBytes) || 0)
  return {
    content: new TextDecoder().decode(bytes.slice(start, end)),
    offset: actualOffset,
    nextOffset,
    totalBytes: total,
    hasMore: Boolean(hasMore || end < bytes.length || nextOffset < total)
  }
}
