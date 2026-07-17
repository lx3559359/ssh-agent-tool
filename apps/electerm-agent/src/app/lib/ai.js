const axios = require('axios')
const { StringDecoder } = require('string_decoder')
const log = require('../common/log')
const defaultSettings = require('../common/config-default')
const { createProxyAgent } = require('./proxy-agent')
const {
  normalizeAIEndpoint,
  normalizeAIModelBaseURL
} = require('../common/ai-endpoint')

// Store for ongoing streaming sessions
const streamingSessions = new Map()
const activeAIChatRequests = new Map()
const activeAgentRequests = new Map()
const AI_HEALTH_REQUEST_TIMEOUT = 8000
const AI_HEALTH_TOTAL_TIMEOUT = 15000
const AI_STREAM_SESSION_TTL = 5 * 60 * 1000

function scheduleStreamingSessionCleanup (sessionId, session) {
  if (!session || session.cleanupTimer) return
  session.completedAt = session.completedAt || Date.now()
  session.cleanupTimer = setTimeout(() => {
    if (streamingSessions.get(sessionId) === session) {
      streamingSessions.delete(sessionId)
    }
  }, AI_STREAM_SESSION_TTL)
  session.cleanupTimer.unref?.()
}

// Stop an ongoing streaming session
exports.stopStream = (sessionId) => {
  const session = streamingSessions.get(sessionId)
  if (!session) {
    return { error: 'Session not found' }
  }

  // Destroy the stream to stop receiving data
  if (session.stream && !session.stream.destroyed) {
    session.stream.destroy()
  }

  // Mark as completed (not an error, just stopped by user)
  session.completed = true
  session.stopped = true

  // Clean up
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer)
  streamingSessions.delete(sessionId)

  return { stopped: true }
}

exports.AIAgentCancel = (requestId) => {
  const id = String(requestId || '')
  const controller = activeAgentRequests.get(id)
  if (!controller) return { cancelled: false }
  controller.abort()
  activeAgentRequests.delete(id)
  return { cancelled: true }
}

exports.AIChatCancel = (requestId) => {
  const id = String(requestId || '')
  const controller = activeAIChatRequests.get(id)
  if (!controller) return { cancelled: false }
  controller.abort()
  activeAIChatRequests.delete(id)
  return { cancelled: true }
}

function parseAuthHeader (authHeaderName) {
  const headerStr = String(authHeaderName || 'Authorization: Bearer').trim()
  const match = headerStr.match(/^([^:]+?)(?:\s*:\s*(.*))?$/)
  return {
    headerKey: match?.[1]?.trim() || 'Authorization',
    headerPrefix: match?.[2]?.trim() || ''
  }
}

const createAIClient = (baseURL, apiKey, proxy, authHeaderName, options = {}) => {
  const {
    headerKey,
    headerPrefix
  } = parseAuthHeader(authHeaderName)
  const headerValue = headerPrefix
    ? `${headerPrefix} ${apiKey}`
    : apiKey
  const config = {
    baseURL,
    headers: {
      'Content-Type': 'application/json'
    }
  }
  if (Number.isFinite(options.timeout) && options.timeout > 0) {
    config.timeout = options.timeout
  }
  if (apiKey) {
    config.headers[headerKey] = headerValue
  }

  // Add proxy agent if proxy is provided
  const agent = proxy ? createProxyAgent(proxy) : null
  if (agent) {
    config.httpsAgent = agent
    config.proxy = false // Disable default proxy behavior when using agent
  }

  return axios.create(config)
}

function getModelName (item) {
  if (typeof item === 'string') {
    return item
  }
  if (!item || typeof item !== 'object') {
    return ''
  }
  return item.id ||
    item.name ||
    item.model ||
    item.model_name ||
    item.model_id ||
    item.modelId ||
    item.modelName ||
    item.model_code ||
    item.modelCode ||
    item.value ||
    item.deployment_id ||
    item.display_name ||
    item.displayName ||
    item.slug ||
    item.key ||
    ''
}

