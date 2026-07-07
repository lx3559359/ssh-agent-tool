const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { Readable } = require('node:stream')

process.env.NODE_ENV = 'development'

const aiPath = path.resolve(__dirname, '../../src/app/lib/ai')

test('normalizes model list responses from common providers and relays', () => {
  const {
    normalizeAIModelsResponse
  } = require(aiPath)

  assert.deepEqual(
    normalizeAIModelsResponse({
      data: [
        { id: 'gpt-4.1-mini' },
        { name: 'deepseek-chat' },
        { model: 'qwen-plus' },
        { model_name: 'glm-4-plus' },
        'moonshot-v1-8k'
      ]
    }),
    [
      'gpt-4.1-mini',
      'deepseek-chat',
      'qwen-plus',
      'glm-4-plus',
      'moonshot-v1-8k'
    ]
  )

  assert.deepEqual(
    normalizeAIModelsResponse({
      result: {
        models: [
          { id: 'doubao-seed-1-6' },
          { name: 'Qwen/Qwen3-32B' }
        ]
      }
    }),
    [
      'doubao-seed-1-6',
      'Qwen/Qwen3-32B'
    ]
  )
})

test('normalizes model aliases used by popular relays', () => {
  const {
    normalizeAIModelsResponse
  } = require(aiPath)

  assert.deepEqual(
    normalizeAIModelsResponse({
      data: [
        { model_id: 'hunyuan-turbos-latest' },
        { modelId: 'gemini-2.5-flash' },
        { value: 'claude-3-5-sonnet-latest' },
        { deployment_id: 'azure-gpt-4.1-mini' }
      ]
    }),
    [
      'hunyuan-turbos-latest',
      'gemini-2.5-flash',
      'claude-3-5-sonnet-latest',
      'azure-gpt-4.1-mini'
    ]
  )
})

