const {
  FLEET_STATUS_PROBE_TIMEOUT_MS,
  fleetStatusProbes,
  runFleetServiceInventoryProbes,
  runFleetStatusProbes
} = require('../common/fleet-status-probes')
const {
  FLEET_SERVICE_INVENTORY_MAX_ITEMS,
  FLEET_SERVICE_INVENTORY_MAX_RESPONSE_BYTES
} = require('../common/fleet-service-inventory')

const COLLECT_ACTION = 'collect-fleet-status'
const CANCEL_ACTION = 'cancel-fleet-status'
const SERVICE_INVENTORY_ACTION = 'collect-fleet-service-inventory'
const DEFAULT_CONCURRENCY = 5
const MAX_CONCURRENCY = 5
const CONNECTION_TIMEOUT_MS = 12000
const DEFAULT_TARGET_TIMEOUT_MS = 30000
const MAX_TARGET_TIMEOUT_MS = 30000
const DEFAULT_TOTAL_TIMEOUT_MS = 30000
const MAX_TOTAL_TIMEOUT_MS = 30000
const FLEET_STATUS_TIMEOUTS = Object.freeze({
  connectionMs: CONNECTION_TIMEOUT_MS,
  probeMs: FLEET_STATUS_PROBE_TIMEOUT_MS,
  targetMs: DEFAULT_TARGET_TIMEOUT_MS,
  totalMs: DEFAULT_TOTAL_TIMEOUT_MS
})
const ALLOWED_PROBE_IDS = Object.freeze(fleetStatusProbes.map(probe => probe.id))
const inventoryPublicTargetMaxBytes = Object.freeze({
  id: 256,
  title: 512,
  host: 512,
  username: 256
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
  'readyTimeout',
  'keepaliveCountMax',
  'keepaliveInterval',
  'proxy',
  'term',
  'envLang'
])
const connectionKeySet = new Set(connectionKeys)
const allowedProbeIdSet = new Set(ALLOWED_PROBE_IDS)
const collectionKeySet = new Set([
  'action',
  'taskId',
  'targets',
  'probeIds',
  'concurrency',
  'targetTimeoutMs',
  'totalTimeoutMs'
])
const inventoryKeySet = new Set([
  'action',
  'taskId',
  'target'
])
const targetKeySet = new Set(['id', 'title', 'connection'])
const sensitiveKey = /(?:^key$|password|passwd|passphrase|private.?key|api.?key|access.?token|auth.?token|token|secret|authorization|cookie|stack)/i
const omittedResponseKey = /^rawOutput$/i
const sensitiveAssignment = /(?:password|passwd|passphrase|private[ _-]?key|api[ _-]?key|access[ _-]?token|auth[ _-]?token|token|secret|authorization|cookie)\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi
const sensitiveCliOption = /(?:^|[\s;&])--?(?:[a-z0-9]+[-_])*(?:password|passwd|passphrase|private[-_]?key|api[-_]?key|access[-_]?token|auth[-_]?token|token|secret)(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gim
const privateKeyBlock = /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi
const sensitiveHeader = /\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]*/gi
const sensitiveAuthorizationAssignment = /\bauthorization\s*=\s*(?:basic|bearer)\s+[^\r\n]*/gi
const sensitiveCookieAssignment = /\b(?:cookie|set-cookie)\s*=\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n]*)/gi

function serviceError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function abortError () {
  const error = new Error('Collection cancelled')
  error.name = 'AbortError'
  error.code = 'CANCELLED'
  return error
}

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

function redactSensitive (value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return redactSensitiveString(value)
  }
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map(item => redactSensitive(item, seen))
  }
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKey.test(key) || omittedResponseKey.test(key)) continue
    result[key] = redactSensitive(item, seen)
  }
  return result
}

