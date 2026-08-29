import {
  createPrivilegedFileProtocol,
  createPrivilegedFileRequest
} from './privileged-file-protocol.js'
import { createPrivilegedStagingSession } from './privileged-file-staging.js'
import { createStreamingSha256 } from './streaming-sha256.js'

const readChunkBytes = 64 * 1024
const maxReadFileBytes = 8 * 1024 * 1024
const directoryRemovalDigest = '0'.repeat(64)
const copyLimits = Object.freeze({
  maxDepth: 128,
  maxNodes: 10000,
  maxTotalBytes: 8 * 1024 * 1024 * 1024
})

const fileTypeChars = Object.freeze({
  file: '-',
  directory: 'd',
  symlink: 'l'
})
function canonicalFilePath (value, label = 'path') {
  const path = String(value ?? '')
  if (path === '/') return path
  if (!path.startsWith('/') || path.includes('\u0000') ||
    (path.length > 1 && path.endsWith('/')) ||
    path.slice(1).split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`root 文件后端 ${label} 必须为规范绝对路径`)
  }
  return path
}

function bytesFromBase64 (value) {
  const text = String(value ?? '')
  if (text.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error('root 文件后端 SFTP Base64 无效')
  }
  const binary = atob(text)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

function bytesToBase64 (bytes) {
  let binary = ''
  const chunkSize = 32 * 1024
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
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

async function sha256Hex (bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function inputBytes (value, maxBytes) {
  const failOversize = () => {
    throw new Error('root 文件后端 writeFile 超过 8 MiB 安全上限')
  }
  if (value instanceof Uint8Array) {
    if (value.byteLength > maxBytes) failOversize()
    return new Uint8Array(value)
  }
  if (value instanceof ArrayBuffer) {
    if (value.byteLength > maxBytes) failOversize()
    return new Uint8Array(value.slice(0))
  }
  const text = String(value ?? '')
  if (text.length > maxBytes) failOversize()
  let encodedLength = 0
  for (let index = 0; index < text.length; index += 1) {
    const first = text.charCodeAt(index)
    if (first <= 0x7F) encodedLength += 1
    else if (first <= 0x7FF) encodedLength += 2
    else if (first >= 0xD800 && first <= 0xDBFF && index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xDC00 &&
      text.charCodeAt(index + 1) <= 0xDFFF) {
      encodedLength += 4
      index += 1
    } else encodedLength += 3
    if (encodedLength > maxBytes) failOversize()
  }
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength !== encodedLength || bytes.byteLength > maxBytes) {
    failOversize()
  }
  return bytes
}

function normalizeMode (value, fallback = 0o600) {
  let mode
  if (value === undefined || value === null) mode = fallback
  else if (typeof value === 'string') {
    if (!/^[0-7]{1,4}$/.test(value)) {
      throw new Error('root 文件后端 mode 无效')
    }
    mode = Number.parseInt(value, 8)
  } else {
    mode = value
  }
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777) {
    throw new Error('root 文件后端 mode 无效')
  }
  return mode
}

function normalizeLocalTransferUploadMode (value, fallback = 0o600) {
  if (value === undefined || value === null || typeof value !== 'number') {
    return normalizeMode(value, fallback)
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > 0o177777) {
    throw new Error('root 文件后端 mode 无效')
  }
  if (value <= 0o7777) return value
  const type = value & 0o170000
  if (type !== 0o100000 && type !== 0o040000) {
    throw new Error('root 文件后端 mode 无效')
  }
  return value & 0o7777
}

function normalizeCancellableOptions (value) {
  if (value === undefined) return Object.freeze({ signal: undefined })
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some(key => key !== 'signal')) {
    throw new Error('root 文件后端 options 无效')
  }
  const signal = value.signal
  if (signal !== undefined &&
    (!signal || typeof signal !== 'object' ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function')) {
    throw new Error('root 文件后端 signal 必须为 AbortSignal')
  }
  return Object.freeze({ signal })
}

function normalizeRecoveryDescribeOptions (value) {
  if (value === undefined) {
    return Object.freeze({ signal: undefined, allowAbsent: false })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some(key => !['signal', 'allowAbsent'].includes(key)) ||
    (value.allowAbsent !== undefined && typeof value.allowAbsent !== 'boolean')) {
    throw new Error('root 文件后端恢复证明 options 无效')
  }
  const { signal } = normalizeCancellableOptions(
    Object.hasOwn(value, 'signal') ? { signal: value.signal } : undefined
  )
  return Object.freeze({ signal, allowAbsent: value.allowAbsent === true })
}

function normalizeRecoveryCopyOptions (value, targetPath) {
  if (value === undefined) {
    return Object.freeze({
      signal: undefined,
      expectedSource: undefined,
      expectedTarget: undefined
    })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some(key => ![
      'signal', 'expectedSource', 'expectedTarget'
    ].includes(key))) {
    throw new Error('root 文件后端 copy options 无效')
  }
  const { signal } = normalizeCancellableOptions(
    Object.hasOwn(value, 'signal') ? { signal: value.signal } : undefined
  )
  const hasExpectedSource = Object.hasOwn(value, 'expectedSource')
  const hasExpectedTarget = Object.hasOwn(value, 'expectedTarget')
  if (hasExpectedSource !== hasExpectedTarget) {
    throw new Error('root 文件后端 copy 恢复证明必须同时绑定源和目标')
  }
  return Object.freeze({
    signal,
    expectedSource: hasExpectedSource
      ? normalizeRecoveryDescriptor(value.expectedSource, 'copy source')
      : undefined,
    expectedTarget: hasExpectedTarget
      ? normalizeBoundAbsentDescriptor(
        value.expectedTarget,
        targetPath,
        'copy target'
      )
      : undefined
  })
}

function normalizeRecoveryRemoveOptions (value) {
  if (value === undefined) {
    return Object.freeze({
      signal: undefined,
      expectedSource: undefined,
      expectedPeer: undefined
    })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some(key => ![
      'signal', 'expectedSource', 'expectedPeer'
    ].includes(key))) {
    throw new Error('root 文件后端 remove options 无效')
  }
  const { signal } = normalizeCancellableOptions(
    Object.hasOwn(value, 'signal') ? { signal: value.signal } : undefined
  )
  let expectedPeer
  if (Object.hasOwn(value, 'expectedPeer')) {
    const peer = value.expectedPeer
    if (!peer || typeof peer !== 'object' || Array.isArray(peer) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(peer)) ||
      Object.keys(peer).length !== 2 ||
      !Object.hasOwn(peer, 'path') ||
      !Object.hasOwn(peer, 'descriptor')) {
      throw new Error('root 文件后端 remove peer 恢复证明无效')
    }
    expectedPeer = Object.freeze({
      path: canonicalFilePath(peer.path, 'remove peer'),
      descriptor: normalizeRecoveryDescriptor(
        peer.descriptor,
        'remove peer'
      )
    })
  }
  return Object.freeze({
    signal,
    expectedSource: Object.hasOwn(value, 'expectedSource')
      ? normalizeRecoveryDescriptor(value.expectedSource, 'remove source')
      : undefined,
    expectedPeer
  })
}

function throwIfAborted (signal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('root 文件操作已取消')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  throw error
}

function childFilePath (parent, name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' ||
    name.includes('/') || name.includes('\u0000')) {
    throw new Error('root 文件后端目录项名称无效')
  }
  return canonicalFilePath(parent === '/' ? `/${name}` : `${parent}/${name}`)
}

function isSameOrChildPath (candidate, parent) {
  return candidate === parent || (parent === '/'
    ? candidate.startsWith('/')
    : candidate.startsWith(`${parent}/`))
}

function parentFilePath (value) {
  const index = value.lastIndexOf('/')
  return index <= 0 ? '/' : value.slice(0, index)
}

const recoveryDescriptorFields = Object.freeze([
  'type', 'device', 'inode', 'size', 'mode', 'uid', 'gid', 'sha256'
])

function normalizeRecoveryDescriptor (value, label = 'recovery source') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).length !== recoveryDescriptorFields.length ||
    recoveryDescriptorFields.some(key => !Object.hasOwn(value, key)) ||
    !['file', 'directory'].includes(value.type) ||
    !/^(?:0|[1-9]\d{0,19})$/.test(String(value.device ?? '')) ||
    !/^(?:0|[1-9]\d{0,19})$/.test(String(value.inode ?? '')) ||
    !Number.isSafeInteger(value.size) || value.size < 0 ||
    !Number.isInteger(value.mode) || value.mode < 0 || value.mode > 0o7777 ||
    !Number.isSafeInteger(value.uid) || !Number.isSafeInteger(value.gid) ||
    !/^[a-f0-9]{64}$/.test(String(value.sha256 || ''))) {
    throw new Error(`root 文件后端 ${label} 恢复证明无效`)
  }
  return Object.freeze(Object.fromEntries(recoveryDescriptorFields.map(key => [
    key,
    ['device', 'inode'].includes(key) ? String(value[key]) : value[key]
  ])))
}

function normalizeBoundAbsentDescriptor (value, path, label = 'recovery target') {
  const remotePath = canonicalFilePath(path)
  const parentPath = parentFilePath(remotePath)
  const basename = remotePath.slice(remotePath.lastIndexOf('/') + 1)
  const parent = value?.parent
  const outerKeys = ['type', 'path', 'basename', 'mustBeAbsent', 'parent']
  const parentKeys = ['path', 'device', 'inode', 'mode', 'uid', 'gid']
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).length !== outerKeys.length ||
    outerKeys.some(key => !Object.hasOwn(value, key)) ||
    value.type !== 'bound-absent' || value.path !== remotePath ||
    value.basename !== basename || value.mustBeAbsent !== true ||
    !parent || typeof parent !== 'object' || Array.isArray(parent) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(parent)) ||
    Object.keys(parent).length !== parentKeys.length ||
    parentKeys.some(key => !Object.hasOwn(parent, key)) ||
    parent.path !== parentPath ||
    !/^(?:0|[1-9]\d{0,19})$/.test(String(parent.device ?? '')) ||
    !/^(?:0|[1-9]\d{0,19})$/.test(String(parent.inode ?? '')) ||
    !Number.isInteger(parent.mode) || parent.mode < 0 || parent.mode > 0o7777 ||
    !Number.isSafeInteger(parent.uid) || !Number.isSafeInteger(parent.gid)) {
    throw new Error(`root 文件后端 ${label} 缺失证明无效`)
  }
  return Object.freeze({
    type: 'bound-absent',
    path: remotePath,
    basename,
    mustBeAbsent: true,
    parent: Object.freeze({
      path: parentPath,
      device: String(parent.device),
      inode: String(parent.inode),
      mode: parent.mode,
      uid: parent.uid,
      gid: parent.gid
    })
  })
}

