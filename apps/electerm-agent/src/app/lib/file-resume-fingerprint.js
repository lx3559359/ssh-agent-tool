const crypto = require('crypto')
const fss = require('fs/promises')

const DEFAULT_BOUNDARY_BYTES = 64 * 1024

function normalizeBoundaryBytes (value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return DEFAULT_BOUNDARY_BYTES
  }
  return Math.min(value, DEFAULT_BOUNDARY_BYTES)
}

async function readBoundary (handle, offset, length) {
  const buffer = Buffer.alloc(length)
  let totalRead = 0
  while (totalRead < length) {
    const { bytesRead } = await handle.read(
      buffer,
      totalRead,
      length - totalRead,
      offset + totalRead
    )
    if (!bytesRead) {
      break
    }
    totalRead += bytesRead
  }
  return buffer.subarray(0, totalRead)
}

async function describeResumeEntry (
  filePath,
  boundaryBytes = DEFAULT_BOUNDARY_BYTES
) {
  const stat = await fss.stat(filePath)
  if (!stat.isFile()) {
    throw new Error('续传指纹仅支持普通文件。')
  }
  const length = Math.min(stat.size, normalizeBoundaryBytes(boundaryBytes))
  const handle = await fss.open(filePath, 'r')
  try {
    const first = await readBoundary(handle, 0, length)
    const lastOffset = Math.max(0, stat.size - length)
    const last = lastOffset === 0
      ? first
      : await readBoundary(handle, lastOffset, length)
    const firstSha256 = crypto.createHash('sha256').update(first).digest('hex')
    const lastSha256 = crypto.createHash('sha256').update(last).digest('hex')
    return {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      firstSha256,
      lastSha256,
      boundarySha256: lastSha256
    }
  } finally {
    await handle.close()
  }
}

module.exports = {
  DEFAULT_BOUNDARY_BYTES,
  describeResumeEntry
}
