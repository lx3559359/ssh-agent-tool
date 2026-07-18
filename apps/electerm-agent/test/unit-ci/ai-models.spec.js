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
    normalizeAIModelsResponse([
      'deepseek-chat',
      { id: 'qwen-plus' },
      { model_name: 'glm-4-plus' }
    ]),
    [
      'deepseek-chat',
      'qwen-plus',
      'glm-4-plus'
    ]
  )

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
        { modelName: 'kimi-k2-0711-preview' },
        { displayName: 'MiniMax-M1' },
        { slug: 'x-ai/grok-4' },
        { key: 'mistral-large-latest' },
        { value: 'claude-3-5-sonnet-latest' },
        { deployment_id: 'azure-gpt-4.1-mini' }
      ]
    }),
    [
      'hunyuan-turbos-latest',
      'gemini-2.5-flash',
      'kimi-k2-0711-preview',
      'MiniMax-M1',
      'x-ai/grok-4',
      'mistral-large-latest',
      'claude-3-5-sonnet-latest',
      'azure-gpt-4.1-mini'
    ]
  )
})

test('normalizes model map responses used by relays and gateways', () => {
  const {
    normalizeAIModelsResponse
  } = require(aiPath)

  assert.deepEqual(
    normalizeAIModelsResponse({
      models: {
        'deepseek-chat': {
          owned_by: 'deepseek'
        },
        'qwen-plus': {
          context_length: 131072
        },
        'gpt-4.1-mini': true
      }
    }),
    [
      'deepseek-chat',
      'qwen-plus',
      'gpt-4.1-mini'
    ]
  )

  assert.deepEqual(
    normalizeAIModelsResponse({
      data: {
        pagination: {
          total: 0,
          page: 1
        },
        hasMore: false
      }
    }),
    []
  )
})

