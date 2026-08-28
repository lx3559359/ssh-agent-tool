/**
 * run cmd with terminal
 */

const {
  terminals
} = require('./remote-common')
const { startSession } = require('./session')

async function runCmd (body) {
  const {
    pid,
    cmd,
    timeoutMs,
    maxOutputBytes,
    executionId
  } = body
  const term = terminals(pid)
  let txt = ''
  if (term) {
    txt = await term.runCmd(cmd, undefined, {
      timeoutMs,
      maxOutputBytes,
      executionId
    })
  }
  return txt
}

async function cancelRunCmd (body) {
  const { pid, executionId } = body
  const term = terminals(pid)
  if (!term) return false
  return await term.cancelRunCmd(executionId) === true
}

function requireTerminal (pid) {
  const term = terminals(pid)
  if (term) return term
  const error = new Error('SSH 会话不存在或已经断开')
  error.code = 'SSH_TUNNEL_SESSION_NOT_FOUND'
  throw error
}

async function startSshTunnel (body) {
  const { pid, tunnel } = body
  return requireTerminal(pid).startSshTunnel(tunnel)
}

async function stopSshTunnel (body) {
  const { pid, tunnelId } = body
  return requireTerminal(pid).stopSshTunnel(tunnelId)
}

async function listSshTunnels (body) {
  return requireTerminal(body.pid).listSshTunnels()
}

async function testSshTunnel (body) {
  const { pid, tunnelId } = body
  return requireTerminal(pid).testSshTunnel(tunnelId)
}

async function resize (body) {
  const { pid, cols, rows } = body
  const term = terminals(pid)
  if (term) {
    term.resize(cols, rows)
  }
  return 'ok'
}

async function toggleTerminalLog (body) {
  const { pid } = body
  const term = terminals(pid)
  if (term) {
    term.toggleTerminalLog()
  }
  return 'ok'
}

async function toggleTerminalLogTimestamp (body) {
  const { pid } = body
  const term = terminals(pid)
  if (term) {
    term.toggleTerminalLogTimestamp()
  }
  return 'ok'
}

async function createTerm (body, ws) {
  const t = await startSession(body, ws)
  const isSsh = typeof t.getPublicSessionMetadata === 'function'
  const metadata = isSsh
    ? t.getPublicSessionMetadata()
    : {}
  const result = { pid: t.pid }
  const hostKeyFingerprint = typeof metadata?.hostKeyFingerprint === 'string'
    ? metadata.hostKeyFingerprint.trim()
    : ''
  if (hostKeyFingerprint) result.hostKeyFingerprint = hostKeyFingerprint
  if (isSsh) {
    const sshSessionGeneration = typeof metadata?.sshSessionGeneration === 'string'
      ? metadata.sshSessionGeneration.trim()
      : ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      sshSessionGeneration
    )) {
      throw new Error('SSH session generation is unavailable')
    }
    const sshTerminalPid = Number(metadata?.sshTerminalPid)
    if (!Number.isSafeInteger(sshTerminalPid) || sshTerminalPid < 1 ||
      sshTerminalPid !== process.pid) {
      throw new Error('SSH terminal process pid is unavailable')
    }
    result.sshSessionGeneration = sshSessionGeneration
    result.sshTerminalPid = sshTerminalPid
  }
  return result
}

async function testTerm (body, ws) {
  const r = await startSession(body, ws, 'test')
  if (r) {
    return r
  } else {
    throw new Error('test failed')
  }
}

async function setTerminalLogPath (body) {
  const { pid, logPath } = body
  const term = terminals(pid)
  if (term) {
    term.setTerminalLogPath(logPath)
  }
  return 'ok'
}

async function startTerminalLogFile (body) {
  const { pid, logFilePath, addTimeStampToTermLog } = body
  const term = terminals(pid)
  if (term) {
    term.startTerminalLogFile(logFilePath, addTimeStampToTermLog)
  }
  return 'ok'
}

exports.createTerm = createTerm
exports.testTerm = testTerm
exports.resize = resize
exports.runCmd = runCmd
exports.cancelRunCmd = cancelRunCmd
exports.startSshTunnel = startSshTunnel
exports.stopSshTunnel = stopSshTunnel
exports.listSshTunnels = listSshTunnels
exports.testSshTunnel = testSshTunnel
exports.toggleTerminalLog = toggleTerminalLog
exports.toggleTerminalLogTimestamp = toggleTerminalLogTimestamp
exports.setTerminalLogPath = setTerminalLogPath
exports.startTerminalLogFile = startTerminalLogFile
