import { assertTrustedOperationId } from '../../common/safety-transactions/operation-id.js'
import { markSftpEditorStage } from './sftp-editor-permission-error.js'
import { isAuthoritativeRemoteMissingError } from './remote-file-errors.js'

const digestChunkBytes = 64 * 1024
const maxManifestBytes = 256 * 1024
const maxDescriptorDepth = 128
const maxDescriptorNodes = 10000
const maxDescriptorTotalBytes = 1024 * 1024 * 1024 * 1024
const digestAlgorithm = 'SHELLPILOT-SHA-256-CHAIN-V1'
const fileTypeMask = 0o170000
const fileTypeModes = {
  0o100000: 'file',
  0o040000: 'directory',
  0o120000: 'symlink'
}

function joinRemotePath (...parts) {
  const result = []
  for (const part of parts.join('/').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') result.pop()
    else result.push(part)
  }
  return `/${result.join('/')}`
}

function parentRemotePath (value) {
  const path = joinRemotePath(value)
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

function assertTransactionOperationDir (transactionRoot, operationDir) {
  const root = joinRemotePath(transactionRoot)
  const directory = joinRemotePath(operationDir)
  if (directory === root || parentRemotePath(directory) !== root ||
    !directory.startsWith(`${root}/`)) {
    throw new Error('SFTP 事务目录逃离唯一快照根目录，已拒绝操作。')
  }
  return directory
}

function assertTransactionArtifactPath (operationDir, artifactPath) {
  const path = joinRemotePath(artifactPath)
  if (parentRemotePath(path) !== operationDir) {
    throw new Error('SFTP 事务产物路径逃离操作目录，已拒绝操作。')
  }
  return path
}

function isMissingError (error) {
  return isAuthoritativeRemoteMissingError(error)
}

function throwIfAborted (signal) {
  if (!signal?.aborted) return
  const error = new Error('SFTP 安全事务已取消。')
  error.name = 'AbortError'
  throw error
}

function runProtectedMutation (context, work, options) {
  throwIfAborted(context?.signal)
  if (typeof context?.runMutation === 'function') {
    return context.runMutation(work, options)
  }
  return work()
}

async function runEditorStage (stage, work) {
  try {
    return await work()
  } catch (error) {
    throw markSftpEditorStage(stage, error)
  }
}

function bytesFromBase64 (value) {
  const binary = globalThis.atob(String(value || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function concatBytes (...values) {
  const length = values.reduce((total, value) => total + value.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const value of values) {
    result.set(value, offset)
    offset += value.byteLength
  }
  return result
}

function lengthBytes (value) {
  let remaining = BigInt(value)
  const result = new Uint8Array(8)
  for (let index = result.length - 1; index >= 0; index -= 1) {
    result[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return result
}

async function sha256Bytes (value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持 SFTP 快照摘要计算。')
  }
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', value))
}

function hexBytes (value) {
  return [...value].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

class BoundedDigest {
  constructor () {
    this.state = new Uint8Array(32)
    this.block = new Uint8Array(digestChunkBytes)
    this.used = 0
    this.size = 0
  }

  async update (value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
    let offset = 0
    while (offset < bytes.byteLength) {
      const length = Math.min(
        this.block.byteLength - this.used,
        bytes.byteLength - offset
      )
      this.block.set(bytes.subarray(offset, offset + length), this.used)
      this.used += length
      this.size += length
      offset += length
      if (this.used === this.block.byteLength) {
        this.state = await sha256Bytes(concatBytes(
          this.state,
          new Uint8Array([0]),
          this.block
        ))
        this.used = 0
      }
    }
  }

  async finish () {
    const digest = await sha256Bytes(concatBytes(
      this.state,
      new Uint8Array([1]),
      this.block.subarray(0, this.used),
      lengthBytes(this.size)
    ))
    return {
      size: this.size,
      digest: hexBytes(digest),
      digestAlgorithm
    }
  }
}

export async function digestSftpText (text) {
  const value = String(text ?? '')
  const digest = new BoundedDigest()
  const encoder = new TextEncoder()
  const characterChunk = 16 * 1024
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + characterChunk)
    const last = value.charCodeAt(end - 1)
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1
    await digest.update(encoder.encode(value.slice(offset, end)))
    offset = end
  }
  return digest.finish()
}

async function digestRemoteFile (
  sftp,
  path,
  expectedSize,
  signal,
  onBytes
) {
  if (typeof sftp.digestFile === 'function') {
    throwIfAborted(signal)
    const remote = await sftp.digestFile(path, {
      expectedSize,
      signal
    })
    throwIfAborted(signal)
    if (!remote || typeof remote !== 'object' || Array.isArray(remote) ||
      !Number.isSafeInteger(remote.size) || remote.size < 0 ||
      (expectedSize !== undefined && remote.size !== expectedSize) ||
      ![digestAlgorithm, 'SHA-256'].includes(remote.digestAlgorithm) ||
      typeof remote.digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(remote.digest)) {
      throw new Error('SFTP 权威摘要结果无效，已停止操作。')
    }
    if (typeof onBytes === 'function' && remote.size > 0) {
      onBytes(remote.size)
    }
    return {
      size: remote.size,
      digest: remote.digest,
      digestAlgorithm: remote.digestAlgorithm
    }
  }
  if (typeof sftp.readFileChunk !== 'function') {
    throw new Error('当前 SFTP 连接不支持有界文件摘要读取。')
  }
  const digest = new BoundedDigest()
  let offset = 0
  let totalBytes
  do {
    throwIfAborted(signal)
    const chunk = await sftp.readFileChunk(path, {
      offset,
      maxBytes: digestChunkBytes
    })
    throwIfAborted(signal)
    if (!chunk || chunk.offset !== offset ||
      !Number.isSafeInteger(chunk.nextOffset) || chunk.nextOffset < offset ||
      !Number.isSafeInteger(chunk.totalBytes) || chunk.totalBytes < 0) {
      throw new Error('SFTP 分块读取结果无效，已停止摘要计算。')
    }
    if (totalBytes !== undefined && chunk.totalBytes !== totalBytes) {
      throw new Error('SFTP 文件在摘要计算期间发生变化。')
    }
    totalBytes = chunk.totalBytes
    const bytes = bytesFromBase64(chunk.base64)
    if (bytes.byteLength !== chunk.bytesRead ||
      chunk.nextOffset !== offset + bytes.byteLength ||
      (chunk.hasMore && bytes.byteLength === 0)) {
      throw new Error('SFTP 分块读取长度无效，已停止摘要计算。')
    }
    await digest.update(bytes)
    if (typeof onBytes === 'function' && bytes.byteLength > 0) {
      onBytes(bytes.byteLength)
    }
    offset = chunk.nextOffset
  } while (offset < totalBytes)
  const result = await digest.finish()
  if (result.size !== totalBytes ||
    (expectedSize !== undefined && result.size !== expectedSize)) {
    throw new Error('SFTP 文件大小与摘要读取结果不一致。')
  }
  return result
}

function typeFromStat (stat) {
  return fileTypeModes[Number(stat?.mode) & fileTypeMask] ||
    (stat?.isDirectory === true ? 'directory' : 'special')
}

function safeMode (stat) {
  return Number(stat?.mode) & 0o7777
}

function safeOwnership (stat) {
  if (!Number.isSafeInteger(stat?.uid) || stat.uid < 0 ||
    !Number.isSafeInteger(stat?.gid) || stat.gid < 0) {
    throw new Error('SFTP 资源缺少有效的 uid/gid，无法创建可靠恢复点。')
  }
  return { uid: stat.uid, gid: stat.gid }
}

async function lstatOrAbsent (sftp, path, signal) {
  throwIfAborted(signal)
  try {
    const stat = await sftp.lstat(path)
    throwIfAborted(signal)
    return stat
  } catch (error) {
    if (isMissingError(error)) return null
    throw error
  }
}

function assertSupportedType (type) {
  if (type === 'symlink') {
    throw new Error('SFTP 符号链接首版不支持安全事务，已拒绝操作。')
  }
  if (!['file', 'directory'].includes(type)) {
    throw new Error('SFTP 特殊文件首版不支持安全事务，已拒绝操作。')
  }
}

function assertEntryName (name) {
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
    throw new Error('SFTP 目录项名称无效，无法完成整树快照。')
  }
}

function createDescriptorBudget () {
  return {
    remainingNodes: maxDescriptorNodes,
    remainingBytes: maxDescriptorTotalBytes
  }
}

async function describeModeEntry (sftp, path, signal) {
  const stat = await lstatOrAbsent(sftp, path, signal)
  if (!stat) return { absent: true }
  const type = typeFromStat(stat)
  assertSupportedType(type)
  return { type, mode: safeMode(stat), ...safeOwnership(stat) }
}

async function describeEntryMetadata (sftp, path, signal) {
  const stat = await lstatOrAbsent(sftp, path, signal)
  if (!stat) return { absent: true }
  const type = typeFromStat(stat)
  assertSupportedType(type)
  return {
    type,
    mode: safeMode(stat),
    ...safeOwnership(stat),
    ...(type === 'file' ? { size: Number(stat.size) } : {})
  }
}

function createByteProgress (onProgress, phase, knownTotal = null) {
  let completedBytes = 0
  let totalBytes = Number.isFinite(knownTotal) && knownTotal >= 0
    ? knownTotal
    : null
  const publish = () => onProgress?.({ phase, completedBytes, totalBytes })
  publish()
  return {
    setKnownTotal (value) {
      if (totalBytes === null && Number.isFinite(value) && value >= 0) {
        totalBytes = value
      }
      publish()
    },
    addBytes (value) {
      const bytes = Number(value)
      if (!Number.isFinite(bytes) || bytes <= 0) return
      completedBytes += bytes
      publish()
    },
    finish () {
      if (totalBytes !== null) completedBytes = totalBytes
      publish()
    }
  }
}

async function describeEntry (
  sftp,
  path,
  budget = createDescriptorBudget(),
  depth = 0,
  signal,
  byteProgress
) {
  throwIfAborted(signal)
  if (depth > maxDescriptorDepth || budget.remainingNodes <= 0) {
    throw new Error('SFTP 目录快照超过深度或节点上限，已拒绝继续操作。')
  }
  budget.remainingNodes -= 1
  const stat = await lstatOrAbsent(sftp, path, signal)
  if (!stat) return { absent: true }
  const type = typeFromStat(stat)
  assertSupportedType(type)
  const descriptor = {
    type,
    mode: safeMode(stat),
    ...safeOwnership(stat)
  }
  if (type === 'file') {
    if (!Number.isSafeInteger(stat.size) || stat.size < 0 ||
      stat.size > budget.remainingBytes) {
      throw new Error('SFTP 文件树超过总字节上限，已拒绝继续操作。')
    }
    budget.remainingBytes -= stat.size
    if (depth === 0) byteProgress?.setKnownTotal(Number(stat.size))
    const digest = await digestRemoteFile(
      sftp,
      path,
      Number(stat.size),
      signal,
      bytes => byteProgress?.addBytes(bytes)
    )
    return { ...descriptor, ...digest }
  }
  const entries = await sftp.list(path)
  throwIfAborted(signal)
  if (!Array.isArray(entries)) {
    throw new Error('SFTP 目录列表无效，无法完成整树快照。')
  }
  descriptor.entries = []
  for (const entry of [...entries].sort((left, right) => (
    String(left.name).localeCompare(String(right.name))
  ))) {
    throwIfAborted(signal)
    const name = String(entry?.name || '')
    assertEntryName(name)
    descriptor.entries.push({
      name,
      entry: await describeEntry(
        sftp,
        joinRemotePath(path, name),
        budget,
        depth + 1,
        signal,
        byteProgress
      )
    })
  }
  return descriptor
}

export async function describeSftpTransferEntry (sftp, path, signal) {
  const descriptor = await describeEntry(
    sftp,
    path,
    createDescriptorBudget(),
    0,
    signal
  )
  const bytes = new TextEncoder().encode(JSON.stringify(descriptor)).byteLength
  if (bytes > maxManifestBytes) {
    throw new Error('SFTP 文件树描述超过清单上限，已拒绝继续传输。')
  }
  return descriptor
}

function sameDescriptor (left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function descriptorMetadata (descriptor) {
  if (descriptor.absent) return { absent: true }
  return {
    type: descriptor.type,
    mode: descriptor.mode,
    uid: descriptor.uid,
    gid: descriptor.gid,
    ...(descriptor.type === 'file' ? { size: descriptor.size } : {})
  }
}

async function verifySnapshotMetadata (sftp, resource, descriptor, signal) {
  const actual = await describeEntryMetadata(
    sftp,
    resource.snapshotPath,
    signal
  )
  if (!sameDescriptor(actual, descriptorMetadata(descriptor))) {
    throw new Error('SFTP 快照元数据发生变化，已拒绝继续操作。')
  }
  return actual
}

function copyComparableDescriptor (descriptor) {
  if (!descriptor || descriptor.absent === true) return descriptor
  const {
    uid,
    gid,
    entries,
    ...comparable
  } = descriptor
  if (Array.isArray(entries)) {
    comparable.entries = entries.map(item => ({
      name: item.name,
      entry: copyComparableDescriptor(item.entry)
    }))
  }
  return comparable
}

function sameCopiedDescriptor (left, right) {
  return sameDescriptor(
    copyComparableDescriptor(left),
    copyComparableDescriptor(right)
  )
}

function matchesExpected (descriptor, expected) {
  if (expected?.absent === true) return descriptor?.absent === true
  if (descriptor?.absent === true) return false
  if (expected?.type && descriptor.type !== expected.type) return false
  if (expected?.mode !== undefined && descriptor.mode !== expected.mode) return false
  if (expected?.uid !== undefined && descriptor.uid !== expected.uid) return false
  if (expected?.gid !== undefined && descriptor.gid !== expected.gid) return false
  if (expected?.size !== undefined && descriptor.size !== expected.size) return false
  if (expected?.digest && descriptor.digest !== expected.digest) return false
  if (expected?.digestAlgorithm &&
    descriptor.digestAlgorithm !== expected.digestAlgorithm) return false
  return true
}

async function ensureDirectory (sftp, path, signal) {
  throwIfAborted(signal)
  const normalized = joinRemotePath(path)
  if (normalized === '/') return
  const existing = await lstatOrAbsent(sftp, normalized, signal)
  if (existing) {
    if (typeFromStat(existing) !== 'directory') {
      throw new Error('SFTP 事务目录路径已被非目录占用。')
    }
    return
  }
  await ensureDirectory(sftp, parentRemotePath(normalized), signal)
  throwIfAborted(signal)
  try {
    await sftp.mkdir(normalized)
    throwIfAborted(signal)
  } catch (error) {
    if (error?.code !== 'EEXIST' && !/already exists/i.test(String(error?.message || error))) {
      throw error
    }
    const created = await lstatOrAbsent(sftp, normalized, signal)
    if (!created || typeFromStat(created) !== 'directory') throw error
  }
}

async function removeTransactionEntry (sftp, path, signal) {
  const stat = await lstatOrAbsent(sftp, path, signal)
  if (!stat) return
  if (typeof sftp.removeEntry !== 'function') {
    throw new Error('当前 SFTP 连接不支持纯 SFTP 删除。')
  }
  await sftp.removeEntry(path, { signal })
  throwIfAborted(signal)
}

function buildPlanSkeleton (operation) {
  const action = operation.effect.action
  const paths = operation.effect.paths
  const primary = paths.source || paths.target
  if (primary === '/') {
    throw new Error('SFTP 根目录不支持首版安全事务。')
  }
  const transactionRoot = joinRemotePath(
    parentRemotePath(primary),
    '.shellpilot-transactions'
  )
  const operationDir = assertTransactionOperationDir(
    transactionRoot,
    joinRemotePath(transactionRoot, assertTrustedOperationId(operation.id))
  )
  const slots = ['rename', 'copy', 'move'].includes(action)
    ? [['source', paths.source], ['target', paths.target]]
    : [[['editor-save', 'upload'].includes(action) ? 'target' : 'source', primary]]
  const plan = {
    adapter: 'sftp',
    action,
    operationDir,
    manifestPath: assertTransactionArtifactPath(
      operationDir,
      joinRemotePath(operationDir, 'manifest.json')
    ),
    resources: slots.map(([slot, path]) => ({
      slot,
      path,
      snapshotRequired: !(action === 'copy' && slot === 'source'),
      snapshotPath: assertTransactionArtifactPath(
        operationDir,
        joinRemotePath(operationDir, slot)
      ),
      stagingPath: assertTransactionArtifactPath(
        operationDir,
        joinRemotePath(operationDir, `${slot}.preparing`)
      ),
      executionPath: assertTransactionArtifactPath(
        operationDir,
        joinRemotePath(operationDir, `${slot}.execute`)
      ),
      executionPreviousPath: assertTransactionArtifactPath(
        operationDir,
        joinRemotePath(operationDir, `${slot}.execute-previous`)
      ),
      restoreTempPath: assertTransactionArtifactPath(
        operationDir,
        joinRemotePath(operationDir, `${slot}.restore-temp`)
      ),
      displacedPath: assertTransactionArtifactPath(
        operationDir,
        joinRemotePath(operationDir, `${slot}.displaced`)
      )
    }))
  }
  return plan
}

function buildArtifacts (plan) {
  return Object.fromEntries([
    ['manifest', plan.manifestPath],
    ...(plan.action === 'chmod'
      ? []
      : plan.resources
        .filter(resource => resource.snapshotRequired !== false)
        .map(resource => [resource.slot, resource.snapshotPath]))
  ])
}

function serializeBoundedManifest (manifest) {
  const text = JSON.stringify(manifest)
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes > maxManifestBytes) {
    throw new Error('SFTP 恢复清单序列化后超过大小上限，未创建快照。')
  }
  return text
}

async function readBoundedText (sftp, path, signal) {
  let offset = 0
  let totalBytes
  const chunks = []
  do {
    throwIfAborted(signal)
    const chunk = await sftp.readFileChunk(path, {
      offset,
      maxBytes: Math.min(digestChunkBytes, maxManifestBytes - offset)
    })
    throwIfAborted(signal)
    if (!chunk || chunk.offset !== offset || chunk.nextOffset <= offset ||
      chunk.totalBytes > maxManifestBytes) {
      throw new Error('SFTP 恢复清单超出上限或分块无效。')
    }
    totalBytes = chunk.totalBytes
    chunks.push(bytesFromBase64(chunk.base64))
    offset = chunk.nextOffset
  } while (offset < totalBytes)
  return new TextDecoder().decode(concatBytes(...chunks))
}

async function verifySnapshot (sftp, resource, signal, byteProgress) {
  if (resource.snapshotRequired === false) return resource.original
  if (resource.original.absent === true) return resource.original
  const snapshot = await describeEntry(
    sftp,
    resource.snapshotPath,
    createDescriptorBudget(),
    0,
    signal,
    byteProgress
  )
  if (!sameDescriptor(snapshot, resource.original)) {
    throw new Error('SFTP 快照校验失败，已拒绝继续操作。')
  }
  return snapshot
}

async function validateManifest (
  sftp,
  operation,
  manifest,
  signal,
  { verifySnapshots = true } = {}
) {
  throwIfAborted(signal)
  const expected = buildPlanSkeleton(operation)
  if (manifest?.schemaVersion !== 1 || manifest?.complete !== true ||
    manifest.id !== operation.id || manifest.effectKey !== operation.effectKey ||
    manifest.endpointKey !== operation.endpointKey ||
    manifest.plan?.adapter !== 'sftp' ||
    manifest.plan?.operationDir !== expected.operationDir ||
    manifest.plan?.manifestPath !== expected.manifestPath ||
    manifest.plan?.action !== operation.effect.action ||
    !Array.isArray(manifest.plan?.resources) ||
    manifest.plan.resources.length !== expected.resources.length) {
    throw new Error('SFTP 恢复清单与当前事务不匹配。')
  }
  for (let index = 0; index < expected.resources.length; index += 1) {
    const actual = manifest.plan.resources[index]
    const skeleton = expected.resources[index]
    for (const field of [
      'slot',
      'path',
      'snapshotRequired',
      'snapshotPath',
      'stagingPath',
      'executionPath',
      'executionPreviousPath',
      'restoreTempPath',
      'displacedPath'
    ]) {
      if (actual?.[field] !== skeleton[field]) {
        throw new Error('SFTP 恢复清单资源路径已被修改。')
      }
    }
    if (verifySnapshots && manifest.plan.action !== 'chmod') {
      await verifySnapshot(sftp, actual, signal)
    }
  }
  const artifacts = buildArtifacts(manifest.plan)
  if (!sameDescriptor(artifacts, manifest.artifacts)) {
    throw new Error('SFTP 恢复清单产物已被修改。')
  }
  return {
    manifestComplete: true,
    plan: manifest.plan,
    artifacts: manifest.artifacts,
    summary: '已复用并验证现有 SFTP 恢复快照。'
  }
}

async function loadManifest (sftp, operation, signal, options = {}) {
  const plan = buildPlanSkeleton(operation)
  if (!await lstatOrAbsent(sftp, plan.manifestPath, signal)) return null
  let manifest
  try {
    manifest = JSON.parse(await readBoundedText(sftp, plan.manifestPath, signal))
  } catch (error) {
    throw new Error(`SFTP 恢复清单读取失败：${error?.message || error}`)
  }
  return validateManifest(sftp, operation, manifest, signal, options)
}

function monitorSnapshotCopy ({
  sftp,
  resource,
  signal,
  onProgress,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let stopped = false
  let timer = null
  let lastBytes = 0
  const totalBytes = resource.original.type === 'file'
    ? resource.original.size
    : null
  const poll = async () => {
    if (stopped || signal?.aborted) return
    try {
      const stat = await lstatOrAbsent(sftp, resource.stagingPath, signal)
      if (stopped) return
      if (stat && totalBytes !== null) {
        lastBytes = Math.max(
          lastBytes,
          Math.min(Number(stat.size) || 0, totalBytes)
        )
        onProgress?.({
          phase: 'snapshot-copy',
          completedBytes: lastBytes,
          totalBytes
        })
      }
    } catch (error) {
      if (!isMissingError(error)) stopped = true
    }
    if (!stopped) timer = setTimer(poll, 250)
  }
  onProgress?.({ phase: 'snapshot-copy', completedBytes: 0, totalBytes })
  timer = setTimer(poll, 250)
  return () => {
    stopped = true
    if (timer !== null) clearTimer(timer)
  }
}

async function copyVerifiedSnapshot (
  sftp,
  resource,
  signal,
  progressOptions = {}
) {
  if (resource.snapshotRequired === false) return
  if (resource.original.absent === true) return
  const {
    onProgress,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    lightweightFinalVerify = false
  } = progressOptions
  const publish = value => onProgress?.(value)
  const existing = await lstatOrAbsent(sftp, resource.snapshotPath, signal)
  if (existing) {
    await verifySnapshot(sftp, resource, signal)
    return
  }
  await removeTransactionEntry(sftp, resource.stagingPath, signal)
  if (typeof sftp.copyEntry !== 'function') {
    throw new Error('当前 SFTP 连接不支持纯 SFTP 快照复制。')
  }
  const stopMonitoring = monitorSnapshotCopy({
    sftp,
    resource,
    signal,
    onProgress: publish,
    setTimer,
    clearTimer
  })
  try {
    await sftp.copyEntry(resource.path, resource.stagingPath, { signal })
  } finally {
    stopMonitoring()
  }
  publish({
    phase: 'snapshot-copy',
    completedBytes: resource.original.type === 'file'
      ? resource.original.size
      : 0,
    totalBytes: resource.original.type === 'file'
      ? resource.original.size
      : null
  })
  const snapshotProgress = createByteProgress(
    publish,
    'snapshot-verify',
    resource.original.type === 'file' ? resource.original.size : null
  )
  const staged = await describeEntry(
    sftp,
    resource.stagingPath,
    createDescriptorBudget(),
    0,
    signal,
    snapshotProgress
  )
  snapshotProgress.finish()
  if (!sameDescriptor(staged, resource.original)) {
    throw new Error('SFTP 快照复制不完整，已拒绝生成恢复清单。')
  }
  throwIfAborted(signal)
  await sftp.rename(resource.stagingPath, resource.snapshotPath)
  throwIfAborted(signal)
  if (lightweightFinalVerify) {
    await verifySnapshotMetadata(sftp, resource, staged, signal)
  } else {
    await verifySnapshot(sftp, resource, signal)
  }
  return staged
}

async function prepareNewManifest (
  sftp,
  operation,
  signal,
  progressOptions = {}
) {
  const plan = buildPlanSkeleton(operation)
  const { onProgress } = progressOptions
  for (const resource of plan.resources) {
    throwIfAborted(signal)
    if (operation.effect.action === 'chmod') {
      resource.original = await describeModeEntry(sftp, resource.path, signal)
    } else {
      const sourceProgress = createByteProgress(onProgress, 'source-scan')
      resource.original = await describeEntry(
        sftp,
        resource.path,
        createDescriptorBudget(),
        0,
        signal,
        sourceProgress
      )
      sourceProgress.finish()
    }
    if (resource.original.absent !== true) {
      if (resource.original.type !== operation.effect.type) {
        throw new Error('SFTP 资源类型与请求不一致，已拒绝操作。')
      }
    } else if (!['editor-save', 'rename', 'upload', 'copy', 'move'].includes(operation.effect.action) ||
      resource.slot === 'source') {
      throw new Error('SFTP 源资源不存在，无法创建恢复点。')
    }
  }

  if (['rename', 'move'].includes(operation.effect.action)) {
    const [source, target] = plan.resources
    const sourceParent = await sftp.stat(parentRemotePath(source.path))
    throwIfAborted(signal)
    const targetParent = await sftp.stat(parentRemotePath(target.path))
    throwIfAborted(signal)
    const hasDeviceIds = Number.isInteger(sourceParent?.dev) &&
      Number.isInteger(targetParent?.dev)
    if (hasDeviceIds && sourceParent.dev !== targetParent.dev) {
      throw new Error('SFTP 重命名跨文件系统，首版已拒绝操作。')
    }
  }

  const artifacts = buildArtifacts(plan)
  const manifest = {
    schemaVersion: 1,
    complete: true,
    id: operation.id,
    endpointKey: operation.endpointKey,
    effectKey: operation.effectKey,
    plan,
    artifacts
  }
  let manifestText = serializeBoundedManifest(manifest)
  const preparingManifest = `${plan.manifestPath}.preparing`
  try {
    await ensureDirectory(sftp, plan.operationDir, signal)
    if (operation.effect.action !== 'chmod') {
      for (const resource of plan.resources) {
        await copyVerifiedSnapshot(sftp, resource, signal, {
          ...progressOptions,
          lightweightFinalVerify: operation.effect.action === 'delete'
        })
      }
    }
    manifestText = serializeBoundedManifest(manifest)
    await removeTransactionEntry(sftp, preparingManifest, signal)
    await sftp.writeFile(preparingManifest, manifestText, 0o600)
    throwIfAborted(signal)
    if (await lstatOrAbsent(sftp, plan.manifestPath, signal)) {
      throw new Error('SFTP 恢复清单已存在但未通过复用校验。')
    }
    await sftp.rename(preparingManifest, plan.manifestPath)
    throwIfAborted(signal)
  } catch (error) {
    for (const resource of plan.resources) {
      try {
        await removeTransactionEntry(sftp, resource.stagingPath)
      } catch {}
    }
    try {
      await removeTransactionEntry(sftp, preparingManifest)
    } catch {}
    throw error
  }
  const verified = await loadManifest(sftp, operation, signal, {
    verifySnapshots: operation.effect.action !== 'delete'
  })
  if (!verified) throw new Error('SFTP 恢复清单提交失败。')
  return {
    ...verified,
    summary: 'SFTP 快照和恢复清单已完成。'
  }
}

async function requireManifest (sftp, operation, signal, options = {}) {
  const prepared = await loadManifest(sftp, operation, signal, options)
  const preparedArtifacts = { ...(operation.artifacts || {}) }
  delete preparedArtifacts.postMutation
  if (!prepared || !sameDescriptor(prepared.plan, operation.plan) ||
    !sameDescriptor(prepared.artifacts, preparedArtifacts)) {
    throw new Error('SFTP 恢复清单与已绑定事务不一致。')
  }
  return prepared
}

async function describePostMutation (sftp, operation, signal) {
  const resources = []
  for (const resource of operation.plan.resources) {
    if (resource.snapshotRequired === false) continue
    resources.push({
      slot: resource.slot,
      descriptor: await describeEntry(
        sftp,
        resource.path,
        createDescriptorBudget(),
        0,
        signal
      )
    })
  }
  const postMutation = {
    schemaVersion: 1,
    digestAlgorithm,
    resources
  }
  if (new TextEncoder().encode(JSON.stringify(postMutation)).byteLength > maxManifestBytes) {
    throw new Error('SFTP 修改后状态清单超过安全上限，已拒绝生成可回滚记录。')
  }
  return postMutation
}

function requirePostMutationDescriptors (operation) {
  const postMutation = operation.artifacts?.postMutation
  if (!postMutation) return null
  if (postMutation.schemaVersion !== 1 ||
    postMutation.digestAlgorithm !== digestAlgorithm ||
    !Array.isArray(postMutation.resources)) {
    throw new Error('SFTP 修改后状态清单无效，已拒绝回滚。')
  }
  const descriptors = new Map()
  for (const item of postMutation.resources) {
    if (!item?.slot || descriptors.has(item.slot) || !item.descriptor) {
      throw new Error('SFTP 修改后状态清单存在重复或缺失项，已拒绝回滚。')
    }
    descriptors.set(item.slot, item.descriptor)
  }
  for (const resource of operation.plan.resources) {
    if (resource.snapshotRequired !== false && !descriptors.has(resource.slot)) {
      throw new Error('SFTP 修改后状态清单不完整，已拒绝回滚。')
    }
  }
  return descriptors
}

async function assertPostMutationUnchanged (sftp, operation, signal) {
  const descriptors = requirePostMutationDescriptors(operation)
  if (!descriptors) return
  const current = []
  for (const resource of operation.plan.resources) {
    if (resource.snapshotRequired === false) continue
    current.push({
      resource,
      descriptor: await describeEntry(
        sftp,
        resource.path,
        createDescriptorBudget(),
        0,
        signal
      )
    })
  }
  for (const item of current) {
    const expected = descriptors.get(item.resource.slot)
    if (!sameDescriptor(item.descriptor, expected) &&
      !sameDescriptor(item.descriptor, item.resource.original)) {
      throw new Error('SFTP 目标在操作完成后发生外部变化，已拒绝回滚。')
    }
  }
}

async function assertOriginalState (
  sftp,
  resource,
  action,
  signal,
  byteProgress
) {
  const current = action === 'chmod'
    ? await describeModeEntry(sftp, resource.path, signal)
    : await describeEntry(
      sftp,
      resource.path,
      createDescriptorBudget(),
      0,
      signal,
      byteProgress
    )
  if (!sameDescriptor(current, resource.original)) {
    throw new Error('SFTP 资源在确认前已发生变化，未执行修改。')
  }
}

async function verifyExecuteState (sftp, operation, signal) {
  const action = operation.effect.action
  const resources = operation.plan.resources
  if (action === 'upload') {
    const target = await describeEntry(
      sftp,
      resources[0].path,
      createDescriptorBudget(),
      0,
      signal
    )
    const sourceDescriptor = operation.effect.expected?.sourceDescriptor
    const descriptorMatches = sourceDescriptor
      ? sameCopiedDescriptor(target, sourceDescriptor)
      : matchesExpected(target, operation.effect.expected)
    if (!descriptorMatches) {
      throw new Error('SFTP 上传后的远程目标校验失败。')
    }
    return
  }
  if (action === 'copy') {
    const source = await describeEntry(
      sftp,
      resources[0].path,
      createDescriptorBudget(),
      0,
      signal
    )
    const target = await describeEntry(
      sftp,
      resources[1].path,
      createDescriptorBudget(),
      0,
      signal
    )
    if (!sameDescriptor(source, resources[0].original) ||
      !sameCopiedDescriptor(target, resources[0].original)) {
      throw new Error('SFTP 复制后的源或目标校验失败。')
    }
    return
  }
  if (action === 'move') {
    const source = await describeEntry(
      sftp,
      resources[0].path,
      createDescriptorBudget(),
      0,
      signal
    )
    const target = await describeEntry(
      sftp,
      resources[1].path,
      createDescriptorBudget(),
      0,
      signal
    )
    if (source.absent !== true ||
      !sameDescriptor(target, resources[0].original)) {
      throw new Error('SFTP 移动后的源或目标校验失败。')
    }
    return
  }
  if (action === 'editor-save') {
    const current = await describeEntry(
      sftp,
      resources[0].path,
      createDescriptorBudget(),
      0,
      signal
    )
    const mode = operation.effect.requestedMode ??
      (resources[0].original.absent ? undefined : resources[0].original.mode)
    const ownership = resources[0].original.absent
      ? {}
      : {
          uid: resources[0].original.uid,
          gid: resources[0].original.gid
        }
    const expected = {
      ...operation.effect.expected,
      type: 'file',
      ...ownership,
      ...(mode === undefined
        ? {}
        : { mode })
    }
    if (!matchesExpected(current, expected)) {
      throw new Error('SFTP 编辑器保存后的大小、摘要或权限验证失败。')
    }
    return
  }
  if (action === 'chmod') {
    const current = await describeModeEntry(sftp, resources[0].path, signal)
    if (current.absent || current.type !== resources[0].original.type ||
      current.mode !== operation.effect.requestedMode ||
      current.uid !== resources[0].original.uid ||
      current.gid !== resources[0].original.gid) {
      throw new Error('SFTP chmod 后的权限验证失败。')
    }
    return
  }
  if (action === 'rename') {
    const source = await describeEntry(sftp, resources[0].path, createDescriptorBudget(), 0, signal)
    const target = await describeEntry(sftp, resources[1].path, createDescriptorBudget(), 0, signal)
    if (source.absent !== true || !sameDescriptor(target, resources[0].original)) {
      throw new Error('SFTP 重命名后的源/目标验证失败。')
    }
    return
  }
  const source = await describeEntry(sftp, resources[0].path, createDescriptorBudget(), 0, signal)
  if (source.absent !== true) throw new Error('SFTP 删除后的路径仍然存在。')
}

async function restoreFromSnapshot (
  sftp,
  resource,
  postExpected,
  allowInterruptedSwap = false,
  signal
) {
  const current = await describeEntry(sftp, resource.path, createDescriptorBudget(), 0, signal)
  if (sameDescriptor(current, resource.original)) return
  const displaced = await describeEntry(
    sftp,
    resource.displacedPath,
    createDescriptorBudget(),
    0,
    signal
  )
  if (current.absent === true) {
    if (postExpected?.absent !== true && displaced.absent === true) {
      const previous = await describeEntry(
        sftp,
        resource.executionPreviousPath,
        createDescriptorBudget(),
        0,
        signal
      )
      if (!allowInterruptedSwap || !sameDescriptor(previous, resource.original)) {
        throw new Error('SFTP 当前目标出现外部变化，已拒绝覆盖。')
      }
    }
  } else if (!matchesExpected(current, postExpected)) {
    throw new Error('SFTP 当前目标出现外部变化，已拒绝覆盖。')
  }

  await verifySnapshot(sftp, resource, signal)
  let restoreTemp = await describeEntry(
    sftp,
    resource.restoreTempPath,
    createDescriptorBudget(),
    0,
    signal
  )
  if (restoreTemp.absent === true) {
    if (typeof sftp.copyEntry !== 'function') {
      throw new Error('当前 SFTP 连接不支持纯 SFTP 快照恢复。')
    }
    await sftp.copyEntry(resource.snapshotPath, resource.restoreTempPath, { signal })
    restoreTemp = await describeEntry(
      sftp,
      resource.restoreTempPath,
      createDescriptorBudget(),
      0,
      signal
    )
  }
  if (!sameDescriptor(restoreTemp, resource.original)) {
    throw new Error('SFTP 恢复临时副本验证失败。')
  }

  if (current.absent !== true) {
    if (displaced.absent !== true) {
      throw new Error('SFTP displaced 路径已有内容，已拒绝覆盖。')
    }
    throwIfAborted(signal)
    await sftp.rename(resource.path, resource.displacedPath)
    throwIfAborted(signal)
  }
  if ((await describeEntry(
    sftp,
    resource.path,
    createDescriptorBudget(),
    0,
    signal
  )).absent === true) {
    await sftp.rename(resource.restoreTempPath, resource.path)
    throwIfAborted(signal)
  }
}

async function restoreAbsent (sftp, resource, postExpected, signal) {
  const current = await describeEntry(sftp, resource.path, createDescriptorBudget(), 0, signal)
  if (current.absent === true) return
  if (!matchesExpected(current, postExpected)) {
    throw new Error('SFTP 当前目标出现外部变化，已拒绝覆盖。')
  }
  const displaced = await describeEntry(
    sftp,
    resource.displacedPath,
    createDescriptorBudget(),
    0,
    signal
  )
  if (displaced.absent !== true) {
    throw new Error('SFTP displaced 路径已有内容，已拒绝覆盖。')
  }
  throwIfAborted(signal)
  await sftp.rename(resource.path, resource.displacedPath)
  throwIfAborted(signal)
}

function postExpectedFor (operation, resource) {
  if (operation.effect.action === 'upload') {
    return operation.effect.expected
  }
  if (operation.effect.action === 'copy') {
    return resource.slot === 'source'
      ? resource.original
      : operation.effect.expected
  }
  if (operation.effect.action === 'move') {
    return resource.slot === 'source'
      ? { absent: true }
      : operation.plan.resources[0].original
  }
  if (operation.effect.action === 'editor-save') {
    const mode = operation.effect.requestedMode ??
      (resource.original.absent ? undefined : resource.original.mode)
    return {
      ...operation.effect.expected,
      type: 'file',
      ...(resource.original.absent
        ? {}
        : { uid: resource.original.uid, gid: resource.original.gid }),
      ...(mode === undefined
        ? {}
        : { mode })
    }
  }
  if (operation.effect.action === 'chmod') {
    return {
      type: resource.original.type,
      mode: operation.effect.requestedMode,
      uid: resource.original.uid,
      gid: resource.original.gid
    }
  }
  if (operation.effect.action === 'rename') {
    return resource.slot === 'source'
      ? { absent: true }
      : operation.plan.resources[0].original
  }
  return { absent: true }
}

export function createSftpTransactionAdapter ({
  getSftp,
  onProgress,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (typeof getSftp !== 'function') {
    throw new Error('SFTP 安全事务缺少连接解析器。')
  }

  const reportProgress = (operation, progress) => {
    if (operation.effect.action !== 'delete' ||
      typeof onProgress !== 'function') return
    try {
      onProgress(operation, progress)
    } catch {}
  }

  const preparedProofs = new Map()

  function cloneProofValue (value) {
    return JSON.parse(JSON.stringify(value))
  }

  function proofPayload (operation) {
    return {
      operationId: operation.id,
      effectKey: operation.effectKey,
      endpointKey: operation.endpointKey,
      recoveryBinding: operation.recoveryBinding || null,
      resources: operation.plan.resources.map(resource => ({
        path: resource.path,
        snapshotPath: resource.snapshotPath,
        original: resource.original
      }))
    }
  }

  function rememberPreparedProof (operation, prepared) {
    if (operation.effect.action !== 'delete') return
    preparedProofs.set(operation.id, {
      operationId: operation.id,
      effectKey: operation.effectKey,
      endpointKey: operation.endpointKey,
      recoveryBinding: null,
      resources: cloneProofValue(prepared.plan.resources.map(resource => ({
        path: resource.path,
        snapshotPath: resource.snapshotPath,
        original: resource.original
      })))
    })
  }

  function consumePreparedProof (operation) {
    const proof = preparedProofs.get(operation.id)
    preparedProofs.delete(operation.id)
    if (!proof || !sameDescriptor(proof, proofPayload(operation))) {
      throw new Error('SFTP 准备证明与当前执行事务不匹配。')
    }
    return proof
  }

  function requireExecutionProof (operation, executeResult) {
    const proof = executeResult?.snapshotProof
    if (!proof || proof.operationId !== operation.id ||
      proof.effectKey !== operation.effectKey ||
      proof.endpointKey !== operation.endpointKey ||
      !sameDescriptor(proof.recoveryBinding, operation.recoveryBinding) ||
      !Array.isArray(proof.resources) ||
      proof.resources.length !== operation.plan.resources.length) {
      throw new Error('SFTP 执行证明与当前事务不匹配。')
    }
    const seenPaths = new Set()
    for (const resource of operation.plan.resources) {
      const item = proof.resources.find(value => value.path === resource.path)
      if (!item || seenPaths.has(item.path) ||
        item.snapshotPath !== resource.snapshotPath ||
        !sameDescriptor(item.descriptor, resource.original)) {
        throw new Error('SFTP 执行证明资源不匹配。')
      }
      seenPaths.add(item.path)
    }
    return proof
  }

  async function requireSftp (operation) {
    const sftp = await getSftp(operation)
    if (!sftp) throw new Error('当前 SFTP 连接已断开，未执行远程修改。')
    return sftp
  }

  return {
    bindPreparedProof (operation) {
      const proof = preparedProofs.get(operation.id)
      const expected = proofPayload(operation)
      const comparable = { ...expected, recoveryBinding: null }
      if (!proof || !sameDescriptor(proof, comparable) ||
        !operation.recoveryBinding) {
        preparedProofs.delete(operation.id)
        throw new Error('SFTP 准备证明与恢复绑定不匹配。')
      }
      proof.recoveryBinding = cloneProofValue(operation.recoveryBinding)
      return true
    },

    discardPreparedProof (operationId) {
      preparedProofs.delete(operationId)
    },

    discardAllPreparedProofs () {
      preparedProofs.clear()
    },

    supports (operation) {
      return operation?.operationKind === 'side-effect' &&
        operation?.effect?.adapter === 'sftp' &&
        [
          'editor-save',
          'delete',
          'rename',
          'chmod',
          'upload',
          'copy',
          'move'
        ].includes(operation.effect.action)
    },

    async prepare (operation, context = {}) {
      const prepare = async () => {
        const sftp = await requireSftp(operation)
        const existing = await loadManifest(sftp, operation, context.signal)
        const prepared = existing || await prepareNewManifest(
          sftp,
          operation,
          context.signal,
          {
            onProgress: value => reportProgress(operation, value),
            setTimer,
            clearTimer
          }
        )
        rememberPreparedProof(operation, prepared)
        return prepared
      }
      return operation.effect.action === 'editor-save'
        ? runEditorStage('snapshot', prepare)
        : prepare()
    },

    async validatePrepared (operation, context = {}) {
      const sftp = await requireSftp(operation)
      await requireManifest(sftp, operation, context.signal)
      for (const resource of operation.plan.resources) {
        await assertOriginalState(
          sftp,
          resource,
          operation.effect.action,
          context.signal
        )
      }
      return { verified: true }
    },

    async beforeExecute (operation, context = {}) {
      const action = operation.effect.action
      const sftp = action === 'editor-save'
        ? await runEditorStage('transaction', () => requireSftp(operation))
        : await requireSftp(operation)
      const { signal } = context
      const verifiedSnapshots = []
      if (action === 'delete') {
        if (operation.recoveryBinding) consumePreparedProof(operation)
        await requireManifest(sftp, operation, signal, {
          verifySnapshots: false
        })
        const knownDeleteBytes = operation.plan.resources.every(resource => (
          resource.original.type === 'file'
        ))
          ? operation.plan.resources.reduce((sum, resource) => (
            sum + resource.original.size * 2
          ), 0)
          : null
        const deleteProgress = createByteProgress(
          value => reportProgress(operation, value),
          'deleting',
          knownDeleteBytes
        )
        for (const resource of operation.plan.resources) {
          const [snapshotCheck, sourceCheck] = await Promise.allSettled([
            verifySnapshot(
              sftp,
              resource,
              signal,
              deleteProgress
            ),
            assertOriginalState(
              sftp,
              resource,
              action,
              signal,
              deleteProgress
            )
          ])
          if (snapshotCheck.status === 'rejected') throw snapshotCheck.reason
          if (sourceCheck.status === 'rejected') throw sourceCheck.reason
          verifiedSnapshots.push({
            resource,
            descriptor: snapshotCheck.value
          })
        }
        deleteProgress.finish()
      } else {
        const validateSnapshot = async () => {
          await requireManifest(sftp, operation, signal)
          for (const resource of operation.plan.resources) {
            await assertOriginalState(sftp, resource, action, signal)
          }
        }
        if (action === 'editor-save') {
          await runEditorStage('snapshot', validateSnapshot)
        } else {
          await validateSnapshot()
        }
      }
      if (['upload', 'copy', 'move'].includes(action)) {
        throw new Error('SFTP 文件传输必须由原有 transfer transport 执行。')
      }
      if (action === 'editor-save') {
        const text = context.input?.text
        if (typeof text !== 'string') {
          throw new Error('SFTP 编辑器保存缺少待写入文本。')
        }
        const expected = await digestSftpText(text)
        if (!matchesExpected(expected, operation.effect.expected)) {
          throw new Error('SFTP 编辑器文本与已确认摘要不一致。')
        }
        const resource = operation.plan.resources[0]
        const mode = operation.effect.requestedMode ??
          (resource.original.absent ? undefined : resource.original.mode)
        const stagingOccupied = await runEditorStage('staging', async () => (
          await lstatOrAbsent(sftp, resource.executionPath, signal) ||
          await lstatOrAbsent(sftp, resource.executionPreviousPath, signal)
        ))
        if (stagingOccupied) {
          throw new Error('SFTP 编辑器事务置换路径已被占用，未修改目标文件。')
        }
        await runEditorStage('staging', () => runProtectedMutation(
          context,
          () => sftp.writeFile(resource.executionPath, text, mode)
        ))
        if (resource.original.absent !== true) {
          let stagedStat = await runEditorStage(
            'metadata',
            () => sftp.lstat(resource.executionPath)
          )
          const ownershipMismatch = stagedStat.uid !== resource.original.uid ||
            stagedStat.gid !== resource.original.gid
          if (ownershipMismatch) {
            if (typeof sftp.chown !== 'function') {
              throw markSftpEditorStage(
                'metadata',
                new Error('当前 SFTP 连接不支持 chown，未修改目标文件。')
              )
            }
            await runEditorStage('metadata', () => runProtectedMutation(
              context,
              () => sftp.chown(
                resource.executionPath,
                resource.original.uid,
                resource.original.gid
              )
            ))
            stagedStat = await runEditorStage(
              'metadata',
              () => sftp.lstat(resource.executionPath)
            )
          }
          if (mode !== undefined && safeMode(stagedStat) !== mode) {
            await runEditorStage('metadata', () => runProtectedMutation(
              context,
              () => sftp.chmod(resource.executionPath, mode)
            ))
          }
        }
        const staged = await runEditorStage('staging', () => describeEntry(
          sftp,
          resource.executionPath,
          createDescriptorBudget(),
          0,
          signal
        ))
        if (!matchesExpected(staged, {
          ...operation.effect.expected,
          type: 'file',
          ...(resource.original.absent
            ? {}
            : { uid: resource.original.uid, gid: resource.original.gid }),
          ...(mode === undefined ? {} : { mode })
        })) {
          throw new Error('SFTP 编辑器暂存文件验证失败，未修改目标文件。')
        }
        await runEditorStage(
          'replace',
          () => assertOriginalState(sftp, resource, action, signal)
        )
        if (resource.original.absent !== true) {
          await runEditorStage('replace', () => runProtectedMutation(
            context,
            () => sftp.rename(resource.path, resource.executionPreviousPath)
          ))
        }
        await runEditorStage('replace', () => runProtectedMutation(
          context,
          () => sftp.rename(resource.executionPath, resource.path)
        ))
      } else if (action === 'chmod') {
        await runProtectedMutation(
          context,
          () => sftp.chmod(
            operation.plan.resources[0].path,
            operation.effect.requestedMode
          )
        )
      } else if (action === 'rename') {
        await runProtectedMutation(
          context,
          () => sftp.rename(
            operation.plan.resources[0].path,
            operation.plan.resources[1].path
          )
        )
      } else {
        const resource = operation.plan.resources[0]
        if (typeof sftp.removeEntry !== 'function') {
          throw new Error('当前 SFTP 连接不支持纯 SFTP 删除。')
        }
        if (await lstatOrAbsent(sftp, resource.executionPath, signal)) {
          throw new Error('SFTP 删除事务执行路径已被占用，未修改源资源。')
        }
        throwIfAborted(signal)
        await runProtectedMutation(
          context,
          () => sftp.rename(resource.path, resource.executionPath)
        )
        await runProtectedMutation(
          context,
          () => sftp.removeEntry(resource.executionPath, { signal }),
          { commitPoint: false }
        )
      }
      return {
        summary: `SFTP ${action} 已执行，等待验证。`,
        ...(action === 'delete'
          ? {
              snapshotProof: {
                ...proofPayload(operation),
                resources: verifiedSnapshots.map(({ resource, descriptor }) => ({
                  path: resource.path,
                  snapshotPath: resource.snapshotPath,
                  descriptor
                }))
              }
            }
          : {})
      }
    },

    async beforeExternalExecute (operation, context = {}) {
      if (!['upload', 'copy', 'move'].includes(operation.effect.action)) {
        throw new Error('该 SFTP 操作不支持外部传输生命周期。')
      }
      const sftp = await requireSftp(operation)
      const { signal } = context
      await requireManifest(sftp, operation, signal)
      for (const resource of operation.plan.resources) {
        await assertOriginalState(sftp, resource, operation.effect.action, signal)
      }
      return {
        verified: true,
        summary: 'SFTP 传输开始前的源与目标状态校验通过。'
      }
    },

    async verifyExecute (operation, context = {}) {
      const sftp = await requireSftp(operation)
      if (operation.effect.action === 'delete' && context.executeResult) {
        const proof = requireExecutionProof(operation, context.executeResult)
        await requireManifest(sftp, operation, context.signal, {
          verifySnapshots: false
        })
        reportProgress(operation, {
          phase: 'result-verify',
          completedBytes: 0,
          totalBytes: null
        })
        await verifyExecuteState(sftp, operation, context.signal)
        for (const item of proof.resources) {
          const resource = operation.plan.resources.find(value => (
            value.path === item.path
          ))
          await verifySnapshotMetadata(
            sftp,
            resource,
            item.descriptor,
            context.signal
          )
        }
        reportProgress(operation, {
          phase: 'result-verify',
          completedBytes: 1,
          totalBytes: null
        })
      } else {
        await requireManifest(sftp, operation, context.signal)
        await verifyExecuteState(sftp, operation, context.signal)
      }
      const postMutation = await describePostMutation(
        sftp,
        operation,
        context.signal
      )
      return {
        verified: true,
        postMutation,
        summary: 'SFTP 修改后状态验证通过。'
      }
    },

    async rollback (operation, context = {}) {
      const sftp = await requireSftp(operation)
      const { signal } = context
      await requireManifest(sftp, operation, signal)
      await assertPostMutationUnchanged(sftp, operation, signal)
      if (operation.effect.action === 'chmod') {
        const resource = operation.plan.resources[0]
        const current = await describeModeEntry(sftp, resource.path, signal)
        if (sameDescriptor(current, resource.original)) {
          return { summary: 'SFTP 权限已处于原始状态。' }
        }
        if (!matchesExpected(current, postExpectedFor(operation, resource))) {
          throw new Error('SFTP 权限出现外部变化，已拒绝回滚。')
        }
        throwIfAborted(signal)
        await sftp.chmod(resource.path, resource.original.mode)
        throwIfAborted(signal)
        return { summary: 'SFTP 原始权限已恢复。' }
      }
      for (const resource of operation.plan.resources) {
        if (resource.snapshotRequired === false) {
          const current = await describeEntry(
            sftp,
            resource.path,
            createDescriptorBudget(),
            0,
            signal
          )
          if (!sameDescriptor(current, resource.original)) {
            throw new Error('SFTP 非修改源在回滚前已发生变化，已拒绝错误恢复。')
          }
          continue
        }
        const expected = postExpectedFor(operation, resource)
        if (resource.original.absent === true) {
          await restoreAbsent(sftp, resource, expected, signal)
        } else {
          await restoreFromSnapshot(
            sftp,
            resource,
            expected,
            Boolean(operation.failedAt),
            signal
          )
        }
      }
      return { summary: 'SFTP 快照已恢复，快照本身保持不变。' }
    },

    async verifyRollback (operation, context = {}) {
      const sftp = await requireSftp(operation)
      const { signal } = context
      await requireManifest(sftp, operation, signal)
      for (const resource of operation.plan.resources) {
        const current = operation.effect.action === 'chmod'
          ? await describeModeEntry(sftp, resource.path, signal)
          : await describeEntry(
            sftp,
            resource.path,
            createDescriptorBudget(),
            0,
            signal
          )
        if (!sameDescriptor(current, resource.original)) {
          throw new Error('SFTP 回滚后的资源验证失败，可保留快照后重试。')
        }
      }
      return { verified: true, summary: 'SFTP 回滚状态验证通过。' }
    }
  }
}

export { digestRemoteFile }
