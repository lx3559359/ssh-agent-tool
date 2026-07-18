import { redactAuditText } from '../../common/safety-transactions/audit-redaction.js'

const fleetErrorCodes = new Set([
  'timeout',
  'auth',
  'host-key',
  'permission',
  'unsupported',
  'cancelled',
  'unknown'
])

const connectionStatuses = new Map([
  ['pending', 'pending'],
  ['connecting', 'connecting'],
  ['connected', 'connected'],
  ['online', 'connected'],
  ['success', 'connected'],
  ['healthy', 'connected'],
  ['failed', 'failed'],
  ['error', 'failed'],
  ['offline', 'offline'],
  ['disconnected', 'offline'],
  ['timeout', 'timeout'],
  ['auth', 'auth'],
  ['host-key', 'host-key'],
  ['permission', 'permission'],
  ['unsupported', 'unsupported'],
  ['cancelled', 'cancelled'],
  ['canceled', 'cancelled'],
  ['aborted', 'cancelled']
])

const criticalStates = new Set([
  'critical',
  'crashed',
  'dead',
  'down',
  'error',
  'exited',
  'failed',
  'failure',
  'unhealthy'
])

const warningStates = new Set([
  'degraded',
  'created',
  'inactive',
  'paused',
  'restarting',
  'stopped',
  'warning'
])

const healthyStates = new Set([
  'active',
  'healthy',
  'ok',
  'running',
  'success',
  'up'
])

const exactSensitiveKeys = new Set([
  'apikey',
  'apikeyheader',
  'accesskey',
  'authheader',
  'authorization',
  'cookie',
  'cookiedata',
  'cookieheader',
  'cookiejar',
  'cookies',
  'cookiestring',
  'cookievalue',
  'credential',
  'credentials',
  'password',
  'passwordhash',
  'passwd',
  'passphrase',
  'privatekey',
  'privatekeypem',
  'proxyauthorization',
  'pwd',
  'secret',
  'secretkey',
  'setcookie',
  'sshpass',
  'stack',
  'token',
  'tokenvalue'
])

const sensitiveKeySuffixes = [
  'password',
  'passwd',
  'passphrase',
  'privatekey',
  'apikey',
  'accesskey',
  'cookie',
  'cookies',
  'secret',
  'secretkey',
  'sshpass',
  'token',
  'authorization',
  'credential',
  'credentials'
]

const sensitiveKeyTokens = new Set([
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'password',
  'passwd',
  'passphrase',
  'secret',
  'sshpass',
  'token'
])

const sensitivePayloadTokens = new Set([
  'blob',
  'bytes',
  'content',
  'data',
  'hash',
  'header',
  'id',
  'jar',
  'material',
  'name',
  'payload',
  'pem',
  'string',
  'value'
])

const sensitiveKeyTokenPairs = [
  ['access', 'key'],
  ['api', 'key'],
  ['private', 'key'],
  ['secret', 'key'],
  ['session', 'token']
]

const dangerousObjectKeys = new Set([
  '__proto__',
  'constructor',
  'prototype'
])

const maxJsonRedactionDepth = 6
const maxJsonRedactionLength = 64 * 1024
const maxJsonParseLength = 1024 * 1024
const maxCloneDepth = 64
const maxCloneNodes = 50000
const maxArrayItems = 2000
const maxTotalStringInputLength = 512 * 1024
const maxTotalStringOutputLength = 512 * 1024
const maxObjectEntries = 2000
const maxProbeNodes = 50000
const maxProbeDepth = 64
const redactedPlaceholder = '[REDACTED]'
const circularPlaceholder = '[CIRCULAR]'
const sharedPlaceholder = '[SHARED]'
const truncatedPlaceholder = '[TRUNCATED]'

const criticalProbeErrorCodes = new Set(['auth', 'host-key', 'timeout'])

const errorPayloadKeys = new Set([
  'error',
  'errorcause',
  'errorcode',
  'errordetail',
  'errormessage',
  'erroroutput',
  'errorreason',
  'errorstack',
  'errortext',
  'exception',
  'exceptiondetail',
  'exceptionmessage',
  'exceptionstack',
  'failuredetail',
  'failuremessage',
  'failurereason',
  'lasterror',
  'lasterrormessage',
  'rawerror',
  'stderr',
  'stderrtext'
])

function deepFreeze (value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const nested of Object.values(value)) deepFreeze(nested, seen)
  return Object.freeze(value)
}

