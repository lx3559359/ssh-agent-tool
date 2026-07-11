const DEFAULT_FILE_PREVIEW_MAX_BYTES = 64 * 1024
const MAX_FILE_PREVIEW_BYTES = 1024 * 1024

function normalizePreviewMaxBytes (maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    return DEFAULT_FILE_PREVIEW_MAX_BYTES
  }
  return Math.min(maxBytes, MAX_FILE_PREVIEW_BYTES)
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
  return 0
}

function trimIncompleteUtf8Tail (buffer) {
  if (!buffer.length) {
    return buffer
  }
  let start = buffer.length - 1
  while (
    start > 0 &&
    (buffer[start] & 0xc0) === 0x80 &&
    buffer.length - start < 4
  ) {
    start -= 1
  }
  const expectedLength = getUtf8SequenceLength(buffer[start])
  const actualLength = buffer.length - start
  return expectedLength > actualLength
    ? buffer.subarray(0, start)
    : buffer
}

function isLikelyBinaryBuffer (buffer) {
  const value = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
  if (!value.length) {
    return false
  }
  const decoded = value.toString('utf8')
  if (!Buffer.from(decoded, 'utf8').equals(value)) {
    return true
  }
  let controlCount = 0
  for (const char of decoded) {
    const code = char.codePointAt(0)
    if (code === 0) {
      return true
    }
    const allowedWhitespace = code === 9 || code === 10 || code === 12 || code === 13
    if (!allowedWhitespace && (code < 32 || (code >= 127 && code <= 159))) {
      controlCount += 1
    }
  }
  return controlCount / decoded.length > 0.2
}

function createTextFilePreview (buffer, {
  maxBytes,
  truncated = false
} = {}) {
  const limit = normalizePreviewMaxBytes(maxBytes)
  const value = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
  const isTruncated = Boolean(truncated || value.length > limit)
  const bounded = value.subarray(0, limit)
  const preview = isTruncated ? trimIncompleteUtf8Tail(bounded) : bounded
  const binary = isLikelyBinaryBuffer(preview)
  return {
    content: binary ? '' : preview.toString('utf8'),
    truncated: isTruncated,
    binary,
    bytesRead: preview.length
  }
}

module.exports = {
  DEFAULT_FILE_PREVIEW_MAX_BYTES,
  normalizePreviewMaxBytes,
  isLikelyBinaryBuffer,
  createTextFilePreview
}
