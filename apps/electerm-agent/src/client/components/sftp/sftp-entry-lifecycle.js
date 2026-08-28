import resolve from '../../common/resolve.js'
import normalizeRemotePath from '../../common/normalize-remote-path.js'

const TIMER_KEYS = ['timer', 'timer4', 'timer5', 'retryHandler']
const DEBOUNCE_KEYS = ['remoteListDebounce', 'localListDebounce']

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
    return false
  }
}

function nextEpoch (value) {
  return Number.isSafeInteger(value) && value >= 0 ? value + 1 : 1
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

export async function commitSftpEntryRemoteClient (entry, token, client) {
  if (!isCurrentSftpEntryRemoteTask(entry, token)) {
    if (client && client !== entry.sftp) await destroySftpClient(client)
    return false
  }
  entry.sftp = client
  return true
}

export function disposeSftpEntryClient (entry) {
  const client = entry.sftp
  entry.sftp = null
  entry.sftpLifecycleEpoch = nextEpoch(entry.sftpLifecycleEpoch)
  return destroySftpClient(client)
}

export function reconnectSftpEntryRemote (entry) {
  const disposed = disposeSftpEntryClient(entry)
  const token = captureLifecycle(entry)
  return Promise.resolve(disposed).then(() => (
    isCurrentLifecycle(entry, token) ? entry.initRemoteAll() : undefined
  ))
}

export async function bindSftpEntryRemoteSession (entry, binding = {}) {
  const nextGeneration = String(binding.sshSessionGeneration || '').trim()
  const nextTerminalPid = String(binding.sshTerminalPid || '').trim()
  const disposed = disposeSftpEntryClient(entry)
  entry.terminalId = binding.terminalId
  entry.port = binding.port
  entry.sshSessionGeneration = nextGeneration
  entry.sshTerminalPid = nextTerminalPid
  const token = captureLifecycle(entry)
  await disposed
  if (!isCurrentLifecycle(entry, token)) return undefined
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