function newEmptyFleetSnapshot () {
  return {
    connection: { status: 'pending', latencyMs: null, error: '' },
    resources: {
      cpu: null,
      memory: null,
      disk: null,
      load: null,
      uptime: ''
    },
    services: [],
    network: { interfaces: [], defaultRoute: null, dns: [] },
    firewall: { provider: '', enabled: null },
    collectedAt: '',
    overallStatus: 'pending'
  }
}

export const emptyFleetSnapshot = deepFreeze(newEmptyFleetSnapshot())

function normalizedKey (key) {
  return String(key).replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function ownValue (value, key) {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) {
    return undefined
  }
  return value[key]
}

function keyTokens (key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function isSensitiveKey (key) {
  const value = normalizedKey(key)
  if (exactSensitiveKeys.has(value) || sensitiveKeySuffixes.some(suffix => {
    return value.length > suffix.length && value.endsWith(suffix)
  })) return true

  const tokens = keyTokens(key)
  if (!sensitivePayloadTokens.has(tokens.at(-1))) return false
  const body = tokens.slice(0, -1)
  return body.some(token => sensitiveKeyTokens.has(token)) ||
    sensitiveKeyTokenPairs.some(([left, right]) => {
      return body.some((token, index) => {
        return token === left && body[index + 1] === right
      })
    })
}

function isErrorPayloadKey (key) {
  return errorPayloadKeys.has(normalizedKey(key))
}

function createSanitizeState () {
  return {
    ancestors: new WeakSet(),
    cache: new WeakMap(),
    redactedCache: new WeakMap(),
    nodes: 0,
    stringInputLength: 0,
    stringOutputLength: 0
  }
}

function safeDateString (value) {
  return Number.isFinite(value.getTime()) ? value.toISOString() : ''
}

function couldContainSensitiveText (text) {
  return /password|passwd|passphrase|private\s*key|privatekey|api[-_ ]?key|apikey|access[-_ ]?key|cookie|secret|token|authorization|auth[-_ ]?header|\bpwd\b|credential|bearer|sshpass|\bstack\b|\b[a-z][a-z0-9+.-]*:\/\/|sk-/i.test(text)
}

function looksLikeJsonContainer (text) {
  const trimmed = text.trim()
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
}

function redactAuditPlainText (text) {
  const prefix = '!\n'
  return redactAuditText(prefix + text).slice(prefix.length)
}

function redactFleetAliasText (value) {
  let text = String(value)
  text = text.replace(
    /(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s?#]*?)(?=,\s*[a-z][a-z0-9+.-]*:\/\/|[/\s?#]|$)/gi,
    (match, scheme, authority) => {
      const at = authority.lastIndexOf('@')
      if (at < 0) return match
      const userinfo = authority.slice(0, at)
      const host = authority.slice(at + 1)
      const separator = userinfo.indexOf(':')
      if (separator >= 0) {
        return `${scheme}${userinfo.slice(0, separator + 1)}${redactedPlaceholder}@${host}`
      }
      return `${scheme}${redactedPlaceholder}@${host}`
    }
  )
  text = text.replace(
    /((\\*)"(?:pwd|auth(?:[ _-]?header)|authorization(?:[ _-]?header)|(?:[a-z0-9_-]+)?password(?:[ _-]?(?:hash|value))|private(?:[ _-]?key[ _-]?pem)|api(?:[ _-]?key[ _-]?header)|(?:[a-z0-9_-]+)?token(?:[ _-]?value)|proxy(?:[ _-]?authorization)|(?:[a-z0-9_-]+)?cookie(?:s|[ _-]?(?:data|header|jar|string|value))?|set(?:[ _-]?cookie))\2"\s*:\s*\2")([\s\S]*?)(\2")/gi,
    `$1${redactedPlaceholder}$4`
  )
  text = text.replace(
    /(\b(?:(?:[a-z0-9_-]+)?secret[ _-]?key|stack|sshpass)\b\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^'\r\n]*'|[^\s,;&}]+)/gi,
    `$1${redactedPlaceholder}`
  )
  text = text.replace(
    /(\bauth(?:[ _-]?header)\b\s*[:=]\s*(?:Basic|Bearer)\s+)(?!\[REDACTED\])[^\s,;&}]+/gi,
    `$1${redactedPlaceholder}`
  )
  text = text.replace(
    /(\b(?:pwd|authorization(?:[ _-]?header)|(?:[a-z0-9_-]+)?password(?:[ _-]?(?:hash|value))|private(?:[ _-]?key[ _-]?pem)|api(?:[ _-]?key[ _-]?header)|(?:[a-z0-9_-]+)?token(?:[ _-]?value)|proxy(?:[ _-]?authorization)|(?:[a-z0-9_-]+)?cookie(?:s|[ _-]?(?:data|header|jar|string|value))?|set(?:[ _-]?cookie))\b\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^'\r\n]*'|[^\s,;&}]+)/gi,
    `$1${redactedPlaceholder}`
  )
  return redactAuditPlainText(text)
}

