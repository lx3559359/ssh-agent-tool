const {
  getReconnectDelayMs,
  appendTunnelEvent,
  classifyTunnelFailure
} = require('./ssh-tunnel-health')
const {
  createProbeResult,
  createProbeStage,
  probeStagesForError
} = require('./ssh-tunnel-probe')

const safeDetailKeys = [
  'requestedPort',
  'suggestedPort',
  'host',
  'tunnelId'
]
const probeRecoverableStates = new Set([
  'failed',
  'port-conflict',
  'session-lost'
])
const untrustedControllerStates = new Set([
  'port-conflict',
  'session-lost'
])

function safeTunnelErrorDetails (details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return undefined
  }
  const safe = {}
  for (const key of safeDetailKeys) {
    const value = details[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safe[key] = value
    }
  }
  return Object.keys(safe).length ? safe : undefined
}

function tunnelError (code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause) error.cause = cause
  const details = safeTunnelErrorDetails(cause?.details)
  if (details) error.details = details
  return error
}

function runtimeTunnelDefinition (definition) {
  const safe = { ...definition }
  delete safe.probeTimeoutMs
  return safe
}

function serializableState (entry) {
  return {
    id: entry.definition.id,
    state: entry.state,
    definition: { ...entry.definition },
    startedAt: entry.startedAt,
    lastTestAt: entry.lastTestAt || null,
    lastTest: entry.lastTest
      ? {
          ...entry.lastTest,
          stages: entry.lastTest.stages.map(stage => ({ ...stage }))
        }
      : null,
    testState: entry.testState,
    reconnectAttempt: entry.reconnectAttempt || 0,
    events: Array.isArray(entry.events)
      ? entry.events.map(event => ({ ...event }))
      : []
  }
}

