import { createPrivilegedFileRequest } from './privileged-file-protocol.js'
import {
  createNativeSftpFileBackend,
  createPrivilegedFileBackend
} from './remote-file-backends.js'
import { assertExactSshTerminalEndpoint } from './sftp-safety-endpoint.js'
import { assertSameSessionEndpoint } from '../../common/safety-transactions/endpoint-guard.js'

const remoteFileMethodNames = Object.freeze([
  'list',
  'lstat',
  'stat',
  'readlink',
  'realpath',
  'readFile',
  'readFileChunk',
  'writeFile',
  'mkdir',
  'touch',
  'rename',
  'rm',
  'rmdir',
  'chmod',
  'chown',
  'copyEntry',
  'removeEntry',
  'cp',
  'mv',
  'describeResumeEntry',
  'upload',
  'download'
])

function requiredIdentity (value, label) {
  const identity = String(value ?? '').trim()
  if (!identity) throw new Error(`远程文件端点缺少${label}`)
  return identity
}

export function assertExactRemoteFileEndpoint ({
  tab = {},
  sftp,
  terminalEndpoint
} = {}) {
  const endpoint = assertExactSshTerminalEndpoint({ tab, terminalEndpoint })
  const sftpTerminalId = requiredIdentity(
    sftp?.terminalId,
    'SFTP 标签页标识'
  )
  if (sftpTerminalId !== endpoint.tabId) {
    throw new Error('远程文件 SFTP 与 SSH 标签页端点不一致')
  }
  const sftpGeneration = requiredIdentity(
    sftp?.sshSessionGeneration,
    'SFTP SSH session generation'
  )
  if (sftpGeneration !== endpoint.sshSessionGeneration) {
    throw new Error('远程文件 SFTP 与 SSH session generation 不一致')
  }
  const sftpTerminalPid = requiredIdentity(
    sftp?.sshTerminalPid,
    'SFTP SSH terminal PID'
  )
  if (sftpTerminalPid !== String(endpoint.sshTerminalPid)) {
    throw new Error('远程文件 SFTP 与 SSH terminal PID 不一致')
  }
  return endpoint
}

export function remoteFileIdentityUnavailable (cause) {
  const error = new Error(
    '无法确认当前终端文件操作身份，远程文件操作尚未发送。'
  )
  error.name = 'RemoteFileIdentityUnavailableError'
  error.code = 'REMOTE_FILE_IDENTITY_UNAVAILABLE'
  if (cause) error.cause = cause
  return error
}

function remoteFileCapabilityReleased () {
  const error = new Error('远程文件 capability 已经释放或正在关闭。')
  error.name = 'RemoteFileCapabilityReleasedError'
  error.code = 'REMOTE_FILE_CAPABILITY_RELEASED'
  return error
}

function projectCapabilityRuntimeIdentity (channel, identity) {
  if (channel === 'sftp') return null
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error('远程文件 capability 运行身份无效')
  }
  const projected = {
    channel: requiredIdentity(identity.channel, '运行身份通道'),
    effectiveUid: requiredIdentity(identity.effectiveUid, '运行身份 UID'),
    effectiveUsername: requiredIdentity(
      identity.effectiveUsername,
      '运行身份用户名'
    )
  }
  if (projected.channel !== channel) {
    throw new Error('远程文件 capability 运行身份通道不一致')
  }
  return Object.freeze(projected)
}

function projectCapabilityCapabilities (capabilities) {
  if (capabilities === null || capabilities === undefined) return null
  if (!capabilities || typeof capabilities !== 'object' ||
    Array.isArray(capabilities)) {
    throw new Error('远程文件 capability capabilities 无效')
  }
  const entries = Object.entries(capabilities)
  if (entries.some(([name, enabled]) => (
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name) ||
    typeof enabled !== 'boolean'
  ))) {
    throw new Error('远程文件 capability capabilities 无效')
  }
  return Object.freeze(Object.fromEntries(entries))
}

function requireProbeResult (probe) {
  if (!probe || probe.exitCode !== 0 || probe.kind !== 'probe') {
    throw new Error('远程文件身份 probe 未成功完成')
  }
  const uid = requiredIdentity(probe.identity?.uid, '当前有效 UID')
  const username = requiredIdentity(
    probe.identity?.username,
    '当前有效用户名'
  )
  return Object.freeze({ uid, username })
}

function createBackendLease (pty) {
  return Object.freeze({
    execute: ({ request, signal } = {}) => pty.execute(
      request,
      signal ? { signal } : {}
    ),
    release: () => pty.release()
  })
}

async function releasePty (pty) {
  const released = await pty.release()
  if (released !== true) {
    throw new Error('远程文件 PTY 租约释放失败')
  }
  return true
}