function boundedStringOutput (text, state) {
  if (state.stringOutputLength + text.length > maxTotalStringOutputLength) {
    return truncatedPlaceholder
  }
  state.stringOutputLength += text.length
  return text
}

function redactSensitiveText (value, state = createSanitizeState(), depth = 0, jsonDepth = 0) {
  const text = String(value)
  if (state.stringInputLength + text.length > maxTotalStringInputLength) {
    return truncatedPlaceholder
  }
  state.stringInputLength += text.length
  let redacted
  if (looksLikeJsonContainer(text)) {
    if (text.length > maxJsonParseLength) {
      redacted = JSON.stringify(redactedPlaceholder)
    } else {
      try {
        const parsed = JSON.parse(text)
        const preserveSensitiveKeys = jsonDepth >= maxJsonRedactionDepth ||
          text.length > maxJsonRedactionLength
        redacted = JSON.stringify(sanitizedClone(
          parsed,
          state,
          depth + 1,
          jsonDepth + 1,
          preserveSensitiveKeys
        ))
      } catch {
        redacted = couldContainSensitiveText(text)
          ? redactFleetAliasText(text)
          : text
      }
    }
  } else {
    redacted = couldContainSensitiveText(text)
      ? redactFleetAliasText(text)
      : text
  }
  return boundedStringOutput(redacted, state)
}

function sanitizedClone (
  value,
  state = createSanitizeState(),
  depth = 0,
  jsonDepth = 0,
  preserveSensitiveKeys = false
) {
  if (depth > maxCloneDepth || state.nodes >= maxCloneNodes) {
    return truncatedPlaceholder
  }
  if (typeof value === 'string') {
    return redactSensitiveText(value, state, depth, jsonDepth)
  }
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (typeof value !== 'object') return null
  if (value instanceof Date) return safeDateString(value)
  if (state.ancestors.has(value)) return circularPlaceholder
  const cache = preserveSensitiveKeys ? state.redactedCache : state.cache
  if (cache.has(value)) return sharedPlaceholder
  state.nodes += 1
  state.ancestors.add(value)

  try {
    if (Array.isArray(value)) {
      const copy = []
      const limit = Math.min(value.length, maxArrayItems)
      for (let index = 0; index < limit; index += 1) {
        copy.push(sanitizedClone(
          value[index],
          state,
          depth + 1,
          jsonDepth,
          preserveSensitiveKeys
        ))
      }
      if (value.length > limit) copy.push(truncatedPlaceholder)
      cache.set(value, true)
      return copy
    }

    const copy = {}
    let entries = 0
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      if (dangerousObjectKeys.has(key)) continue
      if (entries >= maxObjectEntries || state.nodes >= maxCloneNodes) {
        copy._truncated = truncatedPlaceholder
        break
      }
      entries += 1
      const nested = value[key]
      if (isErrorPayloadKey(key)) {
        copy[key] = nested === null || nested === undefined || nested === ''
          ? ''
          : classifyFleetStatusError(nested)
        continue
      }
      if (isSensitiveKey(key)) {
        if (preserveSensitiveKeys) copy[key] = redactedPlaceholder
        continue
      }
      copy[key] = sanitizedClone(
        nested,
        state,
        depth + 1,
        jsonDepth,
        preserveSensitiveKeys
      )
    }
    cache.set(value, true)
    return copy
  } finally {
    state.ancestors.delete(value)
  }
}

