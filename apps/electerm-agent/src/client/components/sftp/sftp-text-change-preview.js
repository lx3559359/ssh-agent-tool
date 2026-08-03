const defaultMaxBytes = 256 * 1024
const defaultChunkBytes = 64 * 1024
const maxDiffCells = 1000000

function abortError () {
  const error = new Error('SFTP 文本差异预览已取消。')
  error.name = 'AbortError'
  return error
}

function throwIfAborted (signal) {
  if (signal?.aborted) throw abortError()
}

function textLines (value) {
  const text = String(value ?? '')
  if (!text) return []
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '' && /\r?\n$/.test(text)) lines.pop()
  return lines
}

function createLcsOperations (before, after) {
  const columns = after.length + 1
  const cells = (before.length + 1) * columns
  const table = new Uint32Array(cells)
  const at = (row, column) => row * columns + column

  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let column = after.length - 1; column >= 0; column -= 1) {
      table[at(row, column)] = before[row] === after[column]
        ? table[at(row + 1, column + 1)] + 1
        : Math.max(
          table[at(row + 1, column)],
          table[at(row, column + 1)]
        )
    }
  }

  const operations = []
  let row = 0
  let column = 0
  while (row < before.length || column < after.length) {
    if (
      row < before.length &&
      column < after.length &&
      before[row] === after[column]
    ) {
      operations.push({
        type: 'context',
        text: before[row],
        oldLine: row + 1,
        newLine: column + 1
      })
      row += 1
      column += 1
    } else if (
      row < before.length &&
      (
        column >= after.length ||
        table[at(row + 1, column)] >= table[at(row, column + 1)]
      )
    ) {
      operations.push({
        type: 'remove',
        text: before[row],
        oldLine: row + 1
      })
      row += 1
    } else {
      operations.push({
        type: 'add',
        text: after[column],
        newLine: column + 1
      })
      column += 1
    }
  }
  return operations
}

function createFallbackOperations (before, after) {
  let prefix = 0
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1
  }

  const operations = []
  for (let index = 0; index < prefix; index += 1) {
    operations.push({
      type: 'context',
      text: before[index],
      oldLine: index + 1,
      newLine: index + 1
    })
  }
  for (let index = prefix; index < before.length - suffix; index += 1) {
    operations.push({
      type: 'remove',
      text: before[index],
      oldLine: index + 1
    })
  }
  for (let index = prefix; index < after.length - suffix; index += 1) {
    operations.push({
      type: 'add',
      text: after[index],
      newLine: index + 1
    })
  }
  for (let offset = suffix; offset > 0; offset -= 1) {
    const oldIndex = before.length - offset
    const newIndex = after.length - offset
    operations.push({
      type: 'context',
      text: before[oldIndex],
      oldLine: oldIndex + 1,
      newLine: newIndex + 1
    })
  }
  return operations
}

function selectContext (operations, contextLines) {
  if (contextLines < 0) return operations
  const selected = new Set()
  for (let index = 0; index < operations.length; index += 1) {
    if (operations[index].type === 'context') continue
    selected.add(index)
    for (let distance = 1; distance <= contextLines; distance += 1) {
      if (operations[index - distance]?.type === 'context') {
        selected.add(index - distance)
      }
      if (operations[index + distance]?.type === 'context') {
        selected.add(index + distance)
      }
    }
  }
  return operations.filter((operation, index) => (
    operation.type !== 'context' || selected.has(index)
  ))
}

function truncateLine (value, maxLength) {
  const text = String(value)
  if (text.length <= maxLength) return { text, truncated: false }
  return {
    text: `${text.slice(0, Math.max(0, maxLength - 1))}…`,
    truncated: true
  }
}

