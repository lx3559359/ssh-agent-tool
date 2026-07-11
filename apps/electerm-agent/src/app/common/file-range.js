const { isLikelyBinaryBuffer } = require('./file-preview')

const DEFAULT_RANGE_BYTES = 256 * 1024
const MAX_RANGE_BYTES = 1024 * 1024

function normalizeRangeOptions (options = {}) {
  const offset = Number.isSafeInteger(options.offset) && options.offset >= 0
    ? options.offset
    : 0
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    ? Math.min(options.maxBytes, MAX_RANGE_BYTES)
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

function findContentEnd (buffer, start, byteLimit) {
  let cursor = start
  while (cursor < buffer.length && cursor < byteLimit) {
    const sequenceLength = getUtf8SequenceLength(buffer[cursor])
    if (sequenceLength === 1) {
      cursor += 1
      continue
    }
    const sequenceEnd = cursor + sequenceLength
    const sequence = buffer.subarray(cursor + 1, sequenceEnd)
    if (
      sequenceEnd <= buffer.length &&
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

  const readLength = Math.min(
    totalBytes - requestedOffset,
    normalized.maxBytes + 4
  )
  const value = await reader.read(requestedOffset, readLength)
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || '')
  const byteLimit = Math.min(buffer.length, normalized.maxBytes)
  let start = 0

  if (requestedOffset > 0) {
    while (start < buffer.length && isContinuationByte(buffer[start])) {
      start += 1
    }
  }

  const end = findContentEnd(buffer, start, byteLimit)
  const contentBuffer = buffer.subarray(start, end)
  const binary = isLikelyBinaryBuffer(contentBuffer)
  const offset = requestedOffset + start
  const nextOffset = requestedOffset + end

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
  DEFAULT_RANGE_BYTES,
  MAX_RANGE_BYTES,
  normalizeRangeOptions,
  readTextRange
}
