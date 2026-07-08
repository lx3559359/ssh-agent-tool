const {
  redactDiagnosticText
} = require('./diagnostic-pack')

const REDACTED = '[已脱敏]'

const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|set-cookie|x-api-key|api[-_ ]?key|apikey|token|secret|password|passphrase|private[-_ ]?key|proxy[-_ ]?password|certificate)/i

function redactLogString (value) {
  return redactDiagnosticText(value)
}

function redactError (error) {
  return redactLogString(error.stack || error.message || String(error))
}

function redactObjectEntry ([key, value], seen) {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return [key, REDACTED]
  }
  return [key, redactLogValue(value, seen)]
}

function redactLogValue (value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return redactLogString(value)
  }
  if (value instanceof Error) {
    return redactError(value)
  }
  if (Array.isArray(value)) {
    return value.map(item => redactLogValue(item, seen))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)
  return Object.fromEntries(
    Object.entries(value).map(entry => redactObjectEntry(entry, seen))
  )
}

function redactLogMessage (message) {
  if (!message?.data) {
    return message
  }
  return {
    ...message,
    data: message.data.map(item => redactLogValue(item))
  }
}

function installLogRedaction (log) {
  if (!log?.hooks || log.__aigshellRedactionInstalled) {
    return log
  }
  log.hooks.push((message) => redactLogMessage(message))
  log.__aigshellRedactionInstalled = true
  return log
}

module.exports = {
  installLogRedaction,
  redactLogMessage,
  redactLogValue
}