function sameRecoveryDescriptor (left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function recoveryParentMatches (metadata, expected) {
  return String(metadata.device) === String(expected.device) &&
    String(metadata.inode) === String(expected.inode) &&
    (metadata.mode & 0o7777) === expected.mode &&
    metadata.uid === expected.uid &&
    metadata.gid === expected.gid
}

function recoveryProofMismatch (message, path, expected, actual, cause) {
  const error = new Error(message)
  error.code = 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH'
  error.path = path
  error.expectedDescriptor = expected
  error.actualDescriptor = actual
  if (cause) error.cause = cause
  return error
}

function requireBoundMetadata (metadata, path, label = 'entry') {
  for (const key of [
    'device', 'inode', 'parentDevice', 'parentInode'
  ]) {
    if (!/^(?:0|[1-9]\d{0,19})$/.test(String(metadata?.[key] ?? ''))) {
      throw new Error(`root 文件后端 ${label} ${key} binding 无效`)
    }
  }
  if (metadata.parentRealPath !== parentFilePath(path)) {
    throw new Error(`root 文件后端 ${label} parent binding 无效`)
  }
  return metadata
}

function sourceBindingArgs (metadata) {
  return {
    sourceParentRealPath: metadata.parentRealPath,
    sourceParentDevice: String(metadata.parentDevice),
    sourceParentInode: String(metadata.parentInode),
    sourceDevice: String(metadata.device),
    sourceInode: String(metadata.inode)
  }
}

function targetParentIdentityArgs (parentPath, metadata) {
  return {
    targetParentRealPath: parentPath,
    targetParentDevice: String(metadata.device),
    targetParentInode: String(metadata.inode)
  }
}

function targetParentBindingArgs (parentPath, metadata) {
  return {
    ...targetParentIdentityArgs(parentPath, metadata),
    targetParentUid: String(metadata.uid),
    targetParentMode: normalizeMode(metadata.mode & 0o7777).toString(8)
  }
}

function sourceParentTrustArgs (metadata) {
  return {
    sourceParentUid: String(metadata.uid),
    sourceParentMode: normalizeMode(metadata.mode & 0o7777).toString(8)
  }
}

function metadataResult (result) {
  const metadata = result?.metadata
  if (!metadata || !Number.isInteger(metadata.mode) ||
    !Number.isSafeInteger(metadata.size) || !Number.isSafeInteger(metadata.uid) ||
    !Number.isSafeInteger(metadata.gid)) {
    throw new Error('root 文件后端元数据结果无效')
  }
  return Object.freeze({
    ...metadata,
    isDirectory: metadata.type === 'directory'
  })
}

function digestResult (result, kind) {
  if (result?.kind !== kind || !/^[a-f0-9]{64}$/.test(result.sha256) ||
    !Number.isSafeInteger(result.size) || result.size < 0) {
    throw new Error('root 文件后端摘要结果无效')
  }
  return result
}

function exclusiveCreateFailure (result, label) {
  if (result === 1) return null
  if (result?.ok !== false || result.claimed !== true ||
    result.code !== 'SFTP_EXCLUSIVE_WRITE_FAILED' ||
    typeof result.message !== 'string' || !result.message) {
    return new Error(`root 文件后端 ${label} exclusive create 结果无效`)
  }
  const error = new Error(result.message)
  error.code = result.code
  error.claimed = true
  error.cleanupSucceeded = result.cleanupSucceeded === true
  if (result.cleanupError) error.cleanupError = new Error(String(result.cleanupError))
  return error
}

function normalizeCreateFailure (value) {
  if (value instanceof Error &&
    (!value.cleanupError || value.cleanupError instanceof Error)) {
    return value
  }
  const error = new Error(String(value?.message || value))
  for (const key of [
    'code', 'claimed', 'cleanupAttempted', 'cleanupSucceeded'
  ]) {
    if (value?.[key] !== undefined) error[key] = value[key]
  }
  if (value?.cleanupError) {
    error.cleanupError = new Error(String(
      value.cleanupError.message || value.cleanupError
    ))
  }
  return error
}

function attachCleanupFailure (error, cleanupError) {
  if (!error.cleanupError) error.cleanupError = cleanupError
  else if (!error.cleanupRetryError) error.cleanupRetryError = cleanupError
  else if (!error.abandonError) error.abandonError = cleanupError
}

function requireIdentity (identity) {
  const uid = String(identity?.effectiveUid ?? identity?.uid ?? '')
  const username = String(identity?.username ?? identity?.effectiveUsername ?? '')
  if (uid !== '0' || !username) {
    throw new Error('root 文件后端需要有效 root 身份 username')
  }
  return { uid, username }
}

function normalizeCapabilities (value) {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('root 文件后端 capabilities 必须为 boolean map')
  }
  const entries = Object.entries(value)
  if (entries.length > 128 || entries.some(([key, enabled]) =>
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) ||
    typeof enabled !== 'boolean')) {
    throw new Error('root 文件后端 capabilities 必须为 boolean map')
  }
  return Object.freeze(Object.fromEntries(entries))
}

export function createNativeSftpFileBackend (sftp) {
  if (!sftp) throw new Error('原生文件后端缺少 SFTP')
  return Object.freeze({
    channel: 'sftp',
    runtimeIdentity: null,
    sftp,
    backend: sftp,
    release: async () => true
  })
}

