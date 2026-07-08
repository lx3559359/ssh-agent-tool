const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('AI chat does not require optional endpoint path or credentials before sending', async () => {
  const {
    isAIConfigMissing
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-config-props.js')))

  assert.equal(isAIConfigMissing({
    baseURLAI: 'https://api.aigh.store',
    modelAI: 'grok-4-1-fast-reasoning',
    roleAI: 'SSH 运维助手',
    apiPathAI: '',
    apiKeyAI: '',
    authHeaderNameAI: '',
    proxyAI: '',
    nameAI: ''
  }), false)
})
