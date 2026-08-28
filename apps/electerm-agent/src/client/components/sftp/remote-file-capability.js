import { createPrivilegedFileRequest } from './privileged-file-protocol.js'
import {
  createNativeSftpFileBackend,
  createPrivilegedFileBackend
} from './remote-file-backends.js'
import { assertExactSshTerminalEndpoint } from './sftp-safety-endpoint.js'
import { assertSameSessionEndpoint } from '../../common/safety-transactions/endpoint-guard.js'

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
  let invalidationPromise
  const proxies = new WeakMap()

  async function guardCurrent () {
    try {
      await assertCurrent()
    } catch (cause) {
      invalidationPromise ||= Promise.resolve(capability.release())
      let releaseError
      try {
        await invalidationPromise
      } catch (error) {
        releaseError = error
      }
      const unavailable = remoteFileIdentityUnavailable(cause)
      if (releaseError) unavailable.releaseError = releaseError
      throw unavailable
    }
  }

  function guardBackend (backend) {
    if (!backend || typeof backend !== 'object') return backend
    if (proxies.has(backend)) return proxies.get(backend)
    const guarded = new Proxy(backend, {
      get (target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        if (typeof value !== 'function') return value
        return async (...args) => {
          await guardCurrent()
          return Reflect.apply(value, target, args)
        }
      }
    })
    proxies.set(backend, guarded)
    return guarded
  }

  const guardedSftp = guardBackend(capability.sftp)
  const guardedBackend = capability.backend === capability.sftp
    ? guardedSftp
    : guardBackend(capability.backend)
  return Object.freeze({
    ...capability,
    sftp: guardedSftp,
    backend: guardedBackend,
    release: () => capability.release()
  })
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