function isRecord (value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function collectionInputFromMessage (message) {
  if (!isRecord(message)) return message
  const { id, ...input } = message
  return input
}

function hasOnlyKeys (value, allowedKeys) {
  return Object.keys(value).every(key => allowedKeys.has(key))
}

function isConnectionValue (value) {
  if (!value || typeof value !== 'object') return true
  return Array.isArray(value) && value.every(item => {
    return !item || typeof item !== 'object'
  })
}

function hasValidConnectionStructure (connection, allowHoppings = true) {
  if (!isRecord(connection) || !hasOnlyKeys(connection, connectionKeySet)) {
    return false
  }
  for (const [key, value] of Object.entries(connection)) {
    if (key === 'connectionHoppings') continue
    if (!isConnectionValue(value)) return false
  }
  if (connection.connectionHoppings === undefined) return true
  if (!allowHoppings || !Array.isArray(connection.connectionHoppings)) return false
  return connection.connectionHoppings.every(hopping => {
    return hasValidConnectionStructure(hopping, false)
  })
}

function hasValidTargetStructure (target) {
  if (!isRecord(target) || !hasOnlyKeys(target, targetKeySet)) return false
  if (!isConnectionValue(target.id) || !isConnectionValue(target.title)) return false
  return hasValidConnectionStructure(target.connection)
}

function boundedNumber (value, fallback, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.max(1, Math.min(maximum, Math.floor(number)))
}

function validateTaskId (taskId) {
  if (typeof taskId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(taskId)) {
    throw serviceError('INVALID_TASK_ID', 'Invalid fleet status task id')
  }
}

function validateCollection (input) {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, collectionKeySet) ||
    (input.action !== undefined && input.action !== COLLECT_ACTION)
  ) {
    throw serviceError('INVALID_REQUEST', 'Invalid fleet status request')
  }
  validateTaskId(input.taskId)
  if (!Array.isArray(input.targets) || !input.targets.length || input.targets.length > 500) {
    throw serviceError('INVALID_TARGETS', 'Fleet status targets are required')
  }
  if (input.targets.some(target => !hasValidTargetStructure(target))) {
    throw serviceError('INVALID_REQUEST', 'Invalid fleet status request')
  }
  if (!Array.isArray(input.probeIds) || !input.probeIds.length) {
    throw serviceError('INVALID_PROBE_ID', 'Probe ids are required')
  }
  if (input.probeIds.some(id => typeof id !== 'string' || !allowedProbeIdSet.has(id))) {
    throw serviceError('INVALID_PROBE_ID', 'Unsupported fleet status probe id')
  }
  if (new Set(input.probeIds).size !== input.probeIds.length) {
    throw serviceError('INVALID_PROBE_ID', 'Duplicate fleet status probe id')
  }
}

function validateInventory (input) {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, inventoryKeySet) ||
    input.action !== SERVICE_INVENTORY_ACTION
  ) {
    throw serviceError('INVALID_REQUEST', 'Invalid fleet status request')
  }
  validateTaskId(input.taskId)
  if (!hasValidTargetStructure(input.target)) {
    throw serviceError('INVALID_REQUEST', 'Invalid fleet status request')
  }
}

function pickConnectionOptions (target) {
  const source = target.connection && typeof target.connection === 'object'
    ? target.connection
    : target
  const result = {}
  for (const [key, value] of Object.entries(source)) {
    if (connectionKeySet.has(key)) result[key] = value
  }
  if (Array.isArray(result.connectionHoppings)) {
    result.connectionHoppings = result.connectionHoppings.map(hopping => {
      const safeHopping = {}
      for (const [key, value] of Object.entries(hopping || {})) {
        if (connectionKeySet.has(key)) safeHopping[key] = value
      }
      return safeHopping
    })
    result.hasHopping = result.connectionHoppings.length > 0
  }
  return result
}

function publicTarget (target) {
  const connection = target.connection && typeof target.connection === 'object'
    ? target.connection
    : target
  return {
    id: String(target.id || connection.id || ''),
    title: String(target.title || connection.title || connection.host || ''),
    host: String(connection.host || ''),
    port: Number(connection.port) || 22,
    username: String(connection.username || '')
  }
}

function boundedUtf8String (value, maxBytes) {
  const text = String(value ?? '')
  if (Buffer.byteLength(text) <= maxBytes) return text
  const characters = []
  let bytes = 0
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character)
    if (bytes + characterBytes > maxBytes) break
    characters.push(character)
    bytes += characterBytes
  }
  return characters.join('')
}

