const tunnelHealthStates = [
  'starting',
  'healthy',
  'reconnecting',
  'port-conflict',
  'session-lost',
  'stopped',
  'failed'
]

const reconnectDelaysMs = [1000, 3000, 10000]
const portConflictCodes = new Set([
  'EADDRINUSE',
  'SSH_TUNNEL_PORT_IN_USE'
])
const sessionLostCodes = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'SSH_CONNECTION_CLOSED',
  'SSH_SESSION_LOST'
])

function getReconnectDelayMs (attempt) {
  return reconnectDelaysMs[Number(attempt)] ?? null
}

function safeText (value, fallback = '') {
  return String(value || fallback)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
}

function appendTunnelEvent (events, event = {}) {
  const state = tunnelHealthStates.includes(event.state)
    ? event.state
    : 'failed'
  const next = [
    ...(Array.isArray(events) ? events : []),
    {
      at: Number.isFinite(event.at) ? event.at : Date.now(),
      state,
      code: safeText(event.code, 'SSH_TUNNEL_EVENT'),
      message: safeText(event.message, state)
    }
  ]
  return next.slice(-50)
}

function classifyTunnelFailure (error = {}) {
  const code = String(error.code || '').toUpperCase()
  if (portConflictCodes.has(code)) return 'port-conflict'
  if (sessionLostCodes.has(code)) return 'session-lost'
  return 'failed'
}

exports.tunnelHealthStates = tunnelHealthStates
exports.getReconnectDelayMs = getReconnectDelayMs
exports.appendTunnelEvent = appendTunnelEvent
exports.classifyTunnelFailure = classifyTunnelFailure