function errorParts (error) {
  const fields = [
    'name',
    'code',
    'type',
    'kind',
    'category',
    'status',
    'message',
    'stderr',
    'reason'
  ]
  const parts = []
  const seen = new WeakSet()
  const pending = [{ value: error, depth: 0 }]
  while (pending.length && parts.length < 100) {
    const item = pending.pop()
    const value = item.value
    if (value === null || value === undefined) continue
    if (typeof value !== 'object') {
      parts.push(String(value))
      continue
    }
    if (seen.has(value)) continue
    seen.add(value)
    for (const field of fields) {
      const fieldValue = ownValue(value, field)
      if (typeof fieldValue === 'string' || typeof fieldValue === 'number') {
        parts.push(String(fieldValue))
      }
    }
    const cause = ownValue(value, 'cause')
    if (item.depth < 8 && cause && cause !== value) {
      pending.push({ value: cause, depth: item.depth + 1 })
    }
  }
  return parts
}

export function classifyFleetStatusError (error) {
  const parts = errorParts(error)
  const directCodes = new Set(parts
    .map(part => part.trim().toLowerCase())
    .filter(part => fleetErrorCodes.has(part)))
  const text = parts.join('\n').toLowerCase()
  if (directCodes.has('cancelled') || /abort|cancel(?:led|ed|lation)|err_canceled/.test(text)) return 'cancelled'
  if (directCodes.has('timeout') || /etimedout|esockettimedout|timed?\s*out|timeout|deadline exceeded/.test(text)) return 'timeout'
  if (directCodes.has('host-key') || /host[-_\s]?key|known[-_\s]?hosts|fingerprint[^\n]*mismatch/.test(text)) return 'host-key'
  if (directCodes.has('auth') || /authentication|auth(?:entication)?[_\s-]*fail|invalid credentials|login denied|bad password|unauthorized|\b401\b|permission denied[^\n]*(?:publickey|password)/.test(text)) return 'auth'
  if (directCodes.has('permission') || /\beacces\b|\beperm\b|permission denied|operation not permitted|access denied|not authorized|insufficient privileges/.test(text)) return 'permission'
  if (directCodes.has('unsupported') || /enotsup|eopnotsupp|unsupported|not supported|command not found|no such command/.test(text)) return 'unsupported'
  return 'unknown'
}

