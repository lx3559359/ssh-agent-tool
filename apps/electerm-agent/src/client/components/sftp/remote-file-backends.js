import {
  createPrivilegedFileProtocol,
  createPrivilegedFileRequest
} from './privileged-file-protocol.js'
import { createPrivilegedStagingSession } from './privileged-file-staging.js'

const fileTypeChars = Object.freeze({
  file: '-',
  directory: 'd',
  symlink: 'l'
})
const missingCodes = new Set([2, 'ENOENT', 'SFTP_NO_SUCH_FILE'])

function isMissingError (error) {
  return missingCodes.has(error?.code) ||
    /no such|not found|does not exist/i.test(String(error?.message || error))
}

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
  if (!sftp) throw new Error('root 文件后端缺少 SFTP')
  if (typeof lease?.execute !== 'function' || typeof lease?.release !== 'function') {
    throw new Error('root 文件后端缺少 bounded lease 合同')
  }
  const rootIdentity = requireIdentity(identity)
  const protocol = createPrivilegedFileProtocol()
  let closed = false
  let staging
  let releasePromise

  async function releaseLeaseAfterFailure (error) {
    try {
      const released = await lease.release()
      if (released !== true) throw new Error('root 文件后端 PTY lease 释放失败')
    } catch (releaseError) {
      if (!error.releaseError) error.releaseError = releaseError
    }
  }

  async function executeRequest (operation, args = {}, allowClosed = false) {
    if (closed && !allowClosed) throw new Error('root 文件后端已经释放')
    const request = createPrivilegedFileRequest({ operation, args })
    const result = await lease.execute({ protocol, request })
    if (!result || result.exitCode !== 0 || result.kind !== operation || result.ok === false) {
      const error = new Error(`root 文件操作失败：${operation}`)
      error.code = 'PRIVILEGED_FILE_OPERATION_FAILED'
      error.operation = operation
      throw error
    }
    return result
  }

  try {
    staging = await createPrivilegedStagingSession({
      sftp,
      execute: request => lease.execute({ protocol, request }),
      ...(createToken ? { createToken } : {})
    })
  } catch (error) {
    closed = true
    await releaseLeaseAfterFailure(error)
    throw error
  }

  const readStages = new Map()

  async function cleanupStageAfterError (stage, error) {
    try {
      await staging.cleanup(stage.path)
    } catch (cleanupError) {
      if (!error.cleanupError) error.cleanupError = cleanupError
    }
    throw error
  }

  async function readWholeStage (stage, expected) {
    const parts = []
    let offset = 0
    let totalBytes
    do {
      const chunk = await sftp.readFileChunk(stage.path, {
        offset,
        maxBytes: 64 * 1024
      })
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
        (chunk.hasMore && bytes.byteLength === 0)) {
        throw new Error('root 文件后端 SFTP stage 分块长度无效')
      }
      parts.push(bytes)
      offset = chunk.nextOffset
    } while (offset < totalBytes)
    const bytes = concatBytes(parts, offset)
    const digest = await sha256Hex(bytes)
    if (bytes.byteLength !== expected.size || digest !== expected.sha256) {
      throw new Error('root 文件后端 SFTP stage 摘要或大小不匹配')
    }
    return bytes
  }

  async function requireReadStage (sourcePath) {
    if (closed) throw new Error('root 文件后端已经释放')
    const path = canonicalFilePath(sourcePath, 'sourcePath')
    if (readStages.has(path)) return readStages.get(path)
    const pending = (async () => {
      const stage = staging.allocate('download')
      try {
        const exported = digestResult(await executeRequest('stage-export', {
          ...staging.rootBinding,
          objectName: stage.objectName,
          sourcePath: path
        }), 'stage-export')
        const bytes = await readWholeStage(stage, exported)
        return Object.freeze({ stage, bytes })
      } catch (error) {
        return cleanupStageAfterError(stage, error)
      }
    })()
    readStages.set(path, pending)
    try {
      return await pending
    } catch (error) {
      readStages.delete(path)
      throw error
    }
  }

  async function fixedMutation (operation, args) {
    await executeRequest(operation, args)
    return 1
  }

  const facade = {
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
      return metadataResult(await executeRequest('lstat', {
        path: canonicalFilePath(path)
      }))
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
      const cached = await requireReadStage(path)
      return new TextDecoder().decode(cached.bytes)
    },
    async readFileChunk (path, options = {}) {
      const cached = await requireReadStage(path)
      const requestedOffset = options.offset === undefined ? 0 : Number(options.offset)
      const requestedMaxBytes = options.maxBytes === undefined
        ? 64 * 1024
        : Number(options.maxBytes)
      if (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0 ||
        !Number.isSafeInteger(requestedMaxBytes) || requestedMaxBytes < 1) {
        throw new Error('root 文件后端 readFileChunk 范围无效')
      }
      const offset = Math.min(requestedOffset, cached.bytes.byteLength)
      const maxBytes = Math.min(requestedMaxBytes, 64 * 1024)
      const bytes = cached.bytes.subarray(
        offset,
        Math.min(cached.bytes.byteLength, offset + maxBytes)
      )
      const nextOffset = offset + bytes.byteLength
      return {
        base64: bytesToBase64(bytes),
        offset,
        nextOffset,
        bytesRead: bytes.byteLength,
        totalBytes: cached.bytes.byteLength,
        hasMore: nextOffset < cached.bytes.byteLength
      }
    },
    async writeFile (path, value, requestedMode) {
      if (closed) throw new Error('root 文件后端已经释放')
      const targetPath = canonicalFilePath(path, 'targetPath')
      const bytes = inputBytes(value)
      const digest = await sha256Hex(bytes)
      let targetMetadata
      try {
        targetMetadata = await facade.lstat(targetPath)
      } catch (error) {
        const absentResult = error?.code === 'PRIVILEGED_FILE_OPERATION_FAILED' &&
          error.operation === 'lstat'
        if (!isMissingError(error) && !absentResult) throw error
      }
      const targetMode = normalizeMode(
        requestedMode,
        targetMetadata ? targetMetadata.mode & 0o7777 : 0o600
      )
      const targetUid = targetMetadata?.uid ?? 0
      const targetGid = targetMetadata?.gid ?? 0
      const stage = staging.allocate('upload')
      let operationError
      try {
        await sftp.createExclusiveFile(stage.path, bytesToBase64(bytes), 0o600)
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
      try {
        await staging.cleanup(stage.path)
      } catch (cleanupError) {
        if (operationError) operationError.cleanupError ||= cleanupError
        else operationError = cleanupError
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
      const [cached, stat] = await Promise.all([
        requireReadStage(remotePath),
        facade.lstat(remotePath)
      ])
      const limit = Math.min(
        64 * 1024,
        Math.max(1, Number(boundarySize) || 64 * 1024)
      )
      const first = cached.bytes.subarray(0, limit)
      const last = cached.bytes.byteLength > limit
        ? cached.bytes.subarray(cached.bytes.byteLength - limit)
        : first
      const [firstSha256, lastSha256] = await Promise.all([
        sha256Hex(first),
        sha256Hex(last)
      ])
      return {
        size: cached.bytes.byteLength,
        mtimeMs: stat.mtime * 1000,
        firstSha256,
        lastSha256,
        boundarySha256: lastSha256
      }
    }
  }
  Object.freeze(facade)

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
