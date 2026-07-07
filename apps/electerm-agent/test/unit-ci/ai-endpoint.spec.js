const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

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

test('preserves query parameters from a full chat completions URL', () => {
  assert.deepEqual(
    normalizeAIEndpoint('https://example.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2026-01-01', ''),
    {
      baseURL: 'https://example.openai.azure.com/openai/deployments/gpt-4o',
      path: '/chat/completions?api-version=2026-01-01'
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

test('normalizes popular provider root URLs to their OpenAI-compatible base paths', () => {
  const cases = [
    ['https://openrouter.ai', 'https://openrouter.ai/api/v1'],
    ['https://dashscope.aliyuncs.com', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
    ['https://open.bigmodel.cn', 'https://open.bigmodel.cn/api/paas/v4'],
    ['https://qianfan.baidubce.com', 'https://qianfan.baidubce.com/v2'],
    ['https://qianfan.bj.baidubce.com', 'https://qianfan.bj.baidubce.com/v2'],
    ['https://api.groq.com', 'https://api.groq.com/openai/v1'],
    ['https://generativelanguage.googleapis.com', 'https://generativelanguage.googleapis.com/v1beta/openai'],
    ['https://ark.cn-beijing.volces.com', 'https://ark.cn-beijing.volces.com/api/v3']
  ]

  for (const [input, expectedBaseURL] of cases) {
    assert.deepEqual(
      normalizeAIEndpoint(input, ''),
      {
        baseURL: expectedBaseURL,
        path: '/chat/completions'
      },
      input
    )
    assert.equal(normalizeAIModelBaseURL(input), expectedBaseURL, input)
  }
})

test('normalizes provider roots that use non-v1 OpenAI-compatible base paths', () => {
  const cases = [
    ['https://api.deepinfra.com', 'https://api.deepinfra.com/v1/openai'],
    ['https://api.fireworks.ai', 'https://api.fireworks.ai/inference/v1']
  ]

  for (const [input, expectedBaseURL] of cases) {
    assert.deepEqual(
      normalizeAIEndpoint(input, ''),
      {
        baseURL: expectedBaseURL,
        path: '/chat/completions'
      },
      input
    )
    assert.equal(normalizeAIModelBaseURL(input), expectedBaseURL, input)
  }
})

test('client endpoint preview uses the same popular provider root URL rules', async () => {
  const {
    normalizeAIEndpoint: normalizeClientAIEndpoint
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/ai-endpoint.js')))

  assert.deepEqual(
    normalizeClientAIEndpoint('https://openrouter.ai', ''),
    {
      baseURL: 'https://openrouter.ai/api/v1',
      path: '/chat/completions'
    }
  )
  assert.deepEqual(
    normalizeClientAIEndpoint('https://dashscope.aliyuncs.com', ''),
    {
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      path: '/chat/completions'
    }
  )
  assert.deepEqual(
    normalizeClientAIEndpoint('https://qianfan.baidubce.com', ''),
    {
      baseURL: 'https://qianfan.baidubce.com/v2',
      path: '/chat/completions'
    }
  )
})