test('tries Ollama tags endpoint when OpenAI models endpoint returns empty list', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const calls = []

  axios.create = (config) => ({
    get: async (urlPath) => {
      calls.push({
        baseURL: config.baseURL,
        path: urlPath
      })
      if (urlPath === '/models') {
        return { data: { data: [] } }
      }
      return {
        data: {
          models: [
            { name: 'qwen2.5:7b' }
          ]
        }
      }
    }
  })

  delete require.cache[aiPath]
  const { AIModels } = require(aiPath)

  try {
    const res = await AIModels('http://127.0.0.1:11434/v1', '', '', 'Authorization: Bearer')
    assert.deepEqual(res, {
      models: ['qwen2.5:7b']
    })
    assert.deepEqual(calls, [
      {
        baseURL: 'http://127.0.0.1:11434/v1',
        path: '/models'
      },
      {
        baseURL: 'http://127.0.0.1:11434',
        path: '/api/tags'
      }
    ])
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('keeps remote model list errors instead of masking them with Ollama fallback', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const calls = []

  axios.create = (config) => ({
    get: async (urlPath) => {
      calls.push({
        baseURL: config.baseURL,
        path: urlPath
      })
      if (urlPath === '/models') {
        throw new Error('remote /models requires a valid API key')
      }
      throw new Error('unexpected Ollama fallback')
    }
  })

  delete require.cache[aiPath]
  const { AIModels } = require(aiPath)

  try {
    const res = await AIModels('https://api.example.com/v1', 'bad-key', '', 'Authorization: Bearer')
    assert.equal(res.error, 'remote /models requires a valid API key')
    assert.deepEqual(calls, [
      {
        baseURL: 'https://api.example.com/v1',
        path: '/models'
      }
    ])
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('returns provider error messages from model list requests', async () => {
  const axios = require('axios')
  const originalCreate = axios.create

  axios.create = () => ({
    get: async () => {
      const err = new Error('Request failed with status code 401')
      err.response = {
        data: {
          error: {
            message: 'API Key 无效或额度不足'
          }
        }
      }
      throw err
    }
  })

  delete require.cache[aiPath]
  const { AIModels } = require(aiPath)

  try {
    const res = await AIModels('https://relay.example.com/v1', 'bad-key', '', 'Authorization: Bearer')
    assert.equal(res.error, 'API Key 无效或额度不足')
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('returns provider error messages from chat requests', async () => {
  const axios = require('axios')
  const originalCreate = axios.create

  axios.create = () => ({
    post: async () => {
      const err = new Error('Request failed with status code 400')
      err.response = {
        data: {
          error: {
            message: '模型名称不存在'
          }
        }
      }
      throw err
    }
  })

  delete require.cache[aiPath]
  const { AIchat } = require(aiPath)

  try {
    const res = await AIchat(
      'hello',
      'bad-model',
      'system',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      false,
      'Authorization: Bearer'
    )

    assert.equal(res.error, '模型名称不存在')
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('normalizes custom AI auth header spacing for chat requests', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  let capturedConfig

  axios.create = (config) => {
    capturedConfig = config
    return {
      post: async () => ({
        data: {
          choices: [
            {
              message: {
                content: 'ok'
              }
            }
          ]
        }
      })
    }
  }

  delete require.cache[aiPath]
  const { AIchat } = require(aiPath)

  try {
    const res = await AIchat(
      'hello',
      'test-model',
      'system',
      'https://api.example.com/v1',
      '',
      'test-key',
      '',
      false,
      'Authorization:Bearer'
    )
    assert.equal(res.response, 'ok')
    assert.equal(capturedConfig.headers.Authorization, 'Bearer test-key')
    assert.equal(capturedConfig.headers['Authorization:Bearer'], undefined)
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('normalizes non-stream chat content arrays to readable text', async () => {
  const axios = require('axios')
  const originalCreate = axios.create

  axios.create = () => ({
    post: async () => ({
      data: {
        choices: [
          {
            message: {
              content: [
                {
                  type: 'text',
                  text: '第一段'
                },
                {
                  type: 'text',
                  text: '第二段'
                }
              ]
            }
          }
        ]
      }
    })
  })

  delete require.cache[aiPath]
  const { AIchat } = require(aiPath)

  try {
    const res = await AIchat(
      'hello',
      'test-model',
      'system',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      false,
      'Authorization: Bearer'
    )

    assert.equal(res.response, '第一段第二段')
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('uses text fallback from non-stream relay responses', async () => {
  const axios = require('axios')
  const originalCreate = axios.create

  axios.create = () => ({
    post: async () => ({
      data: {
        choices: [
          {
            text: '兼容接口回复'
          }
        ]
      }
    })
  })

  delete require.cache[aiPath]
  const { AIchat } = require(aiPath)

  try {
    const res = await AIchat(
      'hello',
      'test-model',
      'system',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      false,
      'Authorization: Bearer'
    )

    assert.equal(res.response, '兼容接口回复')
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('parses stream chunks from relays that omit the space after data colon', async () => {
  const axios = require('axios')
  const originalCreate = axios.create

  axios.create = () => ({
    post: async () => ({
      data: Readable.from([
        Buffer.from('data:{"choices":[{"delta":{"content":"中转站"}}]}\n\n'),
        Buffer.from('data:[DONE]\n\n')
      ])
    })
  })

  delete require.cache[aiPath]
  const {
    AIchat,
    getStreamContent
  } = require(aiPath)

  try {
    const res = await AIchat(
      'hello',
      'test-model',
      'system',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      true,
      'Authorization: Bearer'
    )

    let streamState
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 10))
      streamState = getStreamContent(res.sessionId)
      if (!streamState.hasMore || streamState.error) {
        break
      }
    }

    assert.equal(streamState.error, undefined)
    assert.equal(streamState.content, '中转站')
    assert.equal(streamState.hasMore, false)
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('normalizes stream chat content arrays to readable text', async () => {
  const axios = require('axios')
  const originalCreate = axios.create

  axios.create = () => ({
    post: async () => ({
      data: Readable.from([
        Buffer.from('data: {"choices":[{"delta":{"content":[{"type":"text","text":"流式"},{"type":"text","text":"片段"}]}}]}\n\n'),
        Buffer.from('data: [DONE]\n\n')
      ])
    })
  })

  delete require.cache[aiPath]
  const {
    AIchat,
    getStreamContent
  } = require(aiPath)

  try {
    const res = await AIchat(
      'hello',
      'test-model',
      'system',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      true,
      'Authorization: Bearer'
    )

    let streamState
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 10))
      streamState = getStreamContent(res.sessionId)
      if (!streamState.hasMore || streamState.error) {
        break
      }
    }

    assert.equal(streamState.error, undefined)
    assert.equal(streamState.content, '流式片段')
    assert.equal(streamState.hasMore, false)
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('returns provider error messages from stream response frames', async () => {
  const axios = require('axios')
  const originalCreate = axios.create

  axios.create = () => ({
    post: async () => ({
      data: Readable.from([
        Buffer.from('data: {"error":{"message":"流式额度不足"}}\n\n')
      ])
    })
  })

  delete require.cache[aiPath]
  const {
    AIchat,
    getStreamContent
  } = require(aiPath)

  try {
    const res = await AIchat(
      'hello',
      'test-model',
      'system',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      true,
      'Authorization: Bearer'
    )

    let streamState
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 10))
      streamState = getStreamContent(res.sessionId)
      if (!streamState.hasMore || streamState.error) {
        break
      }
    }

    assert.equal(streamState.error, '流式额度不足')
    assert.equal(streamState.hasMore, false)
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})