function uniqueModels (models) {
  return [...new Set(models.filter(Boolean))]
}

function normalizeModelMapKeys (data) {
  const ignoredKeys = new Set([
    'error',
    'message',
    'code',
    'status',
    'pagination',
    'paging',
    'page',
    'pageSize',
    'page_size',
    'total',
    'count',
    'limit',
    'offset',
    'hasMore',
    'has_more',
    'next',
    'previous',
    'request_id',
    'requestId'
  ])
  return Object.entries(data)
    .filter(([key, value]) => {
      if (ignoredKeys.has(key)) {
        return false
      }
      return value === true ||
        typeof value === 'string' ||
        (value && typeof value === 'object')
    })
    .map(([key]) => key)
}

function normalizeAIModelsResponse (data, allowModelMap = false) {
  const direct = getModelName(data)
  if (direct) {
    return [direct]
  }
  if (Array.isArray(data)) {
    return uniqueModels(data.flatMap(item => normalizeAIModelsResponse(item)))
  }
  if (!data || typeof data !== 'object') {
    return []
  }

  const modelKeys = [
    'data',
    'models',
    'result',
    'items',
    'list',
    'records',
    'rows',
    'model_list',
    'modelList',
    'model_names',
    'modelNames',
    'available_models',
    'availableModels',
    'model_infos',
    'modelInfos'
  ]

  for (const key of modelKeys) {
    const value = data[key]
    if (Array.isArray(value)) {
      const models = value.flatMap(item => normalizeAIModelsResponse(item))
      if (models.length) {
        return uniqueModels(models)
      }
    }
    if (value && typeof value === 'object') {
      const models = normalizeAIModelsResponse(value, true)
      if (models.length) {
        return uniqueModels(models)
      }
    }
  }

  return allowModelMap ? uniqueModels(normalizeModelMapKeys(data)) : []
}

exports.normalizeAIModelsResponse = normalizeAIModelsResponse

function normalizeAIMessageContent (content) {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content.map(item => {
      if (typeof item === 'string') {
        return item
      }
      if (item && typeof item === 'object') {
        return normalizeAIMessageContent(item.text || item.content || '')
      }
      return ''
    }).join('')
  }
  if (content == null) {
    return ''
  }
  return String(content)
}

function getAIChoiceContent (choice) {
  if (!choice || typeof choice !== 'object') {
    return ''
  }
  if (choice.message && Object.prototype.hasOwnProperty.call(choice.message, 'content')) {
    return choice.message.content
  }
  if (choice.delta && Object.prototype.hasOwnProperty.call(choice.delta, 'content')) {
    return choice.delta.content
  }
  return choice.text || ''
}

function pickAIErrorMessage (data) {
  if (!data) {
    return ''
  }
  if (typeof data === 'string') {
    return data
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const message = pickAIErrorMessage(item)
      if (message) {
        return message
      }
    }
    return ''
  }
  if (typeof data !== 'object') {
    return ''
  }

  const nestedKeys = [
    'error',
    'errors',
    'detail',
    'details'
  ]
  for (const key of nestedKeys) {
    const message = pickAIErrorMessage(data[key])
    if (message) {
      return message
    }
  }

  const messageKeys = [
    'message',
    'msg',
    'error_description',
    'errorDescription'
  ]
  for (const key of messageKeys) {
    if (typeof data[key] === 'string' && data[key].trim()) {
      return data[key]
    }
  }

  return ''
}

function getAIErrorMessage (error) {
  const data = error && error.response
    ? error.response.data
    : error
  const message = pickAIErrorMessage(data)
  if (message) {
    return message
  }
  return error && error.message
}

function getAIErrorSecrets (context = {}) {
  const secrets = [context.apiKey]
  for (const value of [context.baseURL, context.proxy]) {
    try {
      const url = new URL(String(value || ''))
      secrets.push(url.username, url.password)
      for (const queryValue of url.searchParams.values()) secrets.push(queryValue)
    } catch (_) {}
  }
  return secrets.filter(Boolean)
}

