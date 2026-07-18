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

test('AI profile migration clears the legacy built-in SSH operations role', async () => {
  const {
    migrateAIProfiles
  } = await import(profilesUrl)

  const config = migrateAIProfiles({
    nameAI: '旧版配置',
    baseURLAI: 'https://api.example.com/v1',
    apiKeyAI: 'sk-example',
    roleAI: 'SSH 运维专家，优先排查服务器、网络、日志、进程、端口、磁盘、内存、Nginx、Docker 和部署问题。回答使用中文和 Markdown。'
  })

  assert.equal(config.roleAI, '')
  assert.equal(config.aiProfiles[0].roleAI, '')
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

  const zh = key => ({
    shellpilotAiUnconfigured: '未配置',
    shellpilotAiStale: '待重新检测',
    shellpilotAiAvailable: '可用',
    shellpilotAiNetworkError: '网络异常'
  })[key] || key
  assert.equal(getAIModelStatus({}, zh).status, 'unconfigured')
  assert.equal(getAIModelStatus({
    baseURLAI: 'https://api.example.com',
    apiKeyAI: 'sk-example'
  }, zh).status, 'stale')
  assert.equal(getAIModelStatus({
    baseURLAI: 'https://api.example.com',
    apiKeyAI: 'sk-example',
    aiStatus: 'available',
    aiStatusMessage: '测试连接成功'
  }, zh).label, '可用')
  assert.equal(getAIModelStatus({
    baseURLAI: 'https://api.example.com',
    apiKeyAI: 'sk-example',
    aiStatus: 'error',
    aiStatusMessage: '模型不存在'
  }, zh).label, '网络异常')
})

