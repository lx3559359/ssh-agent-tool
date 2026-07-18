const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const credentialsUrl = pathToFileURL(
  path.join(aiRoot, 'ai-request-credentials.js')
).href

function source (name) {
  return fs.readFileSync(path.join(aiRoot, name), 'utf8')
}

test('stored chat text redacts spaced API labels and authorization schemes', async () => {
  const { sanitizeAIStoredText } = await import(credentialsUrl)
  const sanitized = sanitizeAIStoredText([
    'API Key: fake-api-key-value',
    'Access Token = fake-access-token-value',
    'Client Secret: fake-client-secret-value',
    'Authorization: Token fake-authorization-token',
    'Authorization: Custom fake-custom-credential'
  ].join('\n'))

  assert.doesNotMatch(sanitized, /fake-(?:api|access|client|authorization|custom)/)
  assert.match(sanitized, /API Key=\[REDACTED\]/i)
  assert.match(sanitized, /Authorization:\s*Token\s+\[REDACTED\]/i)
  assert.match(sanitized, /Authorization:\s*Custom\s+\[REDACTED\]/i)
})

test('stored chat text redacts Chinese labels and fullwidth separators', async () => {
  const { sanitizeAIStoredText } = await import(credentialsUrl)
  const sanitized = sanitizeAIStoredText([
    'API密钥：fake-cn-api-secret',
    '密码＝fake-cn-password',
    '访问令牌: fake-cn-access-token',
    '客户端密钥：fake-cn-client-secret',
    'Authorization＝Token fake-cn-authorization-token'
  ].join('\n'))

  assert.doesNotMatch(sanitized, /fake-cn-/)
  assert.match(sanitized, /API密钥=\[REDACTED\]/)
  assert.match(sanitized, /密码=\[REDACTED\]/)
  assert.match(sanitized, /Authorization＝Token\s+\[REDACTED\]/i)
})

test('stream text sanitizer incrementally redacts secrets split across polls', async () => {
  const { createAIStoredTextAccumulator } = await import(credentialsUrl)
  const accumulator = createAIStoredTextAccumulator()

  const first = accumulator.sanitize('first line\nAuthorization: Bearer partial')
  const second = accumulator.sanitize(
    'first line\nAuthorization: Bearer partial-secret-value\nlast line',
    { final: true }
  )

  assert.match(first, /first line/)
  assert.doesNotMatch(second, /partial-secret-value/)
  assert.match(second, /Authorization:\s*Bearer\s+\[REDACTED\]/)
  assert.match(second, /last line/)
})

test('request credential references remain memory-only and serializable without secrets', async () => {
  const {
    clearAIRequestCredentials,
    createAIRequestCredentialReference,
    resolveAIRequestConfigForProfile
  } = await import(credentialsUrl)
  const apiKey = 'sk-history-must-never-persist'
  const config = {
    id: 'profile-a',
    activeAIProfileId: 'profile-a',
    credentialRevisionAI: 'revision-a',
    apiKeyAI: apiKey,
    aiProfiles: [
      { id: 'profile-a', credentialRevisionAI: 'revision-a', apiKeyAI: apiKey }
    ]
  }

  clearAIRequestCredentials()
  const reference = createAIRequestCredentialReference(config)
  assert.equal(
    resolveAIRequestConfigForProfile(
      reference.credentialTokenAI,
      reference.aiProfileId,
      reference.credentialRevisionAI,
      config
    ).apiKeyAI,
    apiKey
  )
  assert.doesNotMatch(JSON.stringify(reference), /sk-history|apiKeyAI/)

  clearAIRequestCredentials()
  assert.equal(
    resolveAIRequestConfigForProfile(
      reference.credentialTokenAI,
      reference.aiProfileId,
      reference.credentialRevisionAI,
      config
    ).apiKeyAI,
    apiKey
  )
  assert.equal(resolveAIRequestConfigForProfile('', '', '', config).apiKeyAI || '', '')
  assert.equal(
    resolveAIRequestConfigForProfile('', 'deleted-profile', 'revision-a', config).apiKeyAI || '',
    ''
  )
})

