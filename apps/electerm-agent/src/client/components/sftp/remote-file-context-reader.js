import JSZip from 'jszip'

export const REMOTE_CONTEXT_PREVIEW_MAX_BYTES = 64 * 1024
export const REMOTE_CONTEXT_ARCHIVE_MAX_BYTES = 8 * 1024 * 1024
export const REMOTE_CONTEXT_EXPANDED_MAX_BYTES = 8 * 1024 * 1024
export const REMOTE_CONTEXT_ARCHIVE_MAX_ENTRIES = 512
export const REMOTE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

const REMOTE_CONTEXT_ARCHIVE_ENTRY_MAX_BYTES = 8 * 1024 * 1024
const REMOTE_CONTEXT_READ_CHUNK_BYTES = 64 * 1024

function throwIfAborted (signal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('远程文件预览已取消。')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  throw error
}

function boundedInteger (value, fallback, maximum) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) return fallback
  return Math.min(number, maximum)
}

function base64Bytes (value) {
  const binary = atob(String(value || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function concatBytes (parts, length) {
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function bytesBase64 (bytes) {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    )
  }
  return btoa(binary)
}

export async function readRemoteFileBase64Preview (
  backend,
  filePath,
  { signal, maxBytes = REMOTE_ATTACHMENT_MAX_BYTES } = {}
) {
  const limit = boundedInteger(
    maxBytes,
    REMOTE_ATTACHMENT_MAX_BYTES,
    REMOTE_ATTACHMENT_MAX_BYTES
  )
  throwIfAborted(signal)
  const stat = await backend.lstat(filePath, { signal })
  throwIfAborted(signal)
  const size = Number(stat?.size)
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('远程文件大小无效')
  }
  if (size > limit) {
    return { base64: '', truncated: true, bytesRead: 0, totalBytes: size }
  }
  const parts = []
  let offset = 0
  while (offset < size) {
    throwIfAborted(signal)
    const chunk = await backend.readFileChunk(filePath, {
      offset,
      maxBytes: Math.min(REMOTE_CONTEXT_READ_CHUNK_BYTES, size - offset),
      signal
    })
    throwIfAborted(signal)
    const bytes = base64Bytes(chunk?.base64)
    const nextOffset = Number(chunk?.nextOffset)
    const bytesRead = Number(chunk?.bytesRead)
    const totalBytes = Number(chunk?.totalBytes)
    if (!bytes.byteLength ||
      bytes.byteLength > REMOTE_CONTEXT_READ_CHUNK_BYTES ||
      (Number.isFinite(bytesRead) && bytesRead !== bytes.byteLength) ||
      (Number.isFinite(totalBytes) && totalBytes !== size) ||
      !Number.isSafeInteger(nextOffset) ||
      nextOffset !== offset + bytes.byteLength ||
      nextOffset > size) {
      throw new Error('远程文件分块响应无效')
    }
    parts.push(bytes)
    offset = nextOffset
  }
  const bytes = concatBytes(parts, size)
  return {
    base64: bytesBase64(bytes),
    truncated: false,
    bytesRead: size,
    totalBytes: size
  }
}

function binaryPreview (bytes) {
  if (!bytes.byteLength) return false
  let suspicious = 0
  for (const byte of bytes) {
    if (byte === 0) return true
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1
  }
  return suspicious / bytes.byteLength > 0.1
}

function textPreview (bytes, totalBytes, metadata = {}) {
  return {
    content: new TextDecoder().decode(bytes),
    truncated: totalBytes > bytes.byteLength,
    binary: binaryPreview(bytes),
    bytesRead: bytes.byteLength,
    ...metadata
  }
}

function archiveType (filePath) {
  const value = String(filePath || '').toLowerCase()
  if (value.endsWith('.zip')) return 'zip'
  if (value.endsWith('.tgz') || value.endsWith('.tar.gz')) return 'tar.gz'
  if (value.endsWith('.gz')) return 'gz'
  throw new Error('不支持的压缩包类型')
}

function gzipEntryPath (filePath) {
  const name = String(filePath || '').split('/').pop() || 'archive'
  return validateArchivePath(name.replace(/\.gz$/i, '') || 'archive')
}

function validateArchivePath (value) {
  const candidate = String(value || '').replaceAll('\\', '/')
  const parts = candidate.split('/')
  if (!candidate || candidate.startsWith('/') || candidate.includes('\0') ||
    /^[A-Za-z]:/.test(candidate) ||
    parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('压缩成员路径无效')
  }
  return candidate
}

function requireEntrySize (size) {
  const value = Number(size)
  if (!Number.isSafeInteger(value) || value < 0 ||
    value > REMOTE_CONTEXT_ARCHIVE_ENTRY_MAX_BYTES) {
    throw new Error('压缩成员超过 8 MiB 安全上限')
  }
  return value
}

function preflightZipArchive (bytes) {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  )
  const minimumOffset = Math.max(0, bytes.byteLength - 65557)
  let endOffset = -1
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.byteLength) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0) throw new Error('ZIP 中心目录结构无效')
  const disk = view.getUint16(endOffset + 4, true)
  const directoryDisk = view.getUint16(endOffset + 6, true)
  const diskEntries = view.getUint16(endOffset + 8, true)
  const entries = view.getUint16(endOffset + 10, true)
  const directorySize = view.getUint32(endOffset + 12, true)
  const directoryOffset = view.getUint32(endOffset + 16, true)
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== entries ||
    entries === 0xffff || directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    entries > REMOTE_CONTEXT_ARCHIVE_MAX_ENTRIES) {
    throw new Error('ZIP 压缩包成员数量超过 512 个安全上限')
  }
  const directoryEnd = directoryOffset + directorySize
  if (!Number.isSafeInteger(directoryEnd) || directoryEnd > endOffset) {
    throw new Error('ZIP 中心目录边界无效')
  }
  let offset = directoryOffset
  let actualEntries = 0
  while (offset < directoryEnd) {
    if (offset + 46 > directoryEnd ||
      view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('ZIP 中心目录成员无效')
    }
    actualEntries += 1
    if (actualEntries > REMOTE_CONTEXT_ARCHIVE_MAX_ENTRIES) {
      throw new Error('ZIP 压缩包成员数量超过 512 个安全上限')
    }
    offset += 46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true)
  }
  if (offset !== directoryEnd || actualEntries !== entries) {
    throw new Error('ZIP 中心目录计数不一致')
  }
}

