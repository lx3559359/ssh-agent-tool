const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const SCHEMA_VERSION = 1
const MAX_TABS = 20
const MAX_TASKS = 50
const MAX_TITLE_LENGTH = 120
const MAX_TEXT_LENGTH = 160
const VALID_LAYOUTS = new Set(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'])
const VALID_TAB_TYPES = new Set([
  'local', 'ssh', 'telnet', 'serial', 'ftp', 'rdp', 'vnc', 'spice', 'web'
])
const VALID_PANES = new Set(['terminal', 'fileManager', 'ssh', 'sftp'])
const VALID_TASK_TYPES = new Set(['ai', 'agent', 'sftp', 'update', 'safety'])
const SENSITIVE_ASSIGNMENT = /\b(?:api.?key|authorization|cookie|pass(?:word|phrase)?|private.?key|secret|token)\b\s*[:=]\s*[^\s,;]+/gi
const WINDOWS_USER_PATH = /[a-z]:\\users\\[^\\\s]+/gi
const UNIX_USER_PATH = /\/(?:home|users)\/[^/\s]+/gi
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

function defaultFileSystem () {
  return {
    readFileSync: fs.readFileSync.bind(fs),
    mkdirSync: fs.mkdirSync.bind(fs),
    openSync: fs.openSync.bind(fs),
    writeFileSync: fs.writeFileSync.bind(fs),
    fsyncSync: fs.fsyncSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    renameSync: fs.renameSync.bind(fs)
  }
}

function safeNow (now) {
  try {
    const value = Number(now())
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : Date.now()
  } catch {
    return Date.now()
  }
}

function safeIdentifier (value, fallback = '') {
  const text = String(value || '').trim()
  return /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,127}$/.test(text) ? text : fallback
}

function safeText (value, maxLength = MAX_TEXT_LENGTH) {
  return String(value || '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(SENSITIVE_ASSIGNMENT, '[已隐藏]')
    .replace(WINDOWS_USER_PATH, '%USERPROFILE%')
    .replace(UNIX_USER_PATH, '~')
    .trim()
    .slice(0, maxLength)
}

function safePort (value) {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 22
}

function safeBatch (value) {
  const batch = Number(value)
  return Number.isInteger(batch) && batch >= 0 && batch <= 3 ? batch : 0
}

function sanitizeTab (tab = {}, index = 0) {
  if (!tab || typeof tab !== 'object' || Array.isArray(tab)) return null
  const type = String(tab.type || (tab.host ? 'ssh' : 'local'))
  if (!VALID_TAB_TYPES.has(type)) return null
  const id = safeIdentifier(tab.id, `recovered-tab-${index + 1}`)
  const title = safeText(tab.title || tab.name || tab.host || '恢复的标签', MAX_TITLE_LENGTH)
  const result = {
    id,
    type,
    title: title || '恢复的标签',
    batch: safeBatch(tab.batch),
    pane: VALID_PANES.has(tab.pane) ? tab.pane : 'terminal',
    connectionState: 'disconnected',
    recoveryPending: true
  }
  const srcId = safeIdentifier(tab.srcId || tab.bookmarkId)
  if (srcId) result.srcId = srcId
  const host = safeText(tab.host, MAX_TEXT_LENGTH)
  if (host) result.host = host
  if (host) result.port = safePort(tab.port)
  const username = safeText(tab.username, 80)
  if (username) result.username = username
  if (typeof tab.enableSsh === 'boolean') result.enableSsh = tab.enableSsh
  if (typeof tab.enableSftp === 'boolean') result.enableSftp = tab.enableSftp
  return result
}

function sanitizeTask (task = {}, index = 0) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return null
  const type = String(task.type || '')
  if (!VALID_TASK_TYPES.has(type)) return null
  const result = {
    id: safeIdentifier(task.id, `interrupted-task-${index + 1}`),
    type,
    status: 'interrupted',
    title: safeText(task.title || '未完成任务', MAX_TITLE_LENGTH) || '未完成任务'
  }
  const startedAt = new Date(task.startedAt || task.createdAt || 0)
  if (!Number.isNaN(startedAt.getTime())) result.startedAt = startedAt.toISOString()
  return result
}

function sanitizeClientState (state = {}, timestamp = Date.now()) {
  const tabs = Array.isArray(state.tabs)
    ? state.tabs.slice(0, MAX_TABS).map(sanitizeTab).filter(Boolean)
    : []
  const pendingTasks = Array.isArray(state.pendingTasks)
    ? state.pendingTasks.slice(0, MAX_TASKS).map(sanitizeTask).filter(Boolean)
    : []
  const activeTabId = safeIdentifier(state.activeTabId)
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date(timestamp).toISOString(),
    layout: VALID_LAYOUTS.has(state.layout) ? state.layout : 'c1',
    activeTabId: tabs.some(tab => tab.id === activeTabId)
      ? activeTabId
      : (tabs[0]?.id || ''),
    tabs,
    pendingTasks
  }
}

