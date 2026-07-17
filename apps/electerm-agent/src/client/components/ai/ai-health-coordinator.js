import { getAIStatusFingerprint } from './ai-profiles.js'

export const AI_HEALTH_STATUSES = Object.freeze([
  'unconfigured',
  'checking',
  'reachable',
  'available',
  'auth-error',
  'model-error',
  'quota-error',
  'network-error',
  'stale'
])

const STATUS_SET = new Set(AI_HEALTH_STATUSES)
const TERMINAL_STATUS_SET = new Set([
  'reachable',
  'available',
  'auth-error',
  'model-error',
  'quota-error',
  'network-error'
])

function defaultRunGlobalAsync (...args) {
  const invoke = globalThis.window?.pre?.runGlobalAsync
  if (typeof invoke !== 'function') {
    throw new Error('AI 健康检测服务尚未就绪')
  }
  return invoke(...args)
}

function isConfigured (profile = {}) {
  return Boolean(
    String(profile.baseURLAI || '').trim() &&
    String(profile.apiKeyAI || '').trim()
  )
}

function normalizeStatus (status, fallback = 'network-error') {
  return STATUS_SET.has(status) ? status : fallback
}

function redactText (value, secrets = []) {
  let text = String(value || '')
  for (const secret of secrets) {
    if (!secret) continue
    text = text.split(String(secret)).join('[已隐藏]')
  }
  return text
    .replace(/authorization\s*[:=]?\s*(?:bearer|api-key)?\s*[^\s,;]+/ig, '[已隐藏认证信息]')
    .replace(/bearer\s+[a-z0-9._~+/=-]+/ig, '[已隐藏认证信息]')
}

function sanitizeModels (models, secrets) {
  if (!Array.isArray(models)) return []
  return [...new Set(models
    .map(model => redactText(model, secrets).trim())
    .filter(Boolean))]
}