async function decompressBytes (
  bytes,
  format,
  maximum,
  signal,
  truncate = false
) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('当前客户端不支持有界流式解压')
  }
  throwIfAborted(signal)
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream(format))
    .getReader()
  const parts = []
  let length = 0
  let truncated = false
  try {
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      throwIfAborted(signal)
      if (done) break
      if (length + value.byteLength > maximum) {
        if (truncate) {
          parts.push(value.subarray(0, maximum - length))
          length = maximum
          truncated = true
          break
        }
        throw new Error('压缩包解压输出超过 8 MiB 安全上限')
      }
      parts.push(value)
      length += value.byteLength
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return {
    bytes: concatBytes(parts, length),
    truncated
  }
}

function tarString (bytes, offset, length) {
  let end = offset
  const maximum = offset + length
  while (end < maximum && bytes[end] !== 0) end += 1
  return new TextDecoder().decode(bytes.subarray(offset, end)).trim()
}

function tarSize (bytes, offset, length) {
  const value = tarString(bytes, offset, length).replace(/\0/g, '').trim()
  if (!/^[0-7]+$/.test(value)) throw new Error('tar 成员大小无效')
  return requireEntrySize(Number.parseInt(value, 8))
}

function isZeroTarBlock (bytes, offset) {
  for (let index = offset; index < offset + 512; index++) {
    if (bytes[index] !== 0) return false
  }
  return true
}

function parseTarEntries (bytes) {
  const entries = []
  let totalUncompressedBytes = 0
  let offset = 0
  while (offset + 512 <= bytes.byteLength) {
    if (isZeroTarBlock(bytes, offset)) break
    const name = tarString(bytes, offset, 100)
    const prefix = tarString(bytes, offset + 345, 155)
    const entryPath = validateArchivePath(prefix ? `${prefix}/${name}` : name)
    const size = tarSize(bytes, offset + 124, 12)
    const type = bytes[offset + 156]
    const dataOffset = offset + 512
    const dataEnd = dataOffset + size
    if (dataEnd > bytes.byteLength) throw new Error('tar 压缩包内容不完整')
    if (type === 0 || type === 48) {
      entries.push({ path: entryPath, size, dataOffset, dataEnd })
      totalUncompressedBytes += size
      if (entries.length > REMOTE_CONTEXT_ARCHIVE_MAX_ENTRIES) {
        throw new Error('压缩包成员数量超过 512 个安全上限')
      }
      if (totalUncompressedBytes > REMOTE_CONTEXT_EXPANDED_MAX_BYTES) {
        throw new Error('压缩包成员总大小超过 8 MiB 安全上限')
      }
    }
    offset = dataOffset + Math.ceil(size / 512) * 512
  }
  return { entries, totalUncompressedBytes }
}

