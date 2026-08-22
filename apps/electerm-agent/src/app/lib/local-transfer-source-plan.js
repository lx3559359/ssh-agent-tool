const fss = require('fs/promises')
const fs = require('fs')
const crypto = require('crypto')
const path = require('path')

const TRANSFER_DIGEST_CHUNK_BYTES = 64 * 1024
const TRANSFER_DIGEST_ALGORITHM = 'SHELLPILOT-SHA-256-CHAIN-V1'
const TRANSFER_DESCRIPTOR_LIMITS = Object.freeze({
  maxDepth: 128,
  maxNodes: 10000,
  maxTotalBytes: 1024 * 1024 * 1024 * 1024,
  maxManifestBytes: 256 * 1024
})
const SKIPPABLE_TRANSFER_SOURCE_CODES = new Set(['EBUSY', 'EACCES', 'EPERM'])
const SKIPPED_ENTRY = Symbol('SKIPPED_ENTRY')

function boundedPositiveInteger (value, fallback) {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, fallback)
    : fallback
}

function transferDescriptorLimits (options = {}) {
  return Object.fromEntries(Object.entries(TRANSFER_DESCRIPTOR_LIMITS).map(([key, value]) => [
    key,
    boundedPositiveInteger(options[key], value)
  ]))
}

function uint64Bytes (value) {
  const result = Buffer.alloc(8)
  result.writeBigUInt64BE(BigInt(value))
  return result
}

class TransferBoundedDigest {
  constructor () {
    this.state = Buffer.alloc(32)
    this.block = Buffer.alloc(TRANSFER_DIGEST_CHUNK_BYTES)
    this.used = 0
    this.size = 0
  }

  update (value) {
    const bytes = Buffer.from(value)
    let offset = 0
    while (offset < bytes.length) {
      const length = Math.min(this.block.length - this.used, bytes.length - offset)
      bytes.copy(this.block, this.used, offset, offset + length)
      this.used += length
      this.size += length
      offset += length
      if (this.used === this.block.length) {
        this.state = crypto.createHash('sha256')
          .update(this.state)
          .update(Buffer.from([0]))
          .update(this.block)
          .digest()
        this.used = 0
      }
    }
  }

  finish () {
    return {
      size: this.size,
      digest: crypto.createHash('sha256')
        .update(this.state)
        .update(Buffer.from([1]))
        .update(this.block.subarray(0, this.used))
        .update(uint64Bytes(this.size))
        .digest('hex'),
      digestAlgorithm: TRANSFER_DIGEST_ALGORITHM
    }
  }
}

function stableLocalStat (stat) {
  return [
    stat.dev,
    stat.ino,
    stat.size,
    stat.mode,
    stat.mtimeMs,
    stat.ctimeMs
  ].join(':')
}

function createTransferPlanIo (io = {}) {
  return {
    lstat: io.lstat || ((...args) => fss.lstat(...args)),
    readdir: io.readdir || ((...args) => fss.readdir(...args)),
    createReadStream: io.createReadStream || ((...args) => fs.createReadStream(...args))
  }
}

function normalizeTransferSourceErrorCode (code) {
  return String(code || '').trim().toUpperCase()
}

function transferSkipReasonForCode (code) {
  return code === 'EBUSY' ? 'locked' : 'unreadable'
}

function isSkippableTransferSourceError (error) {
  return SKIPPABLE_TRANSFER_SOURCE_CODES.has(
    normalizeTransferSourceErrorCode(error && error.code)
  )
}

function normalizeTransferRelativePathKey (relativePath) {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
}

function transferRootRelativePath (rootPath) {
  const resolved = path.resolve(rootPath)
  const trimmed = resolved.replace(/[\\/]+$/, '')
  return path.basename(trimmed) || path.parse(resolved).root || resolved
}

function transferRelativePath (rootPath, filePath) {
  if (path.resolve(rootPath) === path.resolve(filePath)) {
    return transferRootRelativePath(rootPath)
  }
  return normalizeTransferRelativePathKey(path.relative(rootPath, filePath))
}

