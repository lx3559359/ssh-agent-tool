/**
 * transfer through ws
 */

import generate from './uid'
import initWs from './ws'

const keys = window.pre.transferKeys
const transferControlAckTimeout = 15000

class Transfer {
  async init ({
    onData,
    onEnd,
    onError,
    onPaused,
    ...rest
  }) {
    const id = generate()
    this.id = id
    const th = this
    this.onPaused = onPaused
    const {
      sftpId,
      isFtp,
      port
    } = rest
    const ws = await initWs('transfer', id, sftpId, undefined, port)
    this.pendingControls = new Map()
    this.terminalSeen = false
    this.terminalControlRequested = false
    const maybeDestroy = () => {
      if ((this.terminalSeen || this.terminalControlRequested) &&
        this.pendingControls.size === 0) {
        th.onDestroy(ws)
      }
    }
    keys.forEach(func => {
      th[func] = (...args) => {
        const controlId = generate()
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
          Promise.resolve(ws.once((result) => {
            if (result?.ok !== true) {
              settle(new Error(
                result?.error?.message || 'Transfer control failed'
              ))
              return
            }
            settle(null, true)
          }, `transfer:control:${th.id}:${controlId}`)).catch(error => {
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
        console.debug(arg.error.stack)
        try {
          onError(new Error(arg.error.message))
        } finally {
          maybeDestroy()
        }
      }, 'transfer:err:' + id),
      ws.once((arg) => {
        this.onPaused?.(arg)
      }, 'transfer:paused:' + id)
    ])
    ws.s({
      action: 'transfer-new',
      ...rest,
      id
    })
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
