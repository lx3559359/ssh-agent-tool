const WEB_ERROR_CODE_PATTERN = /^WEB_[A-Z0-9_]+$/

function sanitizeWebErrorDetails (details = {}) {
  const safe = {}
  if (details.origin) safe.origin = String(details.origin)
  if (details.addressClass) {
    safe.addressClass = String(details.addressClass)
  }
  if (details.authorizationToken) {
    safe.authorizationToken = String(details.authorizationToken)
  }
  if (details.readId) safe.readId = String(details.readId)
  return safe
}

class WebAccessError extends Error {
  constructor (code, message, details = {}) {
    super(String(message || 'Web page access failed.'))
    this.name = 'WebAccessError'
    this.code = WEB_ERROR_CODE_PATTERN.test(String(code || ''))
      ? String(code)
      : 'WEB_NETWORK_ERROR'
    this.details = sanitizeWebErrorDetails(details)
  }
}

function isWebAccessError (error) {
  return WEB_ERROR_CODE_PATTERN.test(String(error?.code || ''))
}

function serializeWebAccessError (error) {
  if (!isWebAccessError(error)) {
    return {
      code: 'WEB_NETWORK_ERROR',
      message: 'Web page access failed.',
      details: {}
    }
  }
  return {
    code: error.code,
    message: String(error.message || 'Web page access failed.'),
    details: sanitizeWebErrorDetails(error.details)
  }
}

module.exports = {
  WebAccessError,
  isWebAccessError,
  sanitizeWebErrorDetails,
  serializeWebAccessError
}
