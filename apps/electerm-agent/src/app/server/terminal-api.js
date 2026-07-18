/**
 * run cmd with terminal
 */

const { testConnection, terminal, terminals } = require('./session-process')
const { serializeRunCmdError } = require('./session-common')

async function runCmd (ws, msg) {
  const {
    id,
    pid,
    cmd,
    timeoutMs,
    maxOutputBytes,
    executionId
  } = msg
  const term = terminals(pid)
  try {
    let txt = ''
    if (term) {
      txt = await term.runCmd(cmd, id, {
        timeoutMs,
        maxOutputBytes,
        executionId
      })
    }
    ws.s({
      id,
      data: txt
    })
  } catch (err) {
    ws.s({
      id,
      error: serializeRunCmdError(err)
    })
  }
}

async function cancelRunCmd (ws, msg) {
  const { id, pid, executionId } = msg
  const term = terminals(pid)
  try {
    const cancelled = term
      ? await term.cancelRunCmd(executionId, id)
      : false
    ws.s({ id, data: cancelled })
  } catch (err) {
    ws.s({
      id,
      error: serializeRunCmdError(err)
    })
  }
}

function resize (ws, msg) {
  const { id, pid, cols, rows } = msg
  const term = terminals(pid)
  if (term) {
    term.resize(cols, rows, id)
  }
  ws.s({
    id,
    data: 'ok'
  })
}

async function handleTerminalLogControl (ws, msg, operation) {
  const { id, pid } = msg
  try {
    const term = terminals(pid)
    if (!term) {
      throw new Error(`Terminal with PID ${pid} not found`)
    }
    await operation(term)
    ws.s({
      id,
      data: 'ok'
    })
  } catch (err) {
    ws.s({
      id,
      error: {
        message: err.message,
        stack: err.stack
      }
    })
  }
}

function toggleTerminalLog (ws, msg) {
  return handleTerminalLogControl(ws, msg, term => {
    return term.toggleTerminalLog(msg.id)
  })
}
function toggleTerminalLogTimestamp (ws, msg) {
  const { id, pid } = msg
  const term = terminals(pid)
  if (term) {
    term.toggleTerminalLogTimestamp(id)
  }
  ws.s({
    id,
    data: 'ok'
  })
}

function createTerm (ws, msg) {
  const { id, body } = msg
  terminal(body, ws, id)
    .then(data => {
      ws.s({
        id,
        data
      })
    })
    .catch(err => {
      ws.s({
        id,
        error: {
          message: err.message,
          stack: err.stack
        }
      })
    })
}

function testTerm (ws, msg) {
  const { id, body } = msg
  testConnection(body, ws, id)
    .then(data => {
      if (data) {
        ws.s({
          id,
          data
        })
      } else {
        ws.s({
          id,
          error: {
            message: 'test failed',
            stack: 'test failed'
          }
        })
      }
    })
    .catch(err => {
      ws.s({
        id,
        error: {
          message: err.message || 'test failed',
          stack: err.stack || 'test failed'
        }
      })
    })
}

function setTerminalLogPath (ws, msg) {
  return handleTerminalLogControl(ws, msg, term => {
    return term.setTerminalLogPath(msg.id, msg.logPath)
  })
}
function startTerminalLogFile (ws, msg) {
  return handleTerminalLogControl(ws, msg, term => {
    return term.startTerminalLogFile(
      msg.id,
      msg.logFilePath,
      msg.addTimeStampToTermLog
    )
  })
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
