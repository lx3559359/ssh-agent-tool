export const FLEET_STATUS_ACTIONS = Object.freeze({
  collect: 'collect-fleet-status',
  inventory: 'collect-fleet-service-inventory',
  cancel: 'cancel-fleet-status'
})

export const FLEET_STATUS_PROBE_IDS = Object.freeze([
  'system',
  'resources',
  'services',
  'network',
  'firewall',
  'security',
  'containers'
])

export const FLEET_STATUS_TIMEOUTS = Object.freeze({
  connectionMs: 12000,
  probeMs: 8000,
  targetMs: 30000,
  totalMs: 30000
})

const connectionKeys = Object.freeze([
  'host',
  'port',
  'username',
  'password',
  'privateKey',
  'passphrase',
  'certificate',
  'encode',
  'useSshAgent',
  'sshAgent',
  'serverHostKey',
  'cipher',
  'compress',
  'isMFA',
  'ignoreKeyboardInteractive',
  'interactiveValues',
  'hasHopping',
  'connectionHoppings',
  'term',
  'envLang'
])
const connectionIdentityKeys = Object.freeze([
  'host',
  'port',
  'username',
  'encode',
  'useSshAgent',
  'sshAgent',
  'serverHostKey',
  'cipher',
  'compress',
  'isMFA',
  'ignoreKeyboardInteractive',
  'hasHopping',
  'readyTimeout',
  'keepaliveCountMax',
  'keepaliveInterval',
  'proxy',
  'term',
  'envLang'
])
const sensitiveKey = /(?:^key$|password|passwd|passphrase|private.?key|api.?key|access.?token|auth.?token|token|secret|authorization|cookie|stack)/i
const omittedResponseKey = /^rawOutput$/i
const sensitiveAssignment = /(?:password|passwd|passphrase|private[ _-]?key|api[ _-]?key|access[ _-]?token|auth[ _-]?token|token|secret|authorization|cookie)\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi
const sensitiveCliOption = /(?:^|[\s;&])--?(?:[a-z0-9]+[-_])*(?:password|passwd|passphrase|private[-_]?key|api[-_]?key|access[-_]?token|auth[-_]?token|token|secret)(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gim
const privateKeyBlock = /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi
const sensitiveHeader = /\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]*/gi
const sensitiveAuthorizationAssignment = /\bauthorization\s*=\s*(?:basic|bearer)\s+[^\r\n]*/gi
const sensitiveCookieAssignment = /\b(?:cookie|set-cookie)\s*=\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n]*)/gi

function redactSensitiveString (value) {
  return String(value)
    .replace(privateKeyBlock, '[REDACTED]')
    .replace(sensitiveHeader, '[REDACTED]')
    .replace(sensitiveAuthorizationAssignment, '[REDACTED]')
    .replace(sensitiveCookieAssignment, '[REDACTED]')
    .replace(sensitiveCliOption, ' [REDACTED]')
    .replace(sensitiveAssignment, '[REDACTED]')
    .replace(/("(?:password|passphrase|privateKey|apiKey|api_key|token|secret)"\s*:\s*)(?:"(?:\\.|[^"\\])*"|[^,}\s]+)/gi, '[REDACTED]')
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/\bsk-[a-z0-9_-]{6,}\b/gi, '[REDACTED]')
}

function cloneValue (value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  const result = Array.isArray(value) ? [] : {}
  seen.set(value, result)
  for (const [key, item] of Object.entries(value)) {
    result[key] = cloneValue(item, seen)
  }
  return result
}

function redactResponse (value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return redactSensitiveString(value)
  }
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map(item => redactResponse(item, seen))
  }
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKey.test(key) || omittedResponseKey.test(key)) continue
    result[key] = redactResponse(item, seen)
  }
  return result
}

function getProxy (tab, config) {
  if (typeof tab.proxy === 'string' && tab.proxy) return tab.proxy
  if (
    config.enableGlobalProxy &&
    typeof config.proxy === 'string' &&
    config.proxy
  ) {
    return config.proxy
  }
  return ''
}

function pickConnection (tab, config) {
  const connection = {}
  for (const key of connectionKeys) {
    if (tab[key] !== undefined) connection[key] = cloneValue(tab[key])
  }
  connection.readyTimeout = FLEET_STATUS_TIMEOUTS.connectionMs
  connection.keepaliveInterval = tab.keepaliveInterval || config.keepaliveInterval
  connection.keepaliveCountMax = config.keepaliveCountMax
  connection.proxy = getProxy(tab, config)
  if (Array.isArray(connection.connectionHoppings)) {
    connection.connectionHoppings = connection.connectionHoppings.map(hopping => {
      const safeHopping = {}
      for (const key of connectionKeys) {
        if (hopping?.[key] !== undefined && key !== 'connectionHoppings') {
          safeHopping[key] = cloneValue(hopping[key])
        }
      }
      return safeHopping
    })
    connection.hasHopping = connection.connectionHoppings.length > 0
  }
  return connection
}

function resolvedBookmarkConnection (bookmark, config, applyProfileToTabs) {
  const cloned = cloneValue(bookmark || {})
  const profiled = applyProfileToTabs(cloned) || cloned
  return {
    profiled,
    connection: pickConnection(profiled, config)
  }
}

