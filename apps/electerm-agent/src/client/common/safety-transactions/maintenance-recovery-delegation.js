import {
  assertSameSessionEndpoint,
  normalizeEndpoint
} from './endpoint-guard.js'
import { assertTrustedOperationId } from './operation-id.js'
import { isSafeRollbackScriptPath } from './rollback-script-path.js'

export const maintenanceRecoveryProvider = 'quick-command'

const supportedQuickCommandIds = new Set([
  'builtin-server-hostname-change',
  'builtin-server-hosts-manage',
  'builtin-server-timezone-change',
  'builtin-server-swap-manage',
  'builtin-server-service-boot-policy',
  'builtin-server-cron-manage',
  'builtin-server-firewall-open-port'
])
const intentCapabilities = new WeakMap()
const delegationCapabilities = new WeakMap()
const authorizationCapabilities = new WeakMap()

function deepFreeze (value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function hasUnsafeControlCharacters (value, multiline) {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (multiline && code === 10) continue
    if (code <= 31 || (code >= 127 && code <= 159)) {
      return true
    }
  }
  return false
}

function safeText (value, label, options = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}不能为空。`)
  }
  if (hasUnsafeControlCharacters(value, options.multiline)) {
    throw new Error(`${label}包含控制字符。`)
  }
  return value
}

function safeStringArray (value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组。`)
  return value.map(item => safeText(item, label))
}

function safeEndpoint (endpoint) {
  if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) {
    throw new Error('维护操作缺少服务器端点。')
  }
  const tabId = safeText(String(endpoint.tabId || ''), '维护操作 tab')
  return {
    tabId,
    ...normalizeEndpoint(endpoint)
  }
}

function safeRollbackPath (value) {
  const rollbackPath = safeText(value, '维护操作回滚路径')
  if (!isSafeRollbackScriptPath(rollbackPath) || !rollbackPath.endsWith('.sh')) {
    throw new Error('维护操作回滚路径必须是受控目录中安全且长度受限的直接 .sh 子文件。')
  }
  return rollbackPath
}

function normalizeDetails (details = {}, options = {}) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    throw new Error('维护操作恢复授权不完整。')
  }
  const quickCommandId = safeText(details.quickCommandId, '维护命令 ID')
  if (!supportedQuickCommandIds.has(quickCommandId)) {
    throw new Error('维护命令不允许注册快捷回滚。')
  }
  const normalized = {
    quickCommandId,
    command: safeText(details.command, '维护命令', { multiline: true }),
    title: safeText(details.title, '维护操作标题'),
    rollbackPath: safeRollbackPath(details.rollbackPath),
    endpoint: safeEndpoint(details.endpoint),
    backupTargets: safeStringArray(details.backupTargets, '维护操作备份信息'),
    verification: safeStringArray(details.verification, '维护操作验证信息')
  }
  if (!normalized.verification.length) {
    throw new Error('维护操作至少需要一项验证信息。')
  }
  if (options.operationId) {
    normalized.operationId = assertTrustedOperationId(options.operationId)
  }
  return deepFreeze(normalized)
}

function issueCapability (store, details) {
  const capability = Object.freeze({})
  store.set(capability, details)
  return capability
}

function consumeCapability (store, capability) {
  if (!capability || typeof capability !== 'object') return undefined
  const details = store.get(capability)
  store.delete(capability)
  return details
}

export function isMaintenanceRecoveryQuickCommand (id) {
  return supportedQuickCommandIds.has(String(id || ''))
}

export function createInternalMaintenanceRecoveryIntent (details) {
  return issueCapability(intentCapabilities, normalizeDetails(details))
}

export function consumeInternalMaintenanceRecoveryIntent (capability) {
  return consumeCapability(intentCapabilities, capability)
}

export function createInternalMaintenanceRecoveryDelegation (details) {
  return issueCapability(delegationCapabilities, normalizeDetails(details))
}

export function consumeInternalMaintenanceRecoveryDelegation (capability) {
  return consumeCapability(delegationCapabilities, capability)
}

export function createInternalMaintenanceRecoveryAuthorization (details, operationId) {
  return issueCapability(
    authorizationCapabilities,
    normalizeDetails(details, { operationId })
  )
}

export function consumeInternalMaintenanceRecoveryAuthorization (capability) {
  return consumeCapability(authorizationCapabilities, capability)
}

export function createPersistedMaintenanceRecovery (details, operationId) {
  const normalized = normalizeDetails(details, { operationId })
  return deepFreeze({
    schemaVersion: 1,
    operationId: normalized.operationId,
    quickCommandId: normalized.quickCommandId,
    title: normalized.title,
    rollbackPath: normalized.rollbackPath,
    endpoint: normalized.endpoint,
    backupTargets: normalized.backupTargets,
    verification: normalized.verification
  })
}

export function validatePersistedMaintenanceRecovery (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    value.schemaVersion !== 1) {
    throw new Error('维护操作恢复记录不完整。')
  }
  const normalized = normalizeDetails({
    ...value,
    command: 'persisted-maintenance-command'
  }, { operationId: value.operationId })
  return deepFreeze({
    schemaVersion: 1,
    operationId: normalized.operationId,
    quickCommandId: normalized.quickCommandId,
    title: normalized.title,
    rollbackPath: normalized.rollbackPath,
    endpoint: normalized.endpoint,
    backupTargets: normalized.backupTargets,
    verification: normalized.verification
  })
}

function sameArray (left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function assertAuthorizedMaintenanceRecovery (details, operation) {
  const normalized = normalizeDetails(details, { operationId: details.operationId })
  const persisted = validatePersistedMaintenanceRecovery(
    operation?.metadata?.maintenanceRecovery
  )
  assertSameSessionEndpoint(normalized.endpoint, operation.endpoint)
  if (normalized.operationId !== operation.id ||
    normalized.command !== operation.command ||
    normalized.title !== operation.title ||
    persisted.operationId !== operation.id ||
    persisted.quickCommandId !== normalized.quickCommandId ||
    persisted.title !== normalized.title ||
    persisted.rollbackPath !== normalized.rollbackPath ||
    !sameArray(persisted.backupTargets, normalized.backupTargets) ||
    !sameArray(persisted.verification, normalized.verification)) {
    throw new Error('维护操作恢复授权与当前事务身份不一致。')
  }
  assertSameSessionEndpoint(persisted.endpoint, operation.endpoint)
  return persisted
}

export function assertPersistedMaintenanceRecoveryOperation (operation) {
  const persisted = validatePersistedMaintenanceRecovery(
    operation?.metadata?.maintenanceRecovery
  )
  if (persisted.operationId !== operation.id ||
    persisted.title !== operation.title ||
    operation.risk !== 'change' || operation.reversible !== true ||
    operation.recoveryProvider !== maintenanceRecoveryProvider) {
    throw new Error('维护操作恢复记录与当前事务身份不一致。')
  }
  assertSameSessionEndpoint(persisted.endpoint, operation.endpoint)
  return persisted
}
