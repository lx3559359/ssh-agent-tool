import { createPtyTaskToken } from '../operations-toolkit/runtime/pty-task-protocol.js'
import { createPrivilegedFileRequest } from './privileged-file-protocol.js'

const stageBaseName = '.shellpilot-privileged-transfers'
const safeObjectName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const canonicalDigest = /^[a-f0-9]{64}$/
const missingCodes = new Set([2, 'ENOENT', 'SFTP_NO_SUCH_FILE'])

function isMissingError (error) {
  return missingCodes.has(error?.code)
}

function canonicalRemotePath (value, label) {
  const path = String(value ?? '')
  if (!path.startsWith('/') || path.includes('\u0000') ||
    (path.length > 1 && path.endsWith('/')) ||
    path.slice(1).split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`特权暂存区 ${label} 不是规范绝对路径`)
  }
  return path
}

function joinRemotePath (parent, child) {
  return parent === '/' ? `/${child}` : `${parent}/${child}`
}

function requireToken (createToken, label) {
  const token = String(createToken())
  if (!/^[a-fA-F0-9]{48}$/.test(token)) {
    throw new Error(`特权暂存区 ${label} token 无效`)
  }
  return token.toLowerCase()
}

function encodeBase64 (bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64Bytes (value) {
  const text = String(value ?? '')
  if (text.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error('特权暂存区 SFTP Base64 无效')
  }
  const binary = atob(text)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  if (encodeBase64(bytes) !== text) throw new Error('特权暂存区 SFTP Base64 非规范')
  return bytes
}

async function sha256Hex (value) {
  const bytes = value instanceof Uint8Array
    ? value
    : new TextEncoder().encode(String(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function lstatOrNull (sftp, path) {
  try {
    return await sftp.lstat(path)
  } catch (error) {
    if (isMissingError(error)) return null
    throw error
  }
}

async function readExactFile (sftp, path, expectedBytes, assertCurrent) {
  assertCurrent()
  const chunk = await sftp.readFileChunk(path, {
    offset: 0,
    maxBytes: expectedBytes + 1
  })
  assertCurrent()
  if (!chunk || chunk.offset !== 0 || chunk.nextOffset !== expectedBytes ||
    chunk.bytesRead !== expectedBytes || chunk.totalBytes !== expectedBytes ||
    chunk.hasMore !== false) {
    throw new Error('特权暂存区 SFTP bounded file 长度无效')
  }
  const bytes = decodeBase64Bytes(chunk.base64)
  if (bytes.byteLength !== expectedBytes) {
    throw new Error('特权暂存区 SFTP bounded file bytes 无效')
  }
  return bytes
}

function statType (stat) {
  const mode = Number(stat?.mode)
  const isDirectory = typeof stat?.isDirectory === 'function'
    ? stat.isDirectory()
    : stat?.isDirectory === true
  const isFile = typeof stat?.isFile === 'function' && stat.isFile()
  if ((mode & 0o170000) === 0o120000) return 'symlink'
  if ((mode & 0o170000) === 0o040000 || isDirectory) return 'directory'
  if ((mode & 0o170000) === 0o100000 || isFile) return 'file'
  return 'other'
}

function requirePrivateDirectory (stat, label) {
  if (!stat || statType(stat) !== 'directory') {
    throw new Error(`特权暂存区 ${label} 必须是非 symlink 目录`)
  }
  if ((Number(stat.mode) & 0o7777) !== 0o700) {
    throw new Error(`特权暂存区 ${label} mode 必须为 0700`)
  }
  if (!Number.isSafeInteger(stat.uid) || stat.uid < 0 ||
    !Number.isSafeInteger(stat.gid) || stat.gid < 0) {
    throw new Error(`特权暂存区 ${label} uid/gid 无效`)
  }
  return stat
}

function requirePrivateFile (stat, uid, gid, label) {
  if (!stat || statType(stat) !== 'file') {
    throw new Error(`特权暂存区 ${label} 必须是非 symlink 文件`)
  }
  if ((Number(stat.mode) & 0o7777) !== 0o600) {
    throw new Error(`特权暂存区 ${label} mode 必须为 0600`)
  }
  if (stat.uid !== uid) throw new Error(`特权暂存区 ${label} uid 不匹配`)
  if (stat.gid !== gid) throw new Error(`特权暂存区 ${label} gid 不匹配`)
  return stat
}

function directoryMatches (stat, expected) {
  try {
    const actual = requirePrivateDirectory(stat, '待清理目录')
    return actual.uid === expected.uid && actual.gid === expected.gid
  } catch {
    return false
  }
}

function exclusiveCreateFailure (result, label) {
  if (result === 1) return null
  if (result?.ok !== false || result.claimed !== true ||
    result.code !== 'SFTP_EXCLUSIVE_WRITE_FAILED' ||
    typeof result.message !== 'string' || !result.message) {
    return new Error(`特权暂存区 ${label} exclusive create 结果无效`)
  }
  const error = new Error(result.message)
  error.code = result.code
  error.claimed = true
  error.cleanupAttempted = result.cleanupAttempted === true
  error.cleanupSucceeded = result.cleanupSucceeded === true
  if (result.cleanupError) error.cleanupError = new Error(String(result.cleanupError))
  return error
}

function captureEndpoint (sftp) {
  return Object.freeze(Object.fromEntries(
    ['id', 'terminalId', 'port', 'type'].map(key => [key, sftp[key]])
  ))
}

function assertEndpoint (sftp, endpoint) {
  for (const [key, value] of Object.entries(endpoint)) {
    if (sftp[key] !== value) {
      const error = new Error('特权暂存区 SFTP endpoint/session 已变化')
      error.code = 'PRIVILEGED_STAGING_ENDPOINT_CHANGED'
      throw error
    }
  }
}

function normalizeProof (proof) {
  const sha256 = String(proof?.sha256 ?? '').toLowerCase()
  const size = String(proof?.size ?? '')
  if (!canonicalDigest.test(sha256) || !/^(?:0|[1-9]\d*)$/.test(size) ||
    !Number.isSafeInteger(Number(size))) {
    throw new Error('特权暂存区 owned proof sha256/size 无效')
  }
  return Object.freeze({ sha256, size })
}

function preservedDirectoryError (path) {
  const error = new Error(`特权暂存区目录无法安全证明为空且未替换，已保留：${path}`)
  error.code = 'PRIVILEGED_STAGING_DIRECTORY_PRESERVED'
  return error
}

async function removeKnownEmptyDirectory ({
  sftp,
  path,
  expected,
  assertCurrent
}) {
  assertCurrent()
  const before = await lstatOrNull(sftp, path)
  assertCurrent()
  if (!before) return true
  if (!directoryMatches(before, expected)) throw preservedDirectoryError(path)
  const beforeRealPath = await sftp.realpath(path)
  assertCurrent()
  if (beforeRealPath !== path) throw preservedDirectoryError(path)
  const entries = await sftp.list(path)
  assertCurrent()
  if (!Array.isArray(entries) || entries.length !== 0) {
    throw preservedDirectoryError(path)
  }
  const after = await lstatOrNull(sftp, path)
  assertCurrent()
  if (!after) return true
  if (!directoryMatches(after, expected)) throw preservedDirectoryError(path)
  const afterRealPath = await sftp.realpath(path)
  assertCurrent()
  if (afterRealPath !== path) throw preservedDirectoryError(path)
  await sftp.removeEmptyDirectory(path)
  assertCurrent()
  return true
}

export async function createPrivilegedStagingSession ({
  sftp,
  execute,
  createToken = createPtyTaskToken
} = {}) {
  if (!sftp || typeof sftp.getHomeDir !== 'function' ||
    typeof sftp.realpath !== 'function' || typeof sftp.lstat !== 'function' ||
    typeof sftp.list !== 'function' || typeof sftp.mkdir !== 'function' ||
    typeof sftp.readFileChunk !== 'function' ||
    typeof sftp.createExclusiveFile !== 'function' ||
    typeof sftp.removeEmptyDirectory !== 'function') {
    throw new Error('特权暂存区缺少安全 SFTP 合同')
  }
  if (typeof execute !== 'function' || typeof createToken !== 'function') {
    throw new Error('特权暂存区缺少受控执行合同')
  }

  const endpoint = captureEndpoint(sftp)
  const records = new Map()
  const allocations = new Set()
  const uncertainResiduals = new Set()
  let createdBase = false
  let createdRoot = false
  let base
  let root
  let baseStat
  let rootStat
  let rootBinding

  function assertCurrentEndpoint () {
    assertEndpoint(sftp, endpoint)
  }

  function normalizeOwnedPath (value) {
    const path = canonicalRemotePath(value, '对象路径')
    if (!root || !path.startsWith(`${root}/`)) {
      throw new Error('特权暂存区对象路径逃离 session root')
    }
    const objectName = path.slice(root.length + 1)
    if (!safeObjectName.test(objectName) || objectName.includes('/')) {
      throw new Error('特权暂存区对象路径无效')
    }
    return { path, objectName }
  }

  function recordProof (path, proof) {
    const owned = normalizeOwnedPath(path)
    const normalized = normalizeProof(proof)
    records.set(owned.path, Object.freeze({
      objectName: owned.objectName,
      ...normalized
    }))
    uncertainResiduals.delete(owned.path)
    return owned.path
  }

  async function cleanupProofRecord (path) {
    assertCurrentEndpoint()
    const owned = normalizeOwnedPath(path)
    const proof = records.get(owned.path)
    if (!proof) throw new Error('特权暂存区对象未由本 session proof 记录')
    const request = createPrivilegedFileRequest({
      operation: 'stage-cleanup',
      args: {
        ...rootBinding,
        objectName: proof.objectName,
        sha256: proof.sha256,
        size: proof.size
      }
    })
    const result = await execute(request)
    assertCurrentEndpoint()
    if (result?.kind !== 'stage-cleanup' || result.ok !== true) {
      throw new Error('特权暂存区对象清理失败')
    }
    records.delete(owned.path)
    allocations.delete(owned.path)
    uncertainResiduals.delete(owned.path)
    return true
  }

  async function cleanupDirectories (rootWasVerified) {
    if (!rootWasVerified || records.size !== 0 || uncertainResiduals.size !== 0) {
      return false
    }
    const removedRoot = createdRoot && await removeKnownEmptyDirectory({
      sftp,
      path: root,
      expected: rootStat,
      assertCurrent: assertCurrentEndpoint
    })
    if (removedRoot && createdBase) {
      await removeKnownEmptyDirectory({
        sftp,
        path: base,
        expected: baseStat,
        assertCurrent: assertCurrentEndpoint
      })
    }
    return removedRoot
  }

  try {
    const home = canonicalRemotePath(await sftp.getHomeDir(), 'home')
    assertCurrentEndpoint()
    const homeRealPath = canonicalRemotePath(await sftp.realpath(home), 'home realpath')
    assertCurrentEndpoint()
    if (homeRealPath !== home) throw new Error('特权暂存区 home realpath 不匹配')
    base = joinRemotePath(home, stageBaseName)
    baseStat = await lstatOrNull(sftp, base)
    assertCurrentEndpoint()
    if (!baseStat) {
      await sftp.mkdir(base, { mode: 0o700 })
      assertCurrentEndpoint()
      createdBase = true
      baseStat = await sftp.lstat(base)
      assertCurrentEndpoint()
    }
    baseStat = requirePrivateDirectory(baseStat, 'base')
    const baseRealPath = canonicalRemotePath(await sftp.realpath(base), 'base realpath')
    assertCurrentEndpoint()
    if (baseRealPath !== base) throw new Error('特权暂存区 base realpath 不匹配')

    root = joinRemotePath(base, requireToken(createToken, 'session'))
    if (await lstatOrNull(sftp, root)) throw new Error('特权暂存区 session root 已存在')
    assertCurrentEndpoint()
    await sftp.mkdir(root, { mode: 0o700 })
    assertCurrentEndpoint()
    createdRoot = true
    rootStat = requirePrivateDirectory(await sftp.lstat(root), 'session root')
    assertCurrentEndpoint()
    if (baseStat.uid !== rootStat.uid || baseStat.gid !== rootStat.gid) {
      throw new Error('特权暂存区 base uid/gid 与登录用户创建的 session root 不匹配')
    }
    const rootRealPath = canonicalRemotePath(await sftp.realpath(root), 'root realpath')
    assertCurrentEndpoint()
    if (rootRealPath !== root) throw new Error('特权暂存区 root realpath 不匹配')

    const challengeName = `challenge-${requireToken(createToken, 'challenge')}`
    const responseName = `response-${requireToken(createToken, 'response')}`
    const challengeBytes = new TextEncoder().encode(requireToken(createToken, 'challenge value'))
    const challenge = await sha256Hex(challengeBytes)
    const challengePath = joinRemotePath(root, challengeName)
    const responsePath = joinRemotePath(root, responseName)
    if (await lstatOrNull(sftp, challengePath) || await lstatOrNull(sftp, responsePath)) {
      throw new Error('特权暂存区 challenge/response 已存在')
    }
    assertCurrentEndpoint()
    const challengeCreateResult = await sftp.createExclusiveFile(
      challengePath,
      encodeBase64(challengeBytes),
      0o600
    )
    const challengeCreateError = exclusiveCreateFailure(
      challengeCreateResult,
      'challenge'
    )
    if (challengeCreateError) throw challengeCreateError
    recordProof(challengePath, {
      sha256: challenge,
      size: String(challengeBytes.byteLength)
    })
    assertCurrentEndpoint()
    requirePrivateFile(
      await sftp.lstat(challengePath),
      rootStat.uid,
      rootStat.gid,
      'challenge'
    )
    assertCurrentEndpoint()
    if (await lstatOrNull(sftp, responsePath)) {
      throw new Error('特权暂存区 response 已被占用')
    }
    assertCurrentEndpoint()
    const request = createPrivilegedFileRequest({
      operation: 'stage-handshake',
      args: {
        rootPath: root,
        challengeName,
        responseName,
        challenge,
        rootUid: String(rootStat.uid),
        rootGid: String(rootStat.gid),
        rootMode: '700'
      }
    })
    const handshake = await execute(request)
    assertCurrentEndpoint()
    const expectedResponse = await sha256Hex(`${challenge}:root`)
    if (handshake?.exitCode !== 0 || handshake?.identity?.uid !== '0' ||
      typeof handshake.identity.username !== 'string' || !handshake.identity.username ||
      handshake?.kind !== 'stage-handshake' ||
      handshake.response !== expectedResponse) {
      throw new Error('特权暂存区握手 root 身份或响应不匹配')
    }
    if (handshake.rootRealPath !== root || handshake.uid !== String(rootStat.uid) ||
      handshake.gid !== String(rootStat.gid) || handshake.mode !== '700') {
      throw new Error('特权暂存区握手路径或 uid/gid/mode 不匹配')
    }
    if (!/^(?:0|[1-9]\d{0,19})$/.test(handshake.rootDevice) ||
      !/^(?:0|[1-9]\d{0,19})$/.test(handshake.rootInode)) {
      throw new Error('特权暂存区握手 device/inode 无效')
    }
    rootBinding = Object.freeze({
      rootPath: root,
      rootRealPath: handshake.rootRealPath,
      rootDevice: handshake.rootDevice,
      rootInode: handshake.rootInode,
      rootUid: handshake.uid,
      rootGid: handshake.gid,
      rootMode: handshake.mode
    })
    recordProof(responsePath, {
      sha256: await sha256Hex(expectedResponse),
      size: String(new TextEncoder().encode(expectedResponse).byteLength)
    })
    requirePrivateFile(
      await sftp.lstat(responsePath),
      rootStat.uid,
      rootStat.gid,
      'response'
    )
    assertCurrentEndpoint()
    const responseBytes = await readExactFile(
      sftp,
      responsePath,
      64,
      assertCurrentEndpoint
    )
    if (new TextDecoder().decode(responseBytes) !== expectedResponse) {
      throw new Error('特权暂存区 response 文件响应不匹配')
    }
    const reboundRoot = requirePrivateDirectory(
      await sftp.lstat(root),
      '握手后 session root'
    )
    assertCurrentEndpoint()
    if (reboundRoot.uid !== rootStat.uid || reboundRoot.gid !== rootStat.gid) {
      throw new Error('特权暂存区握手后 root uid/gid 不匹配')
    }
    requirePrivateFile(
      await sftp.lstat(challengePath),
      rootStat.uid,
      rootStat.gid,
      '握手后 challenge'
    )
    assertCurrentEndpoint()
    const reboundChallenge = await readExactFile(
      sftp,
      challengePath,
      challengeBytes.byteLength,
      assertCurrentEndpoint
    )
    if (await sha256Hex(reboundChallenge) !== challenge) {
      throw new Error('特权暂存区握手后 challenge 摘要不匹配')
    }
    assertCurrentEndpoint()
    if (await sftp.realpath(root) !== root) {
      throw new Error('特权暂存区握手后 root realpath 不匹配')
    }
    assertCurrentEndpoint()
  } catch (error) {
    let cleanupError
    let rootWasVerified = false
    if (rootBinding) {
      try {
        assertCurrentEndpoint()
        for (const path of [...records.keys()].reverse()) {
          try {
            await cleanupProofRecord(path)
            rootWasVerified = true
          } catch (current) {
            cleanupError ||= current
            if (current?.code === 'PRIVILEGED_STAGING_ENDPOINT_CHANGED') break
          }
        }
        await cleanupDirectories(rootWasVerified)
      } catch (current) {
        cleanupError ||= current
      }
    }
    if (cleanupError) {
      if (!error.cleanupError) error.cleanupError = cleanupError
      else if (!error.cleanupRetryError) error.cleanupRetryError = cleanupError
    }
    throw error
  }

  let state = 'active'
  let releasePromise

  function assertActive () {
    if (state !== 'active') throw new Error('特权暂存区已经释放')
    assertCurrentEndpoint()
  }

  const session = {
    root,
    rootBinding,
    assertCurrent: assertActive,
    allocate (direction) {
      assertActive()
      if (!['upload', 'download'].includes(direction)) {
        throw new Error('特权暂存区 direction 无效')
      }
      const objectName = `${direction}-${requireToken(createToken, 'object')}`
      const path = joinRemotePath(root, objectName)
      if (allocations.has(path) || records.has(path)) {
        throw new Error('特权暂存区对象名冲突')
      }
      allocations.add(path)
      return Object.freeze({ direction, objectName, path })
    },
    remember (value, proof) {
      assertActive()
      const owned = normalizeOwnedPath(value)
      if (!allocations.has(owned.path)) {
        throw new Error('特权暂存区对象未由本 session 分配')
      }
      return recordProof(owned.path, proof)
    },
    preserve (value) {
      if (state !== 'active') throw new Error('特权暂存区已经释放')
      const owned = normalizeOwnedPath(value)
      if (!allocations.has(owned.path)) {
        throw new Error('特权暂存区对象未由本 session 分配')
      }
      uncertainResiduals.add(owned.path)
      return true
    },
    abandon (value) {
      assertActive()
      const owned = normalizeOwnedPath(value)
      if (!allocations.has(owned.path) || records.has(owned.path)) {
        throw new Error('特权暂存区对象不是可放弃的未证明 allocation')
      }
      allocations.delete(owned.path)
      uncertainResiduals.delete(owned.path)
      return true
    },
    async cleanup (value) {
      assertActive()
      return cleanupProofRecord(value)
    },
    release () {
      if (releasePromise) return releasePromise
      state = 'releasing'
      releasePromise = (async () => {
        let firstError
        let endpointValid = true
        let rootWasVerified = false
        try {
          assertCurrentEndpoint()
        } catch (error) {
          firstError = error
          endpointValid = false
        }
        for (const path of endpointValid ? [...records.keys()] : []) {
          try {
            await cleanupProofRecord(path)
            rootWasVerified = true
          } catch (error) {
            firstError ||= error
            if (error?.code === 'PRIVILEGED_STAGING_ENDPOINT_CHANGED') {
              endpointValid = false
              break
            }
          }
        }
        if (endpointValid && uncertainResiduals.size > 0) {
          firstError ||= new Error('特权暂存区存在无法验证内容的 owned residual，已安全保留')
        }
        if (endpointValid) {
          try {
            await cleanupDirectories(rootWasVerified)
          } catch (error) {
            firstError ||= error
          }
        }
        state = 'released'
        if (firstError) throw firstError
        return true
      })()
      return releasePromise
    }
  }
  return Object.freeze(session)
}