test('chat and configuration history sanitizers remove credentials and restore only current keys', async () => {
  const {
    restoreAIConfigHistoryCredentials,
    sanitizeAIChatHistory,
    sanitizeAIConfigHistory
  } = await import(credentialsUrl)
  const oldSecret = 'sk-old-history-secret'
  const currentSecret = 'sk-current-local-secret'
  const chatHistory = sanitizeAIChatHistory([
    {
      id: 'chat-1',
      prompt: 'hello',
      apiKeyAI: oldSecret
    }
  ])
  const safeConfig = sanitizeAIConfigHistory({
    activeAIProfileId: 'profile-a',
    credentialRevisionAI: 'revision-a',
    apiKeyAI: oldSecret,
    aiProfiles: [
      { id: 'profile-a', nameAI: 'A', credentialRevisionAI: 'revision-a', apiKeyAI: oldSecret },
      { id: 'profile-b', nameAI: 'B', credentialRevisionAI: 'revision-b', apiKeyAI: 'sk-other-old-secret' }
    ]
  })

  assert.doesNotMatch(JSON.stringify(chatHistory), /apiKeyAI|sk-old-history-secret/)
  assert.doesNotMatch(JSON.stringify(safeConfig), /apiKeyAI|sk-old-history-secret|sk-other-old-secret/)

  const restored = restoreAIConfigHistoryCredentials(safeConfig, {
    activeAIProfileId: 'profile-a',
    credentialRevisionAI: 'revision-a',
    apiKeyAI: currentSecret,
    aiProfiles: [
      { id: 'profile-a', credentialRevisionAI: 'revision-a', apiKeyAI: currentSecret },
      { id: 'profile-b', credentialRevisionAI: 'revision-b', apiKeyAI: 'sk-current-b' }
    ]
  })
  assert.equal(restored.apiKeyAI, currentSecret)
  assert.equal(restored.aiProfiles[0].apiKeyAI, currentSecret)
  assert.equal(restored.aiProfiles[1].apiKeyAI, 'sk-current-b')

  const deletedProfile = restoreAIConfigHistoryCredentials({
    activeAIProfileId: 'deleted-profile',
    apiKeyAI: oldSecret,
    aiProfiles: [{ id: 'deleted-profile', apiKeyAI: oldSecret }]
  }, {
    activeAIProfileId: 'profile-a',
    apiKeyAI: currentSecret,
    aiProfiles: [{ id: 'profile-a', apiKeyAI: currentSecret }]
  })
  assert.equal(deletedProfile.apiKeyAI, '')
  assert.equal(deletedProfile.aiProfiles[0].apiKeyAI, '')
})

test('chat entry and config history wiring never persist apiKeyAI', () => {
  const chat = source('ai-chat.jsx')
  const config = source('ai-config.jsx')
  const actions = source('ai-chat-actions.js')
  const history = source('ai-history.jsx')
  const loadData = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/load-data.js'),
    'utf8'
  )
  const chatEntry = chat.match(/const chatEntry = \{[\s\S]*?\n {4}\}/)?.[0] || ''

  assert.match(chat, /createAIRequestCredentialReference/)
  assert.doesNotMatch(chatEntry, /apiKeyAI|mcpServers/)
  assert.match(config, /sanitizeAIConfigHistory/)
  assert.match(config, /restoreAIConfigHistoryCredentials/)
  assert.match(config, /sanitizeHistory=\{sanitizeAIConfigHistory\}/)
  assert.match(history, /safeSetItemJSON\(storageKey, normalized\)/)
  assert.match(actions, /sanitizeAIChatHistory/)
  assert.match(loadData, /normalizeAIChatHistoryOnStartup\(dt\)/)
})

test('transport credentials remain memory-only and fallback requires the same revision', async () => {
  const {
    clearAIRequestCredentials,
    createAIRequestCredentialReference,
    resolveAIRequestConfigForProfile,
    sanitizeAIChatHistory,
    sanitizeAIConfigHistory
  } = await import(credentialsUrl)
  const config = {
    id: 'relay',
    activeAIProfileId: 'relay',
    credentialRevisionAI: 'revision-1',
    apiKeyAI: 'sk-transport-secret',
    baseURLAI: 'https://url-user:url-pass@relay.example.com/v1?sig=query-secret&mode=fast#access_token=fragment-secret',
    apiPathAI: '/chat?token=path-secret&view=full',
    authHeaderNameAI: 'Authorization: Bearer header-secret',
    proxyAI: 'http://proxy-user:proxy-pass@proxy.example.com?credential=proxy-secret',
    mcpServers: [{
      id: 'mcp-a',
      env: { ACCESS_TOKEN: 'mcp-secret' }
    }]
  }

  clearAIRequestCredentials()
  const reference = createAIRequestCredentialReference(config)
  assert.deepEqual(
    resolveAIRequestConfigForProfile(
      reference.credentialTokenAI,
      reference.aiProfileId,
      reference.credentialRevisionAI,
      {}
    ),
    config
  )

  const sanitizedChat = sanitizeAIChatHistory([{ ...config, ...reference }])
  assert.equal(sanitizedChat[0].credentialTokenAI, reference.credentialTokenAI)
  const persisted = JSON.stringify({
    chat: sanitizedChat,
    config: sanitizeAIConfigHistory(config)
  })
  assert.doesNotMatch(
    persisted,
    /sk-transport|url-user|url-pass|query-secret|fragment-secret|path-secret|header-secret|proxy-user|proxy-pass|proxy-secret|mcp-secret/
  )

  clearAIRequestCredentials()
  const currentConfig = {
    ...config,
    aiProfiles: [config]
  }
  assert.equal(
    resolveAIRequestConfigForProfile(
      reference.credentialTokenAI,
      reference.aiProfileId,
      reference.credentialRevisionAI,
      currentConfig
    ).apiKeyAI,
    config.apiKeyAI
  )
  assert.deepEqual(
    resolveAIRequestConfigForProfile(
      reference.credentialTokenAI,
      reference.aiProfileId,
      'revision-old',
      currentConfig
    ),
    {}
  )
})
test('free-text history fields redact credentials and stack traces', async () => {
  const { sanitizeAIChatHistory } = await import(credentialsUrl)
  const history = sanitizeAIChatHistory([{
    response: 'Authorization: Bearer sk-response-secret-1234567890',
    aiStatusMessage: 'https://user:url-password@relay.example.com/v1?token=query-secret',
    toolCalls: [{
      result: 'OPENAI_API_KEY=tool-secret-value\nError: failed\n    at run (agent.js:1:1)'
    }],
    stack: 'Error: sk-stack-secret-1234567890\n    at execute (agent.js:2:2)'
  }])
  const serialized = JSON.stringify(history)

  assert.doesNotMatch(serialized, /sk-response-secret|url-password|query-secret|tool-secret-value|sk-stack-secret/)
  assert.doesNotMatch(serialized, /at run|at execute|agent\.js:/)
  assert.match(serialized, /\[REDACTED\]/)
})

