import resolve from '../../common/resolve.js'
import normalizeRemotePath from '../../common/normalize-remote-path.js'

const TIMER_KEYS = ['timer', 'timer4', 'timer5', 'retryHandler']
const DEBOUNCE_KEYS = ['remoteListDebounce', 'localListDebounce']

function isExpectedSftpBackgroundAbort (error) {
  return error?.name === 'AbortError' ||
    error?.code === 'ABORT_ERR'
}

export function runSftpBackgroundTask (task, options = {}) {
  const reportError = options.reportError || (error => (
    globalThis.window?.store?.onError?.(error)
  ))
  let operation
  try {
    operation = typeof task === 'function' ? task() : task
  } catch (error) {
    operation = Promise.reject(error)
  }
  return Promise.resolve(operation).catch(error => {
    if (isExpectedSftpBackgroundAbort(error)) return undefined
    try {
      reportError(error)
    } catch {
      // The background promise must always terminate observed.
    }
    return undefined
  })
}

export function shouldRetryUnexpectedSftpPacket (error, {
  expectedMessage,
  retryCount,
  maxRetries = 1
}) {
  return (
    typeof error?.message === 'string' &&
    error.message.includes(expectedMessage) &&
    Number.isInteger(retryCount) &&
    retryCount >= 0 &&
    retryCount < maxRetries
  )
}

export function replaceSftpEntryTimer (
  entry,
  key,
  callback,
  delay,
  options = {}
) {
  const clearTimer = options.clearTimer || clearTimeout
  const setTimer = options.setTimer || setTimeout
  if (entry[key] !== undefined && entry[key] !== null) {
    clearTimer(entry[key])
  }
  const timer = setTimer(callback, delay)
  entry[key] = timer
  return timer
}

export function disposeSftpEntryScheduling (entry, options = {}) {
  const clearTimer = options.clearTimer || clearTimeout
  for (const key of TIMER_KEYS) {
    if (entry[key] !== undefined && entry[key] !== null) {
      clearTimer(entry[key])
    }
    entry[key] = null
  }
  for (const key of DEBOUNCE_KEYS) {
    entry[key]?.cancel?.()
  }
}

export async function destroySftpClient (client) {
  if (!client || typeof client.destroy !== 'function') return false
  try {
    await client.destroy()
    return true
  } catch (error) {
    if (error?.code === 'TEARDOWN_TIMEOUT' || error?.uncertain === true) {
      throw error
    }
    return false
  }
}

export function destroySftpEntryClientOnce (entry, client) {
  if (!client || (typeof client !== 'object' && typeof client !== 'function')) {
    return Promise.resolve(false)
  }
  const disposals = entry.sftpClientDisposals ||
    (entry.sftpClientDisposals = new WeakMap())
  if (disposals.has(client)) return disposals.get(client)
  const disposal = destroySftpClient(client)
  disposals.set(client, disposal)
  return disposal
}

function nextEpoch (value) {
  return Number.isSafeInteger(value) && value >= 0 ? value + 1 : 1
}

function createRemoteFileGeneration (entry, accepting) {
  const generation = {
    id: nextEpoch(entry.remoteFileGenerationSequence),
    accepting,
    capabilities: new Set(),
    settlements: new Set(),
    backends: new Map(),
    tail: Promise.resolve()
  }
  entry.remoteFileGenerationSequence = generation.id
  entry.remoteFileGeneration = generation
  entry.remoteFileOperations = generation.capabilities
  entry.remoteFileOperationSettlements = generation.settlements
  entry.remoteFileOperationBackends = generation.backends
  entry.remoteFileOperationTail = generation.tail
  return generation
}

function ensureRemoteFileGeneration (entry) {
  if (entry.remoteFileGeneration) return entry.remoteFileGeneration
  const generation = {
    id: nextEpoch(entry.remoteFileGenerationSequence),
    accepting: entry.remoteFileUnmounted !== true,
    capabilities: entry.remoteFileOperations || new Set(),
    settlements: entry.remoteFileOperationSettlements || new Set(),
    backends: entry.remoteFileOperationBackends || new Map(),
    tail: entry.remoteFileOperationTail || Promise.resolve()
  }
  entry.remoteFileGenerationSequence = generation.id
  entry.remoteFileGeneration = generation
  entry.remoteFileOperations = generation.capabilities
  entry.remoteFileOperationSettlements = generation.settlements
  entry.remoteFileOperationBackends = generation.backends
  entry.remoteFileOperationTail = generation.tail
  return generation
}

