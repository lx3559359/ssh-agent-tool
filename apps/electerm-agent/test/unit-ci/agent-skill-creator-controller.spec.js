const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-skill-creator-controller.js'
)).href

const skillDocument = [
  '---',
  'id: inspect-web-service',
  'name: Inspect Web Service',
  'description: Inspect service evidence.',
  'version: 1.0.0',
  'triggers:',
  '  - web service health',
  '---',
  '',
  '# Workflow',
  '',
  'Read bounded evidence.'
].join('\n')

function response () {
  return JSON.stringify({
    schemaVersion: 1,
    summary: 'Inspect a web service.',
    files: [{ path: 'SKILL.md', content: skillDocument }],
    requestedPermissions: ['ssh.read'],
    riskSummary: ['Remote observations are untrusted.'],
    validationIntent: ['SKILL.md parses']
  })
}

const config = {
  modelAI: 'test-model',
  baseURLAI: 'https://model.test/v1',
  apiPathAI: '',
  apiKeyAI: 'secret-api-key',
  proxyAI: '',
  authHeaderNameAI: 'Authorization: Bearer'
}

test('creator calls only plain AIchat then saves one disabled draft', async () => {
  const { createAgentSkillCreatorController } = await import(moduleUrl)
  const calledGlobalNames = []
  let gatewayCalls = 0
  let enableCalls = 0
  const controller = createAgentSkillCreatorController({
    runGlobalAsync: async name => {
      calledGlobalNames.push(name)
      return { response: response() }
    },
    createDraft: async files => {
      calledGlobalNames.push('createAgentSkillDraft')
      assert.equal(files.find(file => file.path === 'SKILL.md')?.content, skillDocument)
      return {
        id: 'inspect-web-service-draft-1',
        state: 'draft',
        enabled: false,
        valid: true,
        packageDigest: 'a'.repeat(64)
      }
    },
    gateway: () => { gatewayCalls += 1 },
    enableDraft: () => { enableCalls += 1 }
  })
  const result = await controller.generate({
    requirements: 'Inspect a web service',
    config
  })

  assert.deepEqual(calledGlobalNames, ['AIchat', 'createAgentSkillDraft'])
  assert.equal(gatewayCalls, 0)
  assert.equal(enableCalls, 0)
  assert.equal(result.draft.enabled, false)
  assert.equal(controller.getState().status, 'draft-ready')
})

test('cancelling active generation prevents a late draft save', async () => {
  const { createAgentSkillCreatorController } = await import(moduleUrl)
  let resolveAI
  let saves = 0
  const calls = []
  const controller = createAgentSkillCreatorController({
    runGlobalAsync: (name, ...args) => {
      calls.push(name)
      if (name === 'AIChatCancel') return Promise.resolve({ cancelled: true })
      return new Promise(resolve => { resolveAI = resolve })
    },
    createDraft: async () => { saves += 1 }
  })
  const pending = controller.generate({ requirements: 'Inspect', config })
  await new Promise(resolve => setImmediate(resolve))
  await controller.cancel()
  resolveAI({ response: response() })

  await assert.rejects(pending, error => error.code === 'SKILL_CREATOR_CANCELLED')
  assert.equal(saves, 0)
  assert.deepEqual(calls, ['AIchat', 'AIChatCancel'])
  assert.equal(controller.getState().status, 'cancelled')
})

test('invalid JSON and API errors preserve the existing draft and redact secrets', async () => {
  const { createAgentSkillCreatorController } = await import(moduleUrl)
  const existingDraft = Object.freeze({ id: 'existing-draft', packageDigest: 'b'.repeat(64) })
  for (const aiResult of [
    { response: '{bad json' },
    { error: `request rejected for ${config.apiKeyAI}` }
  ]) {
    let saves = 0
    const controller = createAgentSkillCreatorController({
      runGlobalAsync: async () => aiResult,
      createDraft: async () => { saves += 1 }
    })
    await assert.rejects(
      controller.generate({ requirements: 'Revise', existingDraft, config }),
      error => !error.message.includes(config.apiKeyAI)
    )
    assert.equal(saves, 0)
    assert.equal(existingDraft.id, 'existing-draft')
    assert.equal(controller.getState().status, 'failed')
  }
})