export async function createPrivilegedFileBackend ({
  sftp,
  lease,
  identity,
  capabilities,
  createToken
} = {}) {
  let closed = false
  let staging
  let releasePromise
  let rootIdentity
  let normalizedCapabilities
  let protocol
  let executeTail = Promise.resolve()
  const activePublicOperations = new Set()
  const canReleaseLease = typeof lease?.release === 'function'

  function queueLeaseExecute (options) {
    const result = executeTail.catch(() => {}).then(() => lease.execute(options))
    executeTail = result.catch(() => {})
    return result
  }

  async function releaseLeaseAfterFailure (error) {
    await executeTail.catch(() => {})
    try {
      const released = await lease.release()
      if (released !== true) throw new Error('root 文件后端 PTY lease 释放失败')
    } catch (releaseError) {
      if (!error.releaseError) error.releaseError = releaseError
    }
  }

  async function executeRequest (operation, args = {}, options = {}) {
    const request = createPrivilegedFileRequest({ operation, args })
    const result = await queueLeaseExecute({
      protocol,
      request,
      ...(options.signal ? { signal: options.signal } : {})
    })
    if (!result || result.exitCode !== 0 || result.kind !== operation || result.ok === false) {
      const error = new Error(`root 文件操作失败：${operation}`)
      error.code = 'PRIVILEGED_FILE_OPERATION_FAILED'
      error.operation = operation
      if (operation === 'stage-import') {
        error.importResult = result
      }
      throw error
    }
    return result
  }

  try {
    if (!sftp) throw new Error('root 文件后端缺少 SFTP')
    if (typeof lease?.execute !== 'function' || !canReleaseLease) {
      throw new Error('root 文件后端缺少 bounded lease 合同')
    }
    rootIdentity = requireIdentity(identity)
    normalizedCapabilities = normalizeCapabilities(capabilities)
    protocol = createPrivilegedFileProtocol()
    staging = await createPrivilegedStagingSession({
      sftp,
      execute: request => queueLeaseExecute({ protocol, request }),
      ...(createToken ? { createToken } : {})
    })
  } catch (error) {
    closed = true
    if (canReleaseLease) await releaseLeaseAfterFailure(error)
    throw error
  }

  const readStreams = new Map()
  const readLocks = new Map()
  const pendingDigestCleanups = new Set()
  const pendingImportCleanups = new Map()

  function withReadLock (path, work) {
    const previous = readLocks.get(path) || Promise.resolve()
    const current = previous.catch(() => {}).then(work)
    readLocks.set(path, current)
    return current.finally(() => {
      if (readLocks.get(path) === current) readLocks.delete(path)
    })
  }

  async function verifyStageBytes (stage, expected) {
    const digest = createStreamingSha256()
    let offset = 0
    let totalBytes
    do {
      staging.assertCurrent()
      const chunk = await sftp.readFileChunk(stage.path, {
        offset,
        maxBytes: readChunkBytes
      })
      staging.assertCurrent()
      if (!chunk || chunk.offset !== offset ||
        !Number.isSafeInteger(chunk.nextOffset) || chunk.nextOffset < offset ||
        !Number.isSafeInteger(chunk.totalBytes) || chunk.totalBytes < 0 ||
        (totalBytes !== undefined && chunk.totalBytes !== totalBytes)) {
        throw new Error('root 文件后端 SFTP stage 分块结果无效')
      }
      totalBytes = chunk.totalBytes
      const bytes = bytesFromBase64(chunk.base64)
      if (bytes.byteLength !== chunk.bytesRead ||
        chunk.nextOffset !== offset + bytes.byteLength ||
        bytes.byteLength > readChunkBytes ||
        chunk.hasMore !== (chunk.nextOffset < chunk.totalBytes) ||
        chunk.nextOffset > chunk.totalBytes ||
        (chunk.hasMore && bytes.byteLength === 0)) {
        throw new Error('root 文件后端 SFTP stage 分块长度无效')
      }
      digest.update(bytes)
      offset = chunk.nextOffset
    } while (offset < totalBytes)
    if (digest.size !== expected.size || digest.digestHex() !== expected.sha256) {
      throw new Error('root 文件后端 SFTP stage 摘要或大小不匹配')
    }
    return true
  }

  async function createReadStream (path, signal, maxTotalSize) {
    const metadata = requireBoundMetadata(
      await rawFacade.lstat(path, { signal }),
      path,
      'read source'
    )
    if (metadata.type !== 'file') {
      throw new Error('root 文件后端 read source 必须为普通文件')
    }
    if (metadata.size > maxTotalSize) {
      throw new Error('root 文件后端 readFile 超过 8 MiB 安全上限')
    }
    return {
      path,
      metadata,
      nextOffset: 0,
      digest: createStreamingSha256()
    }
  }

  async function closeReadStream (stream, primaryError) {
    if (readStreams.get(stream.path) === stream) readStreams.delete(stream.path)
    if (primaryError) throw primaryError
    return true
  }

  async function boundDigest (stream, operation, offset, maxBytes, signal) {
    const scratch = staging.allocate('download')
    pendingDigestCleanups.add(scratch.objectName)
    try {
      const result = digestResult(await executeRequest(operation, {
        ...staging.rootBinding,
        objectName: scratch.objectName,
        path: stream.path,
        ...sourceBindingArgs(stream.metadata),
        expectedSize: String(stream.metadata.size),
        maxSize: String(stream.maxSize ?? stream.metadata.size),
        ...(operation === 'sha256-range-bound'
          ? { offset: String(offset), maxBytes: String(maxBytes) }
          : {})
      }, { signal }), operation)
      pendingDigestCleanups.delete(scratch.objectName)
      staging.abandon(scratch.path)
      return result
    } catch (error) {
      try { staging.abandon(scratch.path) } catch (abandonError) {
        error.cleanupError ||= abandonError
      }
      try {
        staging.assertCurrent()
        await executeRequest('digest-cleanup', {
          ...staging.rootBinding,
          objectName: scratch.objectName
        })
        pendingDigestCleanups.delete(scratch.objectName)
      } catch (cleanupError) {
        error.cleanupError ||= cleanupError
      }
      throw error
    }
  }

  async function readStreamChunk (stream, maxBytes, signal) {
    const stage = staging.allocate('download')
    let hasProof = false
    let primaryError
    let response
    try {
      const proof = digestResult(await executeRequest('stage-export-range', {
        ...staging.rootBinding,
        objectName: stage.objectName,
        sourcePath: stream.path,
        ...sourceBindingArgs(stream.metadata),
        expectedSize: String(stream.metadata.size),
        maxSize: String(stream.metadata.size),
        offset: String(stream.nextOffset),
        maxBytes: String(maxBytes)
      }, { signal }), 'stage-export-range')
      staging.remember(stage.path, {
        sha256: proof.sha256,
        size: String(proof.size)
      })
      hasProof = true
      if (proof.size > maxBytes ||
        proof.size !== Math.min(maxBytes, stream.metadata.size - stream.nextOffset)) {
        throw new Error('root 文件后端 range stage 大小无效')
      }
      staging.assertCurrent()
      const chunk = await sftp.readFileChunk(stage.path, {
        offset: 0,
        maxBytes
      })
      staging.assertCurrent()
      if (!chunk || chunk.offset !== 0 ||
        !Number.isSafeInteger(chunk.nextOffset) ||
        !Number.isSafeInteger(chunk.totalBytes) || chunk.totalBytes < 0 ||
        chunk.totalBytes !== proof.size) {
        throw new Error('root 文件后端 SFTP range stage 分块结果无效')
      }
      const bytes = bytesFromBase64(chunk.base64)
      if (bytes.byteLength !== chunk.bytesRead || bytes.byteLength !== proof.size ||
        chunk.nextOffset !== bytes.byteLength || chunk.hasMore ||
        await sha256Hex(bytes) !== proof.sha256) {
        throw new Error('root 文件后端 SFTP range stage 摘要或大小不匹配')
      }
      const offset = stream.nextOffset
      stream.digest.update(bytes)
      stream.nextOffset += bytes.byteLength
      const hasMore = stream.nextOffset < stream.metadata.size
      if (!hasMore) {
        const whole = await boundDigest(
          stream,
          'sha256-bound',
          0,
          readChunkBytes,
          signal
        )
        if (whole.size !== stream.metadata.size ||
          whole.sha256 !== stream.digest.digestHex()) {
          throw new Error('root 文件后端源文件摘要或大小发生变化')
        }
      }
      response = {
        base64: chunk.base64,
        offset,
        nextOffset: stream.nextOffset,
        bytesRead: bytes.byteLength,
        totalBytes: stream.metadata.size,
        hasMore
      }
    } catch (error) {
      primaryError = error
    }
    if (hasProof) {
      try { await staging.cleanup(stage.path) } catch (cleanupError) {
        if (primaryError) primaryError.cleanupError ||= cleanupError
        else primaryError = cleanupError
      }
    } else {
      try { staging.preserve(stage.path) } catch (preserveError) {
        if (primaryError) primaryError.cleanupError ||= preserveError
        else primaryError = preserveError
      }
    }
    if (primaryError) return closeReadStream(stream, primaryError)
    if (!response.hasMore) await closeReadStream(stream)
    return response
  }

  async function readLogicalChunk (
    path,
    requestedOffset,
    requestedMaxBytes,
    signal,
    maxTotalSize = Number.MAX_SAFE_INTEGER
  ) {
    return withReadLock(path, async () => {
      let stream = readStreams.get(path)
      if (requestedOffset === 0) {
        if (stream) await closeReadStream(stream)
        stream = await createReadStream(path, signal, maxTotalSize)
        readStreams.set(path, stream)
      } else if (!stream || stream.nextOffset !== requestedOffset) {
        if (stream) await closeReadStream(stream)
        throw new Error('root 文件后端 readFileChunk offset 与当前逻辑读取不连续')
      }
      return readStreamChunk(stream, requestedMaxBytes, signal)
    })
  }

  async function invalidateReadStreams (...affectedPaths) {
    const candidates = [...readStreams.keys()].filter(sourcePath =>
      affectedPaths.some(affectedPath =>
        isSameOrChildPath(sourcePath, affectedPath) ||
        isSameOrChildPath(affectedPath, sourcePath)))
    for (const sourcePath of candidates) {
      await withReadLock(sourcePath, async () => {
        const stream = readStreams.get(sourcePath)
        if (stream) await closeReadStream(stream)
      })
    }
  }

  async function lstatOrMissing (path, signal) {
    try {
      return await rawFacade.lstat(path, { signal })
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async function boundMutationEntry (path, label, signal) {
    if (path === '/') {
      throw new Error(`root 文件后端不允许对根目录执行 ${label}`)
    }
    const metadata = requireBoundMetadata(
      await rawFacade.lstat(path, { signal }),
      path,
      label
    )
    const parentPath = parentFilePath(path)
    const parent = requireBoundMetadata(
      await rawFacade.lstat(parentPath, { signal }),
      parentPath,
      `${label} parent`
    )
    if (parent.type !== 'directory' ||
      String(parent.device) !== String(metadata.parentDevice) ||
      String(parent.inode) !== String(metadata.parentInode)) {
      throw new Error(`root 文件后端 ${label} parent binding 发生变化`)
    }
    return { metadata, parent, parentPath }
  }

  async function boundAbsentParent (path, label, signal) {
    if (path === '/') {
      throw new Error(`root 文件后端不允许对根目录执行 ${label}`)
    }
    if (await lstatOrMissing(path, signal)) {
      const error = new Error(`root 文件后端 ${label} target 已存在：${path}`)
      error.code = 'EEXIST'
      throw error
    }
    const parentPath = parentFilePath(path)
    const parent = requireBoundMetadata(
      await rawFacade.lstat(parentPath, { signal }),
      parentPath,
      `${label} parent`
    )
    if (parent.type !== 'directory') {
      throw new Error(`root 文件后端 ${label} parent 不是目录`)
    }
    return { parent, parentPath }
  }

  function boundTargetArgs (path, entry) {
    return {
      targetPath: path,
      ...targetParentBindingArgs(entry.parentPath, entry.parent),
      targetDevice: String(entry.metadata.device),
      targetInode: String(entry.metadata.inode),
      targetType: entry.metadata.type
    }
  }

  function boundRemovalArgs (path, entry, proof) {
    return {
      targetPath: path,
      ...targetParentIdentityArgs(entry.parentPath, entry.parent),
      targetDevice: String(entry.metadata.device),
      targetInode: String(entry.metadata.inode),
      targetType: entry.metadata.type,
      targetMode: normalizeMode(entry.metadata.mode & 0o7777).toString(8),
      targetUid: String(entry.metadata.uid),
      targetGid: String(entry.metadata.gid),
      sha256: proof?.sha256 ?? directoryRemovalDigest,
      size: String(proof?.size ?? 0)
    }
  }

  function peerRemovalArgs (entry) {
    return {
      peerPath: entry.path,
      peerParentRealPath: entry.metadata.parentRealPath,
      peerParentDevice: String(entry.metadata.parentDevice),
      peerParentInode: String(entry.metadata.parentInode),
      peerDevice: String(entry.metadata.device),
      peerInode: String(entry.metadata.inode),
      peerType: entry.metadata.type,
      peerMode: normalizeMode(entry.metadata.mode & 0o7777).toString(8),
      peerUid: String(entry.metadata.uid),
      peerGid: String(entry.metadata.gid),
      peerSha256: entry.proof?.sha256 ?? directoryRemovalDigest,
      peerSize: String(entry.proof?.size ?? 0)
    }
  }

  function removalMetadataMatches (current, expected) {
    const keys = ['device', 'inode', 'type', 'mode', 'uid', 'gid']
    if (current.type === 'file') {
      keys.push('size')
      if (Object.hasOwn(expected, 'mtime')) keys.push('mtime')
    }
    return keys.every(key => current[key] === expected[key])
  }

  async function prepareBoundRemoval (
    path,
    expectedMetadata,
    expectedProof,
    label,
    signal,
    peerEntry
  ) {
    const entry = await boundMutationEntry(path, label, signal)
    const candidates = Array.isArray(expectedMetadata)
      ? expectedMetadata
      : [expectedMetadata]
    if (!candidates.some(expected =>
      removalMetadataMatches(entry.metadata, expected))) {
      throw new Error(`root 文件后端 ${label} metadata 或 binding 发生变化`)
    }
    let proof
    if (entry.metadata.type === 'file') {
      if (entry.metadata.size > copyLimits.maxTotalBytes) {
        throw new Error(`root 文件后端 ${label} 超过 8 GiB 安全预算`)
      }
      proof = await boundDigest({
        path,
        metadata: entry.metadata,
        maxSize: entry.metadata.size
      }, 'sha256-bound', 0, readChunkBytes, signal)
      if (expectedProof && (proof.sha256 !== expectedProof.sha256 ||
        proof.size !== expectedProof.size)) {
        throw new Error(`root 文件后端 ${label} content proof 发生变化`)
      }
    }
    return {
      ...boundRemovalArgs(path, entry, proof),
      ...(peerEntry ? peerRemovalArgs(peerEntry) : {})
    }
  }

  function importTempPath (targetPath, objectName) {
    const parentPath = parentFilePath(targetPath)
    return canonicalFilePath(
      `${parentPath === '/' ? '' : parentPath}/.shellpilot-${objectName}.tmp`,
      'stage-import residual'
    )
  }

  function parentBindingMatches (actual, expected) {
    return String(actual.device) === String(expected.device) &&
      String(actual.inode) === String(expected.inode) &&
      Number(actual.uid) === Number(expected.uid) &&
      normalizeMode(actual.mode & 0o7777) ===
        normalizeMode(expected.mode & 0o7777)
  }

  function normalizeImportTargetClaim (value, record) {
    const keys = [
      'targetPath', 'targetDevice', 'targetInode', 'targetType',
      'targetParentRealPath', 'targetParentDevice', 'targetParentInode',
      'sha256', 'size', 'mode', 'uid', 'gid'
    ]
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key)) ||
      value.targetPath !== record.targetPath ||
      value.targetType !== 'file' ||
      value.targetParentRealPath !== record.parentPath ||
      String(value.targetParentDevice) !== String(record.parent.device) ||
      String(value.targetParentInode) !== String(record.parent.inode) ||
      value.sha256 !== record.proof.sha256 ||
      value.size !== record.proof.size ||
      !/^(?:0|[1-9]\d*)$/.test(String(value.targetDevice)) ||
      !/^(?:0|[1-9]\d*)$/.test(String(value.targetInode)) ||
      ![value.size, value.mode, value.uid, value.gid].every(Number.isSafeInteger) ||
      value.size < 0 || value.mode < 0 || value.mode > 0o7777 ||
      value.uid < 0 || value.gid < 0) {
      throw new Error('root 文件后端 stage-import target claim 无效')
    }
    return Object.freeze({
      targetPath: value.targetPath,
      targetDevice: String(value.targetDevice),
      targetInode: String(value.targetInode),
      targetType: value.targetType,
      targetParentRealPath: value.targetParentRealPath,
      targetParentDevice: String(value.targetParentDevice),
      targetParentInode: String(value.targetParentInode),
      sha256: value.sha256,
      size: value.size,
      mode: value.mode,
      uid: value.uid,
      gid: value.gid
    })
  }

  function normalizeImportTempClaim (value, record) {
    const keys = [
      'tempPath', 'tempDevice', 'tempInode', 'tempType',
      'tempParentRealPath', 'tempParentDevice', 'tempParentInode'
    ]
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key)) ||
      value.tempPath !== record.tempPath ||
      value.tempType !== 'file' ||
      value.tempParentRealPath !== record.parentPath ||
      String(value.tempParentDevice) !== String(record.parent.device) ||
      String(value.tempParentInode) !== String(record.parent.inode) ||
      !/^(?:0|[1-9]\d*)$/.test(String(value.tempDevice)) ||
      !/^(?:0|[1-9]\d*)$/.test(String(value.tempInode))) {
      throw new Error('root 文件后端 stage-import temp claim 无效')
    }
    return Object.freeze({
      tempPath: value.tempPath,
      tempDevice: String(value.tempDevice),
      tempInode: String(value.tempInode),
      tempType: value.tempType,
      tempParentRealPath: value.tempParentRealPath,
      tempParentDevice: String(value.tempParentDevice),
      tempParentInode: String(value.tempParentInode)
    })
  }

  function normalizeImportMovingClaim (value, record) {
    const keys = [
      'tempPath', 'targetPath', 'tempDevice', 'tempInode', 'tempType',
      'tempParentRealPath', 'tempParentDevice', 'tempParentInode',
      'tempParentUid', 'tempParentMode',
      'targetParentRealPath', 'targetParentDevice', 'targetParentInode',
      'targetParentUid', 'targetParentMode',
      'sha256', 'size', 'initialMode', 'initialUid', 'initialGid',
      'targetMode', 'targetUid', 'targetGid'
    ]
    const integers = [
      value?.tempParentUid, value?.tempParentMode,
      value?.targetParentUid, value?.targetParentMode,
      value?.size, value?.initialMode, value?.initialUid, value?.initialGid,
      value?.targetMode, value?.targetUid, value?.targetGid
    ]
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key)) ||
      value.tempPath !== record.tempPath ||
      value.targetPath !== record.targetPath ||
      value.tempType !== 'file' ||
      value.tempParentRealPath !== record.parentPath ||
      value.targetParentRealPath !== record.parentPath ||
      String(value.tempParentDevice) !== String(record.parent.device) ||
      String(value.tempParentInode) !== String(record.parent.inode) ||
      String(value.targetParentDevice) !== String(record.parent.device) ||
      String(value.targetParentInode) !== String(record.parent.inode) ||
      Number(value.tempParentUid) !== Number(record.parent.uid) ||
      Number(value.targetParentUid) !== Number(record.parent.uid) ||
      normalizeMode(value.tempParentMode) !==
        normalizeMode(record.parent.mode & 0o7777) ||
      normalizeMode(value.targetParentMode) !==
        normalizeMode(record.parent.mode & 0o7777) ||
      value.sha256 !== record.proof.sha256 ||
      value.size !== record.proof.size ||
      value.initialMode !== 0 || value.initialUid !== 0 ||
      value.targetMode !== record.targetMetadata.mode ||
      value.targetUid !== record.targetMetadata.uid ||
      value.targetGid !== record.targetMetadata.gid ||
      !/^(?:0|[1-9]\d*)$/.test(String(value.tempDevice)) ||
      !/^(?:0|[1-9]\d*)$/.test(String(value.tempInode)) ||
      !integers.every(Number.isSafeInteger) || integers.some(number => number < 0)) {
      throw new Error('root 文件后端 stage-import moving claim 无效')
    }
    return Object.freeze(Object.fromEntries(keys.map(key => [key, value[key]])))
  }

  function normalizeImportOutcome (value, record) {
    if (!value || typeof value !== 'object' ||
      typeof value.cleanupSucceeded !== 'boolean' ||
      !['none', 'complete', 'temp', 'moving', 'target', 'unknown'].includes(
        value.residualLocation
      )) {
      throw new Error('root 文件后端 stage-import cleanup status unresolved')
    }
    const tempClaim = value.tempClaim
      ? normalizeImportTempClaim(value.tempClaim, record)
      : null
    const targetClaim = value.targetClaim
      ? normalizeImportTargetClaim(value.targetClaim, record)
      : null
    const movingClaim = value.movingClaim
      ? normalizeImportMovingClaim(value.movingClaim, record)
      : null
    if ((value.cleanupSucceeded &&
        !['none', 'complete'].includes(value.residualLocation)) ||
      (!value.cleanupSucceeded &&
        !['temp', 'moving', 'target', 'unknown'].includes(value.residualLocation)) ||
      (value.residualLocation === 'temp' && !tempClaim) ||
      (value.residualLocation === 'moving' && !movingClaim) ||
      (value.residualLocation === 'target' && !targetClaim) ||
      (value.residualLocation === 'complete' && !targetClaim)) {
      throw new Error('root 文件后端 stage-import cleanup status 无效')
    }
    return Object.freeze({
      cleanupSucceeded: value.cleanupSucceeded,
      residualLocation: value.residualLocation,
      tempClaim,
      movingClaim,
      targetClaim
    })
  }

  async function cleanupImportResidual (record, signal) {
    staging.assertCurrent()
    if (record.cleanupSucceeded === true) {
      pendingImportCleanups.delete(record.objectName)
      return true
    }
    const claim = record.residualLocation === 'temp'
      ? record.tempClaim
      : record.residualLocation === 'moving'
        ? record.movingClaim
        : record.residualLocation === 'target'
          ? record.targetClaim
          : null
    if (!claim) {
      throw new Error(
        'root 文件后端 stage-import cleanup status unresolved without exact claim'
      )
    }
    if (record.residualLocation === 'moving') {
      const result = await executeRequest('stage-import-cleanup', {
        ...staging.rootBinding,
        objectName: record.objectName,
        tempPath: claim.tempPath,
        tempParentRealPath: claim.tempParentRealPath,
        tempParentDevice: claim.tempParentDevice,
        tempParentInode: claim.tempParentInode,
        tempParentUid: claim.tempParentUid,
        tempParentMode: claim.tempParentMode.toString(8),
        targetPath: claim.targetPath,
        targetParentRealPath: claim.targetParentRealPath,
        targetParentDevice: claim.targetParentDevice,
        targetParentInode: claim.targetParentInode,
        targetParentUid: claim.targetParentUid,
        targetParentMode: claim.targetParentMode.toString(8),
        targetDevice: claim.tempDevice,
        targetInode: claim.tempInode,
        targetType: claim.tempType,
        sha256: claim.sha256,
        size: String(claim.size),
        maxSize: String(claim.size),
        initialMode: claim.initialMode.toString(8),
        initialUid: claim.initialUid,
        initialGid: claim.initialGid,
        targetMode: claim.targetMode.toString(8),
        targetUid: claim.targetUid,
        targetGid: claim.targetGid
      }, { signal })
      if (result.cleanupSucceeded !== true ||
        result.residualLocation !== 'none') {
        throw new Error(
          'root 文件后端 stage-import cleanup authoritative status 无效'
        )
      }
      pendingImportCleanups.delete(record.objectName)
      return true
    }
    const candidate = record.residualLocation === 'temp'
      ? record.tempPath
      : record.targetPath
    let entry
    try {
      entry = await boundMutationEntry(
        candidate,
        'stage-import residual cleanup',
        signal
      )
    } catch (error) {
      if (error?.code === 'ENOENT') {
        pendingImportCleanups.delete(record.objectName)
        return true
      }
      throw error
    }
    const claimedDevice = ['temp', 'moving'].includes(record.residualLocation)
      ? claim.tempDevice
      : claim.targetDevice
    const claimedInode = ['temp', 'moving'].includes(record.residualLocation)
      ? claim.tempInode
      : claim.targetInode
    const claimedType = ['temp', 'moving'].includes(record.residualLocation)
      ? claim.tempType
      : claim.targetType
    if (entry.metadata.type !== 'file' ||
      entry.metadata.size !== record.proof.size ||
      !parentBindingMatches(entry.parent, record.parent) ||
      String(entry.metadata.device) !== claimedDevice ||
      String(entry.metadata.inode) !== claimedInode ||
      entry.metadata.type !== claimedType) {
      throw new Error('root 文件后端 stage-import exact claim 发生变化')
    }
    if (record.residualLocation === 'target' && (
      normalizeMode(entry.metadata.mode & 0o7777) !== claim.mode ||
      Number(entry.metadata.uid) !== claim.uid ||
      Number(entry.metadata.gid) !== claim.gid)) {
      throw new Error('root 文件后端 stage-import exact target claim 发生变化')
    }
    const proof = await boundDigest({
      path: candidate,
      metadata: entry.metadata,
      maxSize: record.proof.size
    }, 'sha256-bound', 0, readChunkBytes, signal)
    if (proof.sha256 !== record.proof.sha256 ||
      proof.size !== record.proof.size) {
      throw new Error('root 文件后端 stage-import residual 内容证明发生变化')
    }
    await executeRequest('remove-bound',
      boundRemovalArgs(candidate, entry, proof), { signal })
    pendingImportCleanups.delete(record.objectName)
    return true
  }

  async function executeStageImport (stage, targetPath, parent, args, signal) {
    const record = Object.freeze({
      objectName: stage.objectName,
      targetPath,
      tempPath: importTempPath(targetPath, stage.objectName),
      parent: Object.freeze({ ...parent }),
      parentPath: parentFilePath(targetPath),
      proof: Object.freeze({
        sha256: args.sha256,
        size: Number(args.size)
      }),
      targetMetadata: Object.freeze({
        mode: Number.parseInt(args.targetMode, 8),
        uid: Number(args.targetUid),
        gid: Number(args.targetGid)
      }),
      cleanupSucceeded: null,
      residualLocation: 'unknown',
      tempClaim: null,
      movingClaim: null,
      targetClaim: null
    })
    pendingImportCleanups.set(record.objectName, record)
    try {
      const result = await executeRequest('stage-import', args, { signal })
      const outcome = normalizeImportOutcome(result, record)
      if (outcome.cleanupSucceeded !== true ||
        outcome.residualLocation !== 'complete') {
        throw new Error('root 文件后端 stage-import 成功状态无效')
      }
      pendingImportCleanups.delete(record.objectName)
      return result
    } catch (error) {
      let cleanupRecord = record
      if (error?.importResult) {
        try {
          const outcome = normalizeImportOutcome(error.importResult, record)
          cleanupRecord = Object.freeze({
            ...record,
            ...outcome
          })
          pendingImportCleanups.set(record.objectName, cleanupRecord)
          if (outcome.cleanupSucceeded === true) {
            pendingImportCleanups.delete(record.objectName)
            throw error
          }
        } catch (outcomeError) {
          if (outcomeError === error) throw error
          attachCleanupFailure(error, outcomeError)
        }
      }
      try {
        await cleanupImportResidual(cleanupRecord)
      } catch (cleanupError) {
        attachCleanupFailure(error, cleanupError)
      }
      throw error
    }
  }

  async function boundLstat (path, parentMetadata, signal) {
    const result = await executeRequest('lstat-bound', {
      path,
      sourceParentRealPath: parentFilePath(path),
      sourceParentDevice: String(parentMetadata.device),
      sourceParentInode: String(parentMetadata.inode)
    }, { signal })
    if (result.missing === true) {
      const error = new Error(`No such privileged file: ${path}`)
      error.code = 'ENOENT'
      throw error
    }
    return requireBoundMetadata(metadataResult(result), path, 'bound entry')
  }

  async function boundList (path, metadata, signal) {
    const result = await executeRequest('list-bound', {
      path,
      ...sourceBindingArgs(metadata)
    }, { signal })
    if (!Array.isArray(result.entries)) {
      throw new Error('root 文件后端 bound list 结果无效')
    }
    return result.entries
  }

  async function buildTreeManifest (rootPath, signal) {
    if (rootPath === '/') throw new Error('root 文件后端不允许递归操作根目录')
    const manifest = []
    let nodes = 0
    let totalBytes = 0
    async function visit (path, depth, expectedParent) {
      throwIfAborted(signal)
      if (depth > copyLimits.maxDepth) {
        throw new Error('root 文件后端目录深度超过安全预算')
      }
      const metadata = requireBoundMetadata(
        expectedParent
          ? await boundLstat(path, expectedParent, signal)
          : await rawFacade.lstat(path, { signal }),
        path,
        'manifest entry'
      )
      throwIfAborted(signal)
      if (metadata.type !== 'file' && metadata.type !== 'directory') {
        throw new Error('root 文件后端拒绝复制或删除特殊文件类型')
      }
      nodes += 1
      const remainingBytes = copyLimits.maxTotalBytes - totalBytes
      totalBytes += metadata.type === 'file' ? metadata.size : 0
      if (nodes > copyLimits.maxNodes) {
        throw new Error('root 文件后端节点数超过安全预算')
      }
      if (!Number.isSafeInteger(totalBytes) ||
        totalBytes > copyLimits.maxTotalBytes) {
        throw new Error('root 文件后端总字节数超过安全预算')
      }
      const proof = metadata.type === 'file'
        ? await boundDigest({ path, metadata, maxSize: remainingBytes },
          'sha256-bound', 0, readChunkBytes, signal)
        : null
      if (proof && proof.size !== metadata.size) {
        throw new Error('root 文件后端 manifest 文件大小发生变化')
      }
      const entry = { path, depth, metadata, proof, maxSize: remainingBytes }
      manifest.push(entry)
      if (metadata.type === 'directory') {
        const children = await boundList(path, metadata, signal)
        throwIfAborted(signal)
        for (const child of children) {
          await visit(childFilePath(path, child.name), depth + 1, metadata)
        }
      }
    }
    await visit(rootPath, 0)
    return manifest
  }

  async function recoveryDescriptorFromManifest (manifest, rootPath) {
    const root = manifest[0]
    if (!root || root.path !== rootPath) {
      throw new Error('root 文件后端恢复证明缺少根条目')
    }
    const metadata = root.metadata
    const manifestProof = manifest.map(entry => ({
      path: entry.path,
      depth: entry.depth,
      type: entry.metadata.type,
      device: String(entry.metadata.device),
      inode: String(entry.metadata.inode),
      size: entry.metadata.size,
      mode: entry.metadata.mode & 0o7777,
      uid: entry.metadata.uid,
      gid: entry.metadata.gid,
      sha256: entry.proof?.sha256 || ''
    }))
    const sha256 = metadata.type === 'file'
      ? root.proof?.sha256
      : await sha256Hex(new TextEncoder().encode(JSON.stringify(manifestProof)))
    return normalizeRecoveryDescriptor({
      type: metadata.type,
      device: String(metadata.device),
      inode: String(metadata.inode),
      size: metadata.size,
      mode: metadata.mode & 0o7777,
      uid: metadata.uid,
      gid: metadata.gid,
      sha256
    })
  }

  async function recoveryDescriptorFromCreated (
    sourceManifest,
    created,
    sourceRoot,
    targetRoot
  ) {
    if (created.length !== sourceManifest.length) {
      throw new Error('root 文件后端 copy 完成证明条目数不匹配')
    }
    const createdManifest = created.map((createdEntry, index) => {
      const sourceEntry = sourceManifest[index]
      const expectedPath = targetForManifestEntry(
        sourceEntry,
        sourceRoot,
        targetRoot
      )
      if (createdEntry.path !== expectedPath) {
        throw new Error('root 文件后端 copy 完成证明路径不匹配')
      }
      return {
        path: expectedPath,
        depth: sourceEntry.depth,
        metadata: {
          ...sourceEntry.metadata,
          device: String(createdEntry.binding.device),
          inode: String(createdEntry.binding.inode),
          size: createdEntry.binding.size ?? sourceEntry.metadata.size,
          mode: createdEntry.desiredMetadata?.mode ?? sourceEntry.metadata.mode,
          uid: createdEntry.desiredMetadata?.uid ?? sourceEntry.metadata.uid,
          gid: createdEntry.desiredMetadata?.gid ?? sourceEntry.metadata.gid
        },
        proof: createdEntry.binding.proof || sourceEntry.proof
      }
    })
    return recoveryDescriptorFromManifest(createdManifest, targetRoot)
  }

  async function describeRecoveryState (path, signal, allowAbsent = false) {
    const remotePath = canonicalFilePath(path)
    let manifest
    try {
      manifest = await buildTreeManifest(remotePath, signal)
    } catch (error) {
      if (!allowAbsent || error?.code !== 'ENOENT') throw error
      const parentPath = parentFilePath(remotePath)
      const parent = requireBoundMetadata(
        await rawFacade.lstat(parentPath, { signal }),
        parentPath,
        'recovery absent parent'
      )
      if (parent.type !== 'directory') {
        throw new Error('root 文件后端恢复缺失目标 parent 不是目录')
      }
      try {
        await boundLstat(remotePath, parent, signal)
      } catch (boundError) {
        if (boundError?.code !== 'ENOENT') throw boundError
        return normalizeBoundAbsentDescriptor({
          type: 'bound-absent',
          path: remotePath,
          basename: remotePath.slice(remotePath.lastIndexOf('/') + 1),
          mustBeAbsent: true,
          parent: {
            path: parentPath,
            device: String(parent.device),
            inode: String(parent.inode),
            mode: parent.mode & 0o7777,
            uid: parent.uid,
            gid: parent.gid
          }
        }, remotePath)
      }
      manifest = await buildTreeManifest(remotePath, signal)
    }
    return recoveryDescriptorFromManifest(manifest, remotePath)
  }

  function targetForManifestEntry (entry, sourceRoot, targetRoot) {
    return entry.path === sourceRoot
      ? targetRoot
      : canonicalFilePath(`${targetRoot}${entry.path.slice(sourceRoot.length)}`)
  }

  async function assertManifestEntryCurrent (entry, signal) {
    const current = await boundLstat(entry.path, {
      device: entry.metadata.parentDevice,
      inode: entry.metadata.parentInode
    }, signal)
    for (const key of ['device', 'inode', 'type', 'mode', 'size', 'mtime', 'uid', 'gid']) {
      if (current[key] !== entry.metadata[key]) {
        throw new Error('root 文件后端 manifest entry binding 或 metadata 发生变化')
      }
    }
    return current
  }

  async function copyFileFromManifest (entry, targetPath, parentBinding, signal) {
    const stage = staging.allocate('download')
    let hasProof = false
    let targetCreated = false
    let operationError
    try {
      throwIfAborted(signal)
      const exported = digestResult(await executeRequest('stage-export', {
        ...staging.rootBinding,
        objectName: stage.objectName,
        sourcePath: entry.path,
        ...sourceBindingArgs(entry.metadata),
        expectedSize: String(entry.metadata.size),
        maxSize: String(entry.maxSize)
      }, { signal }), 'stage-export')
      staging.remember(stage.path, {
        sha256: exported.sha256,
        size: String(exported.size)
      })
      hasProof = true
      if (exported.size !== entry.proof.size ||
        exported.sha256 !== entry.proof.sha256) {
        throw new Error('root 文件后端复制源在清单后发生变化')
      }
      throwIfAborted(signal)
      const imported = digestResult(await executeStageImport(
        stage, targetPath, parentBinding, {
          ...staging.rootBinding,
          objectName: stage.objectName,
          targetPath,
          sha256: exported.sha256,
          size: String(exported.size),
          targetMode: normalizeMode(entry.metadata.mode & 0o7777).toString(8),
          targetUid: String(entry.metadata.uid),
          targetGid: String(entry.metadata.gid),
          mustBeAbsent: '1',
          ...targetParentBindingArgs(parentFilePath(targetPath), parentBinding),
          targetDevice: '0',
          targetInode: '0'
        }, signal), 'stage-import')
      if (imported.sha256 !== exported.sha256 || imported.size !== exported.size) {
        throw new Error('root 文件后端复制导入摘要或大小不匹配')
      }
      targetCreated = {
        device: imported.targetDevice,
        inode: imported.targetInode,
        type: 'file',
        mode: entry.metadata.mode,
        uid: entry.metadata.uid,
        gid: entry.metadata.gid,
        size: imported.size,
        proof: {
          sha256: imported.sha256,
          size: imported.size
        }
      }
    } catch (error) {
      operationError = error
    } finally {
      if (hasProof) {
        try { await staging.cleanup(stage.path) } catch (cleanupError) {
          if (operationError) operationError.cleanupError ||= cleanupError
          else operationError = cleanupError
        }
      } else {
        try { staging.preserve(stage.path) } catch (preserveError) {
          if (operationError) operationError.cleanupError ||= preserveError
          else operationError = preserveError
        }
      }
    }
    if (operationError) {
      if (targetCreated) operationError.targetCreated = targetCreated
      throw operationError
    }
    return targetCreated
  }

  async function copyTree (source, target, options) {
    const sourcePath = canonicalFilePath(source, 'source')
    const targetPath = canonicalFilePath(target, 'target')
    const {
      signal,
      expectedSource,
      expectedTarget
    } = normalizeRecoveryCopyOptions(options, targetPath)
    if (isSameOrChildPath(targetPath, sourcePath)) {
      throw new Error('root 文件后端复制目标不能位于复制源内部')
    }
    throwIfAborted(signal)
    const manifest = await buildTreeManifest(sourcePath, signal)
    const sourceDescriptor = await recoveryDescriptorFromManifest(
      manifest,
      sourcePath
    )
    if (expectedSource &&
      !sameRecoveryDescriptor(sourceDescriptor, expectedSource)) {
      throw recoveryProofMismatch(
        'root 文件后端 copy source 恢复证明发生变化',
        sourcePath,
        expectedSource,
        sourceDescriptor
      )
    }
    const targetState = expectedTarget
      ? await describeRecoveryState(targetPath, signal, true)
      : null
    if (expectedTarget &&
      !sameRecoveryDescriptor(targetState, expectedTarget)) {
      throw recoveryProofMismatch(
        'root 文件后端 copy target 缺失证明发生变化',
        targetPath,
        expectedTarget,
        targetState
      )
    }
    if (!expectedTarget && await lstatOrMissing(targetPath, signal)) {
      const error = new Error(`root 文件后端复制目标已存在：${targetPath}`)
      error.code = 'EEXIST'
      throw error
    }
    const targetParentPath = parentFilePath(targetPath)
    const targetParentMetadata = requireBoundMetadata(
      await rawFacade.lstat(targetParentPath, { signal }),
      targetParentPath,
      'copy target parent'
    )
    if (targetParentMetadata.type !== 'directory') {
      throw new Error('root 文件后端复制目标 parent 不是目录')
    }
    if (expectedTarget &&
      !recoveryParentMatches(targetParentMetadata, expectedTarget.parent)) {
      const currentTarget = await describeRecoveryState(targetPath, signal, true)
      throw recoveryProofMismatch(
        'root 文件后端 copy target parent 恢复证明发生变化',
        targetPath,
        expectedTarget,
        currentTarget
      )
    }
    await invalidateReadStreams(targetPath)
    const created = []
    const createdDirectories = new Map([[
      targetParentPath,
      targetParentMetadata
    ]])
    let primaryError
    let completedTargetDescriptor
    try {
      for (const entry of manifest) {
        throwIfAborted(signal)
        await assertManifestEntryCurrent(entry, signal)
        const destination = targetForManifestEntry(entry, sourcePath, targetPath)
        const destinationParent = parentFilePath(destination)
        const parentBinding = createdDirectories.get(destinationParent)
        if (!parentBinding) {
          throw new Error('root 文件后端复制目标 parent binding 缺失')
        }
        if (entry.metadata.type === 'directory') {
          const binding = await executeRequest('mkdir-bound', {
            targetPath: destination,
            ...targetParentBindingArgs(destinationParent, parentBinding),
            targetMode: '700',
            targetUid: '0',
            targetGid: '0'
          }, { signal })
          if (!/^(?:0|[1-9]\d{0,19})$/.test(binding.device) ||
            !/^(?:0|[1-9]\d{0,19})$/.test(binding.inode)) {
            throw new Error('root 文件后端 mkdir binding 结果无效')
          }
          created.push({
            path: destination,
            type: 'directory',
            parentBinding,
            binding: {
              ...binding,
              type: 'directory',
              mode: 0o40700,
              uid: 0,
              gid: 0
            },
            desiredMetadata: entry.metadata
          })
          createdDirectories.set(destination, created.at(-1).binding)
        } else {
          try {
            const binding = await copyFileFromManifest(
              entry,
              destination,
              parentBinding,
              signal
            )
            created.push({
              path: destination,
              type: 'file',
              parentBinding,
              binding
            })
          } catch (error) {
            if (error.targetCreated) {
              created.push({
                path: destination,
                type: 'file',
                parentBinding,
                binding: error.targetCreated
              })
            }
            throw error
          }
        }
      }
      for (const entry of created.filter(entry =>
        entry.type === 'directory').reverse()) {
        throwIfAborted(signal)
        await executeRequest('metadata-bound', {
          targetPath: entry.path,
          ...targetParentBindingArgs(
            parentFilePath(entry.path),
            entry.parentBinding
          ),
          targetDevice: String(entry.binding.device),
          targetInode: String(entry.binding.inode),
          targetType: 'directory',
          targetMode: normalizeMode(
            entry.desiredMetadata.mode & 0o7777
          ).toString(8),
          targetUid: String(entry.desiredMetadata.uid),
          targetGid: String(entry.desiredMetadata.gid)
        }, { signal })
        entry.binding.mode = entry.desiredMetadata.mode
        entry.binding.uid = entry.desiredMetadata.uid
        entry.binding.gid = entry.desiredMetadata.gid
      }
      if (expectedSource) {
        const finalSource = await describeRecoveryState(
          sourcePath,
          signal,
          true
        )
        if (!sameRecoveryDescriptor(finalSource, expectedSource)) {
          throw recoveryProofMismatch(
            'root 文件后端 copy source 在安装期间发生变化',
            sourcePath,
            expectedSource,
            finalSource
          )
        }
        completedTargetDescriptor = await recoveryDescriptorFromCreated(
          manifest,
          created,
          sourcePath,
          targetPath
        )
        const finalTarget = await describeRecoveryState(
          targetPath,
          signal,
          false
        )
        if (!sameRecoveryDescriptor(
          finalTarget,
          completedTargetDescriptor
        )) {
          throw recoveryProofMismatch(
            'root 文件后端 copy target 在完成前发生变化',
            targetPath,
            completedTargetDescriptor,
            finalTarget
          )
        }
      }
    } catch (error) {
      primaryError = error
    }
    if (primaryError) {
      for (const entry of created.reverse()) {
        try {
          const expectedMetadata = [entry.binding]
          if (entry.desiredMetadata) {
            expectedMetadata.push({
              ...entry.binding,
              mode: entry.desiredMetadata.mode,
              uid: entry.desiredMetadata.uid,
              gid: entry.desiredMetadata.gid
            })
          }
          await executeRequest('remove-bound', await prepareBoundRemoval(
            entry.path,
            expectedMetadata,
            entry.binding.proof,
            'copy rollback'
          ))
        } catch (rollbackError) {
          primaryError.rollbackError ||= rollbackError
        }
      }
      if (primaryError.code !== 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH') {
        if (expectedSource) {
          try {
            const actualSource = await describeRecoveryState(
              sourcePath,
              undefined,
              true
            )
            if (!sameRecoveryDescriptor(actualSource, expectedSource)) {
              const mismatch = recoveryProofMismatch(
                'root 文件后端 copy source 实际执行证明发生变化',
                sourcePath,
                expectedSource,
                actualSource,
                primaryError
              )
              mismatch.rollbackError = primaryError.rollbackError
              primaryError = mismatch
            }
          } catch {}
        }
        if (expectedTarget &&
          primaryError.code !== 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH') {
          try {
            const actualTarget = await describeRecoveryState(
              targetPath,
              undefined,
              true
            )
            if (!sameRecoveryDescriptor(actualTarget, expectedTarget)) {
              const mismatch = recoveryProofMismatch(
                'root 文件后端 copy target 实际执行证明发生变化',
                targetPath,
                expectedTarget,
                actualTarget,
                primaryError
              )
              mismatch.rollbackError = primaryError.rollbackError
              primaryError = mismatch
            }
          } catch {}
        }
      }
      throw primaryError
    }
    return completedTargetDescriptor || 1
  }

  async function removeTree (path, options) {
    const {
      signal,
      expectedSource,
      expectedPeer
    } = normalizeRecoveryRemoveOptions(options)
    const remotePath = canonicalFilePath(path)
    if (expectedPeer && (
      isSameOrChildPath(expectedPeer.path, remotePath) ||
      isSameOrChildPath(remotePath, expectedPeer.path)
    )) {
      throw new Error('root 文件后端 remove peer 不能与源路径重叠')
    }
    throwIfAborted(signal)
    const manifest = await buildTreeManifest(remotePath, signal)
    const sourceDescriptor = await recoveryDescriptorFromManifest(
      manifest,
      remotePath
    )
    if (expectedSource &&
      !sameRecoveryDescriptor(sourceDescriptor, expectedSource)) {
      throw recoveryProofMismatch(
        'root 文件后端 remove source 恢复证明发生变化',
        remotePath,
        expectedSource,
        sourceDescriptor
      )
    }
    let peerManifest
    let peerEntriesByPath
    if (expectedPeer) {
      peerManifest = await buildTreeManifest(expectedPeer.path, signal)
      const peerDescriptor = await recoveryDescriptorFromManifest(
        peerManifest,
        expectedPeer.path
      )
      if (!sameRecoveryDescriptor(
        peerDescriptor,
        expectedPeer.descriptor
      )) {
        throw recoveryProofMismatch(
          'root 文件后端 remove peer 恢复证明发生变化',
          expectedPeer.path,
          expectedPeer.descriptor,
          peerDescriptor
        )
      }
      peerEntriesByPath = new Map(peerManifest.map(entry => [entry.path, entry]))
      if (peerManifest.length !== manifest.length) {
        throw recoveryProofMismatch(
          'root 文件后端 remove peer 目录结构发生变化',
          expectedPeer.path,
          expectedPeer.descriptor,
          peerDescriptor
        )
      }
    }
    await invalidateReadStreams(remotePath)
    try {
      for (const entry of [...manifest].reverse()) {
        throwIfAborted(signal)
        const peerPath = expectedPeer
          ? canonicalFilePath(
              `${expectedPeer.path}${entry.path.slice(remotePath.length)}`
          )
          : null
        const peerEntry = peerPath ? peerEntriesByPath.get(peerPath) : null
        if (expectedPeer && !peerEntry) {
          throw recoveryProofMismatch(
            'root 文件后端 remove peer 对应条目缺失',
            peerPath,
            expectedPeer.descriptor,
            null
          )
        }
        const args = await prepareBoundRemoval(
          entry.path,
          entry.metadata,
          entry.proof,
          'removeEntry',
          signal,
          peerEntry
        )
        await executeRequest(
          peerEntry ? 'remove-peer-bound' : 'remove-bound',
          args,
          { signal }
        )
      }
    } catch (error) {
      if (!expectedSource ||
        error.code === 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH') throw error
      if (expectedPeer) {
        try {
          const actualPeer = await describeRecoveryState(
            expectedPeer.path,
            undefined,
            true
          )
          if (!sameRecoveryDescriptor(
            actualPeer,
            expectedPeer.descriptor
          )) {
            throw recoveryProofMismatch(
              'root 文件后端 remove peer 实际执行证明发生变化',
              expectedPeer.path,
              expectedPeer.descriptor,
              actualPeer,
              error
            )
          }
        } catch (peerError) {
          if (peerError?.code === 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH') {
            throw peerError
          }
        }
      }
      let actualSource
      try {
        actualSource = await describeRecoveryState(remotePath, undefined, true)
      } catch {
        throw error
      }
      if (sameRecoveryDescriptor(actualSource, expectedSource)) throw error
      throw recoveryProofMismatch(
        'root 文件后端 remove source 实际执行证明发生变化',
        remotePath,
        expectedSource,
        actualSource,
        error
      )
    }
    return 1
  }

  async function handleUploadCreateFailure (stage, error, expected) {
    const primaryError = normalizeCreateFailure(error)
    if (primaryError.claimed === true &&
      primaryError.cleanupSucceeded !== true) {
      try {
        staging.preserve(stage.path)
        staging.assertCurrent()
        await verifyStageBytes(stage, expected)
        staging.remember(stage.path, {
          sha256: expected.sha256,
          size: String(expected.size)
        })
        await staging.cleanup(stage.path)
      } catch (verificationOrCleanupError) {
        attachCleanupFailure(primaryError, verificationOrCleanupError)
      }
      return primaryError
    }
    try {
      staging.abandon(stage.path)
    } catch (abandonError) {
      attachCleanupFailure(primaryError, abandonError)
    }
    return primaryError
  }

  function transferProgressBytes (value) {
    const transferred = value && typeof value === 'object'
      ? value.transferred
      : value
    return Number.isSafeInteger(transferred) && transferred >= 0
      ? transferred
      : null
  }

  function attachTransferCleanupError (error, cleanupError) {
    if (error && Object.isExtensible(error)) {
      error.cleanupError ||= cleanupError
      return error
    }
    const wrapped = new Error(String(error?.message || error || '远程文件传输失败'))
    wrapped.cause = error
    wrapped.cleanupError = cleanupError
    return wrapped
  }

  function createOwnedTransferStage (direction) {
    const stage = staging.allocate(direction)
    let proof
    let cleaned = false
    let cleanupPromise
    let preserved = false

    async function prove () {
      if (proof) return proof
      let metadata
      try {
        metadata = await boundLstat(stage.path, {
          device: staging.rootBinding.rootDevice,
          inode: staging.rootBinding.rootInode
        })
      } catch (error) {
        if (error?.code === 'ENOENT') {
          staging.abandon(stage.path)
          cleaned = true
        }
        throw error
      }
      if (metadata.type !== 'file' ||
        metadata.size > copyLimits.maxTotalBytes ||
        normalizeMode(metadata.mode & 0o7777) !== 0o600 ||
        String(metadata.parentDevice) !== staging.rootBinding.rootDevice ||
        String(metadata.parentInode) !== staging.rootBinding.rootInode ||
        String(metadata.uid) !== staging.rootBinding.rootUid ||
        String(metadata.gid) !== staging.rootBinding.rootGid) {
        throw new Error('root 文件后端 transfer stage 绑定或 metadata 无效')
      }
      const digested = await boundDigest({
        path: stage.path,
        metadata,
        maxSize: copyLimits.maxTotalBytes
      }, 'sha256-bound', 0, readChunkBytes)
      if (digested.size !== metadata.size) {
        throw new Error('root 文件后端 transfer stage 大小证明不一致')
      }
      staging.remember(stage.path, {
        sha256: digested.sha256,
        size: String(digested.size)
      })
      proof = Object.freeze({ metadata, ...digested })
      return proof
    }

    function remember (value, kind) {
      const digested = digestResult(value, kind)
      staging.remember(stage.path, {
        sha256: digested.sha256,
        size: String(digested.size)
      })
      proof = Object.freeze({ metadata: null, ...digested })
      return proof
    }

    function preserve () {
      if (cleaned || preserved) return
      staging.preserve(stage.path)
      preserved = true
    }

    function cleanup () {
      if (cleaned) return Promise.resolve(true)
      if (cleanupPromise) return cleanupPromise
      cleanupPromise = (async () => {
        try {
          if (!proof) {
            try {
              await prove()
            } catch (error) {
              if (cleaned) return true
              preserve()
              throw error
            }
          }
          await staging.cleanup(stage.path)
          cleaned = true
          return true
        } catch (error) {
          cleanupPromise = undefined
          throw error
        }
      })()
      return cleanupPromise
    }

    return Object.freeze({
      stage,
      prove,
      remember,
      cleanup,
      preserve,
      get proof () { return proof }
    })
  }

  function permitsUploadOverwrite (options = {}) {
    return options.atomicOverwrite === true ||
      options.overwrite === true ||
      options.mergeOrOverwrite === true
  }

  function importClaimDescriptor (claim, proof) {
    if (!claim || claim.targetType !== 'file' ||
      claim.sha256 !== proof.sha256 || claim.size !== proof.size) return null
    try {
      return normalizeRecoveryDescriptor({
        type: 'file',
        device: String(claim.targetDevice),
        inode: String(claim.targetInode),
        size: claim.size,
        mode: claim.mode,
        uid: claim.uid,
        gid: claim.gid,
        sha256: claim.sha256
      }, 'upload installed target')
    } catch {
      return null
    }
  }

  async function cleanupUploadDisplacement (
    displacement,
    peer,
    signal
  ) {
    await removeTree(displacement.stage.path, {
      signal,
      expectedSource: displacement.descriptor,
      ...(peer
        ? {
            expectedPeer: {
              path: peer.path,
              descriptor: peer.descriptor
            }
          }
        : {})
    })
    staging.abandon(displacement.stage.path)
  }

  function preserveUnclaimedUploadDisplacement (stage, cause) {
    const uncertain = new Error(
      'root 文件后端 overwrite displacement copy 未返回可信创建证明，候选残留已保留'
    )
    uncertain.code = 'REMOTE_FILE_RECOVERY_UNCERTAIN'
    uncertain.recoveryUncertain = true
    uncertain.path = stage.path
    uncertain.residualPath = stage.path
    uncertain.phase = 'overwrite-displacement-copy'
    uncertain.cause = cause
    try {
      staging.preserve(stage.path)
    } catch (preserveError) {
      attachCleanupFailure(uncertain, preserveError)
    }
    return uncertain
  }

  async function cleanupFailedNewUploadTarget (
    targetPath,
    installedDescriptor,
    cause
  ) {
    if (!installedDescriptor) return
    try {
      const current = await describeRecoveryState(targetPath, undefined, true)
      if (current.type === 'bound-absent') return
      if (!sameRecoveryDescriptor(current, installedDescriptor)) {
        throw recoveryProofMismatch(
          'root 文件后端 upload 失败后 target 已被其他写入改变',
          targetPath,
          installedDescriptor,
          current,
          cause
        )
      }
      await removeTree(targetPath, {
        expectedSource: installedDescriptor
      })
    } catch (cleanupError) {
      if (cleanupError?.code === 'REMOTE_FILE_RECOVERY_PROOF_MISMATCH') {
        cleanupError.recoveryUncertain = true
        throw cleanupError
      }
      attachCleanupFailure(cause, cleanupError)
    }
  }

  async function rollbackUploadDisplacement ({
    targetPath,
    originalDescriptor,
    installedDescriptor,
    displacement,
    cause
  }) {
    let current
    try {
      current = await describeRecoveryState(targetPath, undefined, true)
    } catch (error) {
      staging.preserve(displacement.stage.path)
      throw recoveryProofMismatch(
        'root 文件后端 upload rollback 无法确认 target',
        targetPath,
        installedDescriptor || originalDescriptor,
        null,
        error
      )
    }

    let restoredDescriptor
    if (sameRecoveryDescriptor(current, originalDescriptor)) {
      restoredDescriptor = current
    } else if (current.type === 'bound-absent') {
      restoredDescriptor = await copyTree(
        displacement.stage.path,
        targetPath,
        {
          expectedSource: displacement.descriptor,
          expectedTarget: current
        }
      )
    } else if (installedDescriptor &&
      sameRecoveryDescriptor(current, installedDescriptor)) {
      await removeTree(targetPath, {
        expectedSource: installedDescriptor,
        expectedPeer: {
          path: displacement.stage.path,
          descriptor: displacement.descriptor
        }
      })
      const absent = await describeRecoveryState(targetPath, undefined, true)
      restoredDescriptor = await copyTree(
        displacement.stage.path,
        targetPath,
        {
          expectedSource: displacement.descriptor,
          expectedTarget: absent
        }
      )
    } else {
      staging.preserve(displacement.stage.path)
      const uncertain = recoveryProofMismatch(
        'root 文件后端 upload rollback target 已被其他写入改变',
        targetPath,
        installedDescriptor || originalDescriptor,
        current,
        cause
      )
      uncertain.recoveryUncertain = true
      uncertain.residualPath = displacement.stage.path
      throw uncertain
    }

    try {
      await cleanupUploadDisplacement(displacement, {
        path: targetPath,
        descriptor: restoredDescriptor
      })
    } catch (error) {
      staging.preserve(displacement.stage.path)
      throw error
    }
    return restoredDescriptor
  }

  function createPrivilegedTransferProxy ({
    onData,
    onPaused,
    onEnd,
    onError,
    finalize,
    cleanup
  }) {
    let inner
    let terminalPromise
    let terminalKind

    function claimTerminal (kind, work) {
      if (terminalPromise) return terminalPromise
      terminalKind = kind
      terminalPromise = (async () => work())()
      terminalPromise.catch(() => {})
      return terminalPromise
    }

    async function finishWithCleanup (work) {
      let primaryError
      let result
      try {
        result = await work()
      } catch (error) {
        primaryError = error
      }
      try {
        await cleanup()
      } catch (cleanupError) {
        primaryError = primaryError
          ? attachTransferCleanupError(primaryError, cleanupError)
          : cleanupError
      }
      if (primaryError) throw primaryError
      return result
    }

    async function control (name) {
      if (terminalPromise) return terminalPromise
      return claimTerminal(name, () => finishWithCleanup(async () => {
        const operation = Object.getOwnPropertyDescriptor(inner, name)?.value
        if (typeof operation === 'function') {
          await Reflect.apply(operation, inner, [])
        }
        return true
      }))
    }

    const callbacks = Object.freeze({
      onData: value => {
        if (terminalPromise) return
        return onData?.(value)
      },
      onPaused: value => {
        if (terminalPromise) return
        return onPaused?.(value)
      },
      onEnd: value => claimTerminal('end', async () => {
        try {
          await finishWithCleanup(() => finalize(value))
        } catch (error) {
          return onError?.(error)
        }
        return onEnd?.(value)
      }),
      onError: error => claimTerminal('error', async () => {
        let failure = error instanceof Error
          ? error
          : new Error(String(error || '远程文件传输失败'))
        try {
          await cleanup()
        } catch (cleanupError) {
          failure = attachTransferCleanupError(failure, cleanupError)
        }
        return onError?.(failure)
      })
    })

    const handle = Object.assign(Object.create(null), {
      pause: async () => {
        if (terminalPromise) return terminalPromise
        const operation = Object.getOwnPropertyDescriptor(inner, 'pause')?.value
        if (typeof operation === 'function') {
          await Reflect.apply(operation, inner, [])
        }
        return true
      },
      resume: async () => {
        if (terminalPromise) return terminalPromise
        const operation = Object.getOwnPropertyDescriptor(inner, 'resume')?.value
        if (typeof operation === 'function') {
          await Reflect.apply(operation, inner, [])
        }
        return true
      },
      cancel: () => control('cancel'),
      interrupt: () => control('interrupt'),
      destroy: () => terminalKind === 'end'
        ? terminalPromise
        : control('destroy')
    })

    return Object.freeze({
      callbacks,
      handle: Object.freeze(handle),
      setInner: value => { inner = value }
    })
  }

  const rawFacade = {
    async list (path, options = {}) {
      const result = await executeRequest('list', {
        path: canonicalFilePath(path)
      }, options)
      if (!Array.isArray(result.entries)) {
        throw new Error('root 文件后端 list 结果无效')
      }
      return result.entries.map(entry => ({
        name: entry.name,
        type: fileTypeChars[entry.type] || '?',
        size: entry.size,
        accessTime: entry.atime * 1000,
        modifyTime: entry.mtime * 1000,
        mode: entry.mode,
        owner: entry.uid,
        group: entry.gid
      }))
    },
    async lstat (path, options = {}) {
      const remotePath = canonicalFilePath(path)
      const result = await executeRequest('lstat', { path: remotePath }, options)
      if (result.missing === true) {
        const error = new Error(`No such privileged file: ${remotePath}`)
        error.code = 'ENOENT'
        throw error
      }
      return metadataResult(result)
    },
    async stat (path, options = {}) {
      return metadataResult(await executeRequest('stat', {
        path: canonicalFilePath(path)
      }, options))
    },
    async readlink (path) {
      const result = await executeRequest('readlink', {
        path: canonicalFilePath(path)
      })
      if (typeof result.text !== 'string') throw new Error('root 文件后端 readlink 结果无效')
      return result.text
    },
    async realpath (path) {
      const result = await executeRequest('realpath', {
        path: canonicalFilePath(path)
      })
      if (typeof result.text !== 'string') throw new Error('root 文件后端 realpath 结果无效')
      return result.text
    },
    async readFile (path) {
      const remotePath = canonicalFilePath(path)
      const initial = requireBoundMetadata(
        await rawFacade.lstat(remotePath),
        remotePath,
        'read source'
      )
      if (initial.type !== 'file') {
        throw new Error('root 文件后端 read source 必须为普通文件')
      }
      if (initial.size > maxReadFileBytes) {
        throw new Error('root 文件后端 readFile 超过 8 MiB 安全上限')
      }
      const parts = []
      let length = 0
      let offset = 0
      let hasMore
      do {
        const chunk = await readLogicalChunk(
          remotePath,
          offset,
          readChunkBytes,
          undefined,
          maxReadFileBytes
        )
        if (chunk.totalBytes > maxReadFileBytes) {
          throw new Error('root 文件后端 readFile 超过 8 MiB 安全上限')
        }
        const bytes = bytesFromBase64(chunk.base64)
        parts.push(bytes)
        length += bytes.byteLength
        offset = chunk.nextOffset
        hasMore = chunk.hasMore
      } while (hasMore)
      return new TextDecoder().decode(concatBytes(parts, length))
    },
    async readFileChunk (path, options = {}) {
      const remotePath = canonicalFilePath(path)
      if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(key => !['offset', 'maxBytes', 'signal'].includes(key))) {
        throw new Error('root 文件后端 readFileChunk options 无效')
      }
      const { signal } = normalizeCancellableOptions(
        Object.hasOwn(options, 'signal') ? { signal: options.signal } : undefined
      )
      const requestedOffset = options.offset === undefined ? 0 : Number(options.offset)
      const requestedMaxBytes = options.maxBytes === undefined
        ? readChunkBytes
        : Number(options.maxBytes)
      if (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0 ||
        !Number.isSafeInteger(requestedMaxBytes) || requestedMaxBytes < 1) {
        throw new Error('root 文件后端 readFileChunk 范围无效')
      }
      return readLogicalChunk(
        remotePath,
        requestedOffset,
        Math.min(requestedMaxBytes, readChunkBytes),
        signal
      )
    },
    async upload ({
      localPath,
      remotePath,
      options = {},
      signal,
      onData,
      onPaused,
      onEnd,
      onError
    } = {}) {
      const targetPath = canonicalFilePath(remotePath, 'upload targetPath')
      throwIfAborted(signal)
      const ownedStage = createOwnedTransferStage('upload')
      let transferred = 0
      const proxy = createPrivilegedTransferProxy({
        onData: value => {
          const current = transferProgressBytes(value)
          if (current !== null) transferred = current
          return onData?.(value)
        },
        onPaused,
        onEnd,
        onError,
        cleanup: ownedStage.cleanup,
        finalize: async value => {
          throwIfAborted(signal)
          const proof = await ownedStage.prove()
          const completed = transferProgressBytes(value) ?? transferred
          if (proof.size !== completed) {
            throw new Error('root 文件后端 upload 已传输大小与 stage 证明不一致')
          }
          const originalDescriptor = await describeRecoveryState(
            targetPath,
            signal,
            true
          )
          let displacement
          let installedDescriptor
          let installVerified = false
          try {
            if (originalDescriptor.type !== 'bound-absent') {
              if (!permitsUploadOverwrite(options)) {
                const error = new Error(
                  `root 文件后端 upload target 已存在：${targetPath}`
                )
                error.code = 'EEXIST'
                throw error
              }
              if (originalDescriptor.type !== 'file') {
                throw new Error('root 文件后端 upload overwrite target 必须为普通文件')
              }
              const displacementStage = staging.allocate('download')
              try {
                const displacementAbsent = await describeRecoveryState(
                  displacementStage.path,
                  signal,
                  true
                )
                const displacementDescriptor = normalizeRecoveryDescriptor(
                  await copyTree(
                    targetPath,
                    displacementStage.path,
                    {
                      signal,
                      expectedSource: originalDescriptor,
                      expectedTarget: displacementAbsent
                    }
                  ),
                  'upload displacement created'
                )
                displacement = Object.freeze({
                  stage: displacementStage,
                  descriptor: displacementDescriptor
                })
                await removeTree(targetPath, {
                  signal,
                  expectedSource: originalDescriptor,
                  expectedPeer: {
                    path: displacementStage.path,
                    descriptor: displacementDescriptor
                  }
                })
              } catch (error) {
                if (!displacement) {
                  throw preserveUnclaimedUploadDisplacement(
                    displacementStage,
                    error
                  )
                }
                throw error
              }
            }

            const targetAbsent = await describeRecoveryState(
              targetPath,
              signal,
              true
            )
            if (targetAbsent.type !== 'bound-absent') {
              throw recoveryProofMismatch(
                'root 文件后端 upload no-clobber target 已被占用',
                targetPath,
                originalDescriptor.type === 'bound-absent'
                  ? originalDescriptor
                  : null,
                targetAbsent
              )
            }
            const { parent, parentPath } = await boundAbsentParent(
              targetPath,
              'upload',
              signal
            )
            if (!recoveryParentMatches(parent, targetAbsent.parent)) {
              throw recoveryProofMismatch(
                'root 文件后端 upload target parent 绑定发生变化',
                targetPath,
                targetAbsent,
                await describeRecoveryState(targetPath, signal, true)
              )
            }
            let imported
            try {
              imported = digestResult(await executeStageImport(
                ownedStage.stage,
                targetPath,
                parent,
                {
                  ...staging.rootBinding,
                  objectName: ownedStage.stage.objectName,
                  targetPath,
                  sha256: proof.sha256,
                  size: String(proof.size),
                  targetMode: normalizeLocalTransferUploadMode(
                    options.mode,
                    0o600
                  ).toString(8),
                  targetUid: '0',
                  targetGid: '0',
                  mustBeAbsent: '1',
                  ...targetParentBindingArgs(parentPath, parent),
                  targetDevice: '0',
                  targetInode: '0'
                },
                signal
              ), 'stage-import')
            } catch (error) {
              installedDescriptor = importClaimDescriptor(
                error?.importResult?.targetClaim,
                proof
              )
              throw error
            }
            installedDescriptor = importClaimDescriptor(
              imported.targetClaim,
              proof
            )
            if (!installedDescriptor || imported.sha256 !== proof.sha256 ||
              imported.size !== proof.size) {
              throw new Error('root 文件后端 upload import 摘要、大小或 target claim 不匹配')
            }
            const installedCurrent = await describeRecoveryState(
              targetPath,
              signal,
              false
            )
            if (!sameRecoveryDescriptor(
              installedCurrent,
              installedDescriptor
            )) {
              throw recoveryProofMismatch(
                'root 文件后端 upload target 安装后证明发生变化',
                targetPath,
                installedDescriptor,
                installedCurrent
              )
            }
            installVerified = true
            if (displacement) {
              try {
                await cleanupUploadDisplacement(displacement, {
                  path: targetPath,
                  descriptor: installedDescriptor
                }, signal)
              } catch (error) {
                staging.preserve(displacement.stage.path)
                throw error
              }
            }
          } catch (error) {
            if (displacement && !installVerified) {
              try {
                await rollbackUploadDisplacement({
                  targetPath,
                  originalDescriptor,
                  installedDescriptor,
                  displacement,
                  cause: error
                })
              } catch (rollbackError) {
                if (rollbackError?.code ===
                  'REMOTE_FILE_RECOVERY_PROOF_MISMATCH') {
                  throw rollbackError
                }
                attachCleanupFailure(error, rollbackError)
              }
            } else if (!displacement && !installVerified) {
              await cleanupFailedNewUploadTarget(
                targetPath,
                installedDescriptor,
                error
              )
            }
            throw error
          }
        }
      })
      try {
        const inner = await sftp.upload({
          localPath,
          remotePath: ownedStage.stage.path,
          signal,
          isDirectory: false,
          options: {
            mode: 0o600,
            atomicUpload: false,
            atomicOverwrite: false,
            keepPartial: false
          },
          ...proxy.callbacks
        })
        proxy.setInner(inner)
        return proxy.handle
      } catch (error) {
        try {
          await ownedStage.cleanup()
        } catch (cleanupError) {
          throw attachTransferCleanupError(error, cleanupError)
        }
        throw error
      }
    },
    async download ({
      localPath,
      remotePath,
      options = {},
      signal,
      onData,
      onPaused,
      onEnd,
      onError
    } = {}) {
      const sourcePath = canonicalFilePath(remotePath, 'download sourcePath')
      throwIfAborted(signal)
      const source = requireBoundMetadata(
        await rawFacade.lstat(sourcePath, { signal }),
        sourcePath,
        'download source'
      )
      if (source.type !== 'file' || source.size > copyLimits.maxTotalBytes) {
        throw new Error('root 文件后端 download source 必须为有界普通文件')
      }
      const ownedStage = createOwnedTransferStage('download')
      try {
        const exported = ownedStage.remember(await executeRequest('stage-export', {
          ...staging.rootBinding,
          objectName: ownedStage.stage.objectName,
          sourcePath,
          ...sourceBindingArgs(source),
          expectedSize: String(source.size),
          maxSize: String(copyLimits.maxTotalBytes)
        }, { signal }), 'stage-export')
        if (exported.size !== source.size) {
          throw new Error('root 文件后端 download export 大小不匹配')
        }
        let transferred = 0
        const proxy = createPrivilegedTransferProxy({
          onData: value => {
            const current = transferProgressBytes(value)
            if (current !== null) transferred = current
            return onData?.(value)
          },
          onPaused,
          onEnd,
          onError,
          cleanup: ownedStage.cleanup,
          finalize: async value => {
            throwIfAborted(signal)
            const completed = transferProgressBytes(value) ?? transferred
            if (completed !== exported.size) {
              throw new Error(
                'root 文件后端 download 已传输大小与 snapshot 证明不一致'
              )
            }
          }
        })
        const inner = await sftp.download({
          localPath,
          remotePath: ownedStage.stage.path,
          signal,
          isDirectory: false,
          options,
          ...proxy.callbacks
        })
        proxy.setInner(inner)
        return proxy.handle
      } catch (error) {
        try {
          await ownedStage.cleanup()
        } catch (cleanupError) {
          throw attachTransferCleanupError(error, cleanupError)
        }
        throw error
      }
    },
    async writeFile (path, value, requestedMode) {
      const targetPath = canonicalFilePath(path, 'targetPath')
      const bytes = inputBytes(value, maxReadFileBytes)
      await invalidateReadStreams(targetPath)
      let targetMetadata
      try {
        targetMetadata = await rawFacade.lstat(targetPath)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      if (targetMetadata) {
        requireBoundMetadata(targetMetadata, targetPath, 'write target')
        const error = new Error(
          'root 文件后端 writeFile 仅允许写入缺失目标；既有目标必须通过安全事务'
        )
        error.code = 'EEXIST'
        throw error
      }
      const digest = await sha256Hex(bytes)
      const targetParentPath = parentFilePath(targetPath)
      const targetParentMetadata = requireBoundMetadata(
        await rawFacade.lstat(targetParentPath),
        targetParentPath,
        'write target parent'
      )
      if (targetParentMetadata.type !== 'directory') {
        throw new Error('root 文件后端 write target parent 不是目录')
      }
      const targetMode = normalizeMode(
        requestedMode,
        0o600
      )
      const targetUid = 0
      const targetGid = 0
      const stage = staging.allocate('upload')
      let operationError
      let cleanStage = true
      try {
        let createResult
        try {
          createResult = await sftp.createExclusiveFile(
            stage.path,
            bytesToBase64(bytes),
            0o600
          )
        } catch (error) {
          cleanStage = false
          throw await handleUploadCreateFailure(stage, error, {
            sha256: digest,
            size: bytes.byteLength
          })
        }
        const createError = exclusiveCreateFailure(createResult, 'upload stage')
        if (createError) {
          cleanStage = false
          throw await handleUploadCreateFailure(stage, createError, {
            sha256: digest,
            size: bytes.byteLength
          })
        }
        staging.remember(stage.path, {
          sha256: digest,
          size: String(bytes.byteLength)
        })
        const imported = digestResult(await executeStageImport(
          stage, targetPath, targetParentMetadata, {
            ...staging.rootBinding,
            objectName: stage.objectName,
            targetPath,
            sha256: digest,
            size: String(bytes.byteLength),
            targetMode: targetMode.toString(8),
            targetUid: String(targetUid),
            targetGid: String(targetGid),
            mustBeAbsent: '1',
            ...targetParentBindingArgs(targetParentPath, targetParentMetadata),
            targetDevice: '0',
            targetInode: '0'
          }), 'stage-import')
        if (imported.sha256 !== digest || imported.size !== bytes.byteLength) {
          throw new Error('root 文件后端 stage-import 摘要或大小不匹配')
        }
      } catch (error) {
        operationError = error
      }
      if (cleanStage) {
        try {
          await staging.cleanup(stage.path)
        } catch (cleanupError) {
          if (operationError) operationError.cleanupError ||= cleanupError
          else operationError = cleanupError
        }
      }
      if (operationError) throw operationError
      return 1
    },
    async mkdir (path) {
      const remotePath = canonicalFilePath(path)
      const current = await lstatOrMissing(remotePath)
      if (current) {
        const entry = await boundMutationEntry(
          remotePath,
          'mkdir existing directory'
        )
        if (entry.metadata.type !== 'directory') {
          const error = new Error(
            `root 文件后端 mkdir target 已存在且不是目录：${remotePath}`
          )
          error.code = 'EEXIST'
          throw error
        }
        return 1
      }
      const { parent, parentPath } = await boundAbsentParent(
        remotePath,
        'mkdir'
      )
      await invalidateReadStreams(remotePath)
      await executeRequest('mkdir-bound', {
        targetPath: remotePath,
        ...targetParentBindingArgs(parentPath, parent),
        targetMode: '700',
        targetUid: '0',
        targetGid: '0'
      })
      return 1
    },
    async touch (path) {
      const remotePath = canonicalFilePath(path)
      const current = await lstatOrMissing(remotePath)
      if (!current) return rawFacade.writeFile(remotePath, new Uint8Array(), 0o600)
      const entry = await boundMutationEntry(remotePath, 'touch')
      if (entry.metadata.type !== 'file') {
        throw new Error('root 文件后端 touch target 必须为普通文件')
      }
      await invalidateReadStreams(remotePath)
      await executeRequest('touch-bound', boundTargetArgs(remotePath, entry))
      return 1
    },
    async rename (source, target, options) {
      const { signal } = normalizeCancellableOptions(options)
      const sourcePath = canonicalFilePath(source, 'source')
      const targetPath = canonicalFilePath(target, 'target')
      if (sourcePath === targetPath) return 1
      throwIfAborted(signal)
      const sourceMetadata = requireBoundMetadata(
        await rawFacade.lstat(sourcePath, { signal }),
        sourcePath,
        'rename source'
      )
      if (!['file', 'directory'].includes(sourceMetadata.type)) {
        throw new Error('root 文件后端 rename source 必须为普通文件或目录')
      }
      if (await lstatOrMissing(targetPath, signal)) {
        const error = new Error(`root 文件后端 rename target 已存在：${targetPath}`)
        error.code = 'EEXIST'
        throw error
      }
      const targetParentPath = parentFilePath(targetPath)
      const targetParent = requireBoundMetadata(
        await rawFacade.lstat(targetParentPath, { signal }),
        targetParentPath,
        'rename target parent'
      )
      if (targetParent.type !== 'directory') {
        throw new Error('root 文件后端 rename target parent 不是目录')
      }
      const sourceParentPath = parentFilePath(sourcePath)
      const sourceParent = sourceParentPath === targetParentPath
        ? targetParent
        : requireBoundMetadata(
          await rawFacade.lstat(sourceParentPath, { signal }),
          sourceParentPath,
          'rename source parent'
        )
      if (sourceParent.type !== 'directory' ||
        String(sourceParent.device) !== String(sourceMetadata.parentDevice) ||
        String(sourceParent.inode) !== String(sourceMetadata.parentInode)) {
        throw new Error('root 文件后端 rename source parent binding 发生变化')
      }
      if (String(sourceMetadata.device) !== String(sourceMetadata.parentDevice) ||
        String(sourceMetadata.device) !== String(targetParent.device)) {
        const error = new Error('root 文件后端 rename 不允许跨文件系统')
        error.code = 'EXDEV'
        throw error
      }
      await invalidateReadStreams(sourcePath, targetPath)
      await executeRequest('rename-bound', {
        sourcePath,
        ...sourceBindingArgs(sourceMetadata),
        ...sourceParentTrustArgs(sourceParent),
        sourceType: sourceMetadata.type,
        targetPath,
        ...targetParentBindingArgs(targetParentPath, targetParent)
      }, { signal })
      return 1
    },
    async rm (path) {
      const remotePath = canonicalFilePath(path)
      const entry = await boundMutationEntry(remotePath, 'rm')
      if (entry.metadata.type !== 'file') {
        throw new Error('root 文件后端 rm target 必须为普通文件')
      }
      await invalidateReadStreams(remotePath)
      await executeRequest('remove-bound', await prepareBoundRemoval(
        remotePath,
        entry.metadata,
        null,
        'rm'
      ))
      return 1
    },
    async rmdir (path) {
      const remotePath = canonicalFilePath(path)
      const entry = await boundMutationEntry(remotePath, 'rmdir')
      if (entry.metadata.type !== 'directory') {
        throw new Error('root 文件后端 rmdir target 必须为目录')
      }
      await invalidateReadStreams(remotePath)
      await executeRequest('remove-bound', await prepareBoundRemoval(
        remotePath,
        entry.metadata,
        null,
        'rmdir'
      ))
      return 1
    },
    async chmod (path, mode) {
      const remotePath = canonicalFilePath(path)
      const targetMode = normalizeMode(mode).toString(8)
      const entry = await boundMutationEntry(remotePath, 'chmod')
      await executeRequest('metadata-bound', {
        ...boundTargetArgs(remotePath, entry),
        targetMode,
        targetUid: String(entry.metadata.uid),
        targetGid: String(entry.metadata.gid)
      })
      return 1
    },
    async chown (path, uid, gid) {
      const remotePath = canonicalFilePath(path)
      const entry = await boundMutationEntry(remotePath, 'chown')
      await executeRequest('metadata-bound', {
        ...boundTargetArgs(remotePath, entry),
        targetMode: normalizeMode(entry.metadata.mode & 0o7777).toString(8),
        targetUid: String(uid),
        targetGid: String(gid)
      })
      return 1
    },
    copyEntry: copyTree,
    removeEntry: removeTree,
    cp: copyTree,
    mv: (source, target, options) => rawFacade.rename(source, target, options),
    async describeRecoveryEntry (path, options) {
      const { signal, allowAbsent } = normalizeRecoveryDescribeOptions(options)
      return describeRecoveryState(path, signal, allowAbsent)
    },
    async describeResumeEntry (path, boundarySize = 64 * 1024) {
      const remotePath = canonicalFilePath(path)
      const limit = Math.min(
        readChunkBytes,
        Math.max(1, Number(boundarySize) || readChunkBytes)
      )
      const stat = requireBoundMetadata(
        await rawFacade.lstat(remotePath),
        remotePath,
        'resume source'
      )
      if (stat.type !== 'file') {
        throw new Error('root 文件后端 resume source 必须为普通文件')
      }
      const first = await boundDigest(
        { path: remotePath, metadata: stat },
        'sha256-range-bound', 0, limit
      )
      const lastOffset = Math.max(0, stat.size - limit)
      const last = await boundDigest(
        { path: remotePath, metadata: stat },
        'sha256-range-bound', lastOffset, limit
      )
      return {
        size: stat.size,
        mtimeMs: stat.mtime * 1000,
        firstSha256: first.sha256,
        lastSha256: last.sha256,
        boundarySha256: last.sha256
      }
    }
  }
  function runPublicOperation (work) {
    if (closed) return Promise.reject(new Error('root 文件后端已经释放'))
    const operation = Promise.resolve().then(work)
    activePublicOperations.add(operation)
    operation.finally(() => activePublicOperations.delete(operation))
      .catch(() => {})
    return operation
  }

  const facade = Object.freeze(Object.fromEntries(
    Object.entries(rawFacade).map(([name, operation]) => [
      name,
      (...args) => runPublicOperation(() => operation(...args))
    ])
  ))

  const runtimeIdentity = Object.freeze({
    channel: 'pty-root',
    effectiveUid: '0',
    effectiveUsername: rootIdentity.username
  })

  const backend = {
    channel: 'pty-root',
    runtimeIdentity,
    sftp: facade,
    backend: facade,
    staging,
    capabilities: normalizedCapabilities,
    release () {
      if (releasePromise) return releasePromise
      closed = true
      releasePromise = (async () => {
        let firstError
        await Promise.allSettled([...activePublicOperations])
        await executeTail.catch(() => {})
        for (const record of [...pendingImportCleanups.values()]) {
          try {
            await cleanupImportResidual(record)
          } catch (error) {
            firstError ||= error
          }
        }
        for (const objectName of [...pendingDigestCleanups]) {
          try {
            staging.assertCurrent()
            await executeRequest('digest-cleanup', {
              ...staging.rootBinding,
              objectName
            })
            pendingDigestCleanups.delete(objectName)
          } catch (error) {
            firstError ||= error
          }
        }
        try { await staging.release() } catch (error) { firstError ||= error }
        try {
          const released = await lease.release()
          if (released !== true) throw new Error('root 文件后端 PTY lease 释放失败')
        } catch (error) {
          firstError ||= error
        }
        if (firstError) throw firstError
        return true
      })()
      return releasePromise
    }
  }
  return Object.freeze(backend)
}
