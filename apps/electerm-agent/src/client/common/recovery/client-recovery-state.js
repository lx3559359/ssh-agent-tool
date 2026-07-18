const SCHEMA_VERSION = 1
const MAX_TABS = 20
const MAX_TASKS = 50
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

function safeIdentifier (value, fallback = '') {
  const text = String(value || '').trim()
  return /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,127}$/.test(text) ? text : fallback
}

function safeText (value, maxLength = 160) {
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

function normalizeTab (tab = {}, index = 0) {
  if (!tab || typeof tab !== 'object' || Array.isArray(tab)) return null
  const type = String(tab.type || (tab.host ? 'ssh' : 'local'))
  if (!VALID_TAB_TYPES.has(type)) return null
  const result = {
    id: safeIdentifier(tab.id, `recovered-tab-${index + 1}`),
    type,
    title: safeText(tab.title || tab.name || tab.host || '恢复的标签', 120) || '恢复的标签',
    batch: safeBatch(tab.batch),
    pane: VALID_PANES.has(tab.pane) ? tab.pane : 'terminal',
    connectionState: 'disconnected',
    recoveryPending: true
  }
  const srcId = safeIdentifier(tab.srcId || tab.bookmarkId)
  if (srcId) result.srcId = srcId
  const host = safeText(tab.host, 160)
  if (host) {
    result.host = host
    result.port = safePort(tab.port)
  }
  const username = safeText(tab.username, 80)
  if (username) result.username = username
  if (typeof tab.enableSsh === 'boolean') result.enableSsh = tab.enableSsh
  if (typeof tab.enableSftp === 'boolean') result.enableSftp = tab.enableSftp
  return result
}

function normalizeTask (task = {}, index = 0) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return null
  const type = String(task.type || '')
  if (!VALID_TASK_TYPES.has(type)) return null
  const result = {
    id: safeIdentifier(task.id, `interrupted-task-${index + 1}`),
    type,
    status: 'interrupted',
    title: safeText(task.title || '未完成任务', 120) || '未完成任务'
  }
  const startedAt = new Date(task.startedAt || task.createdAt || 0)
  if (!Number.isNaN(startedAt.getTime())) result.startedAt = startedAt.toISOString()
  return result
}

function collectPendingTasks (store = {}) {
  const tasks = []
  for (const item of Array.isArray(store.aiChatHistory) ? store.aiChatHistory : []) {
    if (item?.pending !== true && !['pending', 'running'].includes(item?.completionStatus)) continue
    tasks.push({
      id: item.id,
      type: item.mode === 'agent' ? 'agent' : 'ai',
      status: 'interrupted',
      title: item.mode === 'agent' ? 'Agent 任务已中断' : 'AI 对话已中断',
      startedAt: item.createdAt
    })
  }
  for (const transfer of Array.isArray(store.fileTransfers) ? store.fileTransfers : []) {
    if (['completed', 'failed', 'cancelled'].includes(transfer?.status)) continue
    tasks.push({
      id: transfer.id,
      type: 'sftp',
      status: 'interrupted',
      title: 'SFTP 传输已中断',
      startedAt: transfer.createdAt
    })
  }
  const update = store.upgradeInfo || {}
  if (update.downloading || update.installing || update.checking || update.progress > 0) {
    tasks.push({
      id: 'native-update',
      type: 'update',
      status: 'interrupted',
      title: '在线更新已中断',
      startedAt: update.startedAt
    })
  }
  return tasks.slice(0, MAX_TASKS)
}

export function serializeClientRecoveryState (store = {}, options = {}) {
  const timestamp = typeof options.now === 'function' ? options.now() : Date.now()
  const tabs = (Array.isArray(store.tabs) ? store.tabs : [])
    .slice(0, MAX_TABS)
    .map(normalizeTab)
    .filter(Boolean)
  const activeTabId = safeIdentifier(store.activeTabId)
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date(timestamp).toISOString(),
    layout: VALID_LAYOUTS.has(store.layout) ? store.layout : 'c1',
    activeTabId: tabs.some(tab => tab.id === activeTabId)
      ? activeTabId
      : (tabs[0]?.id || ''),
    tabs,
    pendingTasks: collectPendingTasks(store).map(normalizeTask).filter(Boolean)
  }
}

export function buildClientRecoveryPlan (raw = {}) {
  if (!raw || raw.abnormalExit !== true) return null
  const state = raw.clientState || {}
  const tabs = (Array.isArray(state.tabs) ? state.tabs : [])
    .slice(0, MAX_TABS)
    .map(normalizeTab)
    .filter(Boolean)
  const pendingTasks = (Array.isArray(state.pendingTasks) ? state.pendingTasks : [])
    .slice(0, MAX_TASKS)
    .map(normalizeTask)
    .filter(Boolean)
  const activeTabId = safeIdentifier(state.activeTabId)
  return {
    schemaVersion: SCHEMA_VERSION,
    abnormalExit: true,
    reason: safeIdentifier(raw.reason, 'unexpected-exit'),
    layout: VALID_LAYOUTS.has(state.layout) ? state.layout : 'c1',
    activeTabId: tabs.some(tab => tab.id === activeTabId)
      ? activeTabId
      : (tabs[0]?.id || ''),
    tabs,
    pendingTasks
  }
}

export function createRecoveredTabs (plan = {}) {
  return (Array.isArray(plan.tabs) ? plan.tabs : [])
    .slice(0, MAX_TABS)
    .map(normalizeTab)
    .filter(Boolean)
    .map(tab => ({
      ...tab,
      status: 'error',
      autoReConnect: 0,
      recoveryPending: true,
      connectionState: 'disconnected'
    }))
}
