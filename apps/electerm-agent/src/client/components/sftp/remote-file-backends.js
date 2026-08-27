import {
  createPrivilegedFileProtocol,
  createPrivilegedFileRequest
} from './privileged-file-protocol.js'
import { createPrivilegedStagingSession } from './privileged-file-staging.js'
import { createStreamingSha256 } from './streaming-sha256.js'

const readChunkBytes = 64 * 1024
const maxReadFileBytes = 8 * 1024 * 1024

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
  const mode = value === undefined || value === null
    ? fallback
    : typeof value === 'string'
      ? Number.parseInt(value, 8)
      : Number(value)
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) {
    throw new Error('root 文件后端 mode 无效')
  }
  return mode
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

  async function createReadStream (path) {
    const stage = staging.allocate('download')
    let exported
    try {
      exported = digestResult(await executeRequest('stage-export', {
        ...staging.rootBinding,
        objectName: stage.objectName,
        sourcePath: path
      }), 'stage-export')
      staging.remember(stage.path, {
        sha256: exported.sha256,
        size: String(exported.size)
      })
      return {
        path,
        stage,
        proof: exported,
        nextOffset: 0,
        digest: createStreamingSha256()
      }
    } catch (error) {
      if (!exported) {
        try { staging.preserve(stage.path) } catch (preserveError) {
          if (!error.cleanupError) error.cleanupError = preserveError
        }
      }
      throw error
    }
  }

  async function closeReadStream (stream, primaryError) {
    if (readStreams.get(stream.path) === stream) readStreams.delete(stream.path)
    try {
      await staging.cleanup(stream.stage.path)
    } catch (cleanupError) {
      if (primaryError) primaryError.cleanupError ||= cleanupError
      else throw cleanupError
    }
    if (primaryError) throw primaryError
    return true
  }

  async function readStreamChunk (stream, maxBytes) {
    staging.assertCurrent()
    const chunk = await sftp.readFileChunk(stream.stage.path, {
      offset: stream.nextOffset,
      maxBytes
    })
    staging.assertCurrent()
    if (!chunk || chunk.offset !== stream.nextOffset ||
      !Number.isSafeInteger(chunk.nextOffset) ||
      !Number.isSafeInteger(chunk.totalBytes) || chunk.totalBytes < 0 ||
      chunk.totalBytes !== stream.proof.size) {
      return closeReadStream(
        stream,
        new Error('root 文件后端 SFTP stage 分块结果无效')
      )
    }
    const bytes = bytesFromBase64(chunk.base64)
    if (bytes.byteLength !== chunk.bytesRead || bytes.byteLength > maxBytes ||
      chunk.nextOffset !== stream.nextOffset + bytes.byteLength ||
      chunk.nextOffset > chunk.totalBytes ||
      chunk.hasMore !== (chunk.nextOffset < chunk.totalBytes) ||
      (chunk.hasMore && bytes.byteLength === 0)) {
      return closeReadStream(
        stream,
        new Error('root 文件后端 SFTP stage 分块长度无效')
      )
    }
    stream.digest.update(bytes)
    stream.nextOffset = chunk.nextOffset
    if (!chunk.hasMore) {
      const proofError = stream.digest.size !== stream.proof.size ||
        stream.digest.digestHex() !== stream.proof.sha256
        ? new Error('root 文件后端 SFTP stage 摘要或大小不匹配')
        : null
      await closeReadStream(stream, proofError)
    }
    return {
      base64: chunk.base64,
      offset: chunk.offset,
      nextOffset: chunk.nextOffset,
      bytesRead: chunk.bytesRead,
      totalBytes: chunk.totalBytes,
      hasMore: chunk.hasMore
    }
  }

  async function readLogicalChunk (path, requestedOffset, requestedMaxBytes) {
    return withReadLock(path, async () => {
      let stream = readStreams.get(path)
      if (requestedOffset === 0) {
        if (stream) await closeReadStream(stream)
        stream = await createReadStream(path)
        readStreams.set(path, stream)
      } else if (!stream || stream.nextOffset !== requestedOffset) {
        if (stream) await closeReadStream(stream)
        throw new Error('root 文件后端 readFileChunk offset 与当前逻辑读取不连续')
      }
      return readStreamChunk(stream, requestedMaxBytes)
    })
  }

  async function fixedMutation (operation, args) {
    await executeRequest(operation, args)
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
    async list (path) {
      const result = await executeRequest('list', {
        path: canonicalFilePath(path)
      })
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
    async lstat (path) {
      const remotePath = canonicalFilePath(path)
      const result = await executeRequest('lstat', { path: remotePath })
      if (result.missing === true) {
        const error = new Error(`No such privileged file: ${remotePath}`)
        error.code = 'ENOENT'
        throw error
      }
      return metadataResult(result)
    },
    async stat (path) {
      return metadataResult(await executeRequest('stat', {
        path: canonicalFilePath(path)
      }))
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
      const parts = []
      let length = 0
      let offset = 0
      let hasMore
      do {
        const chunk = await rawFacade.readFileChunk(remotePath, {
          offset,
          maxBytes: readChunkBytes
        })
        if (chunk.totalBytes > maxReadFileBytes) {
          const error = new Error('root 文件后端 readFile 超过 8 MiB 安全上限')
          const stream = readStreams.get(remotePath)
          if (stream) {
            try { await closeReadStream(stream) } catch (cleanupError) {
              error.cleanupError = cleanupError
            }
          }
          throw error
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
        Math.min(requestedMaxBytes, readChunkBytes)
      )
    },
    async writeFile (path, value, requestedMode) {
      const targetPath = canonicalFilePath(path, 'targetPath')
      const bytes = inputBytes(value)
      const digest = await sha256Hex(bytes)
      let targetMetadata
      try {
        targetMetadata = await rawFacade.lstat(targetPath)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      const targetMode = normalizeMode(
        requestedMode,
        targetMetadata ? targetMetadata.mode & 0o7777 : 0o600
      )
      const targetUid = targetMetadata?.uid ?? 0
      const targetGid = targetMetadata?.gid ?? 0
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
          targetGid: String(targetGid)
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
    mkdir: path => fixedMutation('mkdir', { path: canonicalFilePath(path) }),
    touch: path => fixedMutation('touch', { path: canonicalFilePath(path) }),
    rename: (source, target) => fixedMutation('rename', {
      source: canonicalFilePath(source, 'source'),
      target: canonicalFilePath(target, 'target')
    }),
    rm: path => fixedMutation('rm', { path: canonicalFilePath(path) }),
    rmdir: path => fixedMutation('rmdir', { path: canonicalFilePath(path) }),
    chmod: (path, mode) => fixedMutation('chmod', {
      path: canonicalFilePath(path),
      mode: normalizeMode(mode).toString(8)
    }),
    chown: (path, uid, gid) => fixedMutation('chown', {
      path: canonicalFilePath(path),
      uid: String(uid),
      gid: String(gid)
    }),
    copyEntry: (source, target) => fixedMutation('copy-entry', {
      source: canonicalFilePath(source, 'source'),
      target: canonicalFilePath(target, 'target')
    }),
    removeEntry: path => fixedMutation('remove-entry', {
      path: canonicalFilePath(path)
    }),
    cp: (source, target) => fixedMutation('copy-entry', {
      source: canonicalFilePath(source, 'source'),
      target: canonicalFilePath(target, 'target')
    }),
    mv: (source, target) => fixedMutation('rename', {
      source: canonicalFilePath(source, 'source'),
      target: canonicalFilePath(target, 'target')
    }),
    async describeResumeEntry (path, boundarySize = 64 * 1024) {
      const remotePath = canonicalFilePath(path)
      const limit = Math.min(
        readChunkBytes,
        Math.max(1, Number(boundarySize) || readChunkBytes)
      )
      let offset = 0
      let hasMore
      let totalBytes = 0
      let first = new Uint8Array(0)
      let last = new Uint8Array(0)
      do {
        const chunk = await rawFacade.readFileChunk(remotePath, {
          offset,
          maxBytes: readChunkBytes
        })
        const bytes = bytesFromBase64(chunk.base64)
        if (first.byteLength < limit) {
          const needed = limit - first.byteLength
          first = concatBytes([
            first,
            bytes.subarray(0, needed)
          ], Math.min(limit, first.byteLength + bytes.byteLength))
        }
        if (bytes.byteLength >= limit) {
          last = bytes.subarray(bytes.byteLength - limit)
        } else {
          const retained = last.subarray(Math.max(0, last.byteLength + bytes.byteLength - limit))
          last = concatBytes([retained, bytes], retained.byteLength + bytes.byteLength)
        }
        offset = chunk.nextOffset
        totalBytes = chunk.totalBytes
        hasMore = chunk.hasMore
      } while (hasMore)
      const stat = await rawFacade.lstat(remotePath)
      const [firstSha256, lastSha256] = await Promise.all([
        sha256Hex(first),
        sha256Hex(last)
      ])
      return {
        size: totalBytes,
        mtimeMs: stat.mtime * 1000,
        firstSha256,
        lastSha256,
        boundarySha256: lastSha256
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
    capabilities: capabilities || null,
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
