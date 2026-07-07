const terminalControlFlag = '__aigshellTerminalControl'
const terminalControlActions = new Set([
  'keepalive',
  'zmodem-event',
  'trzsz-event',
  'xmodem-event'
])

function parseTerminalControlMessage (msg) {
  if (typeof msg !== 'string') {
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(msg)
  } catch (e) {
    return null
  }
  if (!parsed || parsed[terminalControlFlag] !== true) {
    return null
  }
  if (!terminalControlActions.has(parsed.action)) {
    return null
  }
  return parsed
}

exports.terminalControlFlag = terminalControlFlag
exports.parseTerminalControlMessage = parseTerminalControlMessage
