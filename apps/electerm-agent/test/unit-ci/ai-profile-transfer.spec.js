const test = require('node:test')
const assert = require('node:assert/strict')

test('AI profile export excludes every API key by default', async () => {
  const {
    createAIProfileExport
  } = await import('../../src/client/components/ai/ai-profile-transfer.js')
  const exported = createAIProfileExport({
    activeAIProfileId: 'a',
    apiKeyAI: 'root-secret',
    aiProfiles: [
      { id: 'a', nameAI: 'Provider A', apiKeyAI: 'secret-a', modelAI: 'model-a' },
      { id: 'b', nameAI: 'Provider B', apiKeyAI: 'secret-b', modelOptionsAI: ['b-1', 'b-2'] }
    ]
  })

  assert.equal(exported.format, 'shellpilot-ai-profiles')
  assert.equal(exported.version, 1)
  assert.equal(exported.activeAIProfileId, 'a')
  assert.equal(JSON.stringify(exported).includes('secret'), false)
  assert.equal(exported.profiles[0].apiKeyAI, undefined)
  assert.deepEqual(exported.profiles[1].modelOptionsAI, ['b-1', 'b-2'])
})

test('AI profile import preserves existing credentials and provider-specific models', async () => {
  const {
    mergeAIProfileImport
  } = await import('../../src/client/components/ai/ai-profile-transfer.js')
  const current = {
    activeAIProfileId: 'a',
    aiProfiles: [
      { id: 'a', nameAI: 'Provider A', apiKeyAI: 'keep-a', modelAI: 'old-a' },
      { id: 'local', nameAI: 'Local', apiKeyAI: 'keep-local', modelAI: 'local-model' }
    ]
  }
  const merged = mergeAIProfileImport(current, {
    format: 'shellpilot-ai-profiles',
    version: 1,
    activeAIProfileId: 'b',
    profiles: [
      { id: 'a', nameAI: 'Provider A imported', apiKeyAI: 'must-drop', modelAI: 'new-a', modelOptionsAI: ['new-a'] },
      { id: 'b', nameAI: 'Provider B', apiKeyAI: 'must-drop-too', modelAI: 'b-1', modelOptionsAI: ['b-1', 'b-2'] }
    ]
  })

  const providerA = merged.aiProfiles.find(profile => profile.id === 'a')
  const providerB = merged.aiProfiles.find(profile => profile.id === 'b')
  assert.equal(providerA.apiKeyAI, 'keep-a')
  assert.equal(providerA.modelAI, 'new-a')
  assert.equal(providerB.apiKeyAI, '')
  assert.deepEqual(providerB.modelOptionsAI, ['b-1', 'b-2'])
  assert.equal(merged.aiProfiles.some(profile => profile.id === 'local'), true)
  assert.equal(JSON.stringify(merged).includes('must-drop'), false)
})
