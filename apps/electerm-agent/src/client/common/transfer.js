/**
 * transfer through ws
 */

import generate from './uid'
import initWs from './ws'

const keys = window.pre.transferKeys
const transferControlAckTimeout = 15000
const transferStartTimeout = 15000

function transferStartAbortError (signal) {
  if (signal?.reason instanceof Error) return signal.reason
  const error = new Error('Transfer startup was aborted')
  error.name = 'AbortError'
  return error
}

function throwIfTransferStartAborted (signal) {
  if (signal?.aborted) throw transferStartAbortError(signal)
}

function closeLateTransferSocket (ws) {
  try {
    ws?.close?.()
  } catch (error) {
    console.warn('Failed to close a late transfer websocket', error)
  }
}

function transferProtocolError (remote, fallback) {
  const message = typeof remote?.message === 'string' && remote.message
    ? remote.message
    : fallback
  const error = new Error(message)
  if ((typeof remote?.code === 'string' && remote.code.length <= 128) ||
    (typeof remote?.code === 'number' && Number.isFinite(remote.code))) {
    error.code = remote.code
  }
  if (remote?.partialResidual === true) {
    error.partialResidual = true
    if (typeof remote.residualPath === 'string') {
      error.residualPath = remote.residualPath.slice(0, 4096)
    }
    if (typeof remote.cleanupPhase === 'string') {
      error.cleanupPhase = remote.cleanupPhase.slice(0, 128)
    }
  }
  return error
}

function isPlainObject (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function unwrapTransferAcknowledgement (envelope, expectedEventId) {
  if (!isPlainObject(envelope) ||
    !Object.prototype.hasOwnProperty.call(envelope, 'id') ||
    envelope.id !== expectedEventId ||
    !Object.prototype.hasOwnProperty.call(envelope, 'data') ||
    !isPlainObject(envelope.data)) {
    throw new Error('Transfer acknowledgement envelope is invalid')
  }
  return envelope.data
}

function startTransferWebSocket (start, signal, onStop) {
  throwIfTransferStartAborted(signal)
  const startupController = new AbortController()
  const started = Promise.resolve().then(() => start(
    startupController.signal
  ))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return false
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      callback(value)
      return true
    }
    const stop = error => {
      if (!startupController.signal.aborted) startupController.abort(error)
      onStop?.()
    }
    const onAbort = () => {
      const error = transferStartAbortError(signal)
      stop(error)
      finish(reject, error)
    }
    const timer = setTimeout(() => {
      const error = new Error(
        `Transfer startup timed out after ${transferStartTimeout}ms`
      )
      stop(error)
      finish(reject, error)
    }, transferStartTimeout)
    signal?.addEventListener?.('abort', onAbort, { once: true })
    started.then(
      ws => {
        if (!finish(resolve, ws)) {
          onStop?.()
          closeLateTransferSocket(ws)
        }
      },
      error => {
        finish(reject, error)
      }
    )
    if (signal?.aborted) onAbort()
  })
}