function publicTarListing (parsed) {
  return {
    type: 'tar.gz',
    entries: parsed.entries.map(({ path, size }) => ({ path, size })),
    totalUncompressedBytes: parsed.totalUncompressedBytes,
    truncated: false
  }
}

export function createRemoteFileContextReader (backend, {
  signal,
  maxPreviewBytes = REMOTE_CONTEXT_PREVIEW_MAX_BYTES
} = {}) {
  if (!backend || typeof backend.lstat !== 'function' ||
    typeof backend.readFileChunk !== 'function') {
    throw new Error('远程文件后端不支持有界预览')
  }
  const previewLimit = boundedInteger(
    maxPreviewBytes,
    REMOTE_CONTEXT_PREVIEW_MAX_BYTES,
    REMOTE_CONTEXT_PREVIEW_MAX_BYTES
  )
  const archiveBytes = new Map()
  const zipArchives = new Map()
  const tarArchives = new Map()

  async function readBoundedArchive (filePath) {
    if (archiveBytes.has(filePath)) return archiveBytes.get(filePath)
    throwIfAborted(signal)
    const stat = await backend.lstat(filePath, { signal })
    throwIfAborted(signal)
    const size = Number(stat?.size)
    if (!Number.isSafeInteger(size) || size < 0 ||
      size > REMOTE_CONTEXT_ARCHIVE_MAX_BYTES) {
      throw new Error('压缩包输入超过 8 MiB 安全上限')
    }
    const parts = []
    let offset = 0
    while (offset < size) {
      throwIfAborted(signal)
      const chunk = await backend.readFileChunk(filePath, {
        offset,
        maxBytes: Math.min(REMOTE_CONTEXT_READ_CHUNK_BYTES, size - offset),
        signal
      })
      throwIfAborted(signal)
      const value = base64Bytes(chunk?.base64)
      const nextOffset = Number(chunk?.nextOffset)
      if (!value.byteLength || !Number.isSafeInteger(nextOffset) ||
        nextOffset !== offset + value.byteLength || nextOffset > size) {
        throw new Error('远程压缩包分块响应无效')
      }
      parts.push(value)
      offset = nextOffset
    }
    const result = concatBytes(parts, size)
    archiveBytes.set(filePath, result)
    return result
  }

  async function loadZip (filePath) {
    if (zipArchives.has(filePath)) return zipArchives.get(filePath)
    const bytes = await readBoundedArchive(filePath)
    throwIfAborted(signal)
    preflightZipArchive(bytes)
    const zip = await JSZip.loadAsync(bytes)
    throwIfAborted(signal)
    const entries = []
    let totalUncompressedBytes = 0
    for (const item of Object.values(zip.files)) {
      if (item.dir) continue
      const entryPath = validateArchivePath(
        item.unsafeOriginalName || item.name
      )
      const size = requireEntrySize(item?._data?.uncompressedSize)
      entries.push({ path: entryPath, size, item })
      totalUncompressedBytes += size
      if (entries.length > REMOTE_CONTEXT_ARCHIVE_MAX_ENTRIES) {
        throw new Error('压缩包成员数量超过 512 个安全上限')
      }
      if (totalUncompressedBytes > REMOTE_CONTEXT_EXPANDED_MAX_BYTES) {
        throw new Error('压缩包成员总大小超过 8 MiB 安全上限')
      }
    }
    const result = { zip, entries, totalUncompressedBytes }
    zipArchives.set(filePath, result)
    return result
  }

  async function loadTar (filePath) {
    if (tarArchives.has(filePath)) return tarArchives.get(filePath)
    const compressed = await readBoundedArchive(filePath)
    const { bytes } = await decompressBytes(
      compressed,
      'gzip',
      REMOTE_CONTEXT_EXPANDED_MAX_BYTES,
      signal
    )
    const parsed = parseTarEntries(bytes)
    tarArchives.set(filePath, { bytes, ...parsed })
    return tarArchives.get(filePath)
  }

  return Object.freeze({
    async readFilePreview (filePath, maxBytes = previewLimit) {
      const limit = boundedInteger(maxBytes, previewLimit, previewLimit)
      throwIfAborted(signal)
      const stat = await backend.lstat(filePath, { signal })
      throwIfAborted(signal)
      const size = Number(stat?.size)
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error('远程文件大小无效')
      }
      const chunk = await backend.readFileChunk(filePath, {
        offset: 0,
        maxBytes: limit,
        signal
      })
      throwIfAborted(signal)
      const bytes = base64Bytes(chunk?.base64)
      if (bytes.byteLength > limit) {
        throw new Error('远程文件分块超过请求的 byte cap')
      }
      const totalBytes = Number.isSafeInteger(Number(chunk?.totalBytes))
        ? Number(chunk.totalBytes)
        : size
      return textPreview(bytes, Math.max(size, totalBytes))
    },

    async listArchive (filePath) {
      const type = archiveType(filePath)
      if (type === 'gz') {
        return {
          type,
          entries: [{ path: gzipEntryPath(filePath), size: null }],
          totalUncompressedBytes: null,
          truncated: false
        }
      }
      if (type === 'zip') {
        const loaded = await loadZip(filePath)
        return {
          type,
          entries: loaded.entries.map(({ path, size }) => ({ path, size })),
          totalUncompressedBytes: loaded.totalUncompressedBytes,
          truncated: false
        }
      }
      return publicTarListing(await loadTar(filePath))
    },

    async readArchiveTextEntry (filePath, entryPath, options = {}) {
      const limit = boundedInteger(options.maxBytes, previewLimit, previewLimit)
      const type = archiveType(filePath)
      const targetPath = validateArchivePath(entryPath)
      if (type === 'gz') {
        if (targetPath !== gzipEntryPath(filePath)) {
          throw new Error('未找到指定压缩成员')
        }
        const compressed = await readBoundedArchive(filePath)
        const decompressed = await decompressBytes(
          compressed,
          'gzip',
          limit + 1,
          signal,
          true
        )
        const preview = decompressed.bytes.subarray(0, limit)
        const totalBytes = decompressed.truncated
          ? limit + 1
          : decompressed.bytes.byteLength
        return textPreview(preview, totalBytes, {
          archiveType: type,
          entryPath: targetPath
        })
      }
      if (type === 'zip') {
        const loaded = await loadZip(filePath)
        const entry = loaded.entries.find(item => item.path === targetPath)
        if (!entry) throw new Error('未找到指定压缩成员')
        const data = entry.item?._data
        const compressed = data?.compressedContent
        if (!(compressed instanceof Uint8Array) ||
          compressed.byteLength > REMOTE_CONTEXT_ARCHIVE_MAX_BYTES) {
          throw new Error('ZIP 成员压缩输入无效')
        }
        let decompressed
        if (data.compression?.magic === '\x00\x00') {
          decompressed = {
            bytes: compressed.subarray(0, limit + 1),
            truncated: compressed.byteLength > limit + 1
          }
        } else if (data.compression?.magic === '\x08\x00') {
          decompressed = await decompressBytes(
            compressed,
            'deflate-raw',
            limit + 1,
            signal,
            true
          )
        } else {
          throw new Error('ZIP 成员压缩方法不受支持')
        }
        if (!decompressed.truncated &&
          decompressed.bytes.byteLength !== entry.size) {
          throw new Error('ZIP 成员解压大小与受信头不一致')
        }
        const preview = decompressed.bytes.subarray(0, limit)
        const totalBytes = decompressed.truncated
          ? limit + 1
          : decompressed.bytes.byteLength
        return textPreview(preview, totalBytes, {
          archiveType: type,
          entryPath: targetPath
        })
      }
      const loaded = await loadTar(filePath)
      const entry = loaded.entries.find(item => item.path === targetPath)
      if (!entry) throw new Error('未找到指定压缩成员')
      const bytes = loaded.bytes.subarray(
        entry.dataOffset,
        Math.min(entry.dataEnd, entry.dataOffset + limit)
      )
      return textPreview(bytes, entry.size, {
        archiveType: type,
        entryPath: targetPath
      })
    }
  })
}