function createTransferSkipRecordForCode (rootPath, filePath, code) {
  const normalizedCode = normalizeTransferSourceErrorCode(code)
  return {
    path: filePath,
    relativePath: transferRelativePath(rootPath, filePath),
    code: normalizedCode,
    reason: transferSkipReasonForCode(normalizedCode)
  }
}

function createTransferSkipRecord (rootPath, filePath, error) {
  return createTransferSkipRecordForCode(rootPath, filePath, error && error.code)
}

function invalidPinnedTransferSkipError (entry) {
  const relativePath = String((entry && entry.relativePath) || '')
  const code = normalizeTransferSourceErrorCode(entry && entry.code)
  const error = new Error(
    `Invalid pinned transfer skip for "${relativePath || '<unknown>'}" with code "${code || '<missing>'}".`
  )
  error.code = 'TRANSFER_PINNED_SKIP_INVALID'
  return error
}

function foldTransferPathCase (filePath) {
  return process.platform === 'win32'
    ? String(filePath).toLowerCase()
    : String(filePath)
}

function validatePinnedTransferRelativePath (rootPath, relativePath) {
  const rawPath = String(relativePath || '')
  const normalizedSeparators = rawPath.replace(/\\/g, '/')
  if (
    !normalizedSeparators ||
    /^[a-zA-Z]:/.test(rawPath) ||
    path.isAbsolute(rawPath) ||
    path.posix.isAbsolute(normalizedSeparators) ||
    path.win32.isAbsolute(rawPath)
  ) {
    return null
  }
  const segments = normalizedSeparators.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    return null
  }
  const rootAbsolutePath = path.resolve(rootPath)
  const absolutePath = path.resolve(rootAbsolutePath, ...segments)
  const relativeToRoot = path.relative(rootAbsolutePath, absolutePath)
  if (
    !relativeToRoot ||
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    return null
  }
  return {
    absolutePath,
    relativePath: segments.join('/')
  }
}

function pinnedTransferSkipComparisonKey (rootPath, filePath) {
  return foldTransferPathCase(path.normalize(path.resolve(rootPath, filePath)))
}

function createPinnedTransferSkipMap (rootPath, entries = []) {
  const pinned = new Map()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const validatedPath = validatePinnedTransferRelativePath(rootPath, entry.relativePath)
    if (!validatedPath) {
      throw invalidPinnedTransferSkipError(entry)
    }
    const code = normalizeTransferSourceErrorCode(entry.code)
    if (!SKIPPABLE_TRANSFER_SOURCE_CODES.has(code)) {
      throw invalidPinnedTransferSkipError(entry)
    }
    const key = pinnedTransferSkipComparisonKey(rootPath, validatedPath.absolutePath)
    if (pinned.has(key)) {
      throw invalidPinnedTransferSkipError(entry)
    }
    pinned.set(key, {
      relativePath: validatedPath.relativePath,
      code
    })
  }
  return pinned
}

function consumePinnedTransferSkip (context, filePath) {
  if (!context.allowSkips) {
    return null
  }
  const key = pinnedTransferSkipComparisonKey(context.rootPath, filePath)
  if (!context.pinned.has(key)) {
    return null
  }
  const pinned = context.pinned.get(key)
  context.pinned.delete(key)
  const record = createTransferSkipRecordForCode(context.rootPath, filePath, pinned.code)
  context.skipped.push(record)
  return record
}

function maybeSkipTransferSourceError (context, filePath, error) {
  if (!context.allowSkips || !isSkippableTransferSourceError(error)) {
    throw error
  }
  context.skipped.push(createTransferSkipRecord(context.rootPath, filePath, error))
  return SKIPPED_ENTRY
}

async function scanTransferSourceLstat (context, filePath) {
  try {
    return await context.io.lstat(filePath)
  } catch (error) {
    return maybeSkipTransferSourceError(context, filePath, error)
  }
}

async function scanTransferSourceReaddir (context, filePath) {
  try {
    return await context.io.readdir(filePath)
  } catch (error) {
    return maybeSkipTransferSourceError(context, filePath, error)
  }
}

async function scanTransferSourceStream (context, filePath, digest) {
  try {
    for await (const chunk of context.io.createReadStream(filePath, {
      highWaterMark: TRANSFER_DIGEST_CHUNK_BYTES
    })) {
      digest.update(chunk)
    }
    return true
  } catch (error) {
    return maybeSkipTransferSourceError(context, filePath, error)
  }
}