function finiteNumber (value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeUptime (value, state = createSanitizeState()) {
  if (typeof value === 'string') {
    return value.trim() ? redactSensitiveText(value, state) : ''
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return ''
}

function uptimeProbeError (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  for (const key in value) {
    if (!Object.hasOwn(value, key) || !isErrorPayloadKey(key)) continue
    if (hasErrorPayloadValue(value[key])) return value[key]
  }
  return null
}

function normalizeConnectionStatus (value) {
  if (typeof value !== 'string') return 'pending'
  const status = String(value || 'pending').trim().toLowerCase()
  return connectionStatuses.get(status) || 'pending'
}

function normalizeError (error, connectionStatus) {
  if (error !== null && error !== undefined && error !== '') {
    return classifyFleetStatusError(error)
  }
  if (fleetErrorCodes.has(connectionStatus) && connectionStatus !== 'unknown') {
    return connectionStatus
  }
  return ''
}

function hasConnectionErrorValue (value) {
  if (value === null || value === undefined) return false
  return typeof value !== 'string' || Boolean(value.trim())
}

function normalizeCollectedAt (value, state = createSanitizeState()) {
  if (value instanceof Date) return safeDateString(value)
  return typeof value === 'string' ? redactSensitiveText(value, state) : ''
}

function metricState (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const state = ownValue(value, 'status') ??
    ownValue(value, 'health') ??
    ownValue(value, 'severity')
  return typeof state === 'string' ? state.trim().toLowerCase() : ''
}

function stateHealth (state) {
  if (criticalStates.has(state)) return 'critical'
  if (warningStates.has(state)) return 'warning'
  if (healthyStates.has(state)) return 'healthy'
  return null
}

function usagePercent (value, kind) {
  const direct = finiteNumber(value)
  if (direct !== null) return direct
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const keys = ['usedPercent', 'usagePercent', 'percent', 'value']
  for (const key of keys) {
    const number = finiteNumber(ownValue(value, key))
    if (number !== null) return number
  }

  if (kind === 'memory') {
    const totalBytes = finiteNumber(ownValue(value, 'totalBytes'))
    const availableBytes = finiteNumber(ownValue(value, 'availableBytes'))
    if (totalBytes > 0 && availableBytes !== null) {
      return 100 - availableBytes / totalBytes * 100
    }
  }
  return null
}

function loadValue (value, resources) {
  const direct = finiteNumber(value)
  if (direct !== null) return direct
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const normalized = finiteNumber(
    ownValue(value, 'normalized') ?? ownValue(value, 'ratio')
  )
  if (normalized !== null) return normalized
  const oneMinute = finiteNumber(
    ownValue(value, 'one') ??
    ownValue(value, 'oneMinute') ??
    ownValue(value, 'load1')
  )
  const cpu = ownValue(resources, 'cpu')
  const cpuCores = finiteNumber(
    ownValue(cpu, 'cores') ?? ownValue(cpu, 'cpuCores')
  )
  if (oneMinute !== null && cpuCores > 0) return oneMinute / cpuCores
  return oneMinute
}

function percentHealth (percent) {
  if (percent >= 90) return 'critical'
  if (percent >= 80) return 'warning'
  return 'healthy'
}

function loadHealth (load) {
  if (load >= 2) return 'critical'
  if (load >= 1) return 'warning'
  return 'healthy'
}

function createResourceHealthState () {
  return {
    active: new WeakSet(),
    cache: new WeakMap(),
    nodes: 0
  }
}

function resourceHealth (
  value,
  kind,
  resources,
  state = createResourceHealthState(),
  depth = 0
) {
  if (depth > maxProbeDepth || state.nodes >= maxProbeNodes) return null
  const cacheable = value && typeof value === 'object'
  if (cacheable && state.cache.has(value)) return state.cache.get(value)
  if (cacheable && state.active.has(value)) return null
  state.nodes += 1
  if (cacheable) state.active.add(value)

  let status = null
  try {
    if (!Array.isArray(value)) {
      const explicit = stateHealth(metricState(value))
      const number = kind === 'load'
        ? loadValue(value, resources)
        : usagePercent(value, kind)
      if (explicit && explicit !== 'healthy') {
        status = explicit
      } else if (number !== null && number >= 0) {
        status = explicit || (kind === 'load'
          ? loadHealth(number)
          : percentHealth(number))
      }
    }
  } finally {
    if (cacheable) state.active.delete(value)
  }
  if (cacheable) state.cache.set(value, status)
  return status
}

function serviceHealth (service) {
  if (!service || typeof service !== 'object') return null
  const states = [
    ownValue(service, 'activeState'),
    ownValue(service, 'state'),
    ownValue(service, 'status'),
    ownValue(service, 'health')
  ]
    .filter(value => typeof value === 'string')
    .map(value => value.trim().toLowerCase())
  const statuses = states.map(stateHealth).filter(Boolean)
  return worstFleetStatus(statuses, null)
}

function hasErrorPayloadValue (value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return Boolean(value.trim())
  if (typeof value !== 'object') return true
  for (const key in value) {
    if (Object.hasOwn(value, key)) return true
  }
  return false
}

function probeErrorHealth (error) {
  const code = fleetErrorCodes.has(error)
    ? error
    : classifyFleetStatusError(error)
  return criticalProbeErrorCodes.has(code) ? 'critical' : 'warning'
}

function probeErrorStatuses (root) {
  const statuses = []
  const seen = new WeakSet()
  const pending = [{ value: root, depth: 0 }]
  let nodes = 0
  while (pending.length && nodes < maxProbeNodes) {
    const { value, depth } = pending.pop()
    nodes += 1
    if (!value || typeof value !== 'object' || depth > maxProbeDepth) continue
    if (seen.has(value)) continue
    seen.add(value)

    if (Array.isArray(value)) {
      const limit = Math.min(value.length, maxArrayItems)
      for (let index = limit - 1; index >= 0; index -= 1) {
        pending.push({ value: value[index], depth: depth + 1 })
      }
      continue
    }

    let entries = 0
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      if (entries >= maxObjectEntries) break
      entries += 1
      const nested = value[key]
      if (isErrorPayloadKey(key)) {
        if (hasErrorPayloadValue(nested)) {
          statuses.push(probeErrorHealth(nested))
        }
        continue
      }
      pending.push({ value: nested, depth: depth + 1 })
    }
  }
  return statuses
}

function hasMeaningfulProbeValue (root) {
  const seen = new WeakSet()
  const pending = [{ value: root, depth: 0 }]
  let nodes = 0
  while (pending.length && nodes < maxProbeNodes) {
    const { value, depth } = pending.pop()
    nodes += 1
    if (value === null || value === undefined || depth > maxProbeDepth) continue
    if (typeof value === 'string') {
      const text = value.trim()
      if (text && text !== circularPlaceholder &&
          text !== sharedPlaceholder && text !== truncatedPlaceholder &&
          text !== redactedPlaceholder) {
        return true
      }
      continue
    }
    if (typeof value !== 'object') return true
    if (value instanceof Date) {
      if (Number.isFinite(value.getTime())) return true
      continue
    }
    if (seen.has(value)) continue
    seen.add(value)

    if (Array.isArray(value)) {
      const limit = Math.min(value.length, maxArrayItems)
      for (let index = limit - 1; index >= 0; index -= 1) {
        pending.push({ value: value[index], depth: depth + 1 })
      }
      continue
    }

    let entries = 0
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      if (entries >= maxObjectEntries) break
      entries += 1
      if (isErrorPayloadKey(key) || isSensitiveKey(key)) continue
      pending.push({ value: value[key], depth: depth + 1 })
    }
  }
  return false
}