function normalizePersistedSnapshot (value, timestamp) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.schemaVersion !== SCHEMA_VERSION || typeof value.cleanExit !== 'boolean') {
    return null
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: safeIdentifier(value.runId, crypto.randomUUID()),
    cleanExit: value.cleanExit,
    reason: safeIdentifier(value.reason, value.cleanExit ? 'clean-exit' : 'unexpected-exit'),
    updatedAt: new Date(timestamp).toISOString(),
    clientState: sanitizeClientState(value.clientState, timestamp)
  }
}

function createRecoverySnapshotManager (options = {}) {
  const storagePath = String(options.storagePath || '')
  const fileSystem = options.fileSystem || defaultFileSystem()
  const logger = options.logger || console
  const now = typeof options.now === 'function' ? options.now : Date.now
  const runId = safeIdentifier(options.runId, crypto.randomUUID())
  let current = null
  let recoveryPlan = null
  let warned = false

  function warnOnce () {
    if (warned) return
    warned = true
    try {
      logger.warn('recovery_snapshot_persistence_failed')
    } catch {}
  }

  function writeAtomic (snapshot) {
    if (!storagePath) return false
    const tempPath = `${storagePath}.tmp`
    let descriptor
    try {
      fileSystem.mkdirSync(path.dirname(storagePath), { recursive: true })
      descriptor = fileSystem.openSync(tempPath, 'w')
      fileSystem.writeFileSync(descriptor, JSON.stringify(snapshot), 'utf8')
      fileSystem.fsyncSync(descriptor)
      fileSystem.closeSync(descriptor)
      descriptor = undefined
      fileSystem.renameSync(tempPath, storagePath)
      return true
    } catch {
      if (descriptor !== undefined) {
        try { fileSystem.closeSync(descriptor) } catch {}
      }
      warnOnce()
      return false
    }
  }

  function readPrevious (timestamp) {
    if (!storagePath) return null
    try {
      const raw = fileSystem.readFileSync(storagePath, 'utf8')
      const parsed = JSON.parse(raw)
      const normalized = normalizePersistedSnapshot(parsed, timestamp)
      if (!normalized) throw new Error('invalid recovery snapshot')
      return normalized
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      try {
        fileSystem.renameSync(storagePath, `${storagePath}.corrupt-${timestamp}`)
      } catch {}
      return null
    }
  }

  function initialize () {
    const timestamp = safeNow(now)
    const previous = readPrevious(timestamp)
    recoveryPlan = previous && previous.cleanExit === false
      ? {
          schemaVersion: SCHEMA_VERSION,
          abnormalExit: true,
          reason: previous.reason || 'unexpected-exit',
          previousRunId: previous.runId,
          clientState: previous.clientState
        }
      : null
    current = {
      schemaVersion: SCHEMA_VERSION,
      runId,
      cleanExit: false,
      reason: 'running',
      updatedAt: new Date(timestamp).toISOString(),
      clientState: previous?.clientState || sanitizeClientState({}, timestamp)
    }
    writeAtomic(current)
    return recoveryPlan ? JSON.parse(JSON.stringify(recoveryPlan)) : null
  }

  function saveClientState (state) {
    const timestamp = safeNow(now)
    current = {
      ...(current || {}),
      schemaVersion: SCHEMA_VERSION,
      runId,
      cleanExit: false,
      reason: 'running',
      updatedAt: new Date(timestamp).toISOString(),
      clientState: sanitizeClientState(state, timestamp)
    }
    return writeAtomic(current)
  }

  function markAbnormalSync (reason = 'unexpected-exit') {
    const timestamp = safeNow(now)
    current = {
      ...(current || {}),
      schemaVersion: SCHEMA_VERSION,
      runId,
      cleanExit: false,
      reason: safeIdentifier(reason, 'unexpected-exit'),
      updatedAt: new Date(timestamp).toISOString(),
      clientState: current?.clientState || sanitizeClientState({}, timestamp)
    }
    return writeAtomic(current)
  }

  function markCleanExitSync () {
    const timestamp = safeNow(now)
    current = {
      ...(current || {}),
      schemaVersion: SCHEMA_VERSION,
      runId,
      cleanExit: true,
      reason: 'clean-exit',
      updatedAt: new Date(timestamp).toISOString(),
      clientState: current?.clientState || sanitizeClientState({}, timestamp)
    }
    return writeAtomic(current)
  }

  return {
    initialize,
    saveClientState,
    getRecoveryPlan: () => recoveryPlan ? JSON.parse(JSON.stringify(recoveryPlan)) : null,
    dismissRecoveryPlan: () => { recoveryPlan = null; return true },
    markAbnormalSync,
    markCleanExitSync
  }
}

module.exports = {
  createRecoverySnapshotManager,
  sanitizeClientState
}
