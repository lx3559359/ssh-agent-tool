const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const profilesUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/ai-profiles.js')
).href

test('migrates old single AI config into one active profile without losing fields', async () => {
  const {
    migrateAIProfiles,
    getActiveAIConfig
  } = await import(profilesUrl)

  const config = migrateAIProfiles({
    nameAI: 'Aigh自定义中转站',
    baseURLAI: 'https://api.aigh.store',
    apiKeyAI: 'sk-example',
    modelAI: 'grok-4-fast-reasoning',
    apiPathAI: '',
    roleAI: 'SSH 运维专家'
  })

  assert.equal(config.aiProfiles.length, 1)
  assert.equal(config.activeAIProfileId, config.aiProfiles[0].id)
  assert.equal(config.aiProfiles[0].baseURLAI, 'https://api.aigh.store')
  assert.equal(config.aiProfiles[0].modelAI, 'grok-4-fast-reasoning')

  const active = getActiveAIConfig(config)
  assert.equal(active.baseURLAI, 'https://api.aigh.store')
  assert.equal(active.apiKeyAI, 'sk-example')
})

test('upserts multiple AI profiles and switches active profile by id', async () => {
  const {
    migrateAIProfiles,
    upsertAIProfile,
    getActiveAIConfig
  } = await import(profilesUrl)

  let config = migrateAIProfiles({})
  config = upsertAIProfile(config, {
    id: 'deepseek',
    nameAI: 'DeepSeek',
    baseURLAI: 'https://api.deepseek.com',
    apiKeyAI: 'sk-deepseek',
    modelAI: 'deepseek-chat'
  })
  config = upsertAIProfile(config, {
    id: 'aigh',
    nameAI: 'Aigh中转站',
    baseURLAI: 'https://api.aigh.store',
    apiKeyAI: 'sk-aigh',
    modelAI: 'grok-4-fast-reasoning'
  })
  config.activeAIProfileId = 'aigh'

  assert.equal(config.aiProfiles.length, 2)
  assert.equal(getActiveAIConfig(config).nameAI, 'Aigh中转站')
  assert.equal(getActiveAIConfig(config).modelAI, 'grok-4-fast-reasoning')
})

test('removes active AI profile and falls back to the next available profile', async () => {
  const {
    removeAIProfile
  } = await import(profilesUrl)

  const config = removeAIProfile({
    activeAIProfileId: 'aigh',
    aiProfiles: [
      { id: 'deepseek', nameAI: 'DeepSeek', baseURLAI: 'https://api.deepseek.com', apiKeyAI: 'sk' },
      { id: 'aigh', nameAI: 'Aigh中转站', baseURLAI: 'https://api.aigh.store', apiKeyAI: 'sk' }
    ]
  }, 'aigh')

  assert.equal(config.aiProfiles.length, 1)
  assert.equal(config.activeAIProfileId, 'deepseek')
})

test('AI config modal and chat are wired to active AI profile selection', () => {
  const modalSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-config-modal.jsx'),
    'utf8'
  )
  const configSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-config.jsx'),
    'utf8'
  )
  const chatSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat.jsx'),
    'utf8'
  )

  assert.match(modalSource, /migrateAIProfiles/)
  assert.match(configSource, /activeAIProfileId/)
  assert.match(configSource, /handleAddProfile/)
  assert.match(configSource, /handleProfileChange/)
  assert.match(chatSource, /getActiveAIConfig/)
  assert.match(chatSource, /handleActiveAIProfileChange/)
})
