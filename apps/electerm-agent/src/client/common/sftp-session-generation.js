export function bindSftpTransportSession (transport, identity = {}) {
  const generation = String(identity.sshSessionGeneration || '').trim()
  if (!generation) throw new Error('SFTP 缺少 SSH session generation')
  const terminalPid = Number(identity.sshTerminalPid)
  if (!Number.isSafeInteger(terminalPid) || terminalPid < 1) {
    throw new Error('SFTP 缺少 SSH terminal process PID')
  }
  Object.defineProperty(transport, 'sshSessionGeneration', {
    value: generation,
    enumerable: true,
    configurable: false,
    writable: false
  })
  Object.defineProperty(transport, 'sshTerminalPid', {
    value: terminalPid,
    enumerable: true,
    configurable: false,
    writable: false
  })
  return {
    sshSessionGeneration: generation,
    sshTerminalPid: terminalPid
  }
}

export function bindSftpTransportGeneration (transport, value, terminalPid) {
  return bindSftpTransportSession(transport, {
    sshSessionGeneration: value,
    sshTerminalPid: terminalPid
  }).sshSessionGeneration
}
