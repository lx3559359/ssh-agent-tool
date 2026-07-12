function safeText (value) {
  return String(value ?? '').trim()
}

function formatBytes (value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : '-'
}

function formatFileHeader (file = {}) {
  return [
    `来源：${safeText(file.source) || '文件'}`,
    `路径：${safeText(file.path) || '-'}`,
    file.size ? `大小：${file.size}` : ''
  ].filter(Boolean).join('\n')
}

export function formatRangeContext (range = {}, file = {}) {
  const status = range.hasMore
    ? `内容状态：已读取 ${formatBytes(range.bytesRead)} 字节，下一段从 offset ${formatBytes(range.nextOffset)} 继续读取。`
    : `内容状态：已读取到结尾，共 ${formatBytes(range.totalBytes)} 字节。`
  return `${formatFileHeader(file)}
读取范围：${formatBytes(range.offset)} - ${formatBytes(range.nextOffset)}
${status}

\`\`\`text
${String(range.content || '')}
\`\`\``
}

export function buildLogReadPrompt ({
  file = {},
  range = {}
} = {}) {
  const next = range.hasMore
    ? '\n\n后续动作：如果需要完整日志，请继续读取下一段；如果只想定位问题，请优先按关键词搜索。'
    : ''
  return `请结合以下日志片段分析问题。${next}

${formatRangeContext(range, file)}`
}

function formatMatch (match = {}, index) {
  const before = (match.before || []).map(line => `  ${line}`).join('\n')
  const after = (match.after || []).map(line => `  ${line}`).join('\n')
  return [
    `匹配 ${index + 1}${match.lineNumber ? `（行 ${match.lineNumber}）` : ''}:`,
    before ? `前文：\n${before}` : '',
    `命中：${match.line || ''}`,
    after ? `后文：\n${after}` : ''
  ].filter(Boolean).join('\n')
}

export function buildLogSearchPrompt ({
  file = {},
  search = {}
} = {}) {
  const matches = (search.matches || [])
    .map(formatMatch)
    .join('\n\n')
  const continueHint = search.truncated
    ? `\n后续动作：搜索结果已截断，可从 offset ${formatBytes(search.nextOffset)} 继续搜索。`
    : ''
  return `请结合以下日志关键词搜索结果分析问题。

${formatFileHeader(file)}
关键词：${search.query || ''}
扫描字节：${formatBytes(search.scannedBytes)} / ${formatBytes(search.totalBytes)}${continueHint}

${matches || '没有找到匹配结果。'}`
}

function formatArchiveEntries (entries = []) {
  return entries
    .map((entry, index) => `${index + 1}. ${entry.path}${entry.size ? ` (${entry.size} bytes)` : ''}`)
    .join('\n')
}

export function buildArchiveLogPrompt ({
  file = {},
  archive = {},
  entry = {}
} = {}) {
  const entryPath = entry.entryPath || entry.path || ''
  const content = entry.content
    ? `\n已读取成员：${entryPath}
读取字节：${formatBytes(entry.bytesRead)}

\`\`\`text
${entry.content}
\`\`\``
    : '\n尚未读取具体成员，请先选择一个日志成员。'
  const continueHint = entry.hasMore
    ? `\n后续动作：成员内容未读完，可从 offset ${formatBytes(entry.nextOffset)} 继续读取。`
    : ''
  return `请结合以下压缩日志信息分析问题。

${formatFileHeader(file)}
压缩格式：${archive.type || '未知'}
成员列表：
${formatArchiveEntries(archive.entries || []) || '没有可读取成员。'}${content}${continueHint}`
}
