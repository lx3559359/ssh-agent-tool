/**
 * ws function for sftp/file transfer communication
 */

import generate from './uid'
import wait from './wait'
import { pick } from 'lodash-es'

const onces = {}
const wss = {}
const persists = {}
const abandonedCreates = new Map()
const wsStartTimeoutMs = 10000
const abandonedCreateRetentionMs = wsStartTimeoutMs * 2

function send (data) {
  window.worker.postMessage(data)
}

function websocketAbortError (signal) {
  if (signal?.reason instanceof Error) return signal.reason
  const error = new Error('WebSocket startup was aborted')
  error.name = 'AbortError'
  return error
}

function closeAbandonedCreate (id) {
  send({ action: 'close', wsId: id })
  const previous = abandonedCreates.get(id)
  if (previous) clearTimeout(previous)
  const timer = setTimeout(() => {
    if (abandonedCreates.get(id) === timer) {
      abandonedCreates.delete(id)
    }
  }, abandonedCreateRetentionMs)
  abandonedCreates.set(id, timer)
}

class Ws {
  constructor (id, persist) {
    this.id = id
    this.persist = !!persist
  }

  onceIds = []

  s (data) {
    send({
      action: 's',
      args: [data],
      wsId: this.id
    })
  }

  async once (func, id) {
    const maxWait = 300
    let waited = 0
    while (this.closed) {
      if (++waited >= maxWait) {
        console.warn('ws once timeout waiting for reconnection', id)
        return
      }
      await wait(100)
    }
    this.onceIds.push(id)
    onces[id] = {
      resolve: (...args) => {
        func(...args)
        delete onces[id]
        this.onceIds = this.onceIds.filter(d => d !== id)
      }
    }
    send({
      id,
      wsId: this.id,
      action: 'once'
    })
  }

  addEventListener (type = 'message', cb = this.cb) {
    this.cb = cb
    const id = generate()
    if (!this.eids) {
      this.eids = new Set()
    }
    if (!this.cbToId) {
      this.cbToId = new Map()
    }
    this.eids.add(id)
    this.cbToId.set(cb, id)
    persists[id] = {
      resolve: cb
    }
    send({
      id,
      wsId: this.id,
      type,
      action: 'addEventListener'
    })
  }

  removeEventListener (type, cb) {
    if (!this.cbToId || !this.cbToId.has(cb)) {
      return
    }
    const id = this.cbToId.get(cb)
    this.cbToId.delete(cb)
    this.eids.delete(id)
    delete persists[id]
    send({
      id,
      wsId: this.id,
      type,
      action: 'removeEventListener'
    })
  }

  onclose () {

  }

  clearOnces () {
    if (this.eids) {
      for (const eid of this.eids) {
        delete persists[eid]
      }
      this.eids.clear()
    }
    if (this.cbToId) {
      this.cbToId.clear()
    }
    const ids = [...this.onceIds]
    ids.forEach(k => {
      delete onces[k]
    })
    this.onceIds = []
  }

  close () {
    this.onclose()
    if (this.persist) {
      this.closed = true
      return
    }
    this.clearOnces()
    send({
      action: 'close',
      wsId: this.id
    })
    delete wss[this.id]
  }
}

function onEvent (e) {
  if (!e || !e.data) {
    return false
  }
  const {
    id,
    data,
    action,
    persist
  } = e.data
  if (action === 'create' && abandonedCreates.has(id)) {
    clearTimeout(abandonedCreates.get(id))
    abandonedCreates.delete(id)
    send({ action: 'close', wsId: id })
    return
  }
  if (wss[id] && action === 'close') {
    const ws = wss[id]
    ws.onclose()
    if (ws.persist) {
      ws.closed = true
    } else {
      ws.clearOnces()
      delete wss[id]
    }
    return
  }
  if (action === 'close' && typeof onces[id]?.reject === 'function') {
    onces[id].reject(new Error('WebSocket closed before startup completed'))
    delete onces[id]
    return
  }
  if (persists[id]) {
    persists[id].resolve(data)
  } else if (onces[id]) {
    if (action === 'create') {
      if (!wss[id]) {
        wss[id] = new Ws(id, persist)
      } else {
        wss[id].addEventListener()
        wss[id].closed = false
      }
      onces[id].resolve(wss[id])
    } else {
      onces[id].resolve(data)
    }
    delete onces[id]
  }
}

window.worker.addEventListener('message', onEvent)

export default (type, id, sftpId = '', persist, port, options = {}) => {
  const signal = options?.signal
  if (signal !== undefined && (
    !signal || typeof signal.aborted !== 'boolean' ||
    typeof signal.addEventListener !== 'function' ||
    typeof signal.removeEventListener !== 'function'
  )) {
    return Promise.reject(new Error('WebSocket startup signal is invalid'))
  }
  if (signal?.aborted) return Promise.reject(websocketAbortError(signal))
  const opts = pick(window.store.config, [
    'host',
    'port',
    'tokenElecterm',
    'server',
    'urlPath'
  ])
  if (port) {
    opts.port = port
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let sentCreate = false
    const finish = (callback, value) => {
      if (settled) return false
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      if (onces[id] === entry) delete onces[id]
      callback(value)
      return true
    }
    const fail = error => {
      if (!finish(reject, error)) return
      if (sentCreate) closeAbandonedCreate(id)
    }
    const onAbort = () => fail(websocketAbortError(signal))
    const entry = {
      resolve: ws => {
        if (!finish(resolve, ws)) ws?.close?.()
      },
      reject: error => finish(reject, error)
    }
    const timer = setTimeout(() => {
      fail(new Error(`WebSocket startup timed out after ${wsStartTimeoutMs}ms`))
    }, wsStartTimeoutMs)
    onces[id] = entry
    signal?.addEventListener?.('abort', onAbort, { once: true })
    try {
      sentCreate = true
      send({
        id,
        action: 'create',
        persist,
        type,
        args: [
          type,
          id,
          sftpId,
          opts
        ]
      })
      if (signal?.aborted) onAbort()
    } catch (error) {
      fail(error)
    }
  })
}
