const CHAT_PATH = '/chat/completions'
const RESPONSE_PATH = '/responses'
const MODELS_PATH = '/models'

const NO_V1_HOSTS = new Set([
  'api.deepseek.com',
  'api.perplexity.ai'
])

const PROVIDER_BASE_PATHS = new Map([
  ['openrouter.ai', '/api/v1'],
  ['dashscope.aliyuncs.com', '/compatible-mode/v1'],
  ['open.bigmodel.cn', '/api/paas/v4'],
  ['qianfan.baidubce.com', '/v2'],
  ['qianfan.bj.baidubce.com', '/v2'],
  ['api.groq.com', '/openai/v1'],
  ['generativelanguage.googleapis.com', '/v1beta/openai'],
  ['ark.cn-beijing.volces.com', '/api/v3'],
  ['api.deepinfra.com', '/v1/openai'],
  ['api.fireworks.ai', '/inference/v1']
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
  const knownPaths = [CHAT_PATH, RESPONSE_PATH, MODELS_PATH]
  const matched = knownPaths.find(path => lowerPath.endsWith(path))

  if (!matched) {
    return null
  }

  const basePath = cleanPath.slice(0, cleanPath.length - matched.length)
  const endpointSearch = url.search
  url.pathname = basePath || '/'
  url.search = ''
  url.hash = ''

  return {
    baseURL: trimEndSlash(url.toString()),
    path: matched === MODELS_PATH
      ? CHAT_PATH
      : `${matched}${endpointSearch}`
  }
}

function shouldAppendV1 (url) {
  if (NO_V1_HOSTS.has(url.hostname.toLowerCase())) {
    return false
  }
  const cleanPath = trimEndSlash(url.pathname).toLowerCase()
  return cleanPath === '' || cleanPath === '/'
}

function appendPath (baseURL, path) {
  const url = new URL(baseURL)
  url.pathname = path
  url.search = ''
  url.hash = ''
  return trimEndSlash(url.toString())
}

function getProviderBasePath (url) {
  const cleanPath = trimEndSlash(url.pathname).toLowerCase()
  if (cleanPath !== '' && cleanPath !== '/') {
    return ''
  }
  return PROVIDER_BASE_PATHS.get(url.hostname.toLowerCase()) || ''
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
  const providerBasePath = getProviderBasePath(url)
  let normalizedBaseURL = trimEndSlash(rawBaseURL)

  if (!explicitPath && providerBasePath) {
    normalizedBaseURL = appendPath(rawBaseURL, providerBasePath)
  } else if (!explicitPath && shouldAppendV1(url)) {
    normalizedBaseURL = appendPath(rawBaseURL, '/v1')
  }

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
  MODELS_PATH,
  RESPONSE_PATH,
  normalizeAIEndpoint,
  normalizeAIModelBaseURL
}