function createSshTunnelRuntime ({
  startController,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancelSchedule = timer => clearTimeout(timer),
  now = () => Date.now()
}) {
  if (typeof startController !== 'function') {
    throw new TypeError('startController is required')
  }
  const controllers = new Map()

  function normalizeProbeResult (value) {
    const source = value && typeof value === 'object' ? value : {}
    return createProbeResult(source.stages, {
      checkedAt: Number.isFinite(source.checkedAt) ? source.checkedAt : now(),
      summary: source.summary,
      latencyMs: source.latencyMs
    })
  }

  function unavailableProbeResult () {
    return createProbeResult([
      createProbeStage(
        'tunnel',
        'unverified',
        'SSH_TUNNEL_PROBE_UNAVAILABLE',
        '当前隧道控制器不支持连通性检测'
      )
    ], { checkedAt: now() })
  }

  function applyProbeResult (
    entry,
    value,
    controller,
    generation,
    source = 'probe'
  ) {
    if (
      entry.manualStopping ||
      controllers.get(entry.definition.id) !== entry ||
      entry.controller !== controller ||
      entry.probeGeneration !== generation
    ) return null
    const result = normalizeProbeResult(value)
    if (
      source === 'probe' &&
      entry.trafficEvidencePassed &&
      result.verdict === 'unverified'
    ) {
      entry.testState = entry.lastTest.verdict
      return entry.lastTest
    }
    entry.lastTest = result
    entry.lastTestAt = now()
    entry.testState = result.verdict
    if (source === 'evidence') {
      entry.trafficEvidencePassed = result.ok && result.stages.length >= 3
    } else if (result.verdict === 'limited' || result.verdict === 'failed') {
      entry.trafficEvidencePassed = false
    }
    if (
      source === 'probe' &&
      result.ok &&
      probeRecoverableStates.has(entry.state)
    ) {
      cancelReconnect(entry)
      entry.reconnectAttempt = 0
      recordState(entry, 'healthy', {
        code: 'SSH_TUNNEL_PROBE_RECOVERED',
        message: 'SSH 隧道检测已恢复正常'
      })
    }
    return result
  }

  function invalidateProbe (entry, error) {
    entry.probeGeneration += 1
    entry.trafficEvidencePassed = false
    if (!error) {
      entry.lastTest = null
      entry.lastTestAt = null
      entry.testState = 'untested'
      return
    }
    const result = createProbeResult(
      probeStagesForError(entry.definition.sshTunnel, error),
      { checkedAt: now() }
    )
    entry.lastTest = result
    entry.lastTestAt = now()
    entry.testState = result.verdict
  }

  function runProbe (entry) {
    if (entry.probePromise) return entry.probePromise
    const controller = entry.controller
    const generation = entry.probeGeneration
    entry.testState = 'testing'
    const operation = typeof controller?.probe === 'function'
      ? Promise.resolve().then(() => controller.probe())
      : Promise.resolve(unavailableProbeResult())
    const promise = operation
      .catch(error => createProbeResult(
        probeStagesForError(entry.definition.sshTunnel, {
          code: String(error?.code || 'SSH_TUNNEL_TEST_FAILED'),
          message: String(error?.message || 'SSH 隧道连通性检测失败')
        }),
        { checkedAt: now() }
      ))
      .then(result => {
        const applied = applyProbeResult(
          entry,
          result,
          controller,
          generation
        )
        if (applied) return applied
        if (
          controllers.get(entry.definition.id) === entry &&
          entry.lastTest
        ) return normalizeProbeResult(entry.lastTest)
        throw tunnelError(
          'SSH_TUNNEL_PROBE_INVALIDATED',
          'SSH 隧道状态已变化，请重新检测'
        )
      })
      .finally(() => {
        if (entry.probePromise === promise) entry.probePromise = null
      })
    entry.probePromise = promise
    return promise
  }

  function queueProbe (entry) {
    const controller = entry.controller
    const generation = entry.probeGeneration
    queueMicrotask(() => {
      if (
        entry.controller !== controller ||
        entry.probeGeneration !== generation
      ) return
      runProbe(entry).catch(() => {})
    })
  }

  function recordState (entry, state, event = {}) {
    entry.state = state
    entry.events = appendTunnelEvent(entry.events, {
      at: now(),
      state,
      code: event.code,
      message: event.message
    })
  }

  function detachControllerEvents (entry) {
    const controller = entry.controller
    const handlers = entry.controllerHandlers
    if (!controller || !handlers) return
    const off = typeof controller.off === 'function'
      ? controller.off.bind(controller)
      : typeof controller.removeListener === 'function'
        ? controller.removeListener.bind(controller)
        : null
    if (off) {
      off('listening', handlers.listening)
      off('error', handlers.error)
      off('close', handlers.close)
      off('evidence', handlers.evidence)
    }
    entry.controllerHandlers = null
  }

  function cancelReconnect (entry) {
    if (!entry.reconnectTimer) return
    cancelSchedule(entry.reconnectTimer)
    entry.reconnectTimer = null
  }

  function attachControllerEvents (entry) {
    const controller = entry.controller
    if (!controller || typeof controller.on !== 'function') return
    const handlers = {
      listening: () => {
        if (
          entry.manualStopping ||
          untrustedControllerStates.has(entry.state)
        ) return
        entry.reconnectAttempt = 0
        recordState(entry, 'healthy', {
          code: 'SSH_TUNNEL_LISTENING',
          message: '隧道监听正常'
        })
      },
      error: error => handleControllerFailure(entry, error),
      close: reason => handleControllerFailure(entry, {
        code: reason?.code || 'SSH_CONNECTION_CLOSED',
        message: reason?.message || 'SSH 会话已断开'
      }),
      evidence: value => {
        if (untrustedControllerStates.has(entry.state)) return
        entry.probeGeneration += 1
        applyProbeResult(
          entry,
          value,
          controller,
          entry.probeGeneration,
          'evidence'
        )
      }
    }
    entry.controllerHandlers = handlers
    controller.on('listening', handlers.listening)
    controller.on('error', handlers.error)
    controller.on('close', handlers.close)
    controller.on('evidence', handlers.evidence)
  }

  async function reconnect (entry) {
    entry.reconnectTimer = null
    if (
      entry.manualStopping ||
      controllers.get(entry.definition.id) !== entry
    ) return
    recordState(entry, 'reconnecting', {
      code: 'SSH_TUNNEL_RECONNECTING',
      message: `正在进行第 ${entry.reconnectAttempt} 次重连`
    })
    invalidateProbe(entry)
    detachControllerEvents(entry)
    try {
      await entry.controller.close()
    } catch {}
    try {
      const controller = await startController({ ...entry.definition })
      if (!controller || typeof controller.close !== 'function') {
        throw tunnelError(
          'SSH_TUNNEL_CONTROLLER_INVALID',
          'SSH 隧道控制器无效'
        )
      }
      if (
        entry.manualStopping ||
        controllers.get(entry.definition.id) !== entry
      ) {
        await controller.close()
        return
      }
      entry.controller = controller
      entry.probeGeneration += 1
      entry.probePromise = null
      entry.definition = runtimeTunnelDefinition({
        ...entry.definition,
        ...(controller.descriptor || {})
      })
      entry.reconnectAttempt = 0
      attachControllerEvents(entry)
      recordState(entry, 'healthy', {
        code: 'SSH_TUNNEL_RECONNECTED',
        message: 'SSH 隧道已恢复'
      })
      queueProbe(entry)
    } catch (error) {
      handleControllerFailure(entry, error)
    }
  }

  function scheduleReconnect (entry) {
    if (entry.manualStopping || entry.reconnectTimer) return
    const delay = getReconnectDelayMs(entry.reconnectAttempt)
    if (delay === null) {
      recordState(entry, 'failed', {
        code: 'SSH_TUNNEL_RECONNECT_EXHAUSTED',
        message: 'SSH 隧道重连次数已用尽'
      })
      return
    }
    entry.reconnectAttempt += 1
    entry.reconnectTimer = schedule(
      () => reconnect(entry),
      delay
    )
  }

  function handleControllerFailure (entry, error = {}) {
    if (
      entry.manualStopping ||
      controllers.get(entry.definition.id) !== entry
    ) return
    invalidateProbe(entry, error)
    const state = classifyTunnelFailure(error)
    recordState(entry, state, {
      code: error.code || 'SSH_TUNNEL_FAILURE',
      message: error.message || (
        state === 'port-conflict'
          ? '本地端口已被占用'
          : 'SSH 隧道连接已中断'
      )
    })
    if (state === 'session-lost') scheduleReconnect(entry)
  }

  async function start (definition = {}) {
    const id = String(definition.id || '').trim()
    if (!id) {
      throw tunnelError('SSH_TUNNEL_INVALID', 'SSH 隧道缺少唯一标识')
    }
    if (controllers.has(id)) {
      throw tunnelError('SSH_TUNNEL_EXISTS', '该 SSH 隧道已经在运行')
    }
    const runtimeDefinition = runtimeTunnelDefinition({ ...definition, id })
    let controller
    try {
      controller = await startController(runtimeDefinition)
    } catch (cause) {
      throw tunnelError(
        String(cause?.code || 'SSH_TUNNEL_START_FAILED'),
        String(cause?.message || 'SSH 隧道启动失败'),
        cause
      )
    }
    if (!controller || typeof controller.close !== 'function') {
      throw tunnelError(
        'SSH_TUNNEL_CONTROLLER_INVALID',
        'SSH 隧道控制器无效'
      )
    }
    const entry = {
      controller,
      definition: runtimeTunnelDefinition({
        ...runtimeDefinition,
        ...(controller.descriptor || {}),
        id
      }),
      state: 'starting',
      startedAt: now(),
      lastTestAt: null,
      lastTest: null,
      testState: 'untested',
      probePromise: null,
      probeGeneration: 0,
      trafficEvidencePassed: false,
      reconnectAttempt: 0,
      reconnectTimer: null,
      controllerHandlers: null,
      manualStopping: false,
      events: []
    }
    controllers.set(id, entry)
    attachControllerEvents(entry)
    recordState(entry, 'healthy', {
      code: 'SSH_TUNNEL_STARTED',
      message: 'SSH 隧道已启动'
    })
    queueProbe(entry)
    return serializableState(entry)
  }

  async function stop (id) {
    const key = String(id || '')
    const entry = controllers.get(key)
    if (!entry) {
      return { id: key, state: 'stopped', notFound: true }
    }
    entry.manualStopping = true
    entry.probeGeneration += 1
    entry.probePromise = null
    cancelReconnect(entry)
    detachControllerEvents(entry)
    controllers.delete(key)
    try {
      await entry.controller.close()
    } catch (cause) {
      throw tunnelError(
        String(cause?.code || 'SSH_TUNNEL_STOP_FAILED'),
        String(cause?.message || 'SSH 隧道停止失败'),
        cause
      )
    }
    return { id: key, state: 'stopped' }
  }

  function list () {
    return Array.from(controllers.values(), serializableState)
  }

  async function testTunnel (id) {
    const key = String(id || '')
    const entry = controllers.get(key)
    if (!entry) {
      throw tunnelError('SSH_TUNNEL_NOT_FOUND', '未找到正在运行的 SSH 隧道')
    }
    const result = await runProbe(entry)
    return {
      id: key,
      ...result
    }
  }

  async function closeAll (reason = 'closed') {
    const entries = Array.from(controllers.entries())
    controllers.clear()
    let closed = 0
    let failed = 0
    await Promise.all(entries.map(async ([, entry]) => {
      entry.manualStopping = true
      entry.probeGeneration += 1
      entry.probePromise = null
      cancelReconnect(entry)
      detachControllerEvents(entry)
      try {
        await entry.controller.close()
        closed += 1
      } catch {
        failed += 1
      }
    }))
    return { reason, closed, failed }
  }

  return {
    start,
    stop,
    list,
    test: testTunnel,
    closeAll
  }
}

function serializeTunnelError (error) {
  const serialized = {
    code: String(error?.code || 'SSH_TUNNEL_ERROR'),
    message: String(error?.message || 'SSH 隧道操作失败')
  }
  const details = safeTunnelErrorDetails(error?.details)
  if (details) serialized.details = details
  return serialized
}

exports.createSshTunnelRuntime = createSshTunnelRuntime
exports.serializeTunnelError = serializeTunnelError
