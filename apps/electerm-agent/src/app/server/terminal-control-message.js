const terminalControlFlag = '__aigshellTerminalControl'
const {
  managedRequestIdPattern,
  maxManagedCommandBytes
} = require('./managed-terminal-input')
const managedInputProtocolVersion = 2
const managedInputStatuses = new Set([
  'accepted',
  'written',
  'rejected',
  'interrupted'
])
const terminalControlActions = new Set([
  'keepalive',
  'zmodem-event',
  'trzsz-event',
  'xmodem-event',
  'managed-input',
  'managed-input-interrupt',
  'managed-input-capabilities-request'
])

function buildTerminalControlMessage (action, fields = {}) {
  return JSON.stringify({
    [terminalControlFlag]: true,
    action,
    ...fields
  })
}

function buildManagedInputCapabilities () {
  return buildTerminalControlMessage('managed-input-capabilities', {
    protocolVersion: managedInputProtocolVersion
  })
}

function buildManagedInputStatus (requestId, status) {
  if (!managedRequestIdPattern.test(String(requestId || ''))) {
    throw new Error('managed input requestId is invalid')
  }
  if (!managedInputStatuses.has(status)) {
    throw new Error('managed input status is invalid')
  }
  return buildTerminalControlMessage('managed-input-status', {
    requestId,
    status
  })
}

function invalidTerminalControlMessage () {
  return {
    [terminalControlFlag]: true,
    action: 'invalid-control'
  }
}

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
    return invalidTerminalControlMessage()
  }
  if (parsed.action === 'managed-input' && (
    !managedRequestIdPattern.test(parsed.requestId) ||
    typeof parsed.command !== 'string' ||
    !parsed.command.length ||
    Buffer.byteLength(parsed.command) > maxManagedCommandBytes
  )) {
    return invalidTerminalControlMessage()
  }
  return parsed
}

exports.terminalControlFlag = terminalControlFlag
exports.managedInputProtocolVersion = managedInputProtocolVersion
exports.buildManagedInputCapabilities = buildManagedInputCapabilities
exports.buildManagedInputStatus = buildManagedInputStatus
exports.parseTerminalControlMessage = parseTerminalControlMessage
