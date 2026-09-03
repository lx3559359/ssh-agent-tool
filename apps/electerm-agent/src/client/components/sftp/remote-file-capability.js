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
  'digestFile',
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
  'describeRecoveryEntry',
  'describeResumeEntry'
])

const remoteFileTransferMethodNames = Object.freeze([
  'upload',
  'download'
])

const remoteFileTransferControlNames = Object.freeze([
  'pause',
  'resume',
  'cancel',
  'interrupt',
  'destroy'
])

const guardedCapabilityInternals = new WeakMap()
const nativeIdentityStatusPath = '/proc/self/status'
const nativeIdentityStatusMaxBytes = 16 * 1024

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

function hasExactRootUidLine (content) {
  if (typeof content !== 'string' || !content || content.includes('\u0000')) {
    return false
  }
  const match = content.match(/^Uid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*$/m)
  return Boolean(match && match.slice(1).every(value => value === '0'))
}

async function verifyNativeRootSftp (sftp, loginUsername) {
  if (loginUsername !== 'root' ||
    typeof sftp?.readFilePreview !== 'function') return false
  try {
    const preview = await sftp.readFilePreview(
      nativeIdentityStatusPath,
      nativeIdentityStatusMaxBytes
    )
    return preview?.truncated === false &&
      preview?.binary === false &&
      Number.isSafeInteger(preview?.bytesRead) &&
      preview.bytesRead > 0 &&
      preview.bytesRead <= nativeIdentityStatusMaxBytes &&
      hasExactRootUidLine(preview.content)
  } catch {
    // Servers without procfs keep the existing PTY identity probe path.
    return false
  }
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

function publishRemoteFileLeaseState (onLeaseState, event) {
  if (typeof onLeaseState !== 'function') return
  try {
    Promise.resolve(onLeaseState(Object.freeze(event))).catch(() => {})
  } catch {
    // UI observation must never interfere with lease safety or cleanup.
  }
}

function observeRemoteFilePtyLease (pty, { operationId, onLeaseState }) {
  let releasePromise
  publishRemoteFileLeaseState(onLeaseState, {
    state: 'acquired',
    operationId
  })
  return Object.freeze({
    execute: (request, options) => pty.execute(request, options),
    release: () => {
      if (releasePromise) return releasePromise
      releasePromise = (async () => {
        try {
          const released = await releasePty(pty)
          publishRemoteFileLeaseState(onLeaseState, {
            state: 'released',
            operationId
          })
          return released
        } catch (error) {
          publishRemoteFileLeaseState(onLeaseState, {
            state: 'release-failed',
            operationId,
            error
          })
          throw error
        }
      })()
      return releasePromise
    }
  })
}

function createGuardedRemoteFileCapability (capability, assertCurrent) {
  let state = 'open'
  let releasePromise
  const activeOperations = new Set()
  const activeTransfers = new Set()
  const proxies = new WeakMap()
  let transferCapability
  const guardedRemoteFileMethodNames = capability.channel === 'sftp'
    ? remoteFileMethodNames
    : remoteFileMethodNames.filter(name => name !== 'digestFile')

  function settleActive (operation, collection) {
    if (operation.finished) return
    operation.finished = true
    collection.delete(operation)
    operation.markSettled()
  }

  function beginRelease (excludedOperation) {
    if (releasePromise) return releasePromise
    state = 'closing'
    const operations = [...activeOperations]
      .filter(operation => operation !== excludedOperation)
      .map(operation => operation.settled)
    const transfers = [...activeTransfers]
    const pending = [
      ...operations,
      ...transfers
        .filter(operation => operation !== excludedOperation)
        .map(operation => operation.settled)
    ]
    releasePromise = (async () => {
      const stops = await Promise.allSettled(
        transfers
          .filter(operation => (
            operation !== excludedOperation || operation.hasStarted
          ))
          .map(operation => operation.stopForRelease())
      )
      await Promise.allSettled(pending)
      let firstError = stops.find(result => result.status === 'rejected')?.reason
      try {
        const released = await capability.release()
        if (firstError) throw firstError
        return released
      } catch (error) {
        firstError ||= error
        throw firstError
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
      settled: new Promise(resolve => { markSettled = resolve }),
      markSettled
    }
    activeOperations.add(activeOperation)
    return (async () => {
      try {
        await guardCurrent(activeOperation)
        return await operation()
      } finally {
        settleActive(activeOperation, activeOperations)
      }
    })()
  }

  function guardBackend (backend) {
    if (!backend || typeof backend !== 'object') return backend
    if (proxies.has(backend)) return proxies.get(backend)
    const guarded = Object.create(null)
    proxies.set(backend, guarded)
    for (const name of guardedRemoteFileMethodNames) {
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

  function guardTransferBackend (backend, guardedBackend) {
    const guarded = Object.assign(Object.create(null), guardedBackend)
    for (const name of remoteFileTransferMethodNames) {
      const operation = Object.getOwnPropertyDescriptor(backend, name)?.value
      if (typeof operation !== 'function') continue
      Object.defineProperty(guarded, name, {
        enumerable: true,
        value: (options = {}) => {
          if (state !== 'open') {
            return Promise.reject(remoteFileCapabilityReleased())
          }
          const abortController = new AbortController()
          const callerSignal = options && typeof options === 'object'
            ? options.signal
            : undefined
          let markSettled
          let markStarted
          let inner
          let terminalPromise
          let callerStopPromise
          const transfer = {
            finished: false,
            hasStarted: false,
            terminalClaimed: false,
            settled: new Promise(resolve => { markSettled = resolve }),
            started: new Promise(resolve => { markStarted = resolve }),
            markSettled,
            stopForRelease: async () => {
              abortController.abort(remoteFileCapabilityReleased())
              await transfer.started
              if (transfer.terminalClaimed || transfer.finished) {
                return transfer.settled
              }
              return control('cancel', true, true)
            }
          }

          function finishTransfer () {
            callerSignal?.removeEventListener?.('abort', abortFromCaller)
            settleActive(transfer, activeTransfers)
          }

          function abortFromCaller () {
            if (!abortController.signal.aborted) {
              abortController.abort(callerSignal?.reason)
            }
            callerStopPromise ||= (async () => {
              await transfer.started
              if (transfer.finished || transfer.terminalClaimed) return true
              return control('cancel', true, true)
            })()
            callerStopPromise.catch(() => {})
          }

          function terminal (terminalCallback, args) {
            if (terminalPromise) return terminalPromise
            transfer.terminalClaimed = true
            terminalPromise = (async () => {
              try {
                return await terminalCallback?.(...args)
              } finally {
                finishTransfer()
              }
            })()
            return terminalPromise
          }

          function claimTerminalControl (controlName, internal) {
            transfer.terminalClaimed = true
            abortController.abort(remoteFileCapabilityReleased())
            terminalPromise = (async () => {
              let currentError
              let controlError
              if (!internal) {
                try {
                  await assertCurrent()
                } catch (cause) {
                  currentError = remoteFileIdentityUnavailable(cause)
                }
              }
              try {
                await transfer.started
                if (!transfer.finished) {
                  const current = Object.getOwnPropertyDescriptor(
                    inner,
                    controlName
                  )?.value
                  if (typeof current === 'function') {
                    await Reflect.apply(current, inner, [])
                  }
                }
              } catch (error) {
                controlError = error
              } finally {
                finishTransfer()
              }
              if (currentError) {
                if (controlError && Object.isExtensible(currentError)) {
                  currentError.controlError = controlError
                }
                const alreadyReleasing = Boolean(releasePromise)
                const releasing = beginRelease()
                if (!alreadyReleasing) {
                  try {
                    await releasing
                  } catch (releaseError) {
                    if (Object.isExtensible(currentError)) {
                      currentError.releaseError ||= releaseError
                    }
                  }
                }
                throw currentError
              }
              if (controlError) throw controlError
              return true
            })()
            return terminalPromise
          }

          async function control (controlName, terminalControl, internal) {
            if (!internal) {
              if (state !== 'open') throw remoteFileCapabilityReleased()
            }
            if (transfer.finished) return true
            if (transfer.terminalClaimed) return terminalPromise || true
            if (terminalControl) {
              return claimTerminalControl(controlName, internal)
            }
            if (!internal) {
              await guardCurrent(transfer)
            }
            await transfer.started
            if (transfer.finished) return true
            if (transfer.terminalClaimed) return terminalPromise || true
            const current = Object.getOwnPropertyDescriptor(
              inner,
              controlName
            )?.value
            if (typeof current === 'function') {
              await Reflect.apply(current, inner, [])
            }
            return true
          }

          const handle = Object.assign(Object.create(null), Object.fromEntries(
            remoteFileTransferControlNames.map(controlName => [
              controlName,
              () => control(
                controlName,
                ['cancel', 'interrupt', 'destroy'].includes(controlName),
                false
              )
            ])
          ))
          Object.freeze(handle)
          activeTransfers.add(transfer)
          if (callerSignal?.aborted) {
            abortFromCaller()
          } else {
            callerSignal?.addEventListener?.('abort', abortFromCaller, {
              once: true
            })
          }

          return (async () => {
            try {
              await guardCurrent(transfer)
              if (!options || typeof options !== 'object' || Array.isArray(options)) {
                throw new Error('远程文件 transfer options 无效')
              }
              if (callerSignal !== undefined && (
                !callerSignal ||
                typeof callerSignal.addEventListener !== 'function' ||
                typeof callerSignal.removeEventListener !== 'function'
              )) {
                throw new Error('远程文件 transfer signal 无效')
              }
              if (abortController.signal.aborted) {
                throw abortController.signal.reason ||
                  remoteFileCapabilityReleased()
              }
              const transferOptions = {
                ...options,
                signal: abortController.signal,
                onData: (...args) => {
                  if (state !== 'open' || transfer.terminalClaimed) return
                  return options.onData?.(...args)
                },
                onPaused: (...args) => {
                  if (state !== 'open' || transfer.terminalClaimed) return
                  return options.onPaused?.(...args)
                },
                onEnd: (...args) => terminal(options.onEnd, args),
                onError: (...args) => terminal(options.onError, args)
              }
              inner = await Reflect.apply(operation, backend, [transferOptions])
              if (!inner || typeof inner !== 'object') {
                throw new Error('远程文件 transfer handle 无效')
              }
              return handle
            } catch (error) {
              finishTransfer()
              throw error
            } finally {
              transfer.hasStarted = true
              markStarted()
            }
          })()
        }
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
  Object.freeze(guardedCapability)
  guardedCapabilityInternals.set(guardedCapability, Object.freeze({
    createTransferCapability: () => {
      if (transferCapability) return transferCapability
      const transferSftp = guardTransferBackend(capability.sftp, guardedSftp)
      const transferBackend = capability.backend === capability.sftp
        ? transferSftp
        : guardTransferBackend(capability.backend, guardedBackend)
      transferCapability = Object.assign(Object.create(null), {
        channel,
        runtimeIdentity: guardedCapability.runtimeIdentity,
        sftp: transferSftp,
        backend: transferBackend,
        release: () => beginRelease()
      })
      if (Object.hasOwn(guardedCapability, 'capabilities')) {
        transferCapability.capabilities = guardedCapability.capabilities
      }
      return Object.freeze(transferCapability)
    }
  }))
  return guardedCapability
}

export function createRemoteFileTransferCapability (capability) {
  const internal = guardedCapabilityInternals.get(capability)
  if (!internal) {
    throw new Error('远程文件 transfer capability 来源无效')
  }
  return internal.createTransferCapability()
}

function preparedProbeAbortError () {
  const error = new Error('远程文件预探测已取消')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function throwPreparedProbeAbort (signal) {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : preparedProbeAbortError()
}

async function resolvePreparedProbeTerminal ({
  operationId,
  tab,
  getTerminal
}) {
  const ownerId = requiredIdentity(operationId, '操作标识')
  if (typeof getTerminal !== 'function') {
    throw new Error('远程文件端点缺少终端解析器')
  }
  const tabId = requiredIdentity(tab?.id, '标签页标识')
  const terminal = await getTerminal(tabId)
  if (!terminal || typeof terminal.getTerminalSafetyEndpoint !== 'function' ||
    typeof terminal.acquireRemoteFilePtyTask !== 'function') {
    throw new Error('远程文件端点缺少同标签页 SSH 终端')
  }
  const pinnedEndpoint = assertExactSshTerminalEndpoint({
    tab,
    terminalEndpoint: terminal.getTerminalSafetyEndpoint()
  })
  const assertTerminalCurrent = async () => {
    const currentTerminal = await getTerminal(tabId)
    if (!currentTerminal ||
      typeof currentTerminal.getTerminalSafetyEndpoint !== 'function') {
      throw new Error('当前 SSH 终端已不可用')
    }
    const currentEndpoint = assertExactSshTerminalEndpoint({
      tab,
      terminalEndpoint: currentTerminal.getTerminalSafetyEndpoint()
    })
    assertSameSessionEndpoint(pinnedEndpoint, currentEndpoint)
    return currentEndpoint
  }
  const assertCurrent = async sftp => {
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
  return Object.freeze({
    ownerId,
    terminal,
    loginUsername: requiredIdentity(
      tab?.username || tab?.user,
      'SSH 登录用户名'
    ),
    assertTerminalCurrent,
    assertCurrent
  })
}

export function beginRemoteFileCapabilityProbe ({
  operationId,
  tab = {},
  getTerminal,
  signal,
  onLeaseState
} = {}) {
  const controller = new AbortController()
  let pty
  let leaseOwner = 'prepared'
  let releasePromise
  let consumePromise
  let abortPromise
  let consumedLeaseObserver
  let latestLeaseEvent
  const observePreparedLeaseState = event => {
    latestLeaseEvent = event
    publishRemoteFileLeaseState(onLeaseState, event)
    publishRemoteFileLeaseState(consumedLeaseObserver, event)
  }
  const abortFromCaller = () => {
    if (!controller.signal.aborted) {
      controller.abort(signal?.reason || preparedProbeAbortError())
    }
  }
  if (signal?.aborted) abortFromCaller()
  else signal?.addEventListener?.('abort', abortFromCaller, { once: true })

  const releasePreparedLease = () => {
    if (leaseOwner !== 'prepared') return releasePromise || Promise.resolve(true)
    if (releasePromise) return releasePromise
    releasePromise = (async () => {
      if (!pty) return true
      const released = await pty.release()
      leaseOwner = 'released'
      return released
    })()
    return releasePromise
  }

  const probePromise = (async () => {
    throwPreparedProbeAbort(controller.signal)
    const context = await resolvePreparedProbeTerminal({
      operationId,
      tab,
      getTerminal
    })
    throwPreparedProbeAbort(controller.signal)
    pty = await context.terminal.acquireRemoteFilePtyTask(context.ownerId)
    if (!pty || typeof pty.execute !== 'function' ||
      typeof pty.release !== 'function') {
      throw new Error('远程文件 PTY 租约合同无效')
    }
    pty = observeRemoteFilePtyLease(pty, {
      operationId: context.ownerId,
      onLeaseState: observePreparedLeaseState
    })
    throwPreparedProbeAbort(controller.signal)
    await context.assertTerminalCurrent()
    const probe = await pty.execute(createPrivilegedFileRequest({
      operation: 'probe'
    }), { signal: controller.signal })
    const identity = requireProbeResult(probe)
    await context.assertTerminalCurrent()
    return Object.freeze({ context, probe, identity })
  })().catch(async cause => {
    let releaseError
    try {
      await releasePreparedLease()
    } catch (error) {
      releaseError = error
    }
    const unavailable = remoteFileIdentityUnavailable(cause)
    if (releaseError) unavailable.releaseError = releaseError
    throw unavailable
  })
  probePromise.catch(() => {})

  const abort = () => {
    if (abortPromise) return abortPromise
    abortFromCaller()
    abortPromise = (async () => {
      try {
        await probePromise
      } catch (error) {
        if (error?.releaseError) throw error.releaseError
      }
      return releasePreparedLease()
    })()
    return abortPromise
  }

  const consume = ({ sftp, onIdentity, onLeaseState: leaseObserver } = {}) => {
    if (consumePromise) return consumePromise
    consumedLeaseObserver = leaseObserver
    if (latestLeaseEvent) {
      publishRemoteFileLeaseState(consumedLeaseObserver, latestLeaseEvent)
    }
    consumePromise = (async () => {
      let capability
      try {
        const { context, probe, identity } = await probePromise
        await context.assertCurrent(sftp)
        if (await verifyNativeRootSftp(sftp, context.loginUsername)) {
          await releasePreparedLease()
          const identityUpdate = Object.freeze({
            loginUsername: context.loginUsername,
            effectiveUid: '0',
            effectiveUsername: context.loginUsername,
            channel: 'sftp'
          })
          capability = createNativeSftpFileBackend(sftp, identityUpdate)
          capability = createGuardedRemoteFileCapability(
            capability,
            () => context.assertCurrent(sftp)
          )
          await onIdentity?.(identityUpdate)
          await context.assertCurrent(sftp)
          return capability
        }

        const channel = identity.uid === '0' ? 'pty-root' : 'sftp'
        const identityUpdate = Object.freeze(channel === 'sftp'
          ? {
              loginUsername: context.loginUsername,
              effectiveUid: 'unknown',
              effectiveUsername: context.loginUsername,
              channel
            }
          : {
              loginUsername: context.loginUsername,
              effectiveUid: identity.uid,
              effectiveUsername: identity.username,
              channel
            })
        if (channel === 'sftp') {
          await releasePreparedLease()
          capability = createNativeSftpFileBackend(sftp, identityUpdate)
        } else {
          leaseOwner = 'capability'
          const backendLease = createBackendLease(pty)
          capability = await createPrivilegedFileBackend({
            sftp,
            lease: backendLease,
            identity,
            capabilities: probe.capabilities
          })
        }
        await context.assertCurrent(sftp)
        capability = createGuardedRemoteFileCapability(
          capability,
          () => context.assertCurrent(sftp)
        )
        await onIdentity?.(identityUpdate)
        await context.assertCurrent(sftp)
        return capability
      } catch (cause) {
        let releaseError
        if (capability) {
          try {
            await capability.release()
          } catch (error) {
            releaseError = error
          }
        } else if (leaseOwner === 'prepared') {
          try {
            await releasePreparedLease()
          } catch (error) {
            releaseError = error
          }
        }
        const unavailable = cause?.code === 'REMOTE_FILE_IDENTITY_UNAVAILABLE'
          ? cause
          : remoteFileIdentityUnavailable(cause)
        if (releaseError) unavailable.releaseError = releaseError
        throw unavailable
      }
    })()
    return consumePromise
  }

  return Object.freeze({
    consume,
    abort,
    release: abort
  })
}

export async function acquireRemoteFileCapability ({
  operationId,
  tab = {},
  sftp,
  getTerminal,
  signal,
  onIdentity,
  onLeaseState
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

    const loginUsername = requiredIdentity(
      tab.username || tab.user,
      'SSH 登录用户名'
    )
    if (await verifyNativeRootSftp(sftp, loginUsername)) {
      await assertCurrent()
      const identityUpdate = Object.freeze({
        loginUsername,
        effectiveUid: '0',
        effectiveUsername: loginUsername,
        channel: 'sftp'
      })
      capability = createNativeSftpFileBackend(sftp, identityUpdate)
      capability = createGuardedRemoteFileCapability(capability, assertCurrent)
      await onIdentity?.(identityUpdate)
      await assertCurrent()
      return capability
    }

    pty = await terminal.acquireRemoteFilePtyTask(ownerId)
    if (!pty || typeof pty.execute !== 'function' ||
      typeof pty.release !== 'function') {
      throw new Error('远程文件 PTY 租约合同无效')
    }
    pty = observeRemoteFilePtyLease(pty, {
      operationId: ownerId,
      onLeaseState
    })
    await assertCurrent()
    const probe = await pty.execute(createPrivilegedFileRequest({
      operation: 'probe'
    }), signal ? { signal } : {})
    const identity = requireProbeResult(probe)
    await assertCurrent()
    const channel = identity.uid === '0' ? 'pty-root' : 'sftp'
    const identityUpdate = Object.freeze(channel === 'sftp'
      ? {
          loginUsername,
          effectiveUid: 'unknown',
          effectiveUsername: loginUsername,
          channel
        }
      : {
          loginUsername,
          effectiveUid: identity.uid,
          effectiveUsername: identity.username,
          channel
        })

    if (channel === 'sftp') {
      const nativePty = pty
      pty = null
      await releasePty(nativePty)
      capability = createNativeSftpFileBackend(sftp, identityUpdate)
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
