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
import { bindSftpTransportSession } from './sftp-session-generation.js'
import { reconstructSftpError } from './sftp-error.js'

const transferKeys = Object.keys(transferTypeMap)

class Sftp {
  async init (terminalId, port, sshSessionGeneration, sshTerminalPid) {
    const generation = String(sshSessionGeneration || '').trim()
    const terminalPid = Number(sshTerminalPid)
    if (this.type !== 'ftp' && !generation) {
      throw new Error('SFTP 缺少 SSH session generation')
    }
    if (this.type !== 'ftp' &&
      (!Number.isSafeInteger(terminalPid) || terminalPid < 1)) {
      throw new Error('SFTP 缺少 SSH terminal process PID')
    }
    const id = generate()
    const ws = await initWs('sftp', id, terminalId, undefined, port)
    this.ws = ws
    this.id = id
    this.terminalId = terminalId
    this.port = port
    if (this.type !== 'ftp') {
      bindSftpTransportSession(this, {
        sshSessionGeneration: generation,
        sshTerminalPid: terminalPid
      })
    }
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
        const callArgs = func === 'connect' && this.type !== 'ftp'
          ? [{
              ...(args[0] || {}),
              sshSessionGeneration: generation,
              sshTerminalPid: terminalPid
            }]
          : args
        const fid = generate()
        const uid = func + ':' + fid
        const prepared = prepareSftpCancelableCall(func, callArgs, fid)
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
              return reject(reconstructSftpError(arg.error, fallback))
            }
            if (func === 'connect' && this.type !== 'ftp' &&
              (arg.data?.sshSessionGeneration !== generation ||
                arg.data?.sshTerminalPid !== terminalPid)) {
              return reject(new Error('SFTP server SSH session identity mismatch'))
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
    let primaryError
    try {
      if (!ws.closed) {
        const uid = `sftp-destroy:${generate()}`
        await Promise.race([
          new Promise((resolve, reject) => {
            Promise.resolve(ws.once(result => {
              if (result?.error) {
                reject(reconstructSftpError(
                  result.error,
                  'SFTP teardown failed'
                ))
                return
              }
              resolve(result?.data)
            }, uid)).then(() => {
              ws.s({
                action: 'sftp-destroy',
                id: this.id,
                uid,
                terminalId: this.terminalId
              })
            }).catch(reject)
          }),
          wait(1500)
        ])
      }
    } catch (error) {
      primaryError = error
    }
    try {
      ws.close()
    } catch (error) {
      if (!primaryError) {
        primaryError = error
      } else if (primaryError !== error && Object.isExtensible(primaryError)) {
        primaryError.cleanupErrors = Object.freeze([
          ...(Array.isArray(primaryError.cleanupErrors)
            ? primaryError.cleanupErrors
            : []),
          error
        ])
      }
    } finally {
      delete this.ws
    }
    if (primaryError) throw primaryError
  }
}

export default async (
  terminalId,
  type = 'sftp',
  port,
  sshSessionGeneration,
  sshTerminalPid
) => {
  const sftp = new Sftp()
  sftp.type = type
  await sftp.init(
    terminalId,
    port,
    sshSessionGeneration,
    sshTerminalPid
  )
  return sftp
}