function createGuardedRemoteFileCapability (capability, assertCurrent) {
  let state = 'open'
  let releasePromise
  const activeOperations = new Set()
  const proxies = new WeakMap()

  function beginRelease (excludedOperation) {
    if (releasePromise) return releasePromise
    state = 'closing'
    const pending = [...activeOperations]
      .filter(operation => operation !== excludedOperation)
      .map(operation => operation.settled)
    releasePromise = (async () => {
      await Promise.allSettled(pending)
      try {
        return await capability.release()
      } finally {
        state = 'released'
      }
    })()
    return releasePromise
  }

  async function guardCurrent (operation) {
    try {
      await assertCurrent()
    } catch (cause) {
      let releaseError
      if (state === 'open') {
        try {
          await beginRelease(operation)
        } catch (error) {
          releaseError = error
        }
      }
      const unavailable = remoteFileIdentityUnavailable(cause)
      if (releaseError) unavailable.releaseError = releaseError
      throw unavailable
    }
  }

  function runBackendOperation (operation) {
    if (state !== 'open') {
      return Promise.reject(remoteFileCapabilityReleased())
    }
    let markSettled
    const activeOperation = {
      settled: new Promise(resolve => { markSettled = resolve })
    }
    activeOperations.add(activeOperation)
    return (async () => {
      try {
        await guardCurrent(activeOperation)
        return await operation()
      } finally {
        activeOperations.delete(activeOperation)
        markSettled()
      }
    })()
  }

  function guardBackend (backend) {
    if (!backend || typeof backend !== 'object') return backend
    if (proxies.has(backend)) return proxies.get(backend)
    const guarded = Object.create(null)
    proxies.set(backend, guarded)
    for (const name of remoteFileMethodNames) {
      const operation = Object.getOwnPropertyDescriptor(backend, name)?.value
      if (typeof operation !== 'function') continue
      Object.defineProperty(guarded, name, {
        enumerable: true,
        value: (...args) => runBackendOperation(async () => {
          const result = await Reflect.apply(operation, backend, args)
          return result === backend ? guarded : result
        })
      })
    }
    return Object.freeze(guarded)
  }

  const guardedSftp = guardBackend(capability.sftp)
  const guardedBackend = capability.backend === capability.sftp
    ? guardedSftp
    : guardBackend(capability.backend)
  const channel = requiredIdentity(capability.channel, 'capability 通道')
  if (!['sftp', 'pty-root'].includes(channel)) {
    throw new Error('远程文件 capability 通道无效')
  }
  const guardedCapability = Object.assign(Object.create(null), {
    channel,
    runtimeIdentity: projectCapabilityRuntimeIdentity(
      channel,
      capability.runtimeIdentity
    ),
    sftp: guardedSftp,
    backend: guardedBackend,
    release: () => beginRelease()
  })
  if (Object.hasOwn(capability, 'capabilities')) {
    guardedCapability.capabilities = projectCapabilityCapabilities(
      capability.capabilities
    )
  }
  return Object.freeze(guardedCapability)
}

export async function acquireRemoteFileCapability ({
  operationId,
  tab = {},
  sftp,
  getTerminal,
  signal,
  onIdentity
} = {}) {
  let pty
  let capability
  try {
    const ownerId = requiredIdentity(operationId, '操作标识')
    if (typeof getTerminal !== 'function') {
      throw new Error('远程文件端点缺少终端解析器')
    }
    const tabId = requiredIdentity(tab.id, '标签页标识')
    const terminal = await getTerminal(tabId)
    if (!terminal || typeof terminal.getTerminalSafetyEndpoint !== 'function' ||
      typeof terminal.acquireRemoteFilePtyTask !== 'function') {
      throw new Error('远程文件端点缺少同标签页 SSH 终端')
    }
    const terminalEndpoint = terminal.getTerminalSafetyEndpoint()
    const pinnedEndpoint = assertExactRemoteFileEndpoint({
      tab,
      sftp,
      terminalEndpoint
    })
    const assertCurrent = async () => {
      const currentTerminal = await getTerminal(tabId)
      if (!currentTerminal ||
        typeof currentTerminal.getTerminalSafetyEndpoint !== 'function') {
        throw new Error('当前 SSH 终端已不可用')
      }
      const currentEndpoint = assertExactRemoteFileEndpoint({
        tab,
        sftp,
        terminalEndpoint: currentTerminal.getTerminalSafetyEndpoint()
      })
      assertSameSessionEndpoint(pinnedEndpoint, currentEndpoint)
      return currentEndpoint
    }

    pty = await terminal.acquireRemoteFilePtyTask(ownerId)
    if (!pty || typeof pty.execute !== 'function' ||
      typeof pty.release !== 'function') {
      throw new Error('远程文件 PTY 租约合同无效')
    }
    await assertCurrent()
    const probe = await pty.execute(createPrivilegedFileRequest({
      operation: 'probe'
    }), signal ? { signal } : {})
    const identity = requireProbeResult(probe)
    await assertCurrent()
    const channel = identity.uid === '0' ? 'pty-root' : 'sftp'
    const identityUpdate = Object.freeze({
      loginUsername: requiredIdentity(
        tab.username || tab.user,
        'SSH 登录用户名'
      ),
      effectiveUid: identity.uid,
      effectiveUsername: identity.username,
      channel
    })

    if (channel === 'sftp') {
      const nativePty = pty
      pty = null
      await releasePty(nativePty)
      capability = createNativeSftpFileBackend(sftp)
    } else {
      const backendLease = createBackendLease(pty)
      pty = null
      capability = await createPrivilegedFileBackend({
        sftp,
        lease: backendLease,
        identity,
        capabilities: probe.capabilities
      })
    }

    await assertCurrent()
    capability = createGuardedRemoteFileCapability(capability, assertCurrent)
    await onIdentity?.(identityUpdate)
    await assertCurrent()
    return capability
  } catch (cause) {
    let releaseError
    if (capability) {
      try {
        await capability.release()
      } catch (error) {
        releaseError = error
      }
    } else if (pty) {
      try {
        await releasePty(pty)
      } catch (error) {
        releaseError = error
      }
    }
    const unavailable = remoteFileIdentityUnavailable(cause)
    if (releaseError) unavailable.releaseError = releaseError
    throw unavailable
  }
}
