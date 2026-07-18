/**
 * fetch from server
 */

import initWs from './ws'
import generate from './uid'
import { NewPromise } from './promise-timeout'

const id = 's'
window.et.wsOpened = false

const safeRemoteStates = new Set([
  'not-dispatched',
  'in-progress',
  'stopped',
  'unknown',
  'known-failed',
  'verified',
  'changed-unverified'
])

function safeErrorIdentifier (value, pattern) {
  if (typeof value !== 'string' || value.length > 128) return undefined
  return pattern.test(value) ? value : undefined
}

export function reconstructFetchError (remoteError = {}) {
  const error = new Error(String(remoteError.message || 'Remote request failed'))
  const name = safeErrorIdentifier(
    remoteError.name,
    /^[A-Za-z][A-Za-z0-9]*$/
  )
  const code = safeErrorIdentifier(remoteError.code, /^[A-Za-z0-9_:-]+$/)
  if (name) error.name = name
  if (code) error.code = code
  if (safeRemoteStates.has(remoteError.remoteState)) {
    error.remoteState = remoteError.remoteState
  }
  if (typeof remoteError.canAutoRetry === 'boolean') {
    error.canAutoRetry = remoteError.canAutoRetry
  }
  return error
}

export const initWsCommon = async () => {
  if (window.et.wsOpened) {
    return
  }
  const ws = await initWs('common', id, undefined, true)
  if (!ws) {
    return
  }
  window.et.wsOpened = true
  ws.onclose = () => {
    window.et.wsOpened = false
  }
  window.et.commonWs = ws
  window.store.wsInited = true
}

window.pre.ipcOnEvent('power-resume', initWsCommon)

const wsFetch = async (data) => {
  if (!window.et.wsOpened) {
    await initWsCommon()
  }
  const id = generate()
  return new NewPromise((resolve, reject) => {
    window.et.commonWs.once((arg) => {
      if (arg.error) {
        const error = reconstructFetchError(arg.error)
        console.error('fetch error', {
          message: error.message,
          name: error.name,
          ...(error.code ? { code: error.code } : {}),
          ...(error.remoteState ? { remoteState: error.remoteState } : {}),
          ...(typeof error.canAutoRetry === 'boolean'
            ? { canAutoRetry: error.canAutoRetry }
            : {})
        })
        return reject(error)
      }
      resolve(arg.data)
    }, id)
    window.et.commonWs.s({
      id,
      ...data
    })
  })
}
window.wsFetch = wsFetch
export default wsFetch
