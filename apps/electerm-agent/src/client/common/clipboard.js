/**
 * clipboard related
 */

import message from '../components/common/message'

const fileRegWin = /^(remote:)?\w:\\.+/
const fileReg = /^(remote:)?\/.+/

export const readClipboard = () => {
  return window.pre.readClipboard()
}

export const readClipboardAsync = () => {
  const {
    readClipboardSync,
    readClipboard
  } = window.pre
  return readClipboardSync ? readClipboardSync() : Promise.resolve(readClipboard())
}

export function copyTextWithFeedback (
  str,
  writeClipboard,
  notifyCopied,
  notifyCopyFailed
) {
  const fail = () => {
    try {
      notifyCopyFailed()
    } catch {
      // Clipboard failure reporting is best-effort.
    }
    return false
  }
  try {
    const result = writeClipboard(str)
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        notifyCopied()
        return true
      }, fail)
    }
    notifyCopied()
    return true
  } catch {
    return fail()
  }
}

export const copy = (str) => {
  return copyTextWithFeedback(
    str,
    value => window.pre.writeClipboard(value),
    () => message.success({
      content: window.translate('copied'),
      duration: 2,
      key: 'copy-message'
    }),
    () => message.error({
      content: window.translate('shellpilotTunnelCopyFailed'),
      duration: 3,
      key: 'copy-message'
    })
  )
}

export const cut = (str, itemTitle = '') => {
  message.success('Cutted ' + itemTitle, 2)
  window.pre.writeClipboard(str)
}

export const hasFileInClipboardText = (
  text = readClipboard()
) => {
  const arr = text.split('\n')
  return arr.reduce((prev, t) => {
    return prev &&
      (fileReg.test(t) || fileRegWin.test(t))
  }, true)
}
