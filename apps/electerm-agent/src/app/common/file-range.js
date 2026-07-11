const { isLikelyBinaryBuffer } = require('./file-preview')

const MIN_RANGE_BYTES = 4
const DEFAULT_RANGE_BYTES = 256 * 1024
const MAX_RANGE_BYTES = 1024 * 1024

function normalizeRangeOptions (options = {}) {
  const offset = Number.isSafeInteger(options.offset) && options.offset >= 0
    ? options.offset
    : 0
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    ? Math.max(MIN_RANGE_BYTES, Math.min(options.maxBytes, MAX_RANGE_BYTES))
    : DEFAULT_RANGE_BYTES
  return { offset, maxBytes }
}

function isContinuationByte (byte) {
  return (byte & 0xc0) === 0x80
}

function getUtf8SequenceLength (byte) {
  if (byte <= 0x7f) {
    return 1
  }
  if (byte >= 0xc2 && byte <= 0xdf) {
    return 2
  }
  if (byte >= 0xe0 && byte <= 0xef) {
    return 3
  }
  if (byte >= 0xf0 && byte <= 0xf4) {
    return 4
  }
  return 1
}

function isValidUtf8Sequence (buffer, start, length) {
  const sequence = buffer.subarray(start, start + length)
  return sequence.length === length &&
    Buffer.from(sequence.toString('utf8'), 'utf8').equals(sequence)
}

function findSafeStart (buffer, requestedIndex) {
  if (!isContinuationByte(buffer[requestedIndex])) {
    return requestedIndex
  }
  const contextStart = Math.max(0, requestedIndex - 3)
  for (let start = contextStart; start < requestedIndex; start += 1) {
    const sequenceLength = getUtf8SequenceLength(buffer[start])
    const sequenceEnd = start + sequenceLength
    if (
      sequenceLength > 1 &&
      sequenceEnd > requestedIndex &&
      isValidUtf8Sequence(buffer, start, sequenceLength)
    ) {
      return sequenceEnd
    }
  }
  return requestedIndex
}

function findContentEnd (buffer, start, byteLimit, atFileEnd) {
  let cursor = start
  while (cursor < buffer.length && cursor < byteLimit) {
    const sequenceLength = getUtf8SequenceLength(buffer[cursor])
    if (sequenceLength === 1) {
      cursor += 1
      continue
    }
    const sequenceEnd = cursor + sequenceLength
    if (sequenceEnd > buffer.length) {
      if (atFileEnd) {
        cursor += 1
        continue
      }
      break
    }
    const sequence = buffer.subarray(cursor + 1, sequenceEnd)
    if (
      sequence.length === sequenceLength - 1 &&
      sequence.every(isContinuationByte)
    ) {
      if (sequenceEnd > byteLimit) {
        break
      }
      cursor = sequenceEnd
    } else {
      cursor += 1
    }
  }
  return cursor
}

async function readTextRange (reader, options) {
  const normalized = normalizeRangeOptions(options)
  const totalBytes = Math.max(0, await reader.size())
  const requestedOffset = Math.min(normalized.offset, totalBytes)

  if (requestedOffset === totalBytes) {
    return {
      content: '',
      binary: false,
      offset: requestedOffset,
      nextOffset: requestedOffset,
      totalBytes,
      bytesRead: 0,
      hasMore: false
    }
  }

  const contextBytes = Math.min(3, requestedOffset)
  const readOffset = requestedOffset - contextBytes
  const readLength = Math.min(
    totalBytes - readOffset,
    normalized.maxBytes + 4
  )
  const value = await reader.read(readOffset, readLength)
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || '')
  if (buffer.length === 0) {
    const currentTotalBytes = Math.max(0, await reader.size())
    const currentOffset = Math.min(requestedOffset, currentTotalBytes)
    return {
      content: '',
      binary: false,
      offset: currentOffset,
      nextOffset: currentOffset,
      totalBytes: currentTotalBytes,
      bytesRead: 0,
      hasMore: false
    }
  }
  const requestedIndex = Math.min(contextBytes, buffer.length)
  const byteLimit = Math.min(
    buffer.length,
    requestedIndex + normalized.maxBytes
  )
  const start = findSafeStart(buffer, requestedIndex)

  const end = findContentEnd(
    buffer,
    start,
    byteLimit,
    readOffset + buffer.length >= totalBytes
  )
  const contentBuffer = buffer.subarray(start, end)
  const binary = isLikelyBinaryBuffer(contentBuffer)
  const offset = readOffset + start
  const nextOffset = readOffset + end

  return {
    content: binary ? '' : contentBuffer.toString('utf8'),
    binary,
    offset,
    nextOffset,
    totalBytes,
    bytesRead: nextOffset - offset,
    hasMore: nextOffset < totalBytes
  }
}

module.exports = {
  MIN_RANGE_BYTES,
  DEFAULT_RANGE_BYTES,
  MAX_RANGE_BYTES,
  normalizeRangeOptions,
  readTextRange
}