function sanitizeAIErrorMessage (error, context = {}) {
  let message = String(getAIErrorMessage(error) || '模型 API 请求失败')
  for (const secret of getAIErrorSecrets(context)) {
    message = message.split(String(secret)).join('[已隐藏]')
  }
  return message
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/ig, '$1[已隐藏]@')
    .replace(/([?&][^=\s&]+)=([^&\s]+)/g, '$1=[已隐藏]')
    .replace(/\b(?:bearer|basic|token)\s+[a-z0-9._~+/=-]+/ig, '[已隐藏认证信息]')
    .replace(/\b(?:api[ _-]*key|token|secret|password|signature)\s*[:=]\s*[^\s,;]+/ig, '[已隐藏认证信息]')
    .replace(/\bsk-[a-z0-9_-]{6,}\b/ig, '[已隐藏密钥]')
    .slice(0, 1000)
}

function sanitizeAIEndpointForLog (value) {
  try {
    const url = new URL(String(value || ''))
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch (_) {
    return ''
  }
}

function getAIRequestErrorLog (kind, error, context = {}) {
  return {
    kind,
    model: sanitizeAIHealthModelForLog(context.model, context.apiKey),
    baseURL: sanitizeAIEndpointForLog(context.baseURL),
    apiPath: getSafeAIHealthLogContext(context.baseURL, context.apiPath).path,
    status: error?.response?.status,
    code: error?.code,
    message: sanitizeAIErrorMessage(error, context)
  }
}

function logAIRequestError (kind, error, context) {
  log.error('AI request error', getAIRequestErrorLog(kind, error, context))
}

const builtInProviderModels = new Map([
  ['api.openai.com', ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini']],
  ['api.deepseek.com', ['deepseek-chat', 'deepseek-reasoner']],
  ['api.moonshot.cn', ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']],
  ['open.bigmodel.cn', ['glm-4-plus', 'glm-4-air', 'glm-4-flash']],
  ['dashscope.aliyuncs.com', ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long']],
  ['api.siliconflow.cn', ['Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1']],
  ['api.siliconflow.com', ['Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1']],
  ['api.minimax.io', ['MiniMax-M3']],
  ['api.hunyuan.cloud.tencent.com', ['hunyuan-turbos-latest']],
  ['openrouter.ai', ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet']],
  ['ark.cn-beijing.volces.com', ['doubao-seed-1-6']],
  ['api.groq.com', ['llama-3.3-70b-versatile']],
  ['api.x.ai', ['grok-4.5', 'grok-4.1-fast-reasoning']],
  ['generativelanguage.googleapis.com', ['gemini-2.5-flash', 'gemini-2.5-pro']],
  ['api.together.xyz', ['meta-llama/Llama-3.3-70B-Instruct-Turbo']],
  ['qianfan.baidubce.com', ['ernie-4.5-turbo-128k']],
  ['qianfan.bj.baidubce.com', ['ernie-4.5-turbo-128k']]
])

function getBuiltInProviderModels (baseURL) {
  try {
    const host = new URL(String(baseURL || '')).hostname.toLowerCase()
    return builtInProviderModels.get(host) || []
  } catch (_) {
    return []
  }
}

function shouldUseBuiltInProviderModels (error) {
  const status = error?.response?.status
  return status === 404 || status === 405 || status === 501
}

function getBuiltInProviderModelsResult (baseURL) {
  const models = getBuiltInProviderModels(baseURL)
  if (!models.length) {
    return null
  }
  return {
    models,
    source: 'built-in'
  }
}

const aiHealthMessages = {
  reachable: 'API 地址可访问；请选择模型后检测模型可用性。',
  available: 'API 与当前模型均可用。',
  'auth-error': 'API 认证失败，请检查密钥或认证 Header。',
  'model-error': '当前模型不可用，请检查模型名称或模型权限。',
  'quota-error': 'API 额度不足或请求受到限流，请检查账户额度。',
  'network-error': '无法连接模型 API，请检查地址、网络、代理或稍后重试。'
}

function createAIHealthResult (status, apiStatus, modelStatus, models = []) {
  return {
    status,
    apiStatus,
    modelStatus,
    models: uniqueModels(models),
    message: aiHealthMessages[status],
    checkedAt: new Date().toISOString()
  }
}

function containsAIHealthSecret (value, apiKey) {
  const text = String(value || '')
  const secret = String(apiKey || '')
  if (!secret) {
    return false
  }
  return text.includes(secret)
}

function sanitizeAIHealthModels (models, apiKey) {
  return uniqueModels(models
    .map(value => String(value || '').trim())
    .filter(value => value && value.length <= 256 && !containsAIHealthSecret(value, apiKey)))
    .slice(0, 512)
}

function sanitizeAIHealthModelForLog (model, apiKey) {
  const value = String(model || '').slice(0, 160)
  return containsAIHealthSecret(value, apiKey) ? '[redacted-model]' : value
}
function getAIErrorHints (error) {
  const data = error?.response?.data
  const errorData = data && typeof data === 'object' ? data.error : null
  return [
    error?.code,
    data?.code,
    data?.type,
    data?.status,
    errorData?.code,
    errorData?.type,
    errorData?.status,
    getAIErrorMessage(error)
  ]
    .filter(value => typeof value === 'string')
    .join(' ')
    .toLowerCase()
}

function classifyAIHealthError (error, phase) {
  const status = Number(error?.response?.status) || 0
  const hints = getAIErrorHints(error)

  if (
    status === 402 ||
    status === 429 ||
    /\b(?:quota|rate[ _-]*limit|too many requests|insufficient[ _-]*credits?|(?:insufficient|exceeded)[ _-]*(?:user[ _-]*)?quota|quota[ _-]*(?:exceeded|insufficient|depleted)|billing)\b/.test(hints)
  ) {
    return 'quota-error'
  }
  if (
    /\b(?:model[ _-]*not[ _-]*found|invalid[ _-]*model|model[ _-]*(?:does not exist|unsupported|unavailable|unknown)|no such model|deployment[ _-]*(?:not found|does not exist|invalid|unknown))\b/.test(hints)
  ) {
    return 'model-error'
  }
  if (status === 401 || status === 403 || /\b(?:unauthorized|forbidden|invalid[ _-]*(?:api[ _-]*)?key|authentication failed)\b/.test(hints)) {
    return 'auth-error'
  }
  if (
    !error?.response ||
    status >= 500 ||
    /^(?:ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNABORTED|ERR_NETWORK|ERR_CANCELED|ABORT_ERR|AI_HEALTH_TOTAL_TIMEOUT)/.test(String(error?.code || '').toUpperCase())
  ) {
    return 'network-error'
  }
  if (status >= 400 && status < 500) return 'reachable'
  return 'network-error'
}

function getSafeAIHealthLogContext (baseURL, apiPath) {
  let origin = ''
  let safePath = ''
  try {
    const url = new URL(String(baseURL || ''))
    origin = url.origin === 'null' ? '' : url.origin
  } catch (_) {}
  try {
    const url = new URL(String(apiPath || '/'), origin || 'https://invalid.local')
    safePath = url.pathname
  } catch (_) {}
  return {
    origin,
    path: safePath
  }
}

function logAIHealthError (kind, error, context, classification) {
  const safeEndpoint = getSafeAIHealthLogContext(context.baseURL, context.apiPath)
  const code = String(error?.code || '').toUpperCase()
  log.error('AI health check failed', {
    kind,
    model: sanitizeAIHealthModelForLog(context.model, context.apiKey),
    origin: safeEndpoint.origin,
    path: safeEndpoint.path,
    status: Number(error?.response?.status) || undefined,
    code: /^[A-Z0-9_-]{1,64}$/.test(code) ? code : undefined,
    classification
  })
}

function getAIHealthStatuses (classification, modelsReachable) {
  if (classification === 'model-error') {
    return {
      apiStatus: 'reachable',
      modelStatus: 'model-error'
    }
  }
  if (classification === 'quota-error') {
    return {
      apiStatus: 'quota-error',
      modelStatus: 'quota-error'
    }
  }
  if (classification === 'reachable') {
    return {
      apiStatus: 'reachable',
      modelStatus: 'unknown'
    }
  }
  return {
    apiStatus: classification,
    modelStatus: 'unknown'
  }
}

function createAIHealthRequestConfig (signal) {
  return {
    signal,
    timeout: AI_HEALTH_REQUEST_TIMEOUT
  }
}

function isValidAIHealthChatResponse (data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  if (Array.isArray(data.choices) && data.choices.length) {
    const choice = data.choices[0]
    return Boolean(choice && typeof choice === 'object' && (
      choice.message || choice.delta || typeof choice.text === 'string'
    ))
  }
  if (Array.isArray(data.output) && data.output.length) return true
  return ['output_text', 'response', 'text'].some(
    key => typeof data[key] === 'string'
  )
}

async function performAIHealthCheck ({
  model,
  baseURL,
  path,
  apiKey,
  proxy,
  authHeaderName,
  signal
}) {
  let models = []
  let modelsReachable = false
  const modelBaseURL = normalizeAIModelBaseURL(baseURL)

  try {
    const modelsClient = createAIClient(
      modelBaseURL,
      apiKey,
      proxy,
      authHeaderName,
      { timeout: AI_HEALTH_REQUEST_TIMEOUT }
    )
    const response = await modelsClient.get('/models', createAIHealthRequestConfig(signal))
    modelsReachable = true
    models = normalizeAIModelsResponse(response.data)
    if (!models.length) {
      models = getBuiltInProviderModels(baseURL)
    }
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    if (shouldUseBuiltInProviderModels(error)) {
      models = getBuiltInProviderModels(baseURL)
    } else {
      const classification = classifyAIHealthError(error, 'models')
      const statuses = getAIHealthStatuses(classification, false)
      logAIHealthError('models', error, {
        model,
        apiKey,
        baseURL: modelBaseURL,
        apiPath: '/models'
      }, classification)
      return createAIHealthResult(
        classification,
        statuses.apiStatus,
        statuses.modelStatus,
        models
      )
    }
  }

  models = sanitizeAIHealthModels(models, apiKey)

  if (!String(model || '').trim()) {
    return createAIHealthResult(
      'reachable',
      modelsReachable ? 'reachable' : 'unknown',
      'unknown',
      models
    )
  }

  let endpoint
  try {
    endpoint = normalizeAIEndpoint(baseURL, path)
    const chatClient = createAIClient(
      endpoint.baseURL,
      apiKey,
      proxy,
      authHeaderName,
      { timeout: AI_HEALTH_REQUEST_TIMEOUT }
    )
    const response = await chatClient.post(endpoint.path, {
      model,
      messages: [
        {
          role: 'user',
          content: 'ping'
        }
      ],
      stream: false,
      max_tokens: 2
    }, createAIHealthRequestConfig(signal))
    if (response?.data?.error) {
      const responseError = new Error('AI health response contains an error')
      responseError.response = {
        status: 400,
        data: response.data
      }
      throw responseError
    }
    if (!isValidAIHealthChatResponse(response?.data)) {
      return createAIHealthResult(
        'reachable',
        'reachable',
        'unknown',
        models
      )
    }
    return createAIHealthResult(
      'available',
      'reachable',
      'available',
      models
    )
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    const classification = classifyAIHealthError(error, 'chat')
    const statuses = getAIHealthStatuses(classification, modelsReachable)
    logAIHealthError('chat', error, {
      model,
      apiKey,
      baseURL: endpoint?.baseURL || baseURL,
      apiPath: endpoint?.path || path
    }, classification)
    return createAIHealthResult(
      classification,
      statuses.apiStatus,
      statuses.modelStatus,
      models
    )
  }
}

const activeAIHealthChecks = new Map()

exports.AIHealthCheckCancel = (requestId) => {
  const id = String(requestId || '')
  const controller = activeAIHealthChecks.get(id)
  if (!controller) return false
  controller.abort()
  return true
}

exports.AIHealthCheck = async (
  model,
  baseURL,
  path,
  apiKey,
  proxy,
  authHeaderName,
  requestId
) => {
  const controller = new AbortController()
  const id = String(requestId || '')
  if (id) {
    activeAIHealthChecks.get(id)?.abort()
    activeAIHealthChecks.set(id, controller)
  }
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      const error = new Error('AI health check timed out')
      error.code = 'AI_HEALTH_TOTAL_TIMEOUT'
      reject(error)
    }, AI_HEALTH_TOTAL_TIMEOUT)
  })

  try {
    return await Promise.race([
      performAIHealthCheck({
        model,
        baseURL,
        path,
        apiKey,
        proxy,
        authHeaderName,
        signal: controller.signal
      }),
      timeout
    ])
  } catch (error) {
    const classification = 'network-error'
    logAIHealthError('total', error, {
      model,
      apiKey,
      baseURL,
      apiPath: path
    }, classification)
    return createAIHealthResult(
      classification,
      classification,
      'unknown',
      []
    )
  } finally {
    clearTimeout(timer)
    if (id && activeAIHealthChecks.get(id) === controller) {
      activeAIHealthChecks.delete(id)
    }
  }
}

async function fetchOpenAIModels (baseURL, apiKey, proxy, authHeaderName) {
  const client = createAIClient(normalizeAIModelBaseURL(baseURL), apiKey, proxy, authHeaderName)
  const response = await client.get('/models')
  return normalizeAIModelsResponse(response.data)
}

async function fetchOllamaModels (baseURL, apiKey, proxy, authHeaderName) {
  const nativeBaseURL = String(baseURL || '').replace(/\/v1\/?$/, '')
  const client = createAIClient(nativeBaseURL, apiKey, proxy, authHeaderName)
  const response = await client.get('/api/tags')
  return normalizeAIModelsResponse(response.data)
}

function shouldTryOllamaModels (baseURL) {
  try {
    const url = new URL(String(baseURL || ''))
    const host = url.hostname.toLowerCase()
    return host === 'localhost' ||
      host === '::1' ||
      host.startsWith('127.') ||
      url.port === '11434' ||
      host.includes('ollama')
  } catch (_) {
    return false
  }
}

exports.AIModels = async (baseURL, apiKey, proxy, authHeaderName) => {
  try {
    const models = await fetchOpenAIModels(baseURL, apiKey, proxy, authHeaderName)
    if (models.length) {
      return {
        models
      }
    }
    const builtInResult = getBuiltInProviderModelsResult(baseURL)
    if (builtInResult) {
      return builtInResult
    }
    if (!shouldTryOllamaModels(baseURL)) {
      return {
        models: []
      }
    }
    return {
      models: await fetchOllamaModels(baseURL, apiKey, proxy, authHeaderName)
    }
  } catch (e) {
    if (!shouldTryOllamaModels(baseURL)) {
      if (shouldUseBuiltInProviderModels(e)) {
        const builtInResult = getBuiltInProviderModelsResult(baseURL)
        if (builtInResult) {
          return builtInResult
        }
      }
      const errorContext = {
        apiKey,
        proxy,
        baseURL: normalizeAIModelBaseURL(baseURL),
        apiPath: '/models'
      }
      logAIRequestError('models', e, errorContext)
      return {
        error: sanitizeAIErrorMessage(e, errorContext),
        status: classifyAIHealthError(e, 'models')
      }
    }
    try {
      return {
        models: await fetchOllamaModels(baseURL, apiKey, proxy, authHeaderName)
      }
    } catch (err) {
      const errorContext = {
        apiKey,
        proxy,
        baseURL: String(baseURL || '').replace(/\/v1\/?$/, ''),
        apiPath: '/api/tags'
      }
      logAIRequestError('models', err, errorContext)
      return {
        error: sanitizeAIErrorMessage(err, errorContext),
        status: classifyAIHealthError(err, 'models')
      }
    }
  }
}

exports.AIchatWithTools = async (messages, model, baseURL, path, apiKey, proxy, tools, authHeaderName, requestId) => {
  let endpoint
  let errorContext = { model, baseURL, apiPath: path, apiKey, proxy }
  const controller = new AbortController()
  const normalizedRequestId = String(requestId || '')
  try {
    if (normalizedRequestId) {
      activeAgentRequests.get(normalizedRequestId)?.abort()
      activeAgentRequests.set(normalizedRequestId, controller)
    }
    endpoint = normalizeAIEndpoint(baseURL, path)
    errorContext = {
      model,
      baseURL: endpoint.baseURL,
      apiPath: endpoint.path,
      apiKey,
      proxy
    }
    const client = createAIClient(endpoint.baseURL, apiKey, proxy, authHeaderName)
    const requestData = {
      model,
      messages,
      stream: false
    }
    if (tools && tools.length) {
      requestData.tools = tools
    }
    const response = await client.post(endpoint.path, requestData, {
      signal: controller.signal
    })
    const choice = response.data?.choices?.[0]
    if (!choice?.message) {
      const errorMessage = sanitizeAIErrorMessage(response.data, errorContext)
      return {
        error: errorMessage || '模型 API 返回异常，未包含可用的 Agent 消息'
      }
    }
    return {
      message: choice.message
    }
  } catch (e) {
    if (controller.signal.aborted || e?.code === 'ERR_CANCELED') {
      return { cancelled: true }
    }
    logAIRequestError('agent-tools', e, errorContext)
    return { error: sanitizeAIErrorMessage(e, errorContext) }
  } finally {
    if (
      normalizedRequestId &&
      activeAgentRequests.get(normalizedRequestId) === controller
    ) {
      activeAgentRequests.delete(normalizedRequestId)
    }
  }
}

exports.AIchat = async (
  promptOrMessages,
  model = defaultSettings.modelAI,
  role = defaultSettings.roleAI,
  baseURL = defaultSettings.baseURLAI,
  path = defaultSettings.apiPathAI,
  apiKey,
  proxy = defaultSettings.proxyAI,
  stream = true,
  authHeaderName = defaultSettings.authHeaderNameAI,
  requestId
) => {
  let endpoint
  let errorContext = { model, baseURL, apiPath: path, apiKey, proxy }
  const controller = new AbortController()
  const normalizedRequestId = String(requestId || '')
  try {
    if (normalizedRequestId) {
      activeAIChatRequests.get(normalizedRequestId)?.abort()
      activeAIChatRequests.set(normalizedRequestId, controller)
    }
    endpoint = normalizeAIEndpoint(baseURL, path)
    errorContext = {
      model,
      baseURL: endpoint.baseURL,
      apiPath: endpoint.path,
      apiKey,
      proxy
    }
    const client = createAIClient(endpoint.baseURL, apiKey, proxy, authHeaderName)

    const conversationMessages = Array.isArray(promptOrMessages)
      ? promptOrMessages
        .filter(message => (
          message &&
            ['user', 'assistant'].includes(message.role) &&
            String(message.content || '').trim()
        ))
        .map(message => ({
          role: message.role,
          content: String(message.content)
        }))
      : [{ role: 'user', content: String(promptOrMessages || '') }]
    const latestUserMessage = [...conversationMessages]
      .reverse()
      .find(message => message.role === 'user')
    const prompt = latestUserMessage?.content || ''

    // Determine if we should use streaming based on the prompt content
    // Command suggestions should not use streaming for quick response
    const isCommandSuggestion = prompt.includes('give me max 5 command suggestions')
    const useStream = stream && !isCommandSuggestion

    const requestData = {
      model,
      messages: [
        {
          role: 'system',
          content: role
        },
        ...conversationMessages
      ],
      stream: useStream
    }

    if (useStream) {
      // For streaming responses, initiate streaming and return session info
      const response = await client.post(endpoint.path, requestData, {
        responseType: 'stream',
        signal: controller.signal
      })

      const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
      const sessionData = {
        stream: response.data,
        content: '',
        completed: false,
        error: null
      }

      streamingSessions.set(sessionId, sessionData)

      // Start processing the stream
      processStream(sessionId, sessionData, errorContext)

      return {
        sessionId,
        isStream: true,
        hasMore: true,
        content: ''
      }
    } else {
      // For non-streaming responses (command suggestions and when stream=false)
      const response = await client.post(endpoint.path, requestData, {
        signal: controller.signal
      })
      const choice = response.data?.choices?.[0]
      if (!choice) {
        const errorMessage = sanitizeAIErrorMessage(response.data, errorContext)
        return {
          error: errorMessage || '模型 API 返回异常，未包含可用的对话消息'
        }
      }

      return {
        response: normalizeAIMessageContent(getAIChoiceContent(choice)),
        isStream: false
      }
    }
  } catch (e) {
    if (controller.signal.aborted || e?.code === 'ERR_CANCELED') {
      return { cancelled: true }
    }
    logAIRequestError('chat', e, errorContext)
    return {
      error: sanitizeAIErrorMessage(e, errorContext)
    }
  } finally {
    if (
      normalizedRequestId &&
      activeAIChatRequests.get(normalizedRequestId) === controller
    ) {
      activeAIChatRequests.delete(normalizedRequestId)
    }
  }
}

// Function to get the current state of a streaming session
exports.getStreamContent = (sessionId, requestedOffset) => {
  const session = streamingSessions.get(sessionId)
  if (!session) {
    return {
      error: 'Session not found'
    }
  }

  const incremental = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
  const offset = incremental
    ? Math.min(requestedOffset, session.content.length)
    : 0
  const result = {
    content: incremental ? session.content.slice(offset) : session.content,
    hasMore: !session.completed,
    isStream: true
  }
  if (incremental) {
    result.offset = offset
    result.nextOffset = session.content.length
    result.incremental = true
  }

  if (session.error) {
    result.error = session.error
  }

  // Keep completed sessions briefly so remounted renderers can read the final
  // result idempotently without racing an older in-flight poll.
  if (session.completed || session.error) {
    scheduleStreamingSessionCleanup(sessionId, session)
  }

  return result
}

// Process streaming data
function processStream (sessionId, sessionData, errorContext = {}) {
  let buffer = ''
  const decoder = new StringDecoder('utf8')

  const processLines = (shouldFlush = false) => {
    const lines = buffer.split('\n')
    buffer = shouldFlush ? '' : lines.pop()
    const linesToProcess = shouldFlush ? lines.filter(Boolean).concat(buffer ? [buffer] : []) : lines

    for (const line of linesToProcess) {
      const trimmed = line.trim()
      if (trimmed === '') continue

      if (!trimmed.startsWith('data:')) {
        continue
      }

      const payload = trimmed.replace(/^data:\s*/, '')
      if (payload === '[DONE]') {
        sessionData.completed = true
        scheduleStreamingSessionCleanup(sessionId, sessionData)
        return
      }

      try {
        const data = JSON.parse(payload)
        if (data.error) {
          sessionData.error = sanitizeAIErrorMessage(data, errorContext)
          sessionData.completed = true
          scheduleStreamingSessionCleanup(sessionId, sessionData)
          return
        }
        const content = getAIChoiceContent(data.choices && data.choices[0])
        if (content) {
          sessionData.content += normalizeAIMessageContent(content)
        }
      } catch {
        log.error('Error parsing AI stream frame')
      }
    }
  }

  sessionData.stream.on('data', (chunk) => {
    buffer += decoder.write(chunk)
    processLines()
  })

  sessionData.stream.on('end', () => {
    buffer += decoder.end()
    processLines(true)
    sessionData.completed = true
    scheduleStreamingSessionCleanup(sessionId, sessionData)
  })

  sessionData.stream.on('error', (error) => {
    sessionData.error = sanitizeAIErrorMessage(error, errorContext)
    sessionData.completed = true
    scheduleStreamingSessionCleanup(sessionId, sessionData)
  })
}
