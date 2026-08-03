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

test('Agent limits are default-enabled controls in the advanced section only', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/ai-config.jsx'), 'utf8')
  const primaryStart = source.indexOf("className='sp-ai-config-primary-fields'")
  const advancedStart = source.indexOf("className='sp-ai-config-advanced-fields'")
  const primarySource = source.slice(primaryStart, advancedStart)
  const advancedSource = source.slice(advancedStart)
  const fields = [
    'maxDurationMinutes',
    'maxModelRequests',
    'maxToolCalls',
    'maxToolCallsPerTurn',
    'maxModelResponseMiB',
    'maxToolArgumentKiB',
    'maxToolResultMiB'
  ]

  assert.doesNotMatch(primarySource, /agentLimits/)
  assert.match(advancedSource, /shellpilotAiAgentLimitsDefaultEnabled/)
  assert.match(source, /InputNumber/)
  for (const field of fields) {
    assert.match(advancedSource, new RegExp(`name=\\{\\['agentLimits', '${field}'\\]\\}`))
  }
})

test('AI config presents the essential setup before optional provider guidance', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/ai-config.jsx'), 'utf8')
  const primaryStart = source.indexOf("className='sp-ai-config-primary-fields'")
  const providerStart = source.indexOf('{renderRecommendedProviders()}', primaryStart)
  const primarySource = source.slice(primaryStart, providerStart)

  assert.ok(primaryStart > -1)
  assert.ok(providerStart > primaryStart)
  assert.match(primarySource, /aria-labelledby='sp-ai-config-primary-title'/)
  assert.match(primarySource, /shellpilotAiEssentialSetup/)
  assert.match(primarySource, /shellpilotAiEssentialSetupDescription/)
  assert.deepEqual(
    [...primarySource.matchAll(/className='sp-ai-config-step'/g)].map(match => match.index).length,
    3
  )
  assert.ok(primarySource.indexOf("name='baseURLAI'") < primarySource.indexOf("name='apiKeyAI'"))
  assert.ok(primarySource.indexOf("name='apiKeyAI'") < primarySource.indexOf("name='modelAI'"))
})

test('unconfigured AI chat is a compact status with one API configuration action', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/ai-chat.jsx'), 'utf8')
  const start = source.indexOf("className='ai-chat-container ai-chat-unconfigured'")
  const end = source.indexOf('const handleKeyPress', start)
  const emptyState = source.slice(start, end)

  assert.ok(start > -1)
  assert.match(emptyState, /role='status'/)
  assert.match(emptyState, /aria-labelledby='ai-chat-unconfigured-title'/)
  assert.match(emptyState, /aria-describedby='ai-chat-unconfigured-description'/)
  assert.equal((emptyState.match(/<Button/g) || []).length, 1)
  assert.ok(emptyState.indexOf("className='ai-chat-unconfigured-status'") < emptyState.indexOf('<Button'))
  assert.ok(emptyState.indexOf('</div>') < emptyState.indexOf('<Button'))
  assert.match(emptyState, /onClick=\{toggleConfig\}/)
  assert.doesNotMatch(source, /autoCollapse/)
})

test('fresh installs do not present a provider or model before the user configures AI', () => {
  const clientDefaults = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/common/default-setting.js'),
    'utf8'
  )
  const appDefaults = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/common/default-setting.js'),
    'utf8'
  )

  for (const source of [clientDefaults, appDefaults]) {
    assert.match(source, /baseURLAI:\s*''/)
    assert.match(source, /modelAI:\s*''/)
  }
})

test('upgraded empty profiles do not retain the retired placeholder API as a real configuration', async () => {
  const {
    migrateAIProfiles
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/ai/ai-profiles.js')))

  const migrated = migrateAIProfiles({
    baseURLAI: 'https://api.atlascloud.ai/v1',
    modelAI: 'deepseek-chat',
    apiKeyAI: '',
    aiProfiles: []
  })

  assert.equal(migrated.baseURLAI, '')
  assert.equal(migrated.modelAI, '')
  assert.deepEqual(migrated.aiProfiles, [])
})

test('the AI status affordance opens model configuration when the API is missing', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/side-panel-r/right-side-panel-ai-header.jsx'),
    'utf8'
  )
  const handlerStart = source.indexOf('function handleManualAIHealthCheck ()')
  const handlerEnd = source.indexOf('function handleAIHealthKeyDown', handlerStart)
  const handlerSource = source.slice(handlerStart, handlerEnd)

  assert.match(handlerSource, /!activeAIConfig\.baseURLAI \|\| !activeAIConfig\.apiKeyAI/)
  assert.match(handlerSource, /window\.store\.toggleAIConfig\(\)/)
  assert.match(handlerSource, /aiHealthCoordinator\.checkNow/)
})
