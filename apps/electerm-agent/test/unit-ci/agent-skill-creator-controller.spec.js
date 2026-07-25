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
      const document = files.find(file => file.path === 'SKILL.md')?.content
      assert.match(document, /id: inspect-web-service/)
      assert.match(document, /triggers:\n {2}- "web service health"/)
      assert.match(document, /permissions:\n {2}- "ssh\.read"/)
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

test('repairs a generated draft once when package validation rejects it', async () => {
  const { createAgentSkillCreatorController } = await import(moduleUrl)
  const prompts = []
  let saves = 0
  const controller = createAgentSkillCreatorController({
    runGlobalAsync: async (name, prompt) => {
      prompts.push(prompt)
      return { response: response() }
    },
    createDraft: async () => {
      saves += 1
      if (saves === 1) {
        const error = new Error('Skill package did not pass validation.')
        error.code = 'SKILL_VALIDATION_FAILED'
        error.validation = {
          valid: false,
          errors: [{
            code: 'SKILL_FRONTMATTER_KEY_INVALID',
            message: 'Unsupported Skill frontmatter key: examples',
            path: 'SKILL.md'
          }]
        }
        throw error
      }
      return {
        id: 'inspect-web-service-draft-1',
        state: 'draft',
        enabled: false,
        valid: true,
        packageDigest: 'a'.repeat(64)
      }
    }
  })

  const result = await controller.generate({
    requirements: 'Create a keyword search Skill',
    config
  })

  assert.equal(saves, 2)
  assert.equal(prompts.length, 2)
  assert.match(prompts[1], /SKILL_FRONTMATTER_KEY_INVALID/)
  assert.match(prompts[1], /SKILL\.md/)
  assert.equal(result.draft.valid, true)
})

test('reports package validation details after the repair attempt also fails', async () => {
  const { createAgentSkillCreatorController } = await import(moduleUrl)
  let calls = 0
  const controller = createAgentSkillCreatorController({
    runGlobalAsync: async () => {
      calls += 1
      return { response: response() }
    },
    createDraft: async () => {
      const error = new Error('Skill package did not pass validation.')
      error.code = 'SKILL_VALIDATION_FAILED'
      error.validation = {
        valid: false,
        errors: [{
          code: 'SKILL_FRONTMATTER_REQUIRED_FIELD',
          message: 'Skill frontmatter requires triggers.',
          path: 'SKILL.md'
        }]
      }
      throw error
    }
  })

  await assert.rejects(
    controller.generate({ requirements: 'Create a keyword search Skill', config }),
    error => (
      calls === 2 &&
      error.message.includes('SKILL.md') &&
      error.message.includes('触发条件')
    )
  )
})

test('normalizes common AI frontmatter mistakes before saving the draft', async () => {
  const { createAgentSkillCreatorController } = await import(moduleUrl)
  let savedDocument = ''
  const looseResponse = JSON.stringify({
    schemaVersion: 1,
    summary: '关键词搜索',
    files: [{
      path: 'SKILL.md',
      content: `---
id: 关键词搜索
name: 关键词搜索
description: 搜索关键词并整理结果
version: v1
examples:
  - 搜索 nginx
---

# 工作流程

返回匹配的结果。`
    }],
    requestedPermissions: [],
    riskSummary: [],
    validationIntent: []
  })
  const controller = createAgentSkillCreatorController({
    runGlobalAsync: async () => ({ response: looseResponse }),
    createDraft: async files => {
      savedDocument = files.find(file => file.path === 'SKILL.md').content
      return {
        id: 'keyword-search-draft-1',
        state: 'draft',
        enabled: false,
        valid: true,
        packageDigest: 'c'.repeat(64)
      }
    }
  })

  await controller.generate({
    requirements: '创建一个关键词搜索，给出搜索结果条目的 Skill',
    config
  })

  assert.match(savedDocument, /id: custom-skill-[a-f0-9]{8}/)
  assert.match(savedDocument, /triggers:/)
  assert.doesNotMatch(savedDocument, /examples:/)
})

test('reset returns a completed creator to a clean idle state without cancelling AI', async () => {
  const { createAgentSkillCreatorController } = await import(moduleUrl)
  const calls = []
  const controller = createAgentSkillCreatorController({
    runGlobalAsync: async name => {
      calls.push(name)
      return { response: response() }
    },
    createDraft: async () => ({
      id: 'inspect-web-service-draft-1',
      state: 'draft',
      enabled: false,
      valid: true,
      packageDigest: 'a'.repeat(64)
    })
  })

  await controller.generate({ requirements: 'Inspect', config })
  assert.equal(controller.reset(), true)
  assert.equal(controller.getState().status, 'idle')
  assert.deepEqual(calls, ['AIchat'])
})
