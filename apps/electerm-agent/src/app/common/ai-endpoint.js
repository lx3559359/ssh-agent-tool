const CHAT_PATH = '/chat/completions'
const RESPONSE_PATH = '/responses'

const NO_V1_HOSTS = new Set([
  'api.deepseek.com'
])

function trimEndSlash (str) {
  return String(str || '').replace(/\/+$/, '')
}

function normalizePath (path) {
  const p = String(path || '').trim()
  if (!p) {
    return ''
  }
  return p.startsWith('/') ? p : `/${p}`
}

function splitFullEndpoint (baseURL) {
  const url = new URL(baseURL)
  const cleanPath = trimEndSlash(url.pathname)
  const lowerPath = cleanPath.toLowerCase()
  const knownPaths = [CHAT_PATH, RESPONSE_PATH]
  const matched = knownPaths.find(path => lowerPath.endsWith(path))

  if (!matched) {
    return null
  }

  const basePath = cleanPath.slice(0, cleanPath.length - matched.length)
  url.pathname = basePath || '/'
  url.search = ''
  url.hash = ''

  return {
    baseURL: trimEndSlash(url.toString()),
    path: matched
  }
}

function shouldAppendV1 (url) {
  if (NO_V1_HOSTS.has(url.hostname.toLowerCase())) {
    return false
  }
  const cleanPath = trimEndSlash(url.pathname).toLowerCase()
  return cleanPath === '' || cleanPath === '/'
}

function appendV1 (baseURL) {
  const url = new URL(baseURL)
  url.pathname = '/v1'
  url.search = ''
  url.hash = ''
  return trimEndSlash(url.toString())
}

function normalizeAIEndpoint (baseURL, apiPath) {
  const rawBaseURL = String(baseURL || '').trim()
  if (!rawBaseURL) {
    return {
      baseURL: '',
      path: normalizePath(apiPath) || CHAT_PATH
    }
  }

  const explicitPath = normalizePath(apiPath)
  if (!explicitPath) {
    const fullEndpoint = splitFullEndpoint(rawBaseURL)
    if (fullEndpoint) {
      return fullEndpoint
    }
  }

  const url = new URL(rawBaseURL)
  const normalizedBaseURL = explicitPath
    ? trimEndSlash(rawBaseURL)
    : shouldAppendV1(url)
      ? appendV1(rawBaseURL)
      : trimEndSlash(rawBaseURL)

  return {
    baseURL: normalizedBaseURL,
    path: explicitPath || CHAT_PATH
  }
}

function normalizeAIModelBaseURL (baseURL) {
  return normalizeAIEndpoint(baseURL, '').baseURL
}

module.exports = {
  CHAT_PATH,
  RESPONSE_PATH,
  normalizeAIEndpoint,
  normalizeAIModelBaseURL
}
