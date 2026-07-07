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
  streamingSessions.delete(sessionId)

  return { stopped: true }
}

function parseAuthHeader (authHeaderName) {
  const headerStr = String(authHeaderName || 'Authorization: Bearer').trim()
  const match = headerStr.match(/^([^:]+?)(?:\s*:\s*(.*))?$/)
  return {
    headerKey: match?.[1]?.trim() || 'Authorization',
    headerPrefix: match?.[2]?.trim() || ''
  }
}

const createAIClient = (baseURL, apiKey, proxy, authHeaderName) => {
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
    item.value ||
    item.deployment_id ||
    item.display_name ||
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
  if (!data || typeof data !== 'object') {
    return []
  }

  const modelKeys = [
    'data',
    'models',
    'result',
    'items',
    'list'
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
      log.error('AI models error')
      log.error(e)
      return {
        error: getAIErrorMessage(e),
        stack: e.stack
      }
    }
    try {
      return {
        models: await fetchOllamaModels(baseURL, apiKey, proxy, authHeaderName)
      }
    } catch (err) {
      log.error('AI models error')
      log.error(err)
      return {
        error: getAIErrorMessage(err),
        stack: err.stack
      }
    }
  }
}

exports.AIchatWithTools = async (messages, model, baseURL, path, apiKey, proxy, tools, authHeaderName) => {
  try {
    const endpoint = normalizeAIEndpoint(baseURL, path)
    const client = createAIClient(endpoint.baseURL, apiKey, proxy, authHeaderName)
    const requestData = {
      model,
      messages,
      stream: false
    }
    if (tools && tools.length) {
      requestData.tools = tools
    }
    const response = await client.post(endpoint.path, requestData)
    const choice = response.data?.choices?.[0]
    if (!choice?.message) {
      const errorMessage = getAIErrorMessage(response.data)
      return {
        error: errorMessage || '模型 API 返回异常，未包含可用的 Agent 消息'
      }
    }
    return {
      message: choice.message
    }
  } catch (e) {
    log.error('AI chat with tools error', e)
    return { error: getAIErrorMessage(e) }
  }
}

exports.AIchat = async (
  prompt,
  model = defaultSettings.modelAI,
  role = defaultSettings.roleAI,
  baseURL = defaultSettings.baseURLAI,
  path = defaultSettings.apiPathAI,
  apiKey,
  proxy = defaultSettings.proxyAI,
  stream = true,
  authHeaderName = defaultSettings.authHeaderNameAI
) => {
  try {
    const endpoint = normalizeAIEndpoint(baseURL, path)
    const client = createAIClient(endpoint.baseURL, apiKey, proxy, authHeaderName)

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
        {
          role: 'user',
          content: prompt
        }
      ],
      stream: useStream
    }

    if (useStream) {
      // For streaming responses, initiate streaming and return session info
      const response = await client.post(endpoint.path, requestData, {
        responseType: 'stream'
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
      processStream(sessionId, sessionData)

      return {
        sessionId,
        isStream: true,
        hasMore: true,
        content: ''
      }
    } else {
      // For non-streaming responses (command suggestions and when stream=false)
      const response = await client.post(endpoint.path, requestData)

      return {
        response: normalizeAIMessageContent(getAIChoiceContent(response.data.choices[0])),
        isStream: false
      }
    }
  } catch (e) {
    log.error('AI chat error')
    log.error(e)
    return {
      error: getAIErrorMessage(e),
      stack: e.stack
    }
  }
}

// Function to get the current state of a streaming session
exports.getStreamContent = (sessionId) => {
  const session = streamingSessions.get(sessionId)
  if (!session) {
    return {
      error: 'Session not found'
    }
  }

  const result = {
    content: session.content,
    hasMore: !session.completed,
    isStream: true
  }

  if (session.error) {
    result.error = session.error
  }

  // Clean up completed sessions
  if (session.completed || session.error) {
    streamingSessions.delete(sessionId)
  }

  return result
}

// Process streaming data
function processStream (sessionId, sessionData) {
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
        return
      }

      try {
        const data = JSON.parse(payload)
        if (data.error) {
          sessionData.error = getAIErrorMessage(data)
          sessionData.completed = true
          return
        }
        const content = getAIChoiceContent(data.choices && data.choices[0])
        if (content) {
          sessionData.content += normalizeAIMessageContent(content)
        }
      } catch (e) {
        log.error('Error parsing stream data:', e)
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
  })

  sessionData.stream.on('error', (error) => {
    sessionData.error = error.message
    sessionData.completed = true
  })
}