test('normalizes relay model list container aliases', () => {
  const {
    normalizeAIModelsResponse
  } = require(aiPath)

  assert.deepEqual(
    normalizeAIModelsResponse({
      model_list: [
        { model_code: 'qwen-max-latest' },
        { modelCode: 'hunyuan-large-latest' }
      ]
    }),
    [
      'qwen-max-latest',
      'hunyuan-large-latest'
    ]
  )

  assert.deepEqual(
    normalizeAIModelsResponse({
      result: {
        availableModels: [
          { name: 'MiniMax-M1' },
          { id: 'kimi-k2-0711-preview' }
        ]
      }
    }),
    [
      'MiniMax-M1',
      'kimi-k2-0711-preview'
    ]
  )

  assert.deepEqual(
    normalizeAIModelsResponse({
      data: {
        total: 2,
        records: [
          { modelName: 'deepseek-chat' },
          { model_name: 'qwen-plus' }
        ]
      }
    }),
    [
      'deepseek-chat',
      'qwen-plus'
    ]
  )

  assert.deepEqual(
    normalizeAIModelsResponse({
      data: {
        page: 1,
        rows: [
          { id: 'moonshot-v1-8k' },
          { modelCode: 'glm-4-flash' }
        ]
      }
    }),
    [
      'moonshot-v1-8k',
      'glm-4-flash'
    ]
  )

  assert.deepEqual(
    normalizeAIModelsResponse({
      data: {
        model_names: [
          'deepseek-chat',
          'qwen-plus'
        ]
      }
    }),
    [
      'deepseek-chat',
      'qwen-plus'
    ]
  )

  assert.deepEqual(
    normalizeAIModelsResponse({
      result: {
        modelNames: [
          'glm-4-flash',
          'moonshot-v1-8k'
        ]
      }
    }),
    [
      'glm-4-flash',
      'moonshot-v1-8k'
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

test('returns built-in provider models when a known provider returns an empty model list', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const calls = []

  axios.create = (config) => ({
    get: async (urlPath) => {
      calls.push({
        baseURL: config.baseURL,
        path: urlPath
      })
      return {
        data: {
          data: []
        }
      }
    }
  })

  delete require.cache[aiPath]
  const { AIModels } = require(aiPath)

  try {
    const res = await AIModels('https://api.deepseek.com', 'test-key', '', 'Authorization: Bearer')
    assert.deepEqual(res, {
      models: [
        'deepseek-chat',
        'deepseek-reasoner'
      ],
      source: 'built-in'
    })
    assert.deepEqual(calls, [
      {
        baseURL: 'https://api.deepseek.com',
        path: '/models'
      }
    ])
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('returns built-in MiniMax model when its model list is empty', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const calls = []

  axios.create = (config) => ({
    get: async (urlPath) => {
      calls.push({
        baseURL: config.baseURL,
        path: urlPath
      })
      return {
        data: {
          data: []
        }
      }
    }
  })

  delete require.cache[aiPath]
  const { AIModels } = require(aiPath)

  try {
    const res = await AIModels('https://api.minimax.io', 'test-key', '', 'Authorization: Bearer')
    assert.deepEqual(res, {
      models: [
        'MiniMax-M3'
      ],
      source: 'built-in'
    })
    assert.deepEqual(calls, [
      {
        baseURL: 'https://api.minimax.io/v1',
        path: '/models'
      }
    ])
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('returns built-in models for popular providers when their model list is empty', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const calls = []

  axios.create = (config) => ({
    get: async (urlPath) => {
      calls.push({
        baseURL: config.baseURL,
        path: urlPath
      })
      return {
        data: {
          data: []
        }
      }
    }
  })

  delete require.cache[aiPath]
  const { AIModels } = require(aiPath)

  try {
    const cases = [
      ['https://openrouter.ai', ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet']],
      ['https://ark.cn-beijing.volces.com', ['doubao-seed-1-6']],
      ['https://api.groq.com', ['llama-3.3-70b-versatile']],
      ['https://api.x.ai', ['grok-4.5', 'grok-4.1-fast-reasoning']],
      ['https://generativelanguage.googleapis.com', ['gemini-2.5-flash', 'gemini-2.5-pro']],
      ['https://api.together.xyz', ['meta-llama/Llama-3.3-70B-Instruct-Turbo']],
      ['https://qianfan.baidubce.com', ['ernie-4.5-turbo-128k']]
    ]

    for (const [baseURL, models] of cases) {
      const res = await AIModels(baseURL, 'test-key', '', 'Authorization: Bearer')
      assert.deepEqual(res, {
        models,
        source: 'built-in'
      }, baseURL)
    }

    assert.equal(calls.length, cases.length)
    assert.deepEqual(
      calls.map(call => call.path),
      cases.map(() => '/models')
    )
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('returns built-in models for required official providers when their model list is empty', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const calls = []

  axios.create = (config) => ({
    get: async (urlPath) => {
      calls.push({
        baseURL: config.baseURL,
        path: urlPath
      })
      return {
        data: {
          data: []
        }
      }
    }
  })

  delete require.cache[aiPath]
  const { AIModels } = require(aiPath)

  try {
    const cases = [
      ['https://api.openai.com/v1', ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini']],
      ['https://api.deepseek.com', ['deepseek-chat', 'deepseek-reasoner']],
      ['https://dashscope.aliyuncs.com', ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long']],
      ['https://open.bigmodel.cn', ['glm-4-plus', 'glm-4-air', 'glm-4-flash']],
      ['https://api.moonshot.cn/v1', ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']],
      ['https://api.siliconflow.cn/v1', ['Qwen/Qwen3-32B', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1']],
      ['https://openrouter.ai', ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet']]
    ]

    for (const [baseURL, models] of cases) {
      const res = await AIModels(baseURL, 'test-key', '', 'Authorization: Bearer')
      assert.deepEqual(res, {
        models,
        source: 'built-in'
      }, baseURL)
    }

    assert.equal(calls.length, cases.length)
    assert.deepEqual(
      calls.map(call => call.path),
      cases.map(() => '/models')
    )
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

test('returns built-in provider models when a known provider has no models endpoint', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const calls = []

  axios.create = (config) => ({
    get: async (urlPath) => {
      calls.push({
        baseURL: config.baseURL,
        path: urlPath
      })
      const err = new Error('Request failed with status code 404')
      err.response = {
        status: 404,
        data: {
          error: {
            message: 'models endpoint not found'
          }
        }
      }
      throw err
    }
  })

  delete require.cache[aiPath]
  const { AIModels } = require(aiPath)

  try {
    const res = await AIModels('https://api.deepseek.com', 'test-key', '', 'Authorization: Bearer')
    assert.deepEqual(res, {
      models: [
        'deepseek-chat',
        'deepseek-reasoner'
      ],
      source: 'built-in'
    })
    assert.deepEqual(calls, [
      {
        baseURL: 'https://api.deepseek.com',
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
        status: 401,
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
    assert.equal(res.status, 'auth-error')
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('returns nested provider detail messages from model list requests', async () => {
  const axios = require('axios')
  const originalCreate = axios.create

  axios.create = () => ({
    get: async () => {
      const err = new Error('Request failed with status code 403')
      err.response = {
        data: {
          detail: {
            message: 'upstream account has no model permission'
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
    assert.equal(res.error, 'upstream account has no model permission')
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('returns provider error messages from errors arrays', async () => {
  const axios = require('axios')
  const originalCreate = axios.create

  axios.create = () => ({
    get: async () => {
      const err = new Error('Request failed with status code 429')
      err.response = {
        status: 429,
        data: {
          errors: [
            {
              message: 'relay daily quota exceeded'
            }
          ]
        }
      }
      throw err
    }
  })

  delete require.cache[aiPath]
  const { AIModels } = require(aiPath)

  try {
    const res = await AIModels('https://relay.example.com/v1', 'test-key', '', 'Authorization: Bearer')
    assert.equal(res.error, 'relay daily quota exceeded')
    assert.equal(res.status, 'quota-error')
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

test('returns provider error messages from non-stream chat response bodies', async () => {
  const axios = require('axios')
  const originalCreate = axios.create

  axios.create = () => ({
    post: async () => ({
      data: {
        error: {
          message: 'model is not available on this relay'
        }
      }
    })
  })

  delete require.cache[aiPath]
  const { AIchat } = require(aiPath)

  try {
    const res = await AIchat(
      'hello',
      'relay-model',
      'system',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      false,
      'Authorization: Bearer'
    )

    assert.equal(res.error, 'model is not available on this relay')
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('logs AI chat request errors with safe diagnostic context', async () => {
  const axios = require('axios')
  const log = require(path.resolve(__dirname, '../../src/app/common/log'))
  const originalCreate = axios.create
  const originalError = log.error
  const logs = []

  axios.create = () => ({
    post: async () => {
      const err = new Error('Request failed with status code 401')
      err.response = {
        status: 401,
        data: {
          error: {
            message: 'invalid api key'
          }
        }
      }
      err.config = {
        headers: {
          Authorization: 'Bearer sk-live-secret'
        },
        baseURL: 'https://relay.example.com/v1',
        url: '/chat/completions'
      }
      throw err
    }
  })
  log.error = (...args) => logs.push(args)

  delete require.cache[aiPath]
  const { AIchat } = require(aiPath)

  try {
    const res = await AIchat(
      'hello',
      'relay-model',
      'system',
      'https://relay.example.com/v1',
      '/chat/completions',
      'sk-live-secret',
      '',
      false,
      'Authorization: Bearer'
    )

    const serialized = JSON.stringify(logs)
    assert.equal(res.error, '模型 API 认证失败，请检查 API Key 和认证 Header。')
    assert.match(serialized, /AI request error/)
    assert.match(serialized, /chat/)
    assert.match(serialized, /relay-model/)
    assert.match(serialized, /https:\/\/relay\.example\.com\/v1/)
    assert.match(serialized, /\/chat\/completions/)
    assert.match(serialized, /401/)
    assert.equal(serialized.includes('sk-live-secret'), false)
  } finally {
    axios.create = originalCreate
    log.error = originalError
    delete require.cache[aiPath]
  }
})

test('returns provider error messages from tool chat response bodies', async () => {
  const axios = require('axios')
  const originalCreate = axios.create

  axios.create = () => ({
    post: async () => ({
      data: {
        error: {
          message: 'tool calling is disabled for this model'
        }
      }
    })
  })

  delete require.cache[aiPath]
  const { AIchatWithTools } = require(aiPath)

  try {
    const res = await AIchatWithTools(
      [{ role: 'user', content: 'check server' }],
      'test-model',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      [{ type: 'function', function: { name: 'noop', parameters: {} } }],
      'Authorization: Bearer'
    )

    assert.equal(res.error, 'tool calling is disabled for this model')
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
test('redacts credentials and stacks from ordinary chat request errors', async () => {
  const axios = require('axios')
  const log = require(path.resolve(__dirname, '../../src/app/common/log'))
  const originalCreate = axios.create
  const originalError = log.error
  const apiKey = 'sk-chat-secret-1234567890'
  const proxyPassword = 'proxy-chat-secret'

  axios.create = () => ({
    post: async () => {
      const error = new Error(
        'Authorization: Bearer ' + apiKey +
        ' proxy password=' + proxyPassword +
        ' https://relay.example.com/v1?token=query-chat-secret'
      )
      error.stack = 'STACK_WITH_' + apiKey
      throw error
    }
  })
  log.error = () => {}

  delete require.cache[aiPath]
  const { AIchat } = require(aiPath)

  try {
    const result = await AIchat(
      'hello',
      'test-model',
      'system',
      'https://relay.example.com/v1?token=query-chat-secret',
      '',
      apiKey,
      'http://user:' + proxyPassword + '@proxy.example.com:8080',
      false,
      'Authorization: Bearer'
    )
    const serialized = JSON.stringify(result)

    assert.equal('stack' in result, false)
    assert.doesNotMatch(serialized, /sk-chat-secret|proxy-chat-secret|query-chat-secret|STACK_WITH/)
    assert.match(result.error, /已隐藏/)
  } finally {
    axios.create = originalCreate
    log.error = originalError
    delete require.cache[aiPath]
  }
})

test('cancels an in-flight Agent model request by request id', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  let capturedSignal

  axios.create = () => ({
    post: async (requestPath, requestData, options = {}) => {
      capturedSignal = options.signal
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('canceled')
          error.code = 'ERR_CANCELED'
          reject(error)
        }, { once: true })
      })
    }
  })

  delete require.cache[aiPath]
  const { AIchatWithTools, AIAgentCancel } = require(aiPath)

  try {
    const pending = AIchatWithTools(
      [{ role: 'user', content: 'check server' }],
      'test-model',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      [],
      'Authorization: Bearer',
      'agent-request-1'
    )
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(capturedSignal.aborted, false)
    assert.deepEqual(AIAgentCancel('agent-request-1'), { cancelled: true })
    assert.equal(capturedSignal.aborted, true)
    assert.deepEqual(await pending, { cancelled: true })
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('cancels an in-flight normal chat model request by request id', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  let capturedSignal

  axios.create = () => ({
    post: async (requestPath, requestData, options = {}) => {
      capturedSignal = options.signal
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('canceled')
          error.code = 'ERR_CANCELED'
          reject(error)
        }, { once: true })
      })
    }
  })

  delete require.cache[aiPath]
  const { AIchat, AIChatCancel } = require(aiPath)

  try {
    const pending = AIchat(
      [{ role: 'user', content: 'check server' }],
      'test-model',
      'test-role',
      'https://relay.example.com/v1',
      '',
      'test-key',
      '',
      true,
      'Authorization: Bearer',
      'chat-request-1'
    )
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(capturedSignal.aborted, false)
    assert.deepEqual(AIChatCancel('chat-request-1'), { cancelled: true })
    assert.equal(capturedSignal.aborted, true)
    assert.deepEqual(await pending, { cancelled: true })
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('redacts credentials from tool chat request errors', async () => {
  const axios = require('axios')
  const log = require(path.resolve(__dirname, '../../src/app/common/log'))
  const originalCreate = axios.create
  const originalError = log.error
  const apiKey = 'sk-tools-secret-1234567890'

  axios.create = () => ({
    post: async () => {
      const error = new Error('api_key=' + apiKey + ' token=tool-query-secret')
      error.stack = 'STACK_WITH_' + apiKey
      throw error
    }
  })
  log.error = () => {}

  delete require.cache[aiPath]
  const { AIchatWithTools } = require(aiPath)

  try {
    const result = await AIchatWithTools(
      [{ role: 'user', content: 'check server' }],
      'test-model',
      'https://relay.example.com/v1?token=tool-query-secret',
      '',
      apiKey,
      '',
      [{ type: 'function', function: { name: 'noop', parameters: {} } }],
      'Authorization: Bearer'
    )
    const serialized = JSON.stringify(result)

    assert.doesNotMatch(serialized, /sk-tools-secret|tool-query-secret|STACK_WITH/)
    assert.match(result.error, /已隐藏/)
  } finally {
    axios.create = originalCreate
    log.error = originalError
    delete require.cache[aiPath]
  }
})

test('redacts credentials from successful HTTP error response bodies', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const apiKey = 'sk-body-secret-1234567890'

  axios.create = () => ({
    post: async () => ({
      data: {
        error: {
          message: 'Authorization: Bearer ' + apiKey
        }
      }
    })
  })

  delete require.cache[aiPath]
  const { AIchat, AIchatWithTools } = require(aiPath)

  try {
    const chat = await AIchat(
      'hello',
      'test-model',
      'system',
      'https://relay.example.com/v1',
      '',
      apiKey,
      '',
      false,
      'Authorization: Bearer'
    )
    const tools = await AIchatWithTools(
      [{ role: 'user', content: 'check server' }],
      'test-model',
      'https://relay.example.com/v1',
      '',
      apiKey,
      '',
      [{ type: 'function', function: { name: 'noop', parameters: {} } }],
      'Authorization: Bearer'
    )

    assert.doesNotMatch(JSON.stringify({ chat, tools }), /sk-body-secret/)
    assert.match(chat.error, /已隐藏/)
    assert.match(tools.error, /已隐藏/)
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('redacts credentials from stream response error frames', async () => {
  const axios = require('axios')
  const originalCreate = axios.create
  const apiKey = 'sk-stream-secret-1234567890'

  axios.create = () => ({
    post: async () => ({
      data: Readable.from([
        Buffer.from(
          'data: {"error":{"message":"Authorization: Bearer ' +
          apiKey +
          '"}}\n\n'
        )
      ])
    })
  })

  delete require.cache[aiPath]
  const { AIchat, getStreamContent } = require(aiPath)

  try {
    const result = await AIchat(
      'hello',
      'test-model',
      'system',
      'https://relay.example.com/v1',
      '',
      apiKey,
      '',
      true,
      'Authorization: Bearer'
    )

    let streamState
    for (let index = 0; index < 20; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
      streamState = getStreamContent(result.sessionId)
      if (!streamState.hasMore || streamState.error) break
    }

    assert.doesNotMatch(JSON.stringify(streamState), /sk-stream-secret/)
    assert.match(streamState.error, /已隐藏/)
  } finally {
    axios.create = originalCreate
    delete require.cache[aiPath]
  }
})

test('redacts credentials from malformed stream frames before logging', async () => {
  const axios = require('axios')
  const log = require(path.resolve(__dirname, '../../src/app/common/log'))
  const originalCreate = axios.create
  const originalError = log.error
  const apiKey = 'sk-malformed-stream-secret-1234567890'
  const logged = []

  axios.create = () => ({
    post: async () => ({
      data: Readable.from([
        Buffer.from('data: {"error":"' + apiKey + '" invalid-json}\n\n')
      ])
    })
  })
  log.error = (...args) => {
    logged.push(args.map(value => {
      if (value instanceof Error) return value.stack || value.message
      return String(value)
    }).join(' '))
  }

  delete require.cache[aiPath]
  const { AIchat, getStreamContent } = require(aiPath)

  try {
    const result = await AIchat(
      'hello',
      'test-model',
      'system',
      'https://relay.example.com/v1',
      '',
      apiKey,
      '',
      true,
      'Authorization: Bearer'
    )

    let streamState
    for (let index = 0; index < 20; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
      streamState = getStreamContent(result.sessionId)
      if (!streamState.hasMore || streamState.error) break
    }

    assert.doesNotMatch(JSON.stringify(streamState), /sk-malformed-stream-secret|invalid-json|JSON\.parse/)
    assert.doesNotMatch(logged.join('\n'), /sk-malformed-stream-secret|invalid-json|JSON\.parse/)
  } finally {
    axios.create = originalCreate
    log.error = originalError
    delete require.cache[aiPath]
  }
})
