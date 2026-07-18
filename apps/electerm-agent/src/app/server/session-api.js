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
  const metadata = typeof t.getPublicSessionMetadata === 'function'
    ? t.getPublicSessionMetadata()
    : {}
  const result = { pid: t.pid }
  const hostKeyFingerprint = typeof metadata?.hostKeyFingerprint === 'string'
    ? metadata.hostKeyFingerprint.trim()
    : ''
  if (hostKeyFingerprint) result.hostKeyFingerprint = hostKeyFingerprint
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
exports.toggleTerminalLog = toggleTerminalLog
exports.toggleTerminalLogTimestamp = toggleTerminalLogTimestamp
exports.setTerminalLogPath = setTerminalLogPath
exports.startTerminalLogFile = startTerminalLogFile
