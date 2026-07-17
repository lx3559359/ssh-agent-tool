const allowedTypes = new Set(['service', 'container', 'process'])
const allowedGroups = new Set(['system', 'container', 'process-manager'])
const allowedStates = new Set([
  'running',
  'stopped',
  'failed',
  'starting',
  'restarting',
  'paused',
  'unknown'
])
const allowedAutostart = new Set([
  'enabled',
  'disabled',
  'static',
  'masked',
  'unknown'
])
const allowedSources = new Set([
  'systemd',
  'openrc',
  'sysv',
  'docker',
  'compose',
  'supervisor',
  'pm2'
])
const abnormalStates = new Set([
  'failed',
  'starting',
  'restarting',
  'paused',
  'unknown'
])
const disconnectedCodes = new Set([
  'AUTH_FAILED',
  'CONNECTION_FAILED',
  'CONNECTION_TIMEOUT',
  'HOST_KEY_MISMATCH',
  'TARGET_TIMEOUT',
  'TERMINAL_UNAVAILABLE',
  'TOTAL_TIMEOUT'
])

export const fleetServiceGroupLabels = Object.freeze({
  system: '系统服务',
  container: '容器',
  'process-manager': '进程管理器'
})

function safeText (value, maxLength = 512) {
  const text = [...String(value ?? '')].map(character => {
    const code = character.codePointAt(0)
    return code <= 31 || code === 127 ? ' ' : character
  }).join('')
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function groupForType (type) {
  if (type === 'service') return 'system'
  if (type === 'container') return 'container'
  return 'process-manager'
}

function normalizeItem (value) {
  if (!value || typeof value !== 'object') return null
  const name = safeText(value.name, 256)
  const type = safeText(value.type, 32).toLowerCase()
  const source = safeText(value.source, 32).toLowerCase()
  if (!name || !allowedTypes.has(type) || !allowedSources.has(source)) return null
  const proposedGroup = safeText(value.group, 32).toLowerCase()
  const proposedState = safeText(value.state, 32).toLowerCase()
  const proposedAutostart = safeText(value.autostart, 32).toLowerCase()
  return {
    id: safeText(value.id, 320) || `${source}:${name}`,
    name,
    type,
    group: allowedGroups.has(proposedGroup)
      ? proposedGroup
      : groupForType(type),
    state: allowedStates.has(proposedState) ? proposedState : 'unknown',
    autostart: allowedAutostart.has(proposedAutostart)
      ? proposedAutostart
      : 'unknown',
    description: safeText(value.description),
    source
  }
}

function errorFacts (value) {
  const errors = Array.isArray(value?.errors) ? value.errors : []
  if (value?.error && typeof value.error === 'object') errors.push(value.error)
  return errors.map(error => ({
    code: safeText(error?.code, 64).toUpperCase(),
    category: safeText(error?.category, 64).toLowerCase()
  }))
}

function failurePresentation (value, facts) {
  const status = safeText(value?.status, 32).toLowerCase()
  if (
    status === 'cancelled' ||
    facts.some(error => error.code === 'CANCELLED' || error.category === 'cancelled')
  ) {
    return { status: 'cancelled', message: '已取消' }
  }
  if (facts.some(error => error.category === 'permission' || error.code === 'PERMISSION_DENIED')) {
    return { status: 'permission', message: '权限不足' }
  }
  if (facts.some(error => error.category === 'unsupported' || error.code === 'UNSUPPORTED')) {
    return { status: 'unsupported', message: '当前服务器不支持服务检测' }
  }
  if (facts.some(error => (
    disconnectedCodes.has(error.code) ||
    ['auth', 'host-key', 'timeout'].includes(error.category)
  ))) {
    return { status: 'disconnected', message: '未连接或连接已断开' }
  }
  return { status: 'error', message: '检测失败' }
}

export function normalizeFleetServiceInventoryResult (value = {}) {
  const items = (Array.isArray(value?.items) ? value.items : [])
    .map(normalizeItem)
    .filter(Boolean)
  const facts = errorFacts(value)
  const truncated = Boolean(
    value?.truncated ||
    facts.some(error => (
      error.code === 'OUTPUT_TRUNCATED' || error.category === 'partial'
    ))
  )
  const status = safeText(value?.status, 32).toLowerCase()
  const successful = ['completed', 'success'].includes(status)

  if (items.length) {
    const partial = Boolean(facts.length || truncated || !successful)
    return {
      status: partial ? 'partial' : 'ready',
      message: partial
        ? `已发现 ${items.length} 项，部分检测项失败`
        : `已发现 ${items.length} 项`,
      items,
      truncated
    }
  }
  if (successful && truncated && facts.every(error => (
    error.code === 'OUTPUT_TRUNCATED' || error.category === 'partial'
  ))) {
    return {
      status: 'partial',
      message: '\u7ed3\u679c\u53ef\u80fd\u5df2\u622a\u65ad',
      items,
      truncated
    }
  }
  if (successful && !facts.length) {
    return {
      status: 'empty',
      message: '未发现服务',
      items,
      truncated
    }
  }
  return {
    ...failurePresentation(value, facts),
    items,
    truncated
  }
}

export function isAbnormalFleetService (row) {
  return abnormalStates.has(safeText(row?.state, 32).toLowerCase())
}

export function filterFleetServiceRows (rows, filters = {}) {
  const search = safeText(filters.search).toLowerCase()
  const group = safeText(filters.group, 32) || 'all'
  const status = safeText(filters.status, 32) || 'all'
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const searchMatch = !search || [
      row.serverName,
      row.name,
      row.description,
      row.source
    ].some(value => safeText(value).toLowerCase().includes(search))
    const groupMatch = group === 'all' || row.group === group
    const statusMatch = status === 'all' ||
      (status === 'abnormal'
        ? isAbnormalFleetService(row)
        : row.state === status)
    return searchMatch && groupMatch && statusMatch
  })
}
