import { createPtyTaskToken } from '../operations-toolkit/runtime/pty-task-protocol.js'
import { createPrivilegedFileRequest } from './privileged-file-protocol.js'

const stageBaseName = '.shellpilot-privileged-transfers'
const safeObjectName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const missingCodes = new Set([2, 'ENOENT', 'SFTP_NO_SUCH_FILE'])

function isMissingError (error) {
  return missingCodes.has(error?.code) ||
    /no such|not found|does not exist/i.test(String(error?.message || error))
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

function decodeText (value) {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(value)
  return String(value ?? '')
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
  if (result.cleanupError) {
    error.cleanupError = new Error(String(result.cleanupError))
  }
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

async function removeKnownFile (sftp, path, assertCurrent = () => {}) {
  assertCurrent()
  if (!await lstatOrNull(sftp, path)) return
  assertCurrent()
  await sftp.rm(path)
}

async function removeKnownEmptyDirectory (sftp, path, assertCurrent = () => {}) {
  assertCurrent()
  if (!await lstatOrNull(sftp, path)) return false
  assertCurrent()
  const entries = await sftp.list(path)
  assertCurrent()
  if (!Array.isArray(entries) || entries.length !== 0) return false
  await sftp.removeEmptyDirectory(path)
  return true
}

export async function createPrivilegedStagingSession ({
  sftp,
  execute,
  createToken = createPtyTaskToken
} = {}) {
  if (!sftp || typeof sftp.getHomeDir !== 'function' ||
    typeof sftp.realpath !== 'function' || typeof sftp.lstat !== 'function' ||
    typeof sftp.mkdir !== 'function' ||
    typeof sftp.createExclusiveFile !== 'function' ||
    typeof sftp.removeEmptyDirectory !== 'function') {
    throw new Error('特权暂存区缺少安全 SFTP 合同')
  }
  if (typeof execute !== 'function' || typeof createToken !== 'function') {
    throw new Error('特权暂存区缺少受控执行合同')
  }

  const endpoint = captureEndpoint(sftp)
  const createdFiles = []
  let createdBase = false
  let createdRoot = false
  let base
  let root
  let rootBinding
  try {
    const home = canonicalRemotePath(await sftp.getHomeDir(), 'home')
    const homeRealPath = canonicalRemotePath(await sftp.realpath(home), 'home realpath')
    if (homeRealPath !== home) throw new Error('特权暂存区 home realpath 不匹配')
    base = joinRemotePath(home, stageBaseName)
    let baseStat = await lstatOrNull(sftp, base)
    if (!baseStat) {
      await sftp.mkdir(base, { mode: 0o700 })
      createdBase = true
      baseStat = await sftp.lstat(base)
    }
    requirePrivateDirectory(baseStat, 'base')
    const baseRealPath = canonicalRemotePath(await sftp.realpath(base), 'base realpath')
    if (baseRealPath !== base) throw new Error('特权暂存区 base realpath 不匹配')

    root = joinRemotePath(base, requireToken(createToken, 'session'))
    if (await lstatOrNull(sftp, root)) {
      throw new Error('特权暂存区 session root 已存在')
    }
    await sftp.mkdir(root, { mode: 0o700 })
    createdRoot = true
    const rootStat = requirePrivateDirectory(await sftp.lstat(root), 'session root')
    if (baseStat.uid !== rootStat.uid || baseStat.gid !== rootStat.gid) {
      throw new Error('特权暂存区 base uid/gid 与登录用户创建的 session root 不匹配')
    }
    const rootRealPath = canonicalRemotePath(await sftp.realpath(root), 'root realpath')
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
    requirePrivateFile(
      await sftp.lstat(challengePath),
      rootStat.uid,
      rootStat.gid,
      'challenge'
    )
    if (await lstatOrNull(sftp, responsePath)) {
      throw new Error('特权暂存区 response 已被占用')
    }
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
    requirePrivateFile(
      await sftp.lstat(responsePath),
      rootStat.uid,
      rootStat.gid,
      'response'
    )
    if (decodeText(await sftp.readFile(responsePath)) !== expectedResponse) {
      throw new Error('特权暂存区 response 文件响应不匹配')
    }
    const reboundRoot = requirePrivateDirectory(
      await sftp.lstat(root),
      '握手后 session root'
    )
    if (reboundRoot.uid !== rootStat.uid || reboundRoot.gid !== rootStat.gid) {
      throw new Error('特权暂存区握手后 root uid/gid 不匹配')
    }
    requirePrivateFile(
      await sftp.lstat(challengePath),
      rootStat.uid,
      rootStat.gid,
      '握手后 challenge'
    )
    if (await sha256Hex(decodeText(await sftp.readFile(challengePath))) !== challenge) {
      throw new Error('特权暂存区握手后 challenge 摘要不匹配')
    }
    if (await sftp.realpath(root) !== root) {
      throw new Error('特权暂存区握手后 root realpath 不匹配')
    }
    createdFiles.push(challengePath, responsePath)
    rootBinding = Object.freeze({
      rootPath: root,
      rootRealPath: handshake.rootRealPath,
      rootDevice: handshake.rootDevice,
      rootInode: handshake.rootInode,
      rootUid: handshake.uid,
      rootGid: handshake.gid,
      rootMode: handshake.mode
    })
  } catch (error) {
    let cleanupError
    let sameEndpoint = true
    try { assertEndpoint(sftp, endpoint) } catch (current) {
      sameEndpoint = false
      cleanupError = current
    }
    if (sameEndpoint) {
      for (const path of [...createdFiles].reverse()) {
        try {
          await removeKnownFile(sftp, path, () => assertEndpoint(sftp, endpoint))
        } catch (current) {
          cleanupError ||= current
          if (current?.code === 'PRIVILEGED_STAGING_ENDPOINT_CHANGED') {
            sameEndpoint = false
            break
          }
        }
      }
      if (sameEndpoint && createdRoot) {
        try {
          await removeKnownEmptyDirectory(sftp, root, () => assertEndpoint(sftp, endpoint))
        } catch (current) {
          cleanupError ||= current
          if (current?.code === 'PRIVILEGED_STAGING_ENDPOINT_CHANGED') sameEndpoint = false
        }
      }
      if (sameEndpoint && createdBase) {
        try {
          await removeKnownEmptyDirectory(sftp, base, () => assertEndpoint(sftp, endpoint))
        } catch (current) {
          cleanupError ||= current
        }
      }
    }
    if (cleanupError && !error.cleanupError) error.cleanupError = cleanupError
    throw error
  }

  const records = new Map(createdFiles.map(path => [path, path.slice(root.length + 1)]))
  let state = 'active'
  let releasePromise

  function assertActive () {
    if (state !== 'active') throw new Error('特权暂存区已经释放')
    assertEndpoint(sftp, endpoint)
  }

  function normalizeOwnedPath (value) {
    const path = canonicalRemotePath(value, '对象路径')
    if (!path.startsWith(`${root}/`)) {
      throw new Error('特权暂存区对象路径逃离 session root')
    }
    const objectName = path.slice(root.length + 1)
    if (!safeObjectName.test(objectName) || objectName.includes('/')) {
      throw new Error('特权暂存区对象路径无效')
    }
    return { path, objectName }
  }

  async function cleanupOwned (path, requireActive = true) {
    if (requireActive) assertActive()
    else assertEndpoint(sftp, endpoint)
    const owned = normalizeOwnedPath(path)
    if (!records.has(owned.path)) {
      throw new Error('特权暂存区对象未由本 session 记录')
    }
    const request = createPrivilegedFileRequest({
      operation: 'stage-cleanup',
      args: { ...rootBinding, objectName: owned.objectName }
    })
    const result = await execute(request)
    assertEndpoint(sftp, endpoint)
    if (result?.kind !== 'stage-cleanup' || result.ok !== true) {
      throw new Error('特权暂存区对象清理失败')
    }
    if (await lstatOrNull(sftp, owned.path)) {
      throw new Error('特权暂存区对象清理后仍存在')
    }
    records.delete(owned.path)
    return true
  }

  const session = {
    root,
    rootBinding,
    allocate (direction) {
      assertActive()
      if (!['upload', 'download'].includes(direction)) {
        throw new Error('特权暂存区 direction 无效')
      }
      const objectName = `${direction}-${requireToken(createToken, 'object')}`
      const path = joinRemotePath(root, objectName)
      if (records.has(path)) throw new Error('特权暂存区对象名冲突')
      records.set(path, objectName)
      return Object.freeze({ direction, objectName, path })
    },
    remember (value) {
      assertActive()
      const owned = normalizeOwnedPath(value)
      records.set(owned.path, owned.objectName)
      return owned.path
    },
    abandon (value) {
      assertActive()
      const owned = normalizeOwnedPath(value)
      if (!records.has(owned.path)) {
        throw new Error('特权暂存区对象未由本 session 记录')
      }
      records.delete(owned.path)
      return true
    },
    cleanup (value) {
      return cleanupOwned(value)
    },
    release () {
      if (releasePromise) return releasePromise
      state = 'releasing'
      releasePromise = (async () => {
        let firstError
        let endpointValid = true
        try { assertEndpoint(sftp, endpoint) } catch (error) {
          firstError = error
          endpointValid = false
        }
        for (const path of endpointValid ? [...records.keys()] : []) {
          try {
            await cleanupOwned(path, false)
          } catch (error) {
            firstError ||= error
            if (error?.code === 'PRIVILEGED_STAGING_ENDPOINT_CHANGED') {
              endpointValid = false
              break
            }
          }
        }
        if (endpointValid && records.size === 0) {
          try {
            await removeKnownEmptyDirectory(
              sftp,
              root,
              () => assertEndpoint(sftp, endpoint)
            )
          } catch (error) {
            firstError ||= error
            if (error?.code === 'PRIVILEGED_STAGING_ENDPOINT_CHANGED') {
              endpointValid = false
            }
          }
        }
        if (endpointValid && createdBase && records.size === 0) {
          try {
            await removeKnownEmptyDirectory(
              sftp,
              base,
              () => assertEndpoint(sftp, endpoint)
            )
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
