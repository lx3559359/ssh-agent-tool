const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  normalizeAIEndpoint,
  normalizeAIModelBaseURL
} = require(path.resolve(__dirname, '../../src/app/common/ai-endpoint'))

test('normalizes relay root URL to OpenAI-compatible chat endpoint', () => {
  assert.deepEqual(
    normalizeAIEndpoint('https://api.aigh.store', ''),
    {
      baseURL: 'https://api.aigh.store/v1',
      path: '/chat/completions'
    }
  )
})

test('keeps DeepSeek official root URL without forcing /v1', () => {
  assert.deepEqual(
    normalizeAIEndpoint('https://api.deepseek.com', ''),
    {
      baseURL: 'https://api.deepseek.com',
      path: '/chat/completions'
    }
  )
})

test('accepts a full chat completions URL in the API address field', () => {
  assert.deepEqual(
    normalizeAIEndpoint('https://openrouter.ai/api/v1/chat/completions', ''),
    {
      baseURL: 'https://openrouter.ai/api/v1',
      path: '/chat/completions'
    }
  )
})

test('explicit API path is optional but respected when provided', () => {
  assert.deepEqual(
    normalizeAIEndpoint('https://api.example.com/custom', 'chat/completions'),
    {
      baseURL: 'https://api.example.com/custom',
      path: '/chat/completions'
    }
  )
})

test('normalizes model list URL for relay root URL', () => {
  assert.equal(
    normalizeAIModelBaseURL('https://api.aigh.store'),
    'https://api.aigh.store/v1'
  )
})