export function worstFleetStatus (statuses = [], fallback = 'pending') {
  const ranks = { healthy: 1, warning: 2, critical: 3 }
  const values = Array.isArray(statuses) ? statuses : []
  return values.reduce((worst, status) => {
    if (typeof status !== 'string') return worst
    return (ranks[status] || 0) > (ranks[worst] || 0) ? status : worst
  }, fallback)
}

function probeStatuses (snapshot, supplementalProbeErrors = []) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {}
  const resourcesValue = ownValue(source, 'resources')
  const resources = resourcesValue && typeof resourcesValue === 'object'
    ? resourcesValue
    : {}
  const servicesValue = ownValue(source, 'services')
  const services = Array.isArray(servicesValue) ? servicesValue : []
  const networkValue = ownValue(source, 'network')
  const network = networkValue && typeof networkValue === 'object'
    ? networkValue
    : {}
  const firewallValue = ownValue(source, 'firewall')
  const firewall = firewallValue && typeof firewallValue === 'object'
    ? firewallValue
    : {}
  const statuses = probeErrorStatuses({
    resources,
    services,
    network,
    firewall
  })
  if (Array.isArray(supplementalProbeErrors)) {
    for (const error of supplementalProbeErrors) {
      if (hasErrorPayloadValue(error)) statuses.push(probeErrorHealth(error))
    }
  }
  for (const kind of ['cpu', 'memory', 'disk', 'load']) {
    const status = resourceHealth(ownValue(resources, kind), kind, resources)
    if (status) statuses.push(status)
  }
  const uptime = finiteNumber(ownValue(resources, 'uptime'))
  if (uptime !== null && uptime >= 0) {
    statuses.push('healthy')
  }

  for (const service of services.slice(0, maxArrayItems)) {
    const status = serviceHealth(service)
    if (status) statuses.push(status)
  }

  if (hasMeaningfulProbeValue(ownValue(network, 'interfaces')) ||
      hasMeaningfulProbeValue(ownValue(network, 'defaultRoute')) ||
      hasMeaningfulProbeValue(ownValue(network, 'dns'))) {
    statuses.push('healthy')
  }

  if (hasMeaningfulProbeValue(ownValue(firewall, 'provider')) ||
      typeof ownValue(firewall, 'enabled') === 'boolean') {
    statuses.push('healthy')
  }
  return statuses
}

export function deriveFleetStatusHealth (snapshot = {}, supplementalProbeErrors = []) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {}
  const connectionValue = ownValue(source, 'connection')
  const connection = connectionValue && typeof connectionValue === 'object'
    ? connectionValue
    : {}
  const connectionStatus = normalizeConnectionStatus(ownValue(connection, 'status'))
  const connectionError = ownValue(connection, 'error')
  const errorCode = connectionError
    ? classifyFleetStatusError(connectionError)
    : ''

  if (connectionStatus === 'cancelled' || errorCode === 'cancelled') {
    return { overallStatus: 'cancelled' }
  }
  if (connectionStatus === 'unsupported' || errorCode === 'unsupported') {
    return { overallStatus: 'unsupported' }
  }
  if (connectionStatus === 'permission' || errorCode === 'permission') {
    return { overallStatus: 'permission' }
  }
  if (['failed', 'offline', 'timeout', 'auth', 'host-key'].includes(connectionStatus) ||
      errorCode) {
    return { overallStatus: 'offline' }
  }

  const statuses = probeStatuses(source, supplementalProbeErrors)
  const probeStatus = worstFleetStatus(statuses)
  if (probeStatus === 'critical' || probeStatus === 'warning') {
    return { overallStatus: probeStatus }
  }
  if (!statuses.length || connectionStatus !== 'connected') {
    return { overallStatus: 'pending' }
  }
  return { overallStatus: 'healthy' }
}