function safeProxyIdentity (value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
  try {
    const parsed = new URL(hasScheme ? text : `proxy://${text}`)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    if (hasScheme) return parsed.toString()
    return `${parsed.host}${parsed.pathname}`
  } catch (error) {
    if (hasScheme) return redactSensitiveString(text)
    const authority = text.slice(text.lastIndexOf('@') + 1)
    return redactSensitiveString(authority).replace(/[?#].*$/, '')
  }
}

function stableIdentityValue (value) {
  if (Array.isArray(value)) return value.map(stableIdentityValue)
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactSensitiveString(value) : value
  }
  const result = {}
  for (const key of Object.keys(value).sort()) {
    if (sensitiveKey.test(key)) continue
    result[key] = stableIdentityValue(value[key])
  }
  return result
}

function safeConnectionIdentity (connection) {
  const result = {}
  for (const key of connectionIdentityKeys) {
    if (connection[key] === undefined) continue
    result[key] = key === 'proxy'
      ? safeProxyIdentity(connection[key])
      : stableIdentityValue(connection[key])
  }
  if (Array.isArray(connection.connectionHoppings)) {
    result.connectionHoppings = connection.connectionHoppings.map(hopping => {
      return safeConnectionIdentity(hopping || {})
    })
  }
  return result
}

function prepareTargets (bookmarks, config, applyProfileToTabs) {
  if (!Array.isArray(bookmarks) || !bookmarks.length) {
    throw new TypeError('Fleet status bookmarks are required')
  }
  return bookmarks.map((bookmark, index) => {
    const { profiled, connection } = resolvedBookmarkConnection(
      bookmark,
      config,
      applyProfileToTabs
    )
    return {
      id: String(profiled.id || profiled._id || `target-${index}`),
      title: String(profiled.title || profiled.host || `Target ${index + 1}`),
      connection
    }
  })
}

function defaultTaskId () {
  const random = globalThis.crypto?.randomUUID?.() ||
    Math.random().toString(36).slice(2)
  return `fleet-${Date.now()}-${random}`
}

function clientAbortError () {
  const error = new Error('Service inventory cancelled')
  error.name = 'AbortError'
  return error
}

export function createFleetStatusClient ({
  request,
  applyProfileToTabs,
  config,
  createTaskId = defaultTaskId
} = {}) {
  const send = request || (payload => {
    const wsFetch = globalThis.window?.wsFetch
    if (typeof wsFetch !== 'function') {
      throw new TypeError('Fleet status request transport is unavailable')
    }
    return wsFetch(payload)
  })
  const applyProfile = applyProfileToTabs || (
    value => globalThis.window?.store?.applyProfileToTabs?.(value) || value
  )
  const globalConfig = config || globalThis.window?.store?.config || {}
  if (typeof send !== 'function') {
    throw new TypeError('Fleet status request transport is unavailable')
  }

  async function collect ({
    bookmarks,
    probeIds = FLEET_STATUS_PROBE_IDS,
    concurrency = 5,
    targetTimeoutMs = FLEET_STATUS_TIMEOUTS.targetMs,
    totalTimeoutMs = FLEET_STATUS_TIMEOUTS.totalMs,
    taskId = createTaskId()
  }) {
    const result = await send({
      action: FLEET_STATUS_ACTIONS.collect,
      taskId,
      targets: prepareTargets(bookmarks, globalConfig, applyProfile),
      probeIds: [...probeIds],
      concurrency,
      targetTimeoutMs,
      totalTimeoutMs
    })
    return redactResponse(result)
  }

  async function inventory ({
    bookmark,
    taskId = createTaskId(),
    signal
  } = {}) {
    if (!bookmark || typeof bookmark !== 'object' || Array.isArray(bookmark)) {
      throw new TypeError('Fleet service inventory bookmark is required')
    }
    if (signal?.aborted) throw clientAbortError()
    const payload = {
      action: FLEET_STATUS_ACTIONS.inventory,
      taskId,
      target: prepareTargets([bookmark], globalConfig, applyProfile)[0]
    }
    const requestPromise = Promise.resolve(send(payload))
    if (!signal) return redactResponse(await requestPromise)

    let onAbort
    const aborted = new Promise((resolve, reject) => {
      onAbort = () => {
        Promise.resolve(send({
          action: FLEET_STATUS_ACTIONS.cancel,
          taskId
        })).catch(() => {})
        reject(clientAbortError())
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return redactResponse(await Promise.race([requestPromise, aborted]))
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  async function cancel (taskId) {
    const result = await send({
      action: FLEET_STATUS_ACTIONS.cancel,
      taskId
    })
    return redactResponse(result)
  }

  function connectionIdentity (bookmark) {
    const { connection } = resolvedBookmarkConnection(
      bookmark,
      globalConfig,
      applyProfile
    )
    return JSON.stringify(stableIdentityValue(safeConnectionIdentity(connection)))
  }

  return {
    collect,
    inventory,
    cancel,
    connectionIdentity
  }
}