class Transfer {
  async init ({
    onData,
    onEnd,
    onError,
    onPaused,
    signal,
    ...rest
  }) {
    throwIfTransferStartAborted(signal)
    const id = generate()
    this.id = id
    const th = this
    this.onPaused = onPaused
    const {
      sftpId,
      isFtp,
      port
    } = rest
    let ws
    await startTransferWebSocket(async startupSignal => {
      ws = await initWs(
        'transfer', id, sftpId, undefined, port, { signal: startupSignal }
      )
      try {
        throwIfTransferStartAborted(startupSignal)
        this.pendingControls = new Map()
        this.terminalSeen = false
        this.terminalControlRequested = false
        const maybeDestroy = () => {
          if ((this.terminalSeen || this.terminalControlRequested) &&
            this.pendingControls.size === 0) {
            th.onDestroy(ws)
          }
        }
        let startupAcknowledged = false
        let settleStartupAcknowledgement
        const startupAcknowledgement = new Promise((resolve, reject) => {
          settleStartupAcknowledgement = (error, value) => {
            if (startupAcknowledged) return
            startupAcknowledged = true
            if (error) reject(error)
            else resolve(value)
          }
        })
        startupAcknowledgement.catch(() => {})
        const previousOnClose = ws.onclose
        ws.onclose = () => {
          try {
            previousOnClose?.call(ws)
          } finally {
            if (!startupAcknowledged) {
              settleStartupAcknowledgement(new Error(
                'Transfer connection closed before startup acknowledgement'
              ))
            } else {
              th.onDestroy(ws)
            }
          }
        }
        keys.forEach(func => {
          th[func] = (...args) => {
            if (args.length !== 0) {
              return Promise.reject(new Error(
                `Transfer control does not accept arguments: ${func}`
              ))
            }
            const controlId = generate()
            const controlEventId = `transfer:control:${th.id}:${controlId}`
            const terminalControl = ['cancel', 'interrupt', 'destroy'].includes(func)
            if (terminalControl) th.terminalControlRequested = true
            const acknowledgement = new Promise((resolve, reject) => {
              const settle = (error, value) => {
                const pending = th.pendingControls.get(controlId)
                if (!pending) return
                clearTimeout(pending.timer)
                th.pendingControls.delete(controlId)
                if (error) reject(error)
                else resolve(value)
                maybeDestroy()
              }
              const timer = setTimeout(() => {
                settle(new Error(`Transfer control acknowledgement timed out: ${func}`))
              }, transferControlAckTimeout)
              th.pendingControls.set(controlId, { reject, timer })
              if (ws.closed) {
                settle(new Error('Transfer connection closed before control acknowledgement'))
                return
              }
              Promise.resolve(ws.once((envelope) => {
                try {
                  const result = unwrapTransferAcknowledgement(
                    envelope,
                    controlEventId
                  )
                  if (result.ok !== true) {
                    settle(transferProtocolError(
                      result.error,
                      'Transfer control failed'
                    ))
                    return
                  }
                  settle(null, true)
                } catch (error) {
                  settle(error)
                }
              }, controlEventId)).catch(error => {
                settle(error)
              })
              try {
                ws.s({
                  action: 'transfer-func',
                  id: th.id,
                  isFtp,
                  func,
                  sftpId,
                  controlId,
                  args
                })
              } catch (error) {
                settle(error)
              }
            })
            return acknowledgement
          }
        })

        const did = 'transfer:data:' + id
        this.onData = (evt) => {
          const arg = JSON.parse(evt.data)
          if (did === arg.id) {
            onData(arg.data)
          }
        }
        ws.addEventListener('message', this.onData)
        await Promise.all([
          ws.once((arg) => {
            th.terminalSeen = true
            try {
              onEnd(arg)
            } finally {
              maybeDestroy()
            }
          }, 'transfer:end:' + id),
          ws.once((arg) => {
            th.terminalSeen = true
            console.debug('sftp transfer error')
            console.debug(arg?.error?.stack)
            try {
              onError(transferProtocolError(
                arg?.error,
                'SFTP transfer failed'
              ))
            } finally {
              maybeDestroy()
            }
          }, 'transfer:err:' + id),
          ws.once((arg) => {
            this.onPaused?.(arg)
          }, 'transfer:paused:' + id),
          ws.once((envelope) => {
            try {
              const result = unwrapTransferAcknowledgement(
                envelope,
                'transfer:started:' + id
              )
              if (result.id !== id || result.sftpId !== sftpId) {
                settleStartupAcknowledgement(new Error(
                  'Transfer startup acknowledgement identity mismatch'
                ))
                return
              }
              if (result.ok !== true) {
                settleStartupAcknowledgement(transferProtocolError(
                  result.error,
                  'Transfer startup failed'
                ))
                return
              }
              settleStartupAcknowledgement(null, true)
            } catch (error) {
              settleStartupAcknowledgement(error)
            }
          }, 'transfer:started:' + id)
        ])
        throwIfTransferStartAborted(startupSignal)
        if (ws.closed) {
          settleStartupAcknowledgement(new Error(
            'Transfer connection closed before startup send'
          ))
          await startupAcknowledgement
        }
        ws.s({
          action: 'transfer-new',
          ...rest,
          id
        })
        await startupAcknowledgement
        throwIfTransferStartAborted(startupSignal)
        return ws
      } catch (error) {
        closeLateTransferSocket(ws)
        throw error
      }
    }, signal, () => closeLateTransferSocket(ws))
  }

  onDestroy (ws) {
    if (this.destroyed) return
    this.destroyed = true
    const error = new Error('Transfer closed before control acknowledgement')
    for (const pending of this.pendingControls?.values() || []) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingControls?.clear()
    ws.removeEventListener('message', this.onData)
    ws.close()
  }
}

export default async (props) => {
  const transfer = new Transfer()
  await transfer.init(props)
  return transfer
}