export function createFleetStatusSnapshot (collected = {}) {
  const source = collected && typeof collected === 'object' ? collected : {}
  const connectionValue = ownValue(source, 'connection')
  const connectionSource = connectionValue && typeof connectionValue === 'object'
    ? connectionValue
    : {}
  const resourcesValue = ownValue(source, 'resources')
  const resourcesSource = resourcesValue && typeof resourcesValue === 'object'
    ? resourcesValue
    : {}
  const networkValue = ownValue(source, 'network')
  const networkSource = networkValue && typeof networkValue === 'object'
    ? networkValue
    : {}
  const firewallValue = ownValue(source, 'firewall')
  const firewallSource = firewallValue && typeof firewallValue === 'object'
    ? firewallValue
    : {}
  const connectionStatusValue = ownValue(connectionSource, 'status')
  const connectionStatus = normalizeConnectionStatus(connectionStatusValue)
  const connectionErrorValue = ownValue(connectionSource, 'error')
  const connectionError = hasConnectionErrorValue(connectionErrorValue)
    ? connectionErrorValue
    : ownValue(source, 'error')
  const latencyMs = finiteNumber(ownValue(connectionSource, 'latencyMs'))
  const sanitizeState = createSanitizeState()
  const snapshot = {
    connection: {
      status: connectionStatus,
      latencyMs: latencyMs !== null && latencyMs >= 0 ? latencyMs : null,
      error: normalizeError(connectionError, connectionStatus)
    },
    resources: {
      cpu: ownValue(resourcesSource, 'cpu') === undefined
        ? null
        : sanitizedClone(ownValue(resourcesSource, 'cpu'), sanitizeState),
      memory: ownValue(resourcesSource, 'memory') === undefined
        ? null
        : sanitizedClone(ownValue(resourcesSource, 'memory'), sanitizeState),
      disk: ownValue(resourcesSource, 'disk') === undefined
        ? null
        : sanitizedClone(ownValue(resourcesSource, 'disk'), sanitizeState),
      load: ownValue(resourcesSource, 'load') === undefined
        ? null
        : sanitizedClone(ownValue(resourcesSource, 'load'), sanitizeState),
      uptime: normalizeUptime(ownValue(resourcesSource, 'uptime'), sanitizeState)
    },
    services: Array.isArray(ownValue(source, 'services'))
      ? sanitizedClone(ownValue(source, 'services'), sanitizeState)
      : [],
    network: {
      interfaces: Array.isArray(ownValue(networkSource, 'interfaces'))
        ? sanitizedClone(ownValue(networkSource, 'interfaces'), sanitizeState)
        : [],
      defaultRoute: ownValue(networkSource, 'defaultRoute') === undefined
        ? null
        : sanitizedClone(ownValue(networkSource, 'defaultRoute'), sanitizeState),
      dns: Array.isArray(ownValue(networkSource, 'dns'))
        ? sanitizedClone(ownValue(networkSource, 'dns'), sanitizeState)
        : []
    },
    firewall: {
      provider: typeof ownValue(firewallSource, 'provider') === 'string'
        ? redactSensitiveText(ownValue(firewallSource, 'provider'), sanitizeState)
        : '',
      enabled: typeof ownValue(firewallSource, 'enabled') === 'boolean'
        ? ownValue(firewallSource, 'enabled')
        : null
    },
    collectedAt: normalizeCollectedAt(ownValue(source, 'collectedAt'), sanitizeState),
    overallStatus: 'pending'
  }

  const supplementalProbeErrors = [
    ownValue(resourcesSource, 'error'),
    uptimeProbeError(ownValue(resourcesSource, 'uptime')),
    ownValue(networkSource, 'error'),
    ownValue(firewallSource, 'error')
  ]
  snapshot.overallStatus = deriveFleetStatusHealth(
    snapshot,
    supplementalProbeErrors
  ).overallStatus
  return snapshot
}

export function normalizeFleetStatusSnapshot (snapshot = {}) {
  return createFleetStatusSnapshot(snapshot)
}
