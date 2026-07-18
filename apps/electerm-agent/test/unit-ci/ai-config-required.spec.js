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

test('does not require optional model role endpoint path or auth header before sending', async () => {
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
    languageAI: '',
    proxyAI: '',
    nameAI: ''
  }), false)
})

test('AI config modal title is localized for Chinese users', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/ai-config-modal.jsx'), 'utf8')

  assert.match(source, /title=\{e\('shellpilotAiConfigTitle'\)\}/)
  assert.doesNotMatch(source, /title='AI Config'/)
})

test('AI config test connection validates only API address and key', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/ai-config.jsx'), 'utf8')
  const handleTestStart = source.indexOf('const handleTest = async () => {')
  const handleLoadModelsStart = source.indexOf('const handleLoadModels = async () => {')
  const handleTestSource = source.slice(handleTestStart, handleLoadModelsStart)

  assert.match(handleTestSource, /validateFields\(\[\s*'baseURLAI',\s*'apiKeyAI'\s*\]\)/)
  assert.doesNotMatch(handleTestSource, /validateFields\(\)/)
})

test('AI config keeps only address key model and save in the primary section', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/ai-config.jsx'), 'utf8')
  const primaryStart = source.indexOf("className='sp-ai-config-primary-fields'")
  const advancedStart = source.indexOf("className='sp-ai-config-advanced-fields'")
  const primarySource = source.slice(primaryStart, advancedStart)
  const advancedSource = source.slice(advancedStart)

  assert.ok(primaryStart > -1, 'primary AI fields must be explicit')
  assert.ok(advancedStart > primaryStart, 'advanced AI fields must follow the primary fields')
  assert.match(primarySource, /name='baseURLAI'/)
  assert.match(primarySource, /name='apiKeyAI'/)
  assert.match(primarySource, /name='modelAI'/)
  assert.match(primarySource, /htmlType='submit'/)
  assert.doesNotMatch(primarySource, /name='apiPathAI'/)
  assert.doesNotMatch(primarySource, /name='authHeaderNameAI'/)
  assert.doesNotMatch(primarySource, /name='roleAI'/)
  assert.match(advancedSource, /name='apiPathAI'/)
  assert.match(advancedSource, /name='authHeaderNameAI'/)
  assert.match(source, /shellpilotAiAdvancedOptions/)
})
