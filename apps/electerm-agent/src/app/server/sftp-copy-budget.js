const { posix: pathPosix } = require('path')

const defaultSftpCopyLimits = Object.freeze({
  maxDepth: 128,
  maxNodes: 10000,
  maxTotalBytes: 8 * 1024 * 1024 * 1024
})

function boundedInteger (value, fallback, name, allowZero = false) {
  const resolved = value === undefined ? fallback : value
  const minimum = allowZero ? 0 : 1
  if (!Number.isSafeInteger(resolved) || resolved < minimum) {
    throw new Error(`SFTP 复制${name}预算上限无效。`)
  }
  return resolved
}

function normalizeSftpCopyPath (value) {
  const path = String(value || '').replace(/\\/g, '/')
  if (!path.startsWith('/')) {
    throw new Error('SFTP 复制源和目标必须是绝对路径。')
  }
  const normalized = pathPosix.normalize(path)
  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '')
}

function assertSftpCopyTargetOutsideSource (from, to) {
  const source = normalizeSftpCopyPath(from)
  const target = normalizeSftpCopyPath(to)
  const nested = source === '/'
    ? target.startsWith('/')
    : target === source || target.startsWith(`${source}/`)
  if (nested) {
    throw new Error('SFTP 复制目标不能等于或位于复制源内部。')
  }
  return { source, target }
}

function createSftpCopyBudget (limits = {}) {
  return {
    maxDepth: boundedInteger(
      limits.maxDepth,
      defaultSftpCopyLimits.maxDepth,
      '目录深度',
      true
    ),
    maxNodes: boundedInteger(
      limits.maxNodes,
      defaultSftpCopyLimits.maxNodes,
      '节点数'
    ),
    maxTotalBytes: boundedInteger(
      limits.maxTotalBytes,
      defaultSftpCopyLimits.maxTotalBytes,
      '总字节数',
      true
    ),
    nodes: 0,
    totalBytes: 0
  }
}

function consumeSftpCopyBudget (budget, { depth, bytes }) {
  if (!budget || !Number.isSafeInteger(depth) || depth < 0 ||
    !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error('SFTP 复制预算参数无效。')
  }
  if (depth > budget.maxDepth) {
    throw new Error('SFTP 复制目录深度超过安全上限。')
  }
  if (budget.nodes + 1 > budget.maxNodes) {
    throw new Error('SFTP 复制节点数超过安全上限。')
  }
  if (budget.totalBytes + bytes > budget.maxTotalBytes) {
    throw new Error('SFTP 复制总字节数超过安全上限。')
  }
  budget.nodes += 1
  budget.totalBytes += bytes
  return budget
}

module.exports = {
  assertSftpCopyTargetOutsideSource,
  consumeSftpCopyBudget,
  createSftpCopyBudget,
  defaultSftpCopyLimits,
  normalizeSftpCopyPath
}
