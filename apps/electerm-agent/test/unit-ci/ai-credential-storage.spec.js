const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const storage = require(path.resolve(
  __dirname,
  '../../src/app/lib/ai-credential-storage'
))

test('AI credentials are stored as protected values outside ordinary config fields', () => {
  const source = {
    activeAIProfileId: 'profile-a',
    apiKeyAI: 'root-secret',
    aiProfiles: [
      { id: 'profile-a', nameAI: 'A', apiKeyAI: 'profile-secret', modelAI: 'model-a' },
      { id: 'profile-b', nameAI: 'B', apiKeyAI: '', modelAI: 'model-b' }
    ]
  }
  const encrypt = value => `os-safe:${Buffer.from(value).toString('base64')}`
  const decrypt = value => Buffer.from(value.slice('os-safe:'.length), 'base64').toString()
  const protectedConfig = storage.protectAIConfigCredentials(source, encrypt)

  assert.equal(JSON.stringify(protectedConfig).includes('root-secret'), false)
  assert.equal(JSON.stringify(protectedConfig).includes('profile-secret'), false)
  assert.equal(protectedConfig.apiKeyAI, undefined)
  assert.match(protectedConfig.apiKeyAICiphertext, /^os-safe:/)
  assert.equal(protectedConfig.aiProfiles[0].apiKeyAI, undefined)
  assert.match(protectedConfig.aiProfiles[0].apiKeyAICiphertext, /^os-safe:/)

  const restored = storage.restoreAIConfigCredentials(protectedConfig, decrypt)
  assert.equal(restored.apiKeyAI, 'root-secret')
  assert.equal(restored.aiProfiles[0].apiKeyAI, 'profile-secret')
  assert.equal(restored.aiProfiles[1].apiKeyAI, '')
  assert.equal(restored.apiKeyAICiphertext, undefined)
})

test('legacy plaintext credentials are migrated on the next protected save', () => {
  const legacy = {
    apiKeyAI: 'legacy-key',
    aiProfiles: [{ id: 'legacy', apiKeyAI: 'legacy-key' }]
  }
  const protectedConfig = storage.protectAIConfigCredentials(
    legacy,
    value => `encrypted:${value.length}`
  )
  assert.deepEqual(protectedConfig, {
    apiKeyAICiphertext: 'encrypted:10',
    aiProfiles: [{ id: 'legacy', apiKeyAICiphertext: 'encrypted:10' }]
  })
})
