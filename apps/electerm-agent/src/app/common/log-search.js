const {
  DEFAULT_RANGE_BYTES,
  MAX_RANGE_BYTES
} = require('./file-range')

const MAX_QUERY_CHARS = 256
const MAX_MATCHES = 500
const MAX_CONTEXT_LINES = 20

function normalizeSearchOptions (options = {}) {
  const query = String(options.query || '').trim()
  if (!query) {
    throw new Error('搜索关键词不能为空')
  }
  if (query.length > MAX_QUERY_CHARS) {
    throw new Error('搜索关键词过长')
  }
  const maxMatches = Number.isSafeInteger(options.maxMatches) && options.maxMatches > 0
    ? Math.min(options.maxMatches, MAX_MATCHES)
    : 100
  const contextLines = Number.isSafeInteger(options.contextLines) && options.contextLines >= 0
    ? Math.min(options.contextLines, MAX_CONTEXT_LINES)
    : 2
  const chunkBytes = Number.isSafeInteger(options.chunkBytes) && options.chunkBytes > 0
    ? Math.min(options.chunkBytes, MAX_RANGE_BYTES)
    : DEFAULT_RANGE_BYTES
  return {
    query,
    caseSensitive: Boolean(options.caseSensitive),
    maxMatches,
    contextLines,
    chunkBytes,
    startOffset: Number.isSafeInteger(options.startOffset) && options.startOffset >= 0
      ? options.startOffset
      : 0
  }
}

function normalizeLine (line) {
  return String(line || '').replace(/\r$/, '')
}

function createMatcher (query, caseSensitive) {
  if (caseSensitive) {
    return line => line.includes(query)
  }
  const needle = query.toLowerCase()
  return line => line.toLowerCase().includes(needle)
}

function fillAfterContext (pendingMatches, line) {
  for (const pending of pendingMatches) {
    if (pending.remaining <= 0) {
      continue
    }
    pending.match.after.push(line)
    pending.remaining -= 1
  }
  return pendingMatches.filter(pending => pending.remaining > 0)
}

async function searchTextReader (reader, options = {}) {
  if (typeof reader?.readFileRange !== 'function') {
    throw new Error('缺少分块读取能力')
  }
  const normalized = normalizeSearchOptions(options)
  const matches = []
  const beforeLines = []
  let pendingMatches = []
  let carry = ''
  let offset = normalized.startOffset
  let scannedBytes = offset
  let totalBytes = 0
  let truncated = false
  const isMatch = createMatcher(normalized.query, normalized.caseSensitive)

  while (true) {
    const range = await reader.readFileRange({
      offset,
      maxBytes: normalized.chunkBytes
    })
    if (range.binary) {
      throw new Error('二进制内容不可搜索')
    }
    totalBytes = Number(range.totalBytes) || totalBytes
    scannedBytes = Number(range.nextOffset) || scannedBytes

    const text = carry + String(range.content || '')
    const lines = text.split('\n')
    carry = range.hasMore ? lines.pop() : ''
    if (!range.hasMore && carry) {
      lines.push(carry)
      carry = ''
    }

    for (const rawLine of lines) {
      const line = normalizeLine(rawLine)
      pendingMatches = fillAfterContext(pendingMatches, line)
      if (matches.length < normalized.maxMatches && isMatch(line)) {
        const match = {
          line,
          before: beforeLines.slice(-normalized.contextLines),
          after: [],
          offset: range.offset
        }
        matches.push(match)
        if (normalized.contextLines > 0) {
          pendingMatches.push({
            match,
            remaining: normalized.contextLines
          })
        }
      }
      beforeLines.push(line)
      if (beforeLines.length > normalized.contextLines) {
        beforeLines.shift()
      }
    }

    offset = range.nextOffset
    if (matches.length >= normalized.maxMatches) {
      truncated = Boolean(range.hasMore || offset < totalBytes)
      break
    }
    if (!range.hasMore) {
      truncated = false
      break
    }
    if (range.nextOffset <= range.offset) {
      throw new Error('分块读取没有前进，已停止搜索')
    }
  }

  return {
    query: normalized.query,
    caseSensitive: normalized.caseSensitive,
    matches,
    scannedBytes,
    totalBytes,
    nextOffset: offset,
    truncated
  }
}

module.exports = {
  MAX_QUERY_CHARS,
  MAX_MATCHES,
  MAX_CONTEXT_LINES,
  normalizeSearchOptions,
  searchTextReader
}