function boundedInventoryPublicTarget (target) {
  const value = publicTarget(target)
  return {
    id: boundedUtf8String(value.id, inventoryPublicTargetMaxBytes.id),
    title: boundedUtf8String(value.title, inventoryPublicTargetMaxBytes.title),
    host: boundedUtf8String(value.host, inventoryPublicTargetMaxBytes.host),
    port: value.port,
    username: boundedUtf8String(
      value.username,
      inventoryPublicTargetMaxBytes.username
    )
  }
}

function inventoryOutputTruncatedError () {
  return {
    code: 'OUTPUT_TRUNCATED',
    category: 'partial',
    message: 'Service inventory output was truncated'
  }
}

function serializedBytes (value) {
  const serialized = JSON.stringify(value)
  return Buffer.byteLength(serialized === undefined ? 'null' : serialized)
}

function boundedInventoryResponse (value) {
  if (serializedBytes(value) <= FLEET_SERVICE_INVENTORY_MAX_RESPONSE_BYTES) {
    return value
  }
  const items = Array.isArray(value?.items)
    ? value.items.slice(0, FLEET_SERVICE_INVENTORY_MAX_ITEMS)
    : []
  const response = {
    taskId: boundedUtf8String(value?.taskId, 128),
    status: boundedUtf8String(value?.status, 32),
    ...(value?.target
      ? { target: boundedInventoryPublicTarget(value.target) }
      : {}),
    items,
    errors: [inventoryOutputTruncatedError()],
    ...(Number.isFinite(value?.durationMs)
      ? { durationMs: value.durationMs }
      : {})
  }
  while (
    response.items.length &&
    serializedBytes(response) > FLEET_SERVICE_INVENTORY_MAX_RESPONSE_BYTES
  ) {
    response.items.pop()
  }
  if (serializedBytes(response) <= FLEET_SERVICE_INVENTORY_MAX_RESPONSE_BYTES) {
    return response
  }
  return {
    taskId: boundedUtf8String(value?.taskId, 128),
    status: 'error',
    items: [],
    errors: [inventoryOutputTruncatedError()]
  }
}

function safeFailure (code) {
  const failures = {
    CANCELLED: ['cancelled', 'Collection cancelled'],
    TARGET_TIMEOUT: ['timeout', 'Target collection timed out'],
    TOTAL_TIMEOUT: ['timeout', 'Fleet collection timed out'],
    CONNECTION_TIMEOUT: ['timeout', 'SSH connection timed out'],
    HOST_KEY_MISMATCH: ['host-key', 'SSH host key verification failed'],
    AUTH_FAILED: ['auth', 'SSH authentication failed'],
    PERMISSION_DENIED: ['permission', 'SSH permission denied'],
    CONNECTION_FAILED: ['unknown', 'SSH connection failed'],
    PROBE_FAILED: ['unknown', 'Status probe failed'],
    TERMINAL_UNAVAILABLE: ['unknown', 'Temporary SSH session unavailable']
  }
  const [category, message] = failures[code] || ['unknown', 'Fleet status collection failed']
  return {
    code,
    category,
    message
  }
}

function classifyConnectionFailure (error) {
  const code = String(error?.code || '').toUpperCase()
  const category = String(error?.category || '').toLowerCase()
  const text = [
    code,
    category,
    error?.name,
    error?.message,
    error?.originalMessage
  ].filter(Boolean).join(' ')
  if (/HOST.?KEY|KNOWN_HOSTS|FINGERPRINT|主机密钥|主机指纹/i.test(text)) {
    return 'HOST_KEY_MISMATCH'
  }
  if (code === 'ETIMEDOUT' || category === 'timeout' || /TIMED?\s*OUT|TIMEOUT|连接超时/i.test(text)) {
    return 'CONNECTION_TIMEOUT'
  }
  if (/^(?:EACCES|EPERM|PERMISSION_DENIED)$/.test(code) || category === 'permission') {
    return 'PERMISSION_DENIED'
  }
  if (/AUTH/.test(code) || category === 'auth' || /AUTHENTICAT|认证失败|PERMISSION DENIED|ACCESS DENIED/i.test(text)) {
    return 'AUTH_FAILED'
  }
  return 'CONNECTION_FAILED'
}

