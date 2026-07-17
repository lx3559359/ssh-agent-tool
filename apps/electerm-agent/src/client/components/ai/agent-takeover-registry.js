import {
  projectEndpoint
} from '../../common/safety-transactions/endpoint-guard.js'
import {
  assertTakeoverTransition,
  isTakeoverActive
} from './agent-takeover-state.js'

function timestamp (now) {
  const value = now()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid AI takeover registry clock value')
  }
  return date.toISOString()
}

function sessionKey (endpoint) {
  return JSON.stringify([
    endpoint.host,
    endpoint.port,
    endpoint.username,
    endpoint.tabId,
    endpoint.pid,
    endpoint.terminalPid,
    endpoint.sessionType,
    endpoint.hostKeyFingerprint
  ].map(value => String(value)))
}

function freezeRecord (record) {
  return Object.freeze({
    ...record,
    endpoint: Object.freeze({ ...record.endpoint })
  })
}

function takeoverRequiredError () {
  const error = new Error('AI takeover must be enabled for this SSH session')
  error.code = 'AI_TAKEOVER_REQUIRED'
  return error
}

export function createTakeoverRegistry (options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => new Date()
  const records = new Map()
  const listeners = new Set()

  const snapshot = () => Object.freeze([...records.values()])

  const publish = () => {
    const current = snapshot()
    for (const listener of [...listeners]) {
      try {
        listener(current)
      } catch (_) {
      }
    }
  }

  const resolve = endpoint => {
    try {
      const projected = projectEndpoint(endpoint)
      return {
        endpoint: projected,
        key: sessionKey(projected)
      }
    } catch (_) {
      return null
    }
  }

  const get = endpoint => {
    const identity = resolve(endpoint)
    return identity ? records.get(identity.key) : undefined
  }

  const transition = (endpoint, nextState) => {
    const identity = resolve(endpoint)
    const current = identity ? records.get(identity.key) : undefined
    if (!current) throw takeoverRequiredError()
    assertTakeoverTransition(current.state, nextState)
    const next = freezeRecord({
      ...current,
      state: nextState,
      updatedAt: timestamp(now)
    })
    if (nextState === 'off') records.delete(identity.key)
    else records.set(identity.key, next)
    publish()
    return next
  }

  const enable = endpoint => {
    const projected = projectEndpoint(endpoint)
    const key = sessionKey(projected)
    if (records.has(key)) {
      const error = new Error('AI takeover is already active for this SSH session')
      error.code = 'AI_TAKEOVER_ALREADY_ACTIVE'
      throw error
    }
    const enabledAt = timestamp(now)
    const record = freezeRecord({
      endpoint: projected,
      state: 'enabling',
      enabledAt,
      updatedAt: enabledAt
    })
    records.set(key, record)
    publish()
    return record
  }

  const isActive = endpoint => {
    const record = get(endpoint)
    return Boolean(record && isTakeoverActive(record.state))
  }

  const assertActive = endpoint => {
    const record = get(endpoint)
    if (!record || !isTakeoverActive(record.state)) {
      throw takeoverRequiredError()
    }
    return record
  }

  const stop = endpoint => {
    const current = get(endpoint)
    if (!current) throw takeoverRequiredError()
    if (current.state === 'stopping') return current
    return transition(endpoint, 'stopping')
  }

  const disable = (endpoint, reason) => {
    let current = get(endpoint)
    if (!current) return undefined
    if (current.state !== 'stopping') current = stop(endpoint)
    assertTakeoverTransition(current.state, 'off')
    const disabled = freezeRecord({
      ...current,
      state: 'off',
      reason: reason === undefined ? undefined : String(reason),
      updatedAt: timestamp(now)
    })
    const identity = resolve(endpoint)
    records.delete(identity.key)
    publish()
    return disabled
  }

  const subscribe = listener => {
    if (typeof listener !== 'function') {
      throw new TypeError('AI takeover registry listener must be a function')
    }
    listeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      listeners.delete(listener)
    }
  }

  return Object.freeze({
    enable,
    transition,
    disable,
    stop,
    get,
    isActive,
    assertActive,
    subscribe,
    snapshot
  })
}
