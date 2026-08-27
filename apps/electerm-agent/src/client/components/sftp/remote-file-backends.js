import {
  createPrivilegedFileProtocol,
  createPrivilegedFileRequest
} from './privileged-file-protocol.js'
import { createPrivilegedStagingSession } from './privileged-file-staging.js'
import { createStreamingSha256 } from './streaming-sha256.js'

const readChunkBytes = 64 * 1024
const maxReadFileBytes = 8 * 1024 * 1024
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

function inputBytes (value) {
  if (value instanceof Uint8Array) return new Uint8Array(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  return new TextEncoder().encode(String(value ?? ''))
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

function targetParentBindingArgs (parentPath, metadata) {
  return {
    targetParentRealPath: parentPath,
    targetParentDevice: String(metadata.device),
    targetParentInode: String(metadata.inode)
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
      staging.abandon(scratch.path)
      return result
    } catch (error) {
      try { staging.preserve(scratch.path) } catch (preserveError) {
        error.cleanupError ||= preserveError
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

  async function fixedMutation (operation, args, affectedPaths = []) {
    if (affectedPaths.length) await invalidateReadStreams(...affectedPaths)
    await executeRequest(operation, args)
    return 1
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
      const imported = digestResult(await executeRequest('stage-import', {
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
      }, { signal }), 'stage-import')
      if (imported.sha256 !== exported.sha256 || imported.size !== exported.size) {
        throw new Error('root 文件后端复制导入摘要或大小不匹配')
      }
      targetCreated = {
        device: imported.targetDevice,
        inode: imported.targetInode
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
    const { signal } = normalizeCancellableOptions(options)
    const sourcePath = canonicalFilePath(source, 'source')
    const targetPath = canonicalFilePath(target, 'target')
    if (isSameOrChildPath(targetPath, sourcePath)) {
      throw new Error('root 文件后端复制目标不能位于复制源内部')
    }
    throwIfAborted(signal)
    const manifest = await buildTreeManifest(sourcePath, signal)
    if (await lstatOrMissing(targetPath, signal)) {
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
    await invalidateReadStreams(targetPath)
    const created = []
    const createdDirectories = new Map([[
      targetParentPath,
      {
        device: targetParentMetadata.device,
        inode: targetParentMetadata.inode
      }
    ]])
    let primaryError
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
            targetMode: normalizeMode(entry.metadata.mode & 0o7777).toString(8),
            targetUid: String(entry.metadata.uid),
            targetGid: String(entry.metadata.gid)
          }, { signal })
          if (!/^(?:0|[1-9]\d{0,19})$/.test(binding.device) ||
            !/^(?:0|[1-9]\d{0,19})$/.test(binding.inode)) {
            throw new Error('root 文件后端 mkdir binding 结果无效')
          }
          created.push({
            path: destination,
            type: 'directory',
            parentBinding,
            binding
          })
          createdDirectories.set(destination, binding)
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
    } catch (error) {
      primaryError = error
    }
    if (primaryError) {
      for (const entry of created.reverse()) {
        try {
          await executeRequest(
            'remove-bound',
            {
              targetPath: entry.path,
              ...targetParentBindingArgs(
                parentFilePath(entry.path),
                entry.parentBinding
              ),
              targetDevice: entry.binding.device,
              targetInode: entry.binding.inode,
              targetType: entry.type
            }
          )
        } catch (rollbackError) {
          primaryError.rollbackError ||= rollbackError
        }
      }
      throw primaryError
    }
    return 1
  }

  async function removeTree (path, options) {
    const { signal } = normalizeCancellableOptions(options)
    const remotePath = canonicalFilePath(path)
    throwIfAborted(signal)
    const manifest = await buildTreeManifest(remotePath, signal)
    await invalidateReadStreams(remotePath)
    for (const entry of manifest.reverse()) {
      throwIfAborted(signal)
      await executeRequest(
        'remove-bound',
        {
          targetPath: entry.path,
          targetParentRealPath: entry.metadata.parentRealPath,
          targetParentDevice: String(entry.metadata.parentDevice),
          targetParentInode: String(entry.metadata.parentInode),
          targetDevice: String(entry.metadata.device),
          targetInode: String(entry.metadata.inode),
          targetType: entry.metadata.type
        },
        { signal }
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
    async writeFile (path, value, requestedMode) {
      const targetPath = canonicalFilePath(path, 'targetPath')
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
      const bytes = inputBytes(value)
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
        const imported = digestResult(await executeRequest('stage-import', {
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
    mkdir: path => {
      const remotePath = canonicalFilePath(path)
      return fixedMutation('mkdir', { path: remotePath }, [remotePath])
    },
    touch: path => {
      const remotePath = canonicalFilePath(path)
      return fixedMutation('touch', { path: remotePath }, [remotePath])
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
        sourceType: sourceMetadata.type,
        targetPath,
        ...targetParentBindingArgs(targetParentPath, targetParent)
      }, { signal })
      return 1
    },
    rm: path => {
      const remotePath = canonicalFilePath(path)
      return fixedMutation('rm', { path: remotePath }, [remotePath])
    },
    rmdir: path => {
      const remotePath = canonicalFilePath(path)
      return fixedMutation('rmdir', { path: remotePath }, [remotePath])
    },
    chmod: (path, mode) => fixedMutation('chmod', {
      path: canonicalFilePath(path),
      mode: normalizeMode(mode).toString(8)
    }),
    chown: (path, uid, gid) => fixedMutation('chown', {
      path: canonicalFilePath(path),
      uid: String(uid),
      gid: String(gid)
    }),
    copyEntry: copyTree,
    removeEntry: removeTree,
    cp: copyTree,
    mv: (source, target, options) => rawFacade.rename(source, target, options),
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
