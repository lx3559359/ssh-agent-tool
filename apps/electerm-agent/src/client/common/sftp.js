/**
 * sftp through ws
 */

import generate from './uid'
import Transfer from './transfer'
import { transferTypeMap, instSftpKeys as keys } from './constants'
import initWs from './ws'
import wait from './wait'
import {
  createSftpAbortError,
  prepareSftpCancelableCall
} from './sftp-operation-cancellation'

const transferKeys = Object.keys(transferTypeMap)

class Sftp {
  async init (terminalId, port) {
    const id = generate()
    const ws = await initWs('sftp', id, terminalId, undefined, port)
    this.ws = ws
    this.id = id
    this.terminalId = terminalId
    this.port = port
    ws.s({
      action: 'sftp-new',
      id,
      type: this.type,
      terminalId
    })
    const th = this
    this.ws = ws
    keys.forEach(func => {
      th[func] = async (...args) => {
        if (transferKeys.includes(func)) {
          return Transfer({
            sftpId: id,
            isFtp: this.type === 'ftp',
            ...args[0],
            terminalId,
            type: func,
            port
          })
        }
        const fid = generate()
        const uid = func + ':' + fid
        const prepared = prepareSftpCancelableCall(func, args, fid)
        if (prepared.signal?.aborted) throw createSftpAbortError()
        // let ws = await initWs()
        return new Promise((resolve, reject) => {
          const onAbort = prepared.signal
            ? () => {
                ws.s({
                  action: 'sftp-cancel',
                  id,
                  cancelToken: prepared.cancelToken,
                  terminalId,
                  type: this.type
                })
              }
            : null
          const cleanup = () => {
            if (onAbort) {
              prepared.signal.removeEventListener('abort', onAbort)
            }
          }
          if (onAbort) {
            prepared.signal.addEventListener('abort', onAbort, { once: true })
          }
          Promise.resolve(ws.once((arg) => {
            cleanup()
            if (arg.error) {
              console.debug('sftp error', arg.error.message)
              const fallback = typeof window !== 'undefined' && window.translate
                ? window.translate('shellpilotSftpUnavailable')
                : 'SFTP is unavailable'
              const message = String(arg.error.message || '').trim() || fallback
              return reject(new Error(message))
            }
            resolve(arg.data)
          }, uid))
            .then(() => {
              ws.s({
                action: 'sftp-func',
                id,
                uid,
                func,
                args: prepared.args,
                terminalId,
                type: this.type
              })
            })
            .catch(error => {
              cleanup()
              reject(error)
            })
        })
      }
    })
  }

  async destroy () {
    const { ws } = this
    if (!ws) return
    if (!ws.closed) {
      const uid = `sftp-destroy:${generate()}`
      await Promise.race([
        new Promise(resolve => {
          Promise.resolve(ws.once(resolve, uid)).then(() => {
            ws.s({
              action: 'sftp-destroy',
              id: this.id,
              uid,
              terminalId: this.terminalId
            })
          }).catch(resolve)
        }),
        wait(1500)
      ])
    }
    ws.close()
    delete this.ws
  }
}

export default async (terminalId, type = 'sftp', port) => {
  const sftp = new Sftp()
  sftp.type = type
  await sftp.init(terminalId, port)
  return sftp
}
