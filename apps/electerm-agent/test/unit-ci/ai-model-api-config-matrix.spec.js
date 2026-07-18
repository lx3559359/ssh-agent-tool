const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readTest (name) {
  return fs.readFileSync(path.resolve(__dirname, name), 'utf8')
}

function readSource (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src', relativePath), 'utf8')
}

function assertEvidence (source, pattern, label) {
  assert.match(source, pattern, `Missing model API config evidence: ${label}`)
}

test('P1 model API config matrix covers providers model loading and flexible endpoint paths', () => {
  const aiConfig = readSource('client/components/ai/ai-config.jsx')
  const aiModelsTest = readTest('ai-models.spec.js')
  const aiEndpointTest = readTest('ai-endpoint.spec.js')
  const aiConfigRequiredTest = readTest('ai-config-required.spec.js')
  const aiConfigPresetsTest = readTest('ai-config-presets.spec.js')
  const aiBackend = readSource('app/lib/ai.js')

  assertEvidence(aiConfig, /value:\s*'custom-openai-compatible'[\s\S]*baseURLAI:\s*'https:\/\/api\.example\.com'/, 'custom OpenAI-compatible relay preset')
  assertEvidence(aiConfig, /value:\s*'openai'[\s\S]*baseURLAI:\s*'https:\/\/api\.openai\.com\/v1'/, 'OpenAI preset')
  assertEvidence(aiConfig, /value:\s*'deepseek'[\s\S]*baseURLAI:\s*'https:\/\/api\.deepseek\.com'/, 'DeepSeek preset')
  assertEvidence(aiConfig, /value:\s*'dashscope'[\s\S]*baseURLAI:\s*'https:\/\/dashscope\.aliyuncs\.com\/compatible-mode\/v1'/, 'Tongyi DashScope preset')
  assertEvidence(aiConfig, /value:\s*'bigmodel'[\s\S]*baseURLAI:\s*'https:\/\/open\.bigmodel\.cn\/api\/paas\/v4'/, 'Zhipu GLM preset')
  assertEvidence(aiConfig, /value:\s*'moonshot'[\s\S]*baseURLAI:\s*'https:\/\/api\.moonshot\.cn\/v1'/, 'Moonshot preset')
  assertEvidence(aiConfig, /value:\s*'siliconflow'[\s\S]*baseURLAI:\s*'https:\/\/api\.siliconflow\.cn\/v1'/, 'SiliconFlow preset')
  assertEvidence(aiConfig, /value:\s*'openrouter'[\s\S]*baseURLAI:\s*'https:\/\/openrouter\.ai\/api\/v1'/, 'OpenRouter preset')
  assertEvidence(aiConfig, /handleLoadModels[\s\S]*'AIModels'[\s\S]*profile\.baseURLAI[\s\S]*profile\.apiKeyAI/, 'model list loading action')
  assertEvidence(aiConfig, /className='sp-ai-config-advanced-fields'[\s\S]*name='apiPathAI'/, 'optional API path input in advanced settings')
  assertEvidence(aiEndpointTest, /normalizes relay root URL to OpenAI-compatible chat endpoint/, 'relay root URL normalization')
  assertEvidence(aiEndpointTest, /accepts a full chat completions URL in the API address field/, 'full chat completions URL accepted')
  assertEvidence(aiEndpointTest, /explicit API path is optional but respected when provided/, 'explicit path optional but respected')
  assertEvidence(aiModelsTest, /normalizes model list responses from common providers and relays/, 'common model list response parsing')
  assertEvidence(aiModelsTest, /returns built-in models for required official providers when their model list is empty/, 'official provider model fallback')
  assertEvidence(aiConfigRequiredTest, /does not require optional model role endpoint path or auth header before sending/, 'optional fields do not block chat')
  assertEvidence(aiConfigPresetsTest, /xAI Grok provider preset/, 'additional popular model preset coverage')
  assertEvidence(aiBackend, /normalizeAIModelBaseURL/, 'model list endpoint normalization')
})