function normalizeCheckedAt (value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function createState (status, values = {}, secrets = []) {
  return Object.freeze({
    status: normalizeStatus(status, 'stale'),
    apiStatus: redactText(values.apiStatus, secrets),
    modelStatus: redactText(values.modelStatus, secrets),
    models: sanitizeModels(values.models, secrets),
    message: redactText(values.message, secrets),
    checkedAt: normalizeCheckedAt(values.checkedAt)
  })
}

function classifyChatFailure (item = {}) {
  const explicit = String(item.aiHealthStatus || item.healthStatus || '')
  if (['auth-error', 'model-error', 'quota-error', 'network-error'].includes(explicit)) {
    return explicit
  }
  const text = String(item.response || '').toLowerCase()
  if (/\b(?:429|quota|rate[ _-]*limit|too many requests|insufficient[ _-]*(?:credits?|balance)|billing)\b|额度|余额不足|限流/.test(text)) {
    return 'quota-error'
  }
  if (/\b(?:401|403|unauthorized|forbidden|invalid[ _-]*(?:api[ _-]*)?key|authentication failed)\b|认证失败|密钥无效/.test(text)) {
    return 'auth-error'
  }
  if (/\b(?:model not found|unknown model|invalid model)\b|模型不存在|模型不可用/.test(text)) {
    return 'model-error'
  }
  return 'network-error'
}

export function resolveAIChatHealthTransitions (history = [], tracked = new Map()) {
  const entries = new Map(
    (Array.isArray(history) ? history : []).map(item => [item.id, item])
  )
  const nextTracked = new Map()
  const updates = []
  for (const [id, tracking] of tracked.entries()) {
    const item = entries.get(id)
    if (item) {
      const completionStatus = String(item.completionStatus || '')
      const hasResponse = Boolean(String(item.response || '').trim())
      if (completionStatus === 'completed' && hasResponse) {
        updates.push({ id, key: tracking.key, ok: true })
        continue
      }
      if (completionStatus === 'failed' || completionStatus === 'completed') {
        updates.push({
          id,
          key: tracking.key,
          ok: false,
          status: classifyChatFailure(item)
        })
        continue
      }
      if (completionStatus === 'cancelled') continue
      nextTracked.set(id, { ...tracking, seen: true })
      continue
    }
    if (tracking.seen) {
      updates.push({
        id,
        key: tracking.key,
        ok: false,
        status: 'network-error'
      })
    } else {
      nextTracked.set(id, tracking)
    }
  }
  return { updates, tracked: nextTracked }
}

export function getAIHealthRequestKey (profile = {}) {
  const profileId = String(profile.id || profile.activeAIProfileId || 'default')
  return `${profileId}::${getAIStatusFingerprint(profile)}`
}

export function createAIHealthCoordinator ({
  runGlobalAsync = defaultRunGlobalAsync,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  debounceMs = 450,
  cacheTtlMs = 5 * 60 * 1000
} = {}) {
  const states = new Map()
  const inflight = new Map()
  const requestGenerations = new Map()
  const scheduleGenerations = new Map()
  const timers = new Map()
  const listeners = new Set()
  let requestSequence = 0

  function emit () {
    for (const listener of [...listeners]) {
      listener()
    }
  }

  function setState (key, state) {
    if (states.get(key) === state) return state
    states.set(key, state)
    emit()
    return state
  }

  function getStoredSnapshot (key) {
    return states.get(key) || createState('stale')
  }

  function getSnapshot (profile = {}) {
    if (!isConfigured(profile)) {
      return createState('unconfigured')
    }
    const key = getAIHealthRequestKey(profile)
    const current = getStoredSnapshot(key)
    if (
      TERMINAL_STATUS_SET.has(current.status) &&
      current.checkedAt &&
      now() - current.checkedAt > cacheTtlMs
    ) {
      const stale = createState('stale', {
        message: '检测结果已过期，请重新检测',
        checkedAt: current.checkedAt
      })
      states.set(key, stale)
      return stale
    }
    return current
  }

  function updateFromResult (key, result, secret) {
    const state = createState(
      normalizeStatus(result?.status),
      {
        apiStatus: result?.apiStatus,
        modelStatus: result?.modelStatus,
        models: result?.models,
        message: result?.message,
        checkedAt: result?.checkedAt || now()
      },
      [secret]
    )
    return setState(key, state)
  }

  function createRequestId () {
    requestSequence += 1
    return `ai-health-${now()}-${requestSequence}`
  }

  function cancelInflight (key, owner = '') {
    const active = inflight.get(key)
    if (!active || (owner && active.owner !== owner)) return false
    requestGenerations.set(key, (requestGenerations.get(key) || 0) + 1)
    inflight.delete(key)
    try {
      Promise.resolve(
        runGlobalAsync('AIHealthCheckCancel', active.requestId)
      ).catch(() => {})
    } catch (_) {}
    if (TERMINAL_STATUS_SET.has(active.previous?.status)) {
      setState(key, active.previous)
    } else {
      setState(key, createState('stale', { message: '检测已取消' }))
    }
    return true
  }

  function checkNow (profile = {}, { force = false, owner = '' } = {}) {
    const key = getAIHealthRequestKey(profile)
    if (!isConfigured(profile)) {
      const state = setState(key, createState('unconfigured'))
      return Promise.resolve(state)
    }
    if (inflight.has(key)) {
      return inflight.get(key).promise
    }
    const current = getSnapshot(profile)
    if (!force && TERMINAL_STATUS_SET.has(current.status)) {
      return Promise.resolve(current)
    }

    const generation = (requestGenerations.get(key) || 0) + 1
    const requestId = createRequestId()
    requestGenerations.set(key, generation)
    setState(key, createState('checking', {
      message: '正在检测当前 API 与模型'
    }))

    const model = String(profile.modelAI || '').trim()
    const baseURL = String(profile.baseURLAI || '').trim()
    const apiPath = String(profile.apiPathAI || '').trim()
    const apiKey = String(profile.apiKeyAI || '')
    const proxy = String(profile.proxyAI || '').trim()
    const authHeaderName = String(profile.authHeaderNameAI || '').trim()
    let request
    try {
      request = runGlobalAsync(
        'AIHealthCheck',
        model,
        baseURL,
        apiPath,
        apiKey,
        proxy,
        authHeaderName,
        requestId
      )
    } catch (error) {
      request = Promise.reject(error)
    }

    const promise = Promise.resolve(request)
      .then(result => {
        if (requestGenerations.get(key) !== generation) {
          return getStoredSnapshot(key)
        }
        return updateFromResult(key, result, apiKey)
      })
      .catch(error => {
        if (requestGenerations.get(key) !== generation) {
          return getStoredSnapshot(key)
        }
        return updateFromResult(key, {
          status: 'network-error',
          message: error?.message || error,
          checkedAt: now()
        }, apiKey)
      })
      .finally(() => {
        if (inflight.get(key)?.promise === promise) {
          inflight.delete(key)
        }
      })
    inflight.set(key, {
      owner,
      previous: current,
      promise,
      requestId
    })
    return promise
  }
  function invalidateKey (key, message = '配置已变化，等待重新检测') {
    if (!cancelInflight(key)) {
      requestGenerations.set(key, (requestGenerations.get(key) || 0) + 1)
    }
    return setState(key, createState('stale', { message }))
  }

  function schedule (profile = {}, { force = false } = {}) {
    const key = getAIHealthRequestKey(profile)
    const previousTimer = timers.get(key)
    if (previousTimer) {
      clearTimeoutFn(previousTimer)
    }
    const generation = (scheduleGenerations.get(key) || 0) + 1
    const owner = `schedule-${generation}`
    scheduleGenerations.set(key, generation)

    if (!isConfigured(profile)) {
      setState(key, createState('unconfigured'))
      return () => {}
    }
    const current = getSnapshot(profile)
    if (!force && TERMINAL_STATUS_SET.has(current.status)) {
      return () => {}
    }
    if (current.status !== 'checking') {
      setState(key, createState('stale', {
        message: '配置或模型已变化，等待自动检测'
      }))
    }
    const timer = setTimeoutFn(() => {
      timers.delete(key)
      if (scheduleGenerations.get(key) !== generation) return
      checkNow(profile, { force, owner }).catch(() => {})
    }, debounceMs)
    timers.set(key, timer)

    return () => {
      if (scheduleGenerations.get(key) !== generation) return
      scheduleGenerations.set(key, generation + 1)
      const activeTimer = timers.get(key)
      if (activeTimer) {
        clearTimeoutFn(activeTimer)
        timers.delete(key)
      }
      cancelInflight(key, owner)
    }
  }
  function recordChatStarted (key) {
    if (!key) return
    requestGenerations.set(key, (requestGenerations.get(key) || 0) + 1)
    setState(key, createState('checking', {
      message: '正在使用当前模型对话'
    }))
  }

  function recordChatResult (key, result = {}) {
    if (!key) return
    const status = result.ok
      ? 'available'
      : normalizeStatus(result.status, 'network-error')
    setState(key, createState(status, {
      message: result.message,
      checkedAt: result.checkedAt || now()
    }))
  }

  function recordHealthResult (profile, result) {
    const key = getAIHealthRequestKey(profile)
    requestGenerations.set(key, (requestGenerations.get(key) || 0) + 1)
    return updateFromResult(key, result, profile.apiKeyAI)
  }

  function subscribe (listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function dispose () {
    for (const timer of timers.values()) {
      clearTimeoutFn(timer)
    }
    timers.clear()
    listeners.clear()
    for (const key of [...inflight.keys()]) {
      cancelInflight(key)
    }
    for (const key of requestGenerations.keys()) {
      requestGenerations.set(key, requestGenerations.get(key) + 1)
    }
  }

  return {
    checkNow,
    dispose,
    getSnapshot,
    invalidate: profile => invalidateKey(getAIHealthRequestKey(profile)),
    recordChatResult,
    recordChatStarted,
    recordHealthResult,
    schedule,
    subscribe
  }
}

export const aiHealthCoordinator = createAIHealthCoordinator()
