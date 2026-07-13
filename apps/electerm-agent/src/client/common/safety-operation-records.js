export const safetyOperationStorageKey = 'shellpilot-safety-operation-records'
export const legacySftpRecoveryStorageKey = 'shellpilot-sftp-recovery-records'
export const legacyQuickRollbackStorageKey = 'shellpilot-network-rollback'
export const safetyOperationUpdatedEvent = 'shellpilot-safety-operation-records-updated'

function toIsoString (value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString()
}

function normalizeStatus (record = {}) {
  if (record.status) return record.status
  return record.rollbackStatus === 'completed' ? 'restored' : 'available'
}

export function normalizeSafetyOperationRecord (record = {}, defaults = {}) {
  const source = record.source || defaults.source || (record.rollbackPath || record.path ? 'quick-command' : 'sftp')
  const createdAt = toIsoString(record.createdAt)
  const rollbackPath = record.rollbackPath || record.path || ''
  const target = record.target || record.sourcePath || record.title || ''
  return {
    ...defaults,
    ...record,
    id: record.id || `${source}-${new Date(createdAt).getTime()}-${String(target || rollbackPath).replace(/[^a-z0-9]+/gi, '-').slice(-32)}`,
    source,
    kind: record.kind || (source === 'quick-command' ? 'server-change' : 'backup'),
    title: record.title || (source === 'quick-command' ? '服务器配置修改' : 'SFTP 安全操作'),
    target,
    sourcePath: record.sourcePath || '',
    backupPath: record.backupPath || '',
    rollbackPath,
    tabId: record.tabId || defaults.tabId || '',
    host: record.host || defaults.host || '',
    port: Number(record.port || defaults.port || 22),
    username: record.username || defaults.username || '',
    serverTitle: record.serverTitle || defaults.serverTitle || '',
    createdAt,
    status: normalizeStatus(record),
    rollbackStatus: record.rollbackStatus || (normalizeStatus(record) === 'available' ? 'available' : 'completed')
  }
}

export function mergeSafetyOperationRecords (records = [], added = [], limit = 200) {
  const byId = new Map()
  for (const item of [...records, ...added]) {
    if (!item) continue
    const normalized = normalizeSafetyOperationRecord(item)
    const existing = byId.get(normalized.id)
    const existingTime = existing
      ? new Date(existing.updatedAt || existing.createdAt).getTime()
      : -1
    const incomingTime = new Date(normalized.updatedAt || normalized.createdAt).getTime()
    if (!existing || incomingTime >= existingTime) {
      byId.set(normalized.id, normalized)
    }
  }
  return [...byId.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
}

export function migrateSafetyOperationRecords ({
  unifiedRecords = [],
  sftpRecords = [],
  quickRollbackRecord = null
} = {}, limit = 200) {
  const legacySftp = sftpRecords.map(record => normalizeSafetyOperationRecord(record, { source: 'sftp' }))
  const legacyQuick = quickRollbackRecord
    ? [normalizeSafetyOperationRecord(quickRollbackRecord, { source: 'quick-command' })]
    : []
  return mergeSafetyOperationRecords([...legacySftp, ...legacyQuick], unifiedRecords, limit)
}

export function readSafetyOperationRecords (storage, options = {}) {
  const unifiedRecords = storage.safeGetItemJSON(safetyOperationStorageKey, [])
  const sftpRecords = storage.getItemJSON(legacySftpRecoveryStorageKey, [])
  const quickRollbackRecord = storage.getItemJSON(legacyQuickRollbackStorageKey, null)
  const records = migrateSafetyOperationRecords({
    unifiedRecords,
    sftpRecords,
    quickRollbackRecord
  })
  if (JSON.stringify(records) !== JSON.stringify(unifiedRecords)) {
    storage.safeSetItemJSON(safetyOperationStorageKey, records)
  }
  const hadLegacyRecords = sftpRecords.length > 0 || Boolean(quickRollbackRecord)
  if (options.cleanupLegacy !== false && hadLegacyRecords && storage.removeItem) {
    const verified = storage.safeGetItemJSON(safetyOperationStorageKey, [])
    if (JSON.stringify(verified) === JSON.stringify(records)) {
      for (const key of [legacySftpRecoveryStorageKey, legacyQuickRollbackStorageKey]) {
        try {
          storage.removeItem(key)
        } catch (error) {
          // Retry cleanup on the next read while the verified encrypted copy remains available.
        }
      }
    }
  }
  return records
}

export function writeSafetyOperationRecords (storage, records = []) {
  const current = storage.safeGetItemJSON(safetyOperationStorageKey, [])
  const normalized = mergeSafetyOperationRecords(current, records)
  storage.safeSetItemJSON(safetyOperationStorageKey, normalized)
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent(safetyOperationUpdatedEvent))
  }
  return normalized
}