function raceWithAbort (value, signal) {
  if (signal.aborted) return Promise.reject(abortError())
  let onAbort
  const abortPromise = new Promise((resolve, reject) => {
    onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([Promise.resolve(value), abortPromise])
    .finally(() => signal.removeEventListener('abort', onAbort))
}

async function defaultRunProbeBatch (runCmd, options) {
  return runFleetStatusProbes(runCmd, {
    probeIds: options.probeIds,
    concurrency: 3,
    signal: options.signal
  })
}

async function defaultRunInventoryBatch (runCmd, options) {
  return runFleetServiceInventoryProbes(runCmd, { signal: options.signal })
}

function defaultDependencies () {
  const sessionProcess = require('./session-process')
  return {
    openTerminal: sessionProcess.terminal,
    getTerminal: sessionProcess.getTerminal || sessionProcess.terminals,
    closeTerminal: sessionProcess.closeTerminal,
    runProbeBatch: defaultRunProbeBatch,
    runInventoryBatch: defaultRunInventoryBatch,
    redact: redactSensitive,
    now: Date.now
  }
}

function createFleetStatusService (dependencies = {}) {
  const defaults = defaultDependencies()
  const {
    openTerminal = defaults.openTerminal,
    getTerminal = defaults.getTerminal,
    closeTerminal = defaults.closeTerminal,
    runProbeBatch = defaults.runProbeBatch,
    runInventoryBatch = defaults.runInventoryBatch,
    redact = defaults.redact,
    now = defaults.now
  } = dependencies
  if (
    typeof openTerminal !== 'function' ||
    typeof getTerminal !== 'function' ||
    typeof closeTerminal !== 'function' ||
    typeof runProbeBatch !== 'function' ||
    typeof runInventoryBatch !== 'function' ||
    typeof redact !== 'function' ||
    typeof now !== 'function'
  ) {
    throw new TypeError('Invalid fleet status service dependencies')
  }

  const tasks = new Map()
  const cancelledTaskIds = new Set()

  async function closeTaskTerminals (task) {
    await Promise.allSettled([...task.terminalIds].map(pid => closeTerminal(pid)))
  }

  function terminalCommandRunner (terminal, uid, signal) {
    let sequence = 0
    return async (command, options = {}) => {
      const signals = [...new Set([
        signal,
        options.signal
      ].filter(Boolean))]
      if (signals.some(item => item.aborted)) throw abortError()
      const executionId = `${uid}-probe-${++sequence}`
      const commandController = new AbortController()
      let cancellationRequested = false
      let canCancelRunCmd = false
      const cancel = () => {
        if (cancellationRequested) return
        cancellationRequested = true
        commandController.abort()
        if (canCancelRunCmd && typeof terminal.cancelRunCmd === 'function') {
          Promise.resolve(terminal.cancelRunCmd(executionId, `${executionId}-cancel`))
            .catch(() => {})
        }
      }
      for (const item of signals) {
        item.addEventListener('abort', cancel, { once: true })
      }
      try {
        if (typeof terminal.runCmd === 'function') {
          canCancelRunCmd = true
          const commandPromise = terminal.runCmd(command, executionId, {
            timeoutMs: options.timeoutMs,
            maxOutputBytes: options.maxOutputBytes,
            executionId,
            signal: commandController.signal
          })
          return await raceWithAbort(commandPromise, commandController.signal)
        }
        if (terminal.conn && typeof terminal.conn.exec === 'function') {
          return await raceWithAbort(
            terminal.conn.exec(command, {
              signal: commandController.signal,
              timeoutMs: options.timeoutMs,
              maxOutputBytes: options.maxOutputBytes
            }),
            commandController.signal
          )
        }
        throw serviceError('TERMINAL_UNAVAILABLE', 'Temporary SSH session unavailable')
      } finally {
        for (const item of signals) {
          item.removeEventListener('abort', cancel)
        }
      }
    }
  }

  async function collectTarget (task, target, index, targetTimeoutMs) {
    const startedAt = now()
    const meta = task.kind === 'inventory'
      ? boundedInventoryPublicTarget(target)
      : publicTarget(target)
    const controller = new AbortController()
    let timedOut = false
    const onTaskAbort = () => controller.abort()
    task.controller.signal.addEventListener('abort', onTaskAbort, { once: true })
    if (task.controller.signal.aborted) controller.abort()
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, targetTimeoutMs)
    const uid = `fleet-status-${task.id}-${index}-${startedAt}`
    task.terminalIds.add(uid)
    let pid = uid
    const connection = pickConnectionOptions(target)
    const options = {
      ...connection,
      type: 'remote',
      uid,
      tabId: uid,
      srcTabId: uid,
      enableSsh: false,
      saveTerminalLogToFile: false,
      sshTunnels: [],
      x11: false,
      readyTimeout: CONNECTION_TIMEOUT_MS,
      abortSignal: controller.signal
    }

    try {
      if (controller.signal.aborted) throw abortError()
      try {
        const opened = await raceWithAbort(
          Promise.resolve(openTerminal(options, task.request, uid)),
          controller.signal
        )
        pid = opened?.pid || uid
        task.terminalIds.add(pid)
      } catch (error) {
        if (controller.signal.aborted) throw error
        const code = classifyConnectionFailure(error)
        throw serviceError(code, safeFailure(code).message)
      }
      if (controller.signal.aborted) throw abortError()
      const terminal = getTerminal(pid)
      if (!terminal) {
        throw serviceError('TERMINAL_UNAVAILABLE', 'Temporary SSH session unavailable')
      }
      let payload
      if (task.kind === 'inventory') {
        payload = await raceWithAbort(
          runInventoryBatch(terminalCommandRunner(terminal, pid, controller.signal), {
            signal: controller.signal,
            target: meta
          }),
          controller.signal
        )
      } else {
        const probes = await raceWithAbort(
          runProbeBatch(terminalCommandRunner(terminal, pid, controller.signal), {
            probeIds: task.probeIds,
            signal: controller.signal,
            target: meta
          }),
          controller.signal
        )
        payload = { probes }
      }
      return {
        target: meta,
        status: 'success',
        ...payload,
        durationMs: Math.max(0, now() - startedAt)
      }
    } catch (error) {
      let code = error?.code
      if (timedOut) code = 'TARGET_TIMEOUT'
      else if (task.controller.signal.aborted || controller.signal.aborted) {
        code = task.totalTimedOut ? 'TOTAL_TIMEOUT' : 'CANCELLED'
      }
      if (![
        'TARGET_TIMEOUT',
        'TOTAL_TIMEOUT',
        'CANCELLED',
        'CONNECTION_TIMEOUT',
        'HOST_KEY_MISMATCH',
        'AUTH_FAILED',
        'PERMISSION_DENIED',
        'CONNECTION_FAILED',
        'PROBE_FAILED',
        'TERMINAL_UNAVAILABLE'
      ].includes(code)) {
        code = 'PROBE_FAILED'
      }
      return {
        target: meta,
        status: code === 'TARGET_TIMEOUT' || code === 'TOTAL_TIMEOUT' || code === 'CONNECTION_TIMEOUT'
          ? 'timeout'
          : (code === 'CANCELLED' ? 'cancelled' : 'error'),
        error: safeFailure(code),
        durationMs: Math.max(0, now() - startedAt)
      }
    } finally {
      clearTimeout(timeout)
      task.controller.signal.removeEventListener('abort', onTaskAbort)
      await Promise.allSettled([
        closeTerminal(pid),
        pid === uid ? Promise.resolve(false) : closeTerminal(uid)
      ])
    }
  }

  async function collect (input, request) {
    validateCollection(input)
    if (tasks.has(input.taskId)) {
      throw serviceError('TASK_EXISTS', 'Fleet status task already exists')
    }
    cancelledTaskIds.delete(input.taskId)
    const concurrency = boundedNumber(
      input.concurrency,
      DEFAULT_CONCURRENCY,
      MAX_CONCURRENCY
    )
    const targetTimeoutMs = boundedNumber(
      input.targetTimeoutMs,
      DEFAULT_TARGET_TIMEOUT_MS,
      MAX_TARGET_TIMEOUT_MS
    )
    const totalTimeoutMs = boundedNumber(
      input.totalTimeoutMs,
      DEFAULT_TOTAL_TIMEOUT_MS,
      MAX_TOTAL_TIMEOUT_MS
    )
    const task = {
      id: input.taskId,
      request,
      probeIds: [...input.probeIds],
      kind: 'status',
      controller: new AbortController(),
      terminalIds: new Set(),
      totalTimedOut: false
    }
    tasks.set(task.id, task)
    const onRequestClose = () => {
      cancel(task.id).catch(() => {})
    }
    if (request && typeof request.on === 'function') {
      request.on('close', onRequestClose)
    }
    const totalTimer = setTimeout(() => {
      task.totalTimedOut = true
      task.controller.abort()
      closeTaskTerminals(task).catch(() => {})
    }, totalTimeoutMs)
    const results = new Array(input.targets.length)
    let nextIndex = 0

    async function worker () {
      while (!task.controller.signal.aborted && nextIndex < input.targets.length) {
        const index = nextIndex
        nextIndex += 1
        if (task.controller.signal.aborted) break
        results[index] = await collectTarget(
          task,
          input.targets[index],
          index,
          targetTimeoutMs
        )
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, input.targets.length) }, worker))
      const queuedCode = task.totalTimedOut ? 'TOTAL_TIMEOUT' : 'CANCELLED'
      for (let index = 0; index < results.length; index += 1) {
        if (results[index]) continue
        results[index] = {
          target: publicTarget(input.targets[index]),
          status: queuedCode === 'TOTAL_TIMEOUT' ? 'timeout' : 'cancelled',
          error: safeFailure(queuedCode),
          durationMs: 0
        }
      }
      return redact({
        taskId: task.id,
        status: task.controller.signal.aborted
          ? (task.totalTimedOut ? 'timeout' : 'cancelled')
          : 'completed',
        results
      })
    } finally {
      clearTimeout(totalTimer)
      if (request && typeof request.removeListener === 'function') {
        request.removeListener('close', onRequestClose)
      }
      await closeTaskTerminals(task)
      tasks.delete(task.id)
    }
  }

  async function inventory (input, request, signal) {
    validateInventory(input)
    if (tasks.has(input.taskId)) {
      throw serviceError('TASK_EXISTS', 'Fleet status task already exists')
    }
    cancelledTaskIds.delete(input.taskId)
    const task = {
      id: input.taskId,
      request,
      kind: 'inventory',
      controller: new AbortController(),
      terminalIds: new Set(),
      totalTimedOut: false
    }
    tasks.set(task.id, task)
    const onRequestClose = () => {
      cancel(task.id).catch(() => {})
    }
    const onSignalAbort = () => {
      task.controller.abort()
      closeTaskTerminals(task).catch(() => {})
    }
    if (request && typeof request.on === 'function') {
      request.on('close', onRequestClose)
    }
    if (signal && typeof signal.addEventListener === 'function') {
      if (signal.aborted) onSignalAbort()
      else signal.addEventListener('abort', onSignalAbort, { once: true })
    }
    const totalTimer = setTimeout(() => {
      task.totalTimedOut = true
      task.controller.abort()
      closeTaskTerminals(task).catch(() => {})
    }, DEFAULT_TOTAL_TIMEOUT_MS)

    try {
      const result = await collectTarget(
        task,
        input.target,
        0,
        DEFAULT_TARGET_TIMEOUT_MS
      )
      const { status, ...data } = result
      const response = redact({
        taskId: task.id,
        status: status === 'success' ? 'completed' : status,
        ...data
      })
      return boundedInventoryResponse(response)
    } finally {
      clearTimeout(totalTimer)
      if (request && typeof request.removeListener === 'function') {
        request.removeListener('close', onRequestClose)
      }
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onSignalAbort)
      }
      await closeTaskTerminals(task)
      tasks.delete(task.id)
    }
  }

  async function cancel (taskId) {
    validateTaskId(taskId)
    const task = tasks.get(taskId)
    if (!task) {
      return redact({
        taskId,
        cancelled: cancelledTaskIds.has(taskId)
      })
    }
    cancelledTaskIds.add(taskId)
    if (cancelledTaskIds.size > 1000) {
      cancelledTaskIds.delete(cancelledTaskIds.values().next().value)
    }
    task.controller.abort()
    await closeTaskTerminals(task)
    return redact({ taskId, cancelled: true })
  }

  return {
    collect,
    inventory,
    cancel
  }
}

module.exports = {
  ALLOWED_PROBE_IDS,
  CANCEL_ACTION,
  COLLECT_ACTION,
  FLEET_STATUS_TIMEOUTS,
  SERVICE_INVENTORY_ACTION,
  collectionInputFromMessage,
  createFleetStatusService,
  redactSensitive
}
