const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const fs = require('node:fs')

test('AI chat requires only API address and API key before sending', async () => {
  const {
    isAIConfigMissing
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-config-props.js')))

  assert.equal(isAIConfigMissing({
    baseURLAI: 'https://api.aigh.store',
    apiKeyAI: 'sk-example',
    modelAI: '',
    roleAI: '',
    apiPathAI: '',
    authHeaderNameAI: '',
    proxyAI: '',
    nameAI: ''
  }), false)

  assert.equal(isAIConfigMissing({
    baseURLAI: 'https://api.aigh.store',
    apiKeyAI: ''
  }), true)

  assert.equal(isAIConfigMissing({
    baseURLAI: '',
    apiKeyAI: 'sk-example'
  }), true)
})

test('AI config modal title is localized for Chinese users', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/ai-config-modal.jsx'), 'utf8')

  assert.match(source, /title='模型 API 配置'/)
  assert.doesNotMatch(source, /title='AI Config'/)
})