async function describeTransferEntryInternal (filePath, context, depth) {
  if (depth > context.budget.maxDepth) {
    throw new Error('本地上传目录超过允许的深度上限。')
  }
  if (context.budget.remainingNodes <= 0) {
    throw new Error('本地上传目录超过允许的节点上限。')
  }
  context.budget.remainingNodes -= 1
  if (consumePinnedTransferSkip(context, filePath)) {
    return null
  }

  const before = await scanTransferSourceLstat(context, filePath)
  if (before === SKIPPED_ENTRY) {
    return null
  }
  if (before.isSymbolicLink()) {
    throw new Error('本地上传源包含符号链接，已拒绝受保护传输。')
  }
  if (!before.isFile() && !before.isDirectory()) {
    throw new Error('本地上传源包含特殊文件，已拒绝受保护传输。')
  }

  const descriptor = {
    type: before.isDirectory() ? 'directory' : 'file',
    mode: Number(before.mode) & 0o7777,
    uid: Number.isSafeInteger(before.uid) ? before.uid : 0,
    gid: Number.isSafeInteger(before.gid) ? before.gid : 0
  }

  if (before.isFile()) {
    if (context.budget.totalBytes + before.size > context.budget.maxTotalBytes) {
      throw new Error('本地上传源超过允许的总字节上限。')
    }
    const digest = new TransferBoundedDigest()
    const streamResult = await scanTransferSourceStream(context, filePath, digest)
    if (streamResult === SKIPPED_ENTRY) {
      return null
    }
    const result = digest.finish()
    const after = await scanTransferSourceLstat(context, filePath)
    if (after === SKIPPED_ENTRY) {
      return null
    }
    if (stableLocalStat(before) !== stableLocalStat(after) || result.size !== before.size) {
      throw new Error('本地上传源在摘要计算期间发生变化。')
    }
    context.budget.totalBytes += before.size
    return { ...descriptor, ...result }
  }

  const names = await scanTransferSourceReaddir(context, filePath)
  if (names === SKIPPED_ENTRY) {
    return null
  }
  descriptor.entries = []
  for (const name of names.sort((left, right) => left.localeCompare(right))) {
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
      throw new Error('本地上传目录包含无效条目名称。')
    }
    const child = await describeTransferEntryInternal(
      path.join(filePath, name),
      context,
      depth + 1
    )
    if (!child) {
      continue
    }
    descriptor.entries.push({
      name,
      entry: child
    })
  }
  const after = await scanTransferSourceLstat(context, filePath)
  if (after === SKIPPED_ENTRY) {
    return null
  }
  if (stableLocalStat(before) !== stableLocalStat(after)) {
    throw new Error('本地上传目录在摘要计算期间发生变化。')
  }
  return descriptor
}

async function describeTransferPlan (filePath, options = {}, allowSkips) {
  const limits = transferDescriptorLimits(options)
  const context = {
    rootPath: filePath,
    allowSkips,
    pinned: allowSkips ? createPinnedTransferSkipMap(filePath, options.pinnedSkips) : new Map(),
    skipped: [],
    io: createTransferPlanIo(options.io),
    budget: {
      ...limits,
      remainingNodes: limits.maxNodes,
      totalBytes: 0
    }
  }
  const descriptor = await describeTransferEntryInternal(filePath, context, 0)
  if (
    descriptor &&
    Buffer.byteLength(JSON.stringify(descriptor), 'utf8') > limits.maxManifestBytes
  ) {
    throw new Error('本地上传目录清单超过允许的大小上限。')
  }
  return {
    descriptor: descriptor || null,
    skipped: context.skipped
  }
}

async function describeTransferEntry (filePath, options = {}) {
  const plan = await describeTransferPlan(filePath, options, false)
  return plan.descriptor
}

async function prepareTransferEntry (filePath, options = {}) {
  return describeTransferPlan(filePath, options, true)
}

module.exports = {
  describeTransferEntry,
  prepareTransferEntry,
  isSkippableTransferSourceError
}