export function updateSafetyOperationRecord (records = [], id, patch = {}) {
  return records.map(record => {
    if (record.id !== id) return record
    const next = {
      ...record,
      ...patch,
      updatedAt: new Date().toISOString()
    }
    if (patch.status && patch.status !== 'failed') {
      next.error = ''
      next.failedAt = ''
    }
    return normalizeSafetyOperationRecord(next)
  })
}

export function filterSafetyOperationRecords (records = [], filters = {}) {
  const keyword = String(filters.keyword || '').trim().toLowerCase()
  return records.filter(record => {
    if (filters.host && record.host !== filters.host) return false
    if (filters.source && record.source !== filters.source) return false
    if (filters.status && record.status !== filters.status) return false
    if (!keyword) return true
    return [
      record.title,
      record.target,
      record.sourcePath,
      record.backupPath,
      record.rollbackPath,
      record.host,
      record.serverTitle
    ].some(value => String(value || '').toLowerCase().includes(keyword))
  })
}

export function matchesSafetyOperationEndpoint (record = {}, tab = {}, requireComplete = false) {
  const recordUsername = record.username || ''
  const tabUsername = tab.username || tab.user || ''
  if (requireComplete && (!record.host || !record.port || !recordUsername)) return false
  if (record.host && tab.host !== record.host) return false
  if (record.port && Number(tab.port || 22) !== Number(record.port)) return false
  if (recordUsername && tabUsername !== recordUsername) return false
  return true
}

export function findSafetyOperationSession (record = {}, tabIds = [], getSession) {
  const exact = record.tabId ? getSession(record.tabId) : null
  if (
    exact?.pid &&
    exact.isSsh?.() &&
    matchesSafetyOperationEndpoint(record, exact.props?.tab || {}, true)
  ) return exact

  const ids = [...new Set(tabIds.filter(Boolean).filter(tabId => tabId !== record.tabId))]
  return ids.map(tabId => getSession(tabId)).find(session => {
    return Boolean(
      session?.pid &&
      session.isSsh?.() &&
      matchesSafetyOperationEndpoint(record, session.props?.tab || {}, true)
    )
  })
}

export function createQuickCommandSafetyRecord ({
  title,
  rollbackPath,
  tab = {},
  seconds = 0,
  protected: protectedMode = true,
  now = new Date()
}) {
  const expiresAt = seconds > 0
    ? new Date(now.getTime() + Number(seconds) * 1000).toISOString()
    : ''
  return normalizeSafetyOperationRecord({
    id: `quick-command-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'quick-command',
    kind: 'server-change',
    title: title || '服务器配置修改',
    target: title || '服务器配置修改',
    rollbackPath,
    tabId: tab.id || '',
    host: tab.host || '',
    port: tab.port || 22,
    username: tab.username || tab.user || '',
    serverTitle: tab.title || tab.name || '',
    createdAt: now.toISOString(),
    seconds: Number(seconds || 0),
    expiresAt,
    protected: protectedMode,
    status: 'available',
    rollbackStatus: 'available'
  })
}

function shellQuote (value) {
  const escaped = String(value || '').replace(/'/g, '\'"\'"\'')
  return '\'' + escaped + '\''
}

export function buildQuickCommandRollbackAction (record = {}, action = 'rollback') {
  const path = record.rollbackPath || record.path || ''
  if (!path) return ''
  const quotedPath = shellQuote(path)
  const quotedArmedPath = shellQuote(`${path}.armed`)
  if (action === 'keep') {
    return `if [ "$(id -u)" = "0" ]; then rm -f ${quotedArmedPath}; else sudo rm -f ${quotedArmedPath}; fi && echo "已保留新配置，自动回滚已取消"`
  }
  return `if [ -x ${quotedPath} ]; then if [ "$(id -u)" = "0" ]; then sh ${quotedPath}; else sudo sh ${quotedPath}; fi; else echo "回滚脚本不存在或已失效" >&2; exit 44; fi`
}

export function buildVerifiedQuickCommandRollbackAction (record, action, token) {
  const marker = String(token || '').replace(/[^a-zA-Z0-9_-]/g, '')
  const command = buildQuickCommandRollbackAction(record, action)
  return `( ${command} ); __shellpilot_rc=$?; printf '\n__SHELLPILOT_ROLLBACK_RC_${marker}=%s\n' "$__shellpilot_rc"; exit "$__shellpilot_rc"`
}

export function assertVerifiedQuickCommandRollbackResult (output, token) {
  const marker = String(token || '').replace(/[^a-zA-Z0-9_-]/g, '')
  const match = String(output || '').match(new RegExp(`__SHELLPILOT_ROLLBACK_RC_${marker}=(\\d+)`))
  if (!match) throw new Error('远端未返回执行状态，无法确认回滚是否成功。')
  const code = Number(match[1])
  if (code !== 0) throw new Error(`远端回滚命令执行失败，退出码 ${code}。`)
  return true
}