test('free-text sanitizing redacts quoted JSON credential fields', async () => {
  const { sanitizeAIStoredText } = await import(credentialsUrl)
  const sanitized = sanitizeAIStoredText(JSON.stringify({
    api_key: 'json api secret with spaces',
    password: 'json password secret',
    normal: 'keep this value'
  }))

  assert.doesNotMatch(sanitized, /json api secret|json password secret/)
  assert.match(sanitized, /keep this value/)
  assert.match(sanitized, /\[REDACTED\]/)
})

test('stream sanitizing never exposes an unfinished private key block', async () => {
  const { createAIStoredTextAccumulator } = await import(credentialsUrl)
  const accumulator = createAIStoredTextAccumulator()
  const sanitized = accumulator.sanitize([
    'ordinary output',
    '-----BEGIN PRIVATE KEY-----',
    'unfinished-private-key-secret'
  ].join('\n'))

  assert.match(sanitized, /ordinary output/)
  assert.doesNotMatch(sanitized, /BEGIN PRIVATE KEY|unfinished-private-key-secret/)
  assert.match(sanitized, /\[REDACTED\]/)
})
test('free-text history redacts values following sensitive CLI flags', async () => {
  const { sanitizeAIChatHistory } = await import(credentialsUrl)
  const history = sanitizeAIChatHistory([{
    response: [
      'tool failed: client',
      '--verbose',
      '--api-key after-switch-api-secret',
      '--json',
      '--access-token after-switch-access-secret',
      '--api-key plain-cli-secret',
      '--token second-cli-secret',
      '--access-token access-token-secret',
      '--client-secret client-secret-value',
      '--authorization authorization-value',
      '--openai-api-key provider-key-value',
      '--secret-key secret-key-value',
      '--api-key --token adjacent-token-secret',
      '--auth --client-secret adjacent-client-secret',
      '--model ordinary-model'
    ].join(' ')
  }])
  const serialized = JSON.stringify(history)

  assert.doesNotMatch(serialized, /after-switch-api-secret|after-switch-access-secret|plain-cli-secret|second-cli-secret|access-token-secret|client-secret-value|authorization-value|provider-key-value|secret-key-value|adjacent-token-secret|adjacent-client-secret/)
  assert.match(serialized, /--api-key \[REDACTED\]/)
  assert.match(serialized, /--token \[REDACTED\]/)
  assert.match(serialized, /ordinary-model/)
})

test('recursive history sanitizing cleans string leaves inside arrays', async () => {
  const { sanitizeAIChatHistory } = await import(credentialsUrl)
  const history = sanitizeAIChatHistory([{
    responseParts: [
      'ordinary output',
      '--token=array-secret-value',
      {
        nested: [
          'still ordinary',
          'https://url-user:url-pass@relay.example.com/v1?token=query-secret'
        ]
      }
    ]
  }])
  const serialized = JSON.stringify(history)

  assert.equal(history[0].responseParts[0], 'ordinary output')
  assert.equal(history[0].responseParts[2].nested[0], 'still ordinary')
  assert.doesNotMatch(serialized, /array-secret-value|url-user|url-pass|query-secret/)
  assert.match(serialized, /\[REDACTED\]/)
})

test('recursive history sanitizing redacts values following sensitive CLI flags', async () => {
  const { sanitizeAIChatHistory } = await import(credentialsUrl)
  const history = sanitizeAIChatHistory([{
    toolCalls: [{
      args: [
        '--api-key',
        'split-api-secret',
        '--model',
        'ordinary-model',
        {
          nestedArgs: [
            '--token',
            'nested-token-secret',
            '--monkey',
            'banana',
            '--verbose'
          ]
        }
      ]
    }]
  }])
  const args = history[0].toolCalls[0].args
  const nestedArgs = args[4].nestedArgs
  const serialized = JSON.stringify(history)

  assert.deepEqual(args.slice(0, 4), [
    '--api-key',
    '[REDACTED]',
    '--model',
    'ordinary-model'
  ])
  assert.deepEqual(nestedArgs, [
    '--token',
    '[REDACTED]',
    '--monkey',
    'banana',
    '--verbose'
  ])
  assert.doesNotMatch(serialized, /split-api-secret|nested-token-secret/)
})
