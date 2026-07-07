const {
  redactDiagnosticText
} = require('./diagnostic-pack')

const MAX_FIELD_LENGTH = 20000

function toText (value) {
  if (value === undefined || value === null) {
    return ''
  }
  if (value instanceof Error) {
    return value.stack || value.message || String(value)
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function limitText (value, maxLength = MAX_FIELD_LENGTH) {
  const text = toText(value)
  if (text.length <= maxLength) {
    return text
  }
  return text.slice(0, maxLength) + '\n[truncated]'
}

function safeText (value, options = {}) {
  return redactDiagnosticText(limitText(value), options)
}

function normalizeRendererErrorReport (payload = {}, options = {}) {
  const redactOptions = {
    homeDir: options.homeDir,
    userName: options.userName,
    userProfile: options.userProfile,
    appDataPath: options.appDataPath
  }
  return {
    source: 'renderer',
    createdAt: options.now || new Date().toISOString(),
    message: safeText(payload.message, redactOptions),
    stack: safeText(payload.stack, redactOptions),
    componentStack: safeText(payload.componentStack, redactOptions),
    location: safeText(payload.location, redactOptions),
    userAgent: safeText(payload.userAgent, redactOptions)
  }
}

function reportRendererError (payload, log, options = {}) {
  const report = normalizeRendererErrorReport(payload, options)
  log.error('renderer-process error', report)
  return { ok: true }
}

module.exports = {
  normalizeRendererErrorReport,
  reportRendererError
}