test('AI model status includes latency, last check and failure details', async () => {
  const { getAIModelStatus } = await import(profilesUrl)
  const config = {
    baseURLAI: 'https://api.example.com',
    apiKeyAI: 'sk-example',
    modelAI: 'model-a'
  }
  const checkedAt = Date.now()
  const available = getAIModelStatus(config, key => key, {
    status: 'available',
    latencyMs: 126,
    checkedAt,
    message: '检测成功'
  })
  assert.equal(available.latencyMs, 126)
  assert.equal(available.checkedAt, checkedAt)
  assert.match(available.title, /响应 126 ms/)
  assert.match(available.title, /最近检测/)

  const failed = getAIModelStatus(config, key => key, {
    status: 'network-error',
    latencyMs: 8001,
    checkedAt,
    message: '连接超时'
  })
  assert.equal(failed.failureReason, '连接超时')
  assert.match(failed.title, /连接超时/)

  const unconfigured = getAIModelStatus({}, key => key)
  assert.equal(unconfigured.latencyMs, null)

  const unchecked = getAIModelStatus(config, key => key, {
    status: 'stale',
    latencyMs: null
  })
  assert.equal(unchecked.latencyMs, null)
  assert.doesNotMatch(unchecked.title, /响应 0 ms/)
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

test('AI profile migration restores technical name fallbacks without persisting localized display copy', async () => {
  const {
    migrateAIProfiles,
    getAIProfileOptions
  } = await import(profilesUrl)
  const source = {
    activeAIProfileId: 'model-profile',
    aiProfiles: [
      {
        id: 'model-profile',
        nameAI: '',
        modelAI: 'deepseek-chat',
        baseURLAI: 'https://api.deepseek.com'
      },
      {
        id: 'url-profile',
        nameAI: '   ',
        modelAI: '',
        baseURLAI: 'https://relay.example.com/v1'
      },
      {
        id: 'empty-profile',
        nameAI: '',
        modelAI: '',
        baseURLAI: ''
      }
    ]
  }
  const migrated = migrateAIProfiles(source)
  const translate = language => key => ({
    zh_cn: { shellpilotAiDefaultConfiguration: 'AI 配置' },
    en_us: { shellpilotAiDefaultConfiguration: 'AI Configuration' }
  })[language][key] || key

  assert.deepEqual(
    migrated.aiProfiles.map(profile => profile.nameAI),
    ['deepseek-chat', 'https://relay.example.com/v1', '']
  )
  assert.deepEqual(
    getAIProfileOptions(migrated, translate('zh_cn')).map(option => option.label),
    ['deepseek-chat', 'https://relay.example.com/v1', 'AI 配置']
  )
  assert.deepEqual(
    getAIProfileOptions(migrated, translate('en_us')).map(option => option.label),
    ['deepseek-chat', 'https://relay.example.com/v1', 'AI Configuration']
  )
  assert.equal(migrated.aiProfiles[2].nameAI, '')
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
    path.resolve(__dirname, '../../src/client/components/side-panel-r/right-side-panel-ai-header.jsx'),
    'utf8'
  )

  assert.match(modalSource, /migrateAIProfiles/)
  assert.match(configSource, /activeAIProfileId/)
  assert.match(configSource, /handleAddProfile/)
  assert.match(configSource, /handleProfileChange/)
  assert.match(configSource, /saveProfileStatus/)
  assert.match(configSource, /aiStatus/)
  assert.match(configSource, /modelOptionsAI/)
  assert.match(configSource, /shellpilotAiQuickSetup/)
  assert.match(configSource, /shellpilotAiQuickSetupDescription/)
  assert.match(configSource, /shellpilotAiLoadModels/)
  assert.doesNotMatch(configSource, /ai-config-field-guide/)
  assert.match(configSource, /shellpilotAiApiConfigurationExtra/)
  assert.match(configSource, /shellpilotAiProviderTemplateExtra/)
  assert.match(configSource, /shellpilotAiConfigurationNameExtra/)
  assert.match(configSource, /shellpilotAiApiAddressHelp/)
  assert.match(configSource, /shellpilotAiApiPathHelp/)
  assert.match(configSource, /shellpilotAiApiKeyExtra/)
  assert.match(configSource, /shellpilotAiProxyExtra/)
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

test('AI health fingerprint sanitizes API path secrets and tracks auth semantics', async () => {
  const { getAIStatusFingerprint } = await import(profilesUrl)
  const base = {
    baseURLAI: 'https://relay.example.com/v1',
    modelAI: 'model-a',
    proxyAI: '',
    credentialRevisionAI: 'revision-1'
  }
  const first = getAIStatusFingerprint({
    ...base,
    apiPathAI: 'https://path-user:path-secret@relay.example.com/chat?api_key=query-secret&mode=fast',
    authHeaderNameAI: 'Authorization: Bearer header-secret'
  })
  const sameSemantics = getAIStatusFingerprint({
    ...base,
    apiPathAI: 'https://other-user:other-secret@relay.example.com/chat?api_key=other-query-secret&mode=fast',
    authHeaderNameAI: 'Authorization: Bearer other-header-secret'
  })
  const differentHeader = getAIStatusFingerprint({
    ...base,
    apiPathAI: 'https://third-user:third-secret@relay.example.com/chat?token=ignored&mode=fast',
    authHeaderNameAI: 'x-api-key: should-not-appear'
  })

  assert.equal(first, sameSemantics)
  assert.notEqual(first, differentHeader)
  assert.doesNotMatch(
    first + sameSemantics + differentHeader,
    /path-user|path-secret|query-secret|other-secret|header-secret|should-not-appear/
  )
})

test('AI health fingerprints strip common URL credentials and rotate credential revisions', async () => {
  const {
    getAIStatusFingerprint,
    withAICredentialRevision
  } = await import(profilesUrl)
  const fingerprint = getAIStatusFingerprint({
    baseURLAI: 'https://user:password@relay.example.com/v1?sig=secret-a&credential=secret-b&pass=secret-c&pwd=secret-d&mode=fast#access_token=fragment-secret',
    apiPathAI: '/chat?token=secret-e&view=full',
    modelAI: 'model-a',
    credentialRevisionAI: 'revision-1'
  })
  assert.doesNotMatch(
    fingerprint,
    /user|password|secret-a|secret-b|secret-c|secret-d|secret-e|fragment-secret/
  )

  const previous = withAICredentialRevision({
    apiKeyAI: 'sk-same',
    baseURLAI: 'https://relay.example.com/v1?sig=old-secret',
    proxyAI: 'http://proxy-user:old-password@proxy.example.com'
  }, undefined, () => 'revision-1')
  const next = withAICredentialRevision({
    ...previous,
    baseURLAI: 'https://relay.example.com/v1?sig=new-secret',
    proxyAI: 'http://proxy-user:new-password@proxy.example.com'
  }, previous, () => 'revision-2')
  assert.equal(previous.credentialRevisionAI, 'revision-1')
  assert.equal(next.credentialRevisionAI, 'revision-2')
})
test('MCP changes rotate credential revisions without persisting MCP secrets', async () => {
  const { withAICredentialRevision } = await import(profilesUrl)
  const previous = withAICredentialRevision({
    apiKeyAI: 'sk-same',
    mcpServers: [{ id: 'mcp-a', env: { TOKEN: 'old-secret' } }]
  }, undefined, () => 'revision-1')
  const next = withAICredentialRevision({
    ...previous,
    mcpServers: [{ id: 'mcp-a', env: { TOKEN: 'new-secret' } }]
  }, previous, () => 'revision-2')

  assert.equal(previous.credentialRevisionAI, 'revision-1')
  assert.equal(next.credentialRevisionAI, 'revision-2')
})

test('AI health fingerprint fallback removes fragments from malformed URLs', async () => {
  const { getAIStatusFingerprint } = await import(profilesUrl)
  const fingerprint = getAIStatusFingerprint({
    baseURLAI: 'https://invalid host/path?mode=fast#access_token=fragment-secret',
    modelAI: 'model-a',
    credentialRevisionAI: 'revision-1'
  })

  assert.doesNotMatch(fingerprint, /fragment-secret|access_token/)
})

test('AI status fingerprints never persist raw endpoint or proxy values', async () => {
  const { getAIStatusFingerprint } = await import(profilesUrl)
  const fingerprint = getAIStatusFingerprint({
    baseURLAI: 'https://relay.example.com/private-path-token/v1?code=unknown-query-secret',
    apiPathAI: '/chat/private-api-token/completions?api-version=2026-01-01',
    proxyAI: 'http://proxy-user:proxy-pass@proxy.example.com/private-proxy-token',
    modelAI: 'model-a',
    credentialRevisionAI: 'revision-1'
  })

  assert.doesNotMatch(
    fingerprint,
    /relay\.example|private-path-token|unknown-query-secret|private-api-token|proxy-user|proxy-pass|private-proxy-token/
  )
})
test('credential-aware profile upserts rotate revisions on every persistence path', async () => {
  const { upsertAIProfileWithCredentialRevision } = await import(profilesUrl)
  let config = upsertAIProfileWithCredentialRevision({}, {
    id: 'profile-a',
    nameAI: 'Relay',
    apiKeyAI: 'sk-first',
    baseURLAI: 'https://relay.example.com/v1'
  }, () => 'revision-1')
  assert.equal(config.credentialRevisionAI, 'revision-1')

  config = upsertAIProfileWithCredentialRevision(config, {
    ...config,
    apiKeyAI: 'sk-second'
  }, () => 'revision-2')
  assert.equal(config.credentialRevisionAI, 'revision-2')
  assert.equal(config.aiProfiles[0].credentialRevisionAI, 'revision-2')
})
test('a credential change keeps one revision from health check through status persistence', async () => {
  const {
    getAIStatusFingerprint,
    upsertAIProfile,
    withAICredentialRevision
  } = await import(profilesUrl)
  const previous = {
    id: 'profile-a',
    apiKeyAI: 'sk-old',
    baseURLAI: 'https://relay.example.com/v1',
    modelAI: 'model-a',
    credentialRevisionAI: 'revision-old'
  }
  const config = {
    ...previous,
    activeAIProfileId: previous.id,
    aiProfiles: [previous]
  }
  let revisionCount = 0
  const createRevision = () => `revision-${++revisionCount}`
  const checkedProfile = withAICredentialRevision({
    ...previous,
    apiKeyAI: 'sk-new'
  }, previous, createRevision)
  const checkedFingerprint = getAIStatusFingerprint(checkedProfile)
  const saved = upsertAIProfile(config, {
    ...checkedProfile,
    aiStatus: 'available',
    aiStatusFingerprint: checkedFingerprint
  })
  const repeatedCheck = withAICredentialRevision(
    saved.aiProfiles[0],
    saved.aiProfiles[0],
    createRevision
  )
  const editedAgain = withAICredentialRevision({
    ...repeatedCheck,
    apiKeyAI: 'sk-newer'
  }, saved.aiProfiles[0], createRevision)

  assert.equal(repeatedCheck.credentialRevisionAI, checkedProfile.credentialRevisionAI)
  assert.equal(saved.aiStatusFingerprint, getAIStatusFingerprint(saved))
  assert.equal(revisionCount, 2)
  assert.equal(editedAgain.credentialRevisionAI, 'revision-2')
})
test('AI profile request guard rejects stale edits and profile switches', async () => {
  const { isAIProfileRequestCurrent } = await import(profilesUrl)
  const requestProfile = {
    id: 'profile-a',
    activeAIProfileId: 'profile-a',
    nameAI: 'Relay A',
    baseURLAI: 'https://relay.example.com/v1',
    apiPathAI: '/chat/completions',
    apiKeyAI: 'request-secret',
    authHeaderNameAI: 'Authorization: Bearer',
    proxyAI: 'http://proxy.example.com',
    modelAI: 'model-a',
    credentialRevisionAI: 'revision-a'
  }

  assert.equal(isAIProfileRequestCurrent(requestProfile, requestProfile), true)
  assert.equal(isAIProfileRequestCurrent(requestProfile, {
    ...requestProfile,
    apiKeyAI: 'edited-secret'
  }), false)
  assert.equal(isAIProfileRequestCurrent(requestProfile, {
    ...requestProfile,
    baseURLAI: 'https://other.example.com/v1'
  }), false)
  assert.equal(isAIProfileRequestCurrent(requestProfile, {
    ...requestProfile,
    modelAI: 'model-b'
  }), false)
  assert.equal(isAIProfileRequestCurrent(requestProfile, {
    ...requestProfile,
    id: 'profile-b',
    activeAIProfileId: 'profile-b'
  }), false)
  assert.equal(isAIProfileRequestCurrent(requestProfile, {
    ...requestProfile,
    credentialRevisionAI: 'revision-b'
  }), false)
})
