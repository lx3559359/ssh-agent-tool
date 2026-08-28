/**
 * common functions for remote process handling,
 * for sftp, terminal and transfer
 */

const globalState = require('./global-state')

function sftp (id, inst) {
  if (inst) {
    globalState.setSession(id, inst)
    return inst
  }
  return globalState.getSession(id)
}

function terminals (id, inst) {
  if (inst) {
    globalState.setSession(id, inst)
    return inst
  }
  return globalState.getSession(id)
}

function transfer (id, sftpId, inst) {
  const ss = sftp(sftpId)
  if (!ss) {
    return
  }
  if (inst) {
    ss.transfers[id] = inst
    return inst
  }
  return ss.transfers[id]
}

function onDestroySftp (id, graceful = false) {
  const inst = sftp(id)
  if (!inst) return
  if (graceful && typeof inst.destroyGracefully === 'function') {
    return inst.destroyGracefully()
  }
  return inst.kill && inst.kill()
}

function onDestroyTransfer (id, sftpId) {
  const sftpInst = sftp(sftpId)
  const inst = sftpInst?.transfers?.[id]
  if (!inst) return Promise.resolve(true)
  return Promise.resolve()
    .then(() => inst.destroy?.())
    .finally(() => {
      if (sftpInst.transfers?.[id] === inst) {
        delete sftpInst.transfers[id]
      }
    })
    .then(() => true)
}

function cleanAllSessions () {
  const { sessions } = globalState.data
  for (const id in sessions) {
    const inst = sessions[id]
    inst && inst.kill && inst.kill()
  }
}

module.exports = {
  sftp,
  transfer,
  onDestroySftp,
  onDestroyTerminal: onDestroySftp,
  onDestroyTransfer,
  terminals,
  cleanAllSessions
}