export function buildSftpTextChangePreview ({
  path,
  beforeText,
  afterText,
  existed = true,
  contextLines = 1,
  maxPreviewLines = 80,
  maxLineLength = 240
}) {
  const before = textLines(beforeText)
  const after = textLines(afterText)
  const operations = before.length * after.length <= maxDiffCells
    ? createLcsOperations(before, after)
    : createFallbackOperations(before, after)
  const addedLines = operations.filter(item => item.type === 'add').length
  const removedLines = operations.filter(item => item.type === 'remove').length
  const changed = addedLines > 0 || removedLines > 0
  const contextual = selectContext(
    operations,
    Math.max(0, Number(contextLines) || 0)
  )
  const limit = Math.max(1, Number(maxPreviewLines) || 1)
  let truncated = contextual.length > limit
  const lines = contextual.slice(0, limit).map(item => {
    const shortened = truncateLine(
      item.text,
      Math.max(8, Number(maxLineLength) || 8)
    )
    if (shortened.truncated) truncated = true
    return {
      type: item.type,
      text: shortened.text,
      ...(item.oldLine ? { oldLine: item.oldLine } : {}),
      ...(item.newLine ? { newLine: item.newLine } : {})
    }
  })

  return {
    path: String(path || ''),
    changeType: !existed ? 'created' : changed ? 'modified' : 'unchanged',
    beforeBytes: new TextEncoder().encode(String(beforeText ?? '')).byteLength,
    afterBytes: new TextEncoder().encode(String(afterText ?? '')).byteLength,
    addedLines,
    removedLines,
    lines,
    truncated
  }
}

function decodeBase64 (value) {
  const binary = globalThis.atob(String(value || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export async function readSftpSnapshotText (
  sftp,
  resource,
  {
    maxBytes = defaultMaxBytes,
    signal
  } = {}
) {
  throwIfAborted(signal)
  if (resource?.original?.absent === true) {
    return { available: true, text: '', existed: false }
  }
  if (resource?.original?.type !== 'file') {
    return {
      available: false,
      existed: true,
      reason: 'not-text-file'
    }
  }
  const size = Number(resource.original.size)
  const limit = Math.max(1, Number(maxBytes) || defaultMaxBytes)
  if (!Number.isSafeInteger(size) || size < 0 || size > limit) {
    return {
      available: false,
      existed: true,
      reason: 'file-too-large',
      size: Number.isSafeInteger(size) && size >= 0 ? size : undefined
    }
  }
  if (typeof sftp?.readFileChunk !== 'function') {
    return {
      available: false,
      existed: true,
      reason: 'bounded-read-unavailable'
    }
  }
  if (size === 0) return { available: true, text: '', existed: true }

  const chunks = []
  let offset = 0
  let totalBytes
  while (offset < size) {
    throwIfAborted(signal)
    const chunk = await sftp.readFileChunk(resource.snapshotPath, {
      offset,
      maxBytes: Math.min(defaultChunkBytes, size - offset)
    })
    throwIfAborted(signal)
    if (
      !chunk ||
      chunk.offset !== offset ||
      !Number.isSafeInteger(chunk.nextOffset) ||
      chunk.nextOffset <= offset ||
      !Number.isSafeInteger(chunk.totalBytes) ||
      chunk.totalBytes !== size ||
      chunk.totalBytes > limit
    ) {
      return {
        available: false,
        existed: true,
        reason: 'invalid-chunk'
      }
    }
    if (totalBytes !== undefined && totalBytes !== chunk.totalBytes) {
      return {
        available: false,
        existed: true,
        reason: 'snapshot-changed'
      }
    }
    totalBytes = chunk.totalBytes
    const bytes = decodeBase64(chunk.base64)
    if (
      bytes.byteLength !== chunk.bytesRead ||
      chunk.nextOffset !== offset + bytes.byteLength ||
      (chunk.hasMore && bytes.byteLength === 0)
    ) {
      return {
        available: false,
        existed: true,
        reason: 'invalid-chunk'
      }
    }
    chunks.push(bytes)
    offset = chunk.nextOffset
  }

  const complete = new Uint8Array(size)
  let writeOffset = 0
  for (const chunk of chunks) {
    complete.set(chunk, writeOffset)
    writeOffset += chunk.byteLength
  }
  try {
    return {
      available: true,
      text: new TextDecoder('utf-8', { fatal: true }).decode(complete),
      existed: true
    }
  } catch {
    return {
      available: false,
      existed: true,
      reason: 'not-utf8-text'
    }
  }
}