export function initializeRemoteFileGeneration (entry) {
  return ensureRemoteFileGeneration(entry)
}

export function isCurrentRemoteFileGeneration (entry, generation) {
  return Boolean(generation) &&
    entry.remoteFileGeneration === generation
}

export function activateRemoteFileGeneration (entry, generation) {
  if (entry.remoteFileUnmounted ||
    !isCurrentRemoteFileGeneration(entry, generation)) {
    return false
  }
  generation.accepting = true
  return true
}

function preserveSettlementErrors (errors) {
  const primaryError = errors[0]
  if (primaryError && errors.length > 1 && Object.isExtensible(primaryError)) {
    const existing = Array.isArray(primaryError.cleanupErrors)
      ? primaryError.cleanupErrors
      : []
    primaryError.cleanupErrors = Object.freeze([
      ...existing,
      ...errors.slice(1)
    ])
  }
  return primaryError
}

async function settleTransferOwner (owner) {
  const errors = []
  for (const work of [
    () => owner.cancelAndWait?.(),
    () => owner.transferSafety?.dispose?.(),
    () => owner.releaseRemoteFileSession?.()
  ]) {
    try {
      await work()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw preserveSettlementErrors(errors)
  return true
}

export function quiesceSftpEntryTransfers (entry, options = {}) {
  const generation = ensureRemoteFileGeneration(entry)
  generation.accepting = false
  const tabId = String(entry.props?.tab?.id || '')
  const candidates = options.owners || [
    ...(globalThis.window?.refsTransfers?.values?.() || [])
  ]
  const owners = [...new Set(candidates)].filter(owner => (
    String(owner?.tabId ?? owner?.props?.transfer?.tabId ?? '') === tabId
  ))
  const hasSafetyOperations = Boolean(
    entry.transferSafetySessionAliases?.size
  )
  const hasPreparedSessions = Boolean(
    entry.preparedTransferFileSessions?.size
  )
  if (!owners.length && !hasSafetyOperations && !hasPreparedSessions) {
    return null
  }

  return (async () => {
    const errors = []
    const ownerSettlements = await Promise.allSettled(
      owners.map(settleTransferOwner)
    )
    for (const result of ownerSettlements) {
      if (result.status === 'rejected') errors.push(result.reason)
    }

    const operationIds = [
      ...(entry.transferSafetySessionAliases?.keys?.() || [])
    ]
    for (const operationId of operationIds) {
      const session = entry.transferSafetySessionPins?.get(operationId)
      try {
        await entry.cancelTransferSafetyOperation?.(operationId, session)
      } catch (error) {
        errors.push(error)
      }
    }

    const preparedTransferIds = [
      ...(entry.preparedTransferFileSessions?.keys?.() || [])
    ]
    for (const transferId of preparedTransferIds) {
      try {
        await entry.releasePreparedTransferFileSession?.(transferId)
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length) throw preserveSettlementErrors(errors)
    return true
  })()
}

export function drainRemoteFileGeneration (entry, options = {}) {
  if (options.invalidateIdentity !== false) {
    try {
      entry.invalidateRemoteFileIdentity?.()
    } catch {
      // UI invalidation must not prevent capability cleanup or transport drain.
    }
  }
  const generation = ensureRemoteFileGeneration(entry)
  generation.accepting = false
  const client = detachSftpEntryClient(entry)
  const nextGeneration = createRemoteFileGeneration(entry, false)
  const capabilities = [...generation.capabilities]
  const settlements = [...generation.settlements]
  generation.capabilities.clear()
  generation.settlements.clear()
  generation.backends.clear()
  const releases = capabilities.map(capability => {
    try {
      return capability.release()
    } catch (error) {
      return Promise.reject(error)
    }
  })
  const settled = Promise.allSettled([...releases, ...settlements])
  const previousDrain = entry.remoteFileGenerationDrainTail ||
    Promise.resolve()
  const promise = Promise.resolve(previousDrain)
    .then(() => settled)
    .then(() => destroySftpEntryClientOnce(entry, client))
  const drainTail = promise.then(() => undefined)
  drainTail.catch(() => {})
  entry.remoteFileGenerationDrainTail = drainTail
  return Object.freeze({
    client,
    generation: nextGeneration,
    promise
  })
}

function captureLifecycle (entry) {
  return Object.freeze({
    lifecycleEpoch: entry.sftpLifecycleEpoch || 0,
    sshSessionGeneration: String(entry.sshSessionGeneration || '').trim(),
    sshTerminalPid: String(entry.sshTerminalPid || '').trim()
  })
}

function isCurrentLifecycle (entry, token) {
  return Boolean(token) &&
    (entry.sftpLifecycleEpoch || 0) === token.lifecycleEpoch &&
    String(entry.sshSessionGeneration || '').trim() ===
      token.sshSessionGeneration &&
    String(entry.sshTerminalPid || '').trim() === token.sshTerminalPid
}

export function beginSftpEntryRemoteTask (entry, expectedGeneration) {
  entry.sftpRemoteRequestEpoch = nextEpoch(entry.sftpRemoteRequestEpoch)
  return Object.freeze({
    ...captureLifecycle(entry),
    requestEpoch: entry.sftpRemoteRequestEpoch,
    sshSessionGeneration: String(
      expectedGeneration ?? entry.sshSessionGeneration ?? ''
    ).trim()
  })
}

export function isCurrentSftpEntryRemoteTask (entry, token) {
  return isCurrentLifecycle(entry, token) &&
    entry.sftpRemoteRequestEpoch === token.requestEpoch
}

export async function commitSftpEntryRemoteClient (
  entry,
  token,
  client,
  generation
) {
  if (!isCurrentSftpEntryRemoteTask(entry, token) ||
    (generation && (!generation.accepting ||
      !isCurrentRemoteFileGeneration(entry, generation)))) {
    if (client && client !== entry.sftp) {
      await destroySftpEntryClientOnce(entry, client)
    }
    return false
  }
  entry.sftp = client
  return true
}

export function detachSftpEntryClient (entry) {
  const client = entry.sftp
  entry.sftp = null
  entry.sftpLifecycleEpoch = nextEpoch(entry.sftpLifecycleEpoch)
  return client
}

export function disposeSftpEntryClient (entry) {
  return drainRemoteFileGeneration(entry).promise
}

export async function reconnectSftpEntryRemote (entry) {
  const drain = drainRemoteFileGeneration(entry)
  await drain.promise
  if (!activateRemoteFileGeneration(entry, drain.generation)) return undefined
  const token = captureLifecycle(entry)
  const remote = await entry.initRemoteAll()
  return isCurrentLifecycle(entry, token) &&
    isCurrentRemoteFileGeneration(entry, drain.generation)
    ? remote
    : undefined
}

export async function bindSftpEntryRemoteSession (entry, binding = {}) {
  const nextGeneration = String(binding.sshSessionGeneration || '').trim()
  const nextTerminalPid = String(binding.sshTerminalPid || '').trim()
  const terminalSessionChanged =
    String(entry.sshSessionGeneration || '').trim() !== nextGeneration ||
    String(entry.sshTerminalPid || '').trim() !== nextTerminalPid
  const drain = drainRemoteFileGeneration(entry)
  await drain.promise
  if (!isCurrentRemoteFileGeneration(entry, drain.generation) ||
    entry.remoteFileUnmounted) {
    return undefined
  }
  entry.terminalId = binding.terminalId
  entry.port = binding.port
  entry.sshSessionGeneration = nextGeneration
  entry.sshTerminalPid = nextTerminalPid
  if (terminalSessionChanged) {
    try {
      entry.resetRemoteFileLeaseOutcome?.()
    } catch {
      // UI outcome reset must not prevent binding the authoritative session.
    }
  }
  if (!activateRemoteFileGeneration(entry, drain.generation)) return undefined
  const token = captureLifecycle(entry)
  const remote = entry.shouldRenderRemote()
    ? await entry.initRemoteAll()
    : undefined
  if (!isCurrentLifecycle(entry, token)) return undefined
  entry.initLocalAll()
  return remote
}

function canonicalRemotePath (value) {
  const normalized = normalizeRemotePath(String(value || ''))
  if (!normalized) return ''
  const homeRelative = normalized === '~' || normalized.startsWith('~/')
  const parts = []
  const source = homeRelative ? normalized.slice(2) : normalized
  for (const part of source.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return homeRelative ? ['~', ...parts].join('/') : `/${parts.join('/')}`
}

export function removeDeletedRemoteEntries (remote = [], deletedPaths = []) {
  const targets = new Set(deletedPaths
    .map(canonicalRemotePath)
    .filter(Boolean))
  if (!targets.size) return remote
  return remote.filter(file => {
    if (!file || file.isParent || file.isEmpty || file.isEditing) return true
    const absolutePath = canonicalRemotePath(resolve(
      String(file.path || ''),
      String(file.name || '')
    ))
    return !targets.has(absolutePath)
  })
}
