const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../../src/client/components')
const coordinatorUrl = pathToFileURL(
  path.join(root, 'ai/ai-health-coordinator.js')
).href

function source (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('chat health transition observer reports real success and disappearance failures once', async () => {
  const { resolveAIChatHealthTransitions } = await import(coordinatorUrl)
  const tracked = new Map([
    ['success', { key: 'profile::model-a', seen: true }],
    ['failed', { key: 'profile::model-b', seen: true }],
    ['new', { key: 'profile::model-c', seen: false }]
  ])
  const result = resolveAIChatHealthTransitions([
    { id: 'success', response: '真实回复', completionStatus: 'completed' },
    { id: 'new', response: '', completionStatus: 'pending' }
  ], tracked)

  assert.deepEqual(result.updates, [
    { id: 'success', key: 'profile::model-a', ok: true },
    { id: 'failed', key: 'profile::model-b', ok: false, status: 'network-error' }
  ])
  assert.equal(result.tracked.has('success'), false)
  assert.equal(result.tracked.has('failed'), false)
  assert.equal(result.tracked.get('new').seen, true)
})

test('right AI panel automatically checks current selection and offers compact manual refresh', () => {
  const panel = source('side-panel-r/side-panel-r.jsx')
  const style = source('side-panel-r/right-side-panel.styl')

  assert.match(panel, /aiHealthCoordinator/)
  assert.match(panel, /useEffect/)
  assert.match(panel, /aiHealthCoordinator\.schedule\(activeAIConfig\)/)
  assert.match(panel, /return \(\) => \{[\s\S]*unsubscribe\(\)[\s\S]*cancelCheck\(\)/)
  assert.match(panel, /aiHealthCoordinator\.checkNow\(activeAIConfig, \{ force: true \}\)/)
  assert.match(panel, /ReloadOutlined/)
  assert.match(panel, /getAIModelStatus\(activeAIConfig, e, aiHealthState\)/)
  assert.match(panel, /role='button'/)
  assert.match(style, /&\.checking/)
  assert.match(style, /&\.reachable/)
  assert.match(style, /&\.auth-error/)
  assert.match(style, /&\.model-error/)
  assert.match(style, /&\.quota-error/)
  assert.match(style, /&\.network-error/)
  assert.match(style, /&\.stale/)
})

test('AI configuration uses health contract and never marks model-list loading as available', () => {
  const config = source('ai/ai-config.jsx')
  const loadModels = config.match(/const handleLoadModels = async \(\) => \{[\s\S]*?\n {2}\}/)?.[0] || ''
  const saveStatus = config.match(/function saveProfileStatus \([\s\S]*?\n {2}\}/)?.[0] || ''
  const persistedProfile = config.match(/function getPersistedProfile \([\s\S]*?\n {2}\}/)?.[0] || ''

  assert.match(config, /aiHealthCoordinator\.checkNow/)
  assert.match(config, /withAICredentialRevision/)
  assert.match(config, /credentialRevisionAI/)
  assert.match(loadModels, /withAICredentialRevision/)
  assert.match(loadModels, /recordHealthResult/)
  assert.match(loadModels, /status: 'reachable'/)
  assert.doesNotMatch(loadModels, /saveProfileStatus\('available'/)
  assert.match(saveStatus, /upsertAIProfile\(/)
  assert.doesNotMatch(saveStatus, /upsertAIProfileWithCredentialRevision/)
  assert.match(persistedProfile, /values\.aiProfiles/)
  assert.doesNotMatch(persistedProfile, /initialValues/)
  assert.doesNotMatch(config, /runGlobalAsync\(\s*'AIchat',[\s\S]*shellpilotAiTestPrompt/)
})

test('AI configuration discards stale async results before mutating the form', () => {
  const config = source('ai/ai-config.jsx')
  const handleTestStart = config.indexOf('const handleTest = async () => {')
  const loadModelsStart = config.indexOf('const handleLoadModels = async () => {')
  const loadModelsEnd = config.indexOf('function handleSelectHistory', loadModelsStart)
  const handleTest = config.slice(handleTestStart, loadModelsStart)
  const loadModels = config.slice(loadModelsStart, loadModelsEnd)

  assert.ok(config.includes('profileRequestGenerationRef = useRef(0)'))
  assert.ok(config.includes('isAIProfileRequestCurrent'))
  assert.ok(handleTest.includes('requestGeneration = ++profileRequestGenerationRef.current'))
  assert.ok(handleTest.includes('isProfileRequestCurrent(profile, requestGeneration)'))
  assert.ok(loadModels.includes('requestGeneration = ++profileRequestGenerationRef.current'))
  assert.ok(loadModels.includes('isProfileRequestCurrent(profile, requestGeneration)'))
  assert.ok(
    handleTest.indexOf('isProfileRequestCurrent(profile, requestGeneration)') <
      handleTest.indexOf('saveProfileStatus(')
  )
  assert.ok(
    loadModels.indexOf('isProfileRequestCurrent(profile, requestGeneration)') <
      loadModels.indexOf('setModelOptions(options)')
  )
  assert.match(handleTest, /finally\s*\{\s*setTesting\(false\)\s*\}/)
  assert.match(loadModels, /finally\s*\{\s*setLoadingModels\(false\)\s*\}/)
  assert.match(loadModels, /saveProfileStatus\(res\.status \|\| 'network-error'/)
})
test('AI chat feeds actual history completion back to the shared coordinator', () => {
  const chat = source('ai/ai-chat.jsx')

  assert.match(chat, /resolveAIChatHealthTransitions/)
  assert.match(chat, /getAIHealthRequestKey/)
  assert.match(chat, /recordChatStarted/)
  assert.match(chat, /recordChatResult/)
  assert.match(chat, /submittedHealthChecksRef/)
  assert.match(chat, /useEffect\(\(\) => \{[\s\S]*props\.aiChatHistory/)
})

test('health labels and hints are complete in Chinese and English', () => {
  const i18n = source('../common/shellpilot-i18n-overrides.js')
  const keys = [
    'shellpilotAiChecking',
    'shellpilotAiReachable',
    'shellpilotAiAuthError',
    'shellpilotAiModelError',
    'shellpilotAiQuotaError',
    'shellpilotAiNetworkError',
    'shellpilotAiStale',
    'shellpilotAiManualRecheck'
  ]

  for (const key of keys) {
    assert.equal(i18n.split(`${key}:`).length, 3, `${key} should exist in both catalogs`)
  }
})
