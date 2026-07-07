const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

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
