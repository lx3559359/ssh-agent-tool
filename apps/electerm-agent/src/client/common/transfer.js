/**
 * transfer through ws
 */

import generate from './uid'
import initWs from './ws'

const keys = window.pre.transferKeys

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
    keys.forEach(func => {
      th[func] = (...args) => {
        ws.s({
          action: 'transfer-func',
          id: th.id,
          isFtp,
          func,
          sftpId,
          args
        })
        if (['cancel', 'interrupt', 'destroy'].includes(func)) {
          th.onDestroy(ws)
        }
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
        onEnd(arg)
        th.onDestroy(ws)
      }, 'transfer:end:' + id),
      ws.once((arg) => {
        console.debug('sftp transfer error')
        console.debug(arg.error.stack)
        onError(new Error(arg.error.message))
        th.onDestroy(ws)
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
    ws.removeEventListener('message', this.onData)
    ws.close()
  }
}

export default async (props) => {
  const transfer = new Transfer()
  await transfer.init(props)
  return transfer
}
