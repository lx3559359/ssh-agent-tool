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

test('AI model status reports real tested state instead of configured-only state', async () => {
  const {
    getAIModelStatus
  } = await import(profilesUrl)

  assert.equal(getAIModelStatus({}).status, 'unconfigured')
  assert.equal(getAIModelStatus({
    baseURLAI: 'https://api.example.com',
    apiKeyAI: 'sk-example'
  }).status, 'pending')
  assert.equal(getAIModelStatus({
    baseURLAI: 'https://api.example.com',
    apiKeyAI: 'sk-example',
    aiStatus: 'available',
    aiStatusMessage: '测试连接成功'
  }).label, '可用')
  assert.equal(getAIModelStatus({
    baseURLAI: 'https://api.example.com',
    apiKeyAI: 'sk-example',
    aiStatus: 'error',
    aiStatusMessage: '模型不存在'
  }).label, '异常')
})

test('AI profiles persist fetched model lists and expose model switch options', async () => {
  const {
    upsertAIProfile,
    getAIModelOptions
  } = await import(profilesUrl)

  const config = upsertAIProfile({}, {
    id: 'aigh',
    nameAI: 'Aigh',
    baseURLAI: 'https://api.aigh.store',
    apiKeyAI: 'sk-aigh',
    modelAI: 'grok-4',
    modelOptionsAI: ['grok-3', 'grok-4', 'grok-4-fast-reasoning', 'grok-4']
  })

  assert.deepEqual(
    getAIModelOptions(config).map(item => item.value),
    ['grok-3', 'grok-4', 'grok-4-fast-reasoning']
  )
  assert.deepEqual(config.aiProfiles[0].modelOptionsAI, [
    'grok-3',
    'grok-4',
    'grok-4-fast-reasoning'
  ])
})

test('AI profile selector shows only config names while model selector keeps models', async () => {
  const {
    upsertAIProfile,
    getAIProfileOptions,
    getAIModelOptions
  } = await import(profilesUrl)

  const config = upsertAIProfile({}, {
    id: 'aigh',
    nameAI: '中转站',
    baseURLAI: 'https://api.aigh.store',
    apiKeyAI: 'sk-aigh',
    modelAI: 'grok-4-fast-reasoning'
  })

  assert.deepEqual(getAIProfileOptions(config), [
    { value: 'aigh', label: '中转站' }
  ])
  assert.deepEqual(getAIModelOptions(config), [
    { value: 'grok-4-fast-reasoning', label: 'grok-4-fast-reasoning' }
  ])
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
  const sidePanelSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/side-panel-r/side-panel-r.jsx'),
    'utf8'
  )

  assert.match(modalSource, /migrateAIProfiles/)
  assert.match(configSource, /activeAIProfileId/)
  assert.match(configSource, /handleAddProfile/)
  assert.match(configSource, /handleProfileChange/)
  assert.match(configSource, /saveProfileStatus/)
  assert.match(configSource, /aiStatus/)
  assert.match(configSource, /modelOptionsAI/)
  assert.match(configSource, /AI 使用说明/)
  assert.match(configSource, /拉取模型/)
  assert.doesNotMatch(configSource, /ai-config-field-guide/)
  assert.match(configSource, /管理多组 API \/ 中转站配置/)
  assert.match(configSource, /快速填入常见官方模型或中转站地址/)
  assert.match(configSource, /给当前 API 起一个便于识别的名字/)
  assert.match(configSource, /可填写基础地址/)
  assert.match(configSource, /特殊网关才需要手动指定路径/)
  assert.match(configSource, /不同服务商和中转站的 Key 需要分别配置/)
  assert.match(configSource, /仅影响模型 API 网络请求/)
  assert.match(chatSource, /getActiveAIConfig/)
  assert.doesNotMatch(chatSource, /handleActiveAIProfileChange/)
  assert.doesNotMatch(chatSource, /className='ai-profile-select'/)
  assert.match(sidePanelSource, /getActiveAIConfig/)
  assert.match(sidePanelSource, /getAIProfileOptions/)
  assert.match(sidePanelSource, /getAIModelOptions/)
  assert.match(sidePanelSource, /getAIModelStatus/)
  assert.match(sidePanelSource, /handleActiveAIProfileChange/)
  assert.match(sidePanelSource, /handleActiveAIModelChange/)
  assert.match(sidePanelSource, /right-panel-ai-profile-select/)
  assert.match(sidePanelSource, /right-panel-ai-model-select/)
  assert.match(sidePanelSource, /right-panel-model-status/)
})
