const terminalControlFlag = '__aigshellTerminalControl'
const {
  managedRequestIdPattern,
  maxManagedCommandBytes
} = require('./managed-terminal-input')
const terminalControlActions = new Set([
  'keepalive',
  'zmodem-event',
  'trzsz-event',
  'xmodem-event',
  'managed-input',
  'managed-input-interrupt'
])

function parseTerminalControlMessage (msg) {
  if (Buffer.isBuffer(msg)) {
    msg = msg.toString('utf8')
  } else if (msg instanceof ArrayBuffer) {
    msg = Buffer.from(msg).toString('utf8')
  }
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
  if (parsed.action === 'managed-input' && (
    !managedRequestIdPattern.test(parsed.requestId) ||
    typeof parsed.command !== 'string' ||
    !parsed.command.length ||
    Buffer.byteLength(parsed.command) > maxManagedCommandBytes
  )) {
    return null
  }
  return parsed
}

exports.terminalControlFlag = terminalControlFlag
exports.parseTerminalControlMessage = parseTerminalControlMessage
