const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-skill-draft-normalizer.js'
)).href

test('turns a loose Chinese AI draft into controlled Skill metadata', async () => {
  const { normalizeAgentSkillDraftFiles } = await import(moduleUrl)
  const result = normalizeAgentSkillDraftFiles({
    requirements: '创建一个关键词搜索，给出搜索结果条目的 Skill',
    requestedPermissions: ['ssh.read'],
    files: [{
      path: 'SKILL.md',
      content: `---
id: 关键词搜索
name: 关键词搜索
description: 搜索并整理结果
version: v1
examples:
  - test
---

# 工作流程

根据关键词返回搜索结果。`
    }]
  })

  assert.equal(result.changed, true)
  assert.match(result.files[0].content, /^---\nid: custom-skill-[a-f0-9]{8}\n/)
  assert.match(result.files[0].content, /version: 1\.0\.0/)
  assert.match(result.files[0].content, /triggers:\n {2}- "创建一个关键词搜索，给出搜索结果条目的 Skill"/)
  assert.match(result.files[0].content, /permissions:\n {2}- "ssh\.read"/)
  assert.doesNotMatch(result.files[0].content, /examples:/)
  assert.match(result.files[0].content, /根据关键词返回搜索结果/)
})

test('aligns a valid manifest with the normalized Skill id and version', async () => {
  const { normalizeAgentSkillDraftFiles } = await import(moduleUrl)
  const result = normalizeAgentSkillDraftFiles({
    requirements: 'Inspect a web service',
    requestedPermissions: ['ssh.read'],
    files: [
      {
        path: 'SKILL.md',
        content: `---
id: Inspect_Web_Service
name: Inspect Web Service
description: Inspect bounded evidence
version: latest
triggers: [service failure]
---

# Workflow

Read bounded evidence.`
      },
      {
        path: 'skill.json',
        content: JSON.stringify({
          schemaVersion: 1,
          id: 'wrong-id',
          version: '2',
          unknown: true,
          tools: ['read_service_status']
        })
      }
    ]
  })

  const document = result.files.find(file => file.path === 'SKILL.md').content
  const manifest = JSON.parse(result.files.find(file => file.path === 'skill.json').content)
  assert.match(document, /id: inspect-web-service/)
  assert.match(document, /version: 1\.0\.0/)
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    id: 'inspect-web-service',
    version: '1.0.0',
    implicitMatching: false,
    requestedPermissions: ['ssh.read'],
    tools: ['read_service_status'],
    prechecks: [],
    scripts: [],
    verification: []
  })
})

test('keeps malformed manifests for validator review instead of hiding executable declarations', async () => {
  const { normalizeAgentSkillDraftFiles } = await import(moduleUrl)
  const malformed = '{"scripts": ['
  const result = normalizeAgentSkillDraftFiles({
    requirements: 'Inspect',
    files: [
      { path: 'SKILL.md', content: '# Inspect' },
      { path: 'skill.json', content: malformed },
      { path: 'scripts/run.sh', content: 'echo inspect\n' }
    ]
  })

  assert.equal(
    result.files.find(file => file.path === 'skill.json').content,
    malformed
  )
})
