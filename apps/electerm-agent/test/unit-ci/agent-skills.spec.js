const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/agent-skills.js')
).href

test('clean install has no business skills', async () => {
  const {
    getBuiltInAgentSkills,
    getAgentSkills,
    buildAgentSkillPrompt
  } = await import(moduleUrl)

  assert.deepEqual(getBuiltInAgentSkills(), [])
  assert.deepEqual(getAgentSkills(), [])
  assert.equal(buildAgentSkillPrompt(), '')

  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent-skills.js'),
    'utf8'
  )
  for (const legacyId of [
    'linux-health',
    'nginx-troubleshooting',
    'docker-troubleshooting',
    'disk-cleanup'
  ]) {
    assert.doesNotMatch(source, new RegExp(legacyId))
  }
})

test('Agent skill prompt exposes enabled metadata and only selected documents', async () => {
  const { getAgentSkills, buildAgentSkillPrompt } = await import(moduleUrl)
  const customSkills = [
    {
      id: 'custom-redis',
      name: 'Redis inspection',
      description: 'Inspect Redis safely.',
      version: '1.0.0',
      triggers: ['redis'],
      implicitMatching: true,
      packageDigest: 'a'.repeat(64),
      enabled: true,
      valid: true
    },
    {
      id: 'disabled-skill',
      name: 'Disabled Skill',
      packageDigest: 'b'.repeat(64),
      enabled: false,
      valid: true
    },
    {
      id: 'invalid-skill',
      name: 'Invalid Skill',
      enabled: true,
      valid: false
    }
  ]

  const skills = getAgentSkills({ customSkills })
  assert.deepEqual(skills.map(skill => skill.id), ['custom-redis'])

  const prompt = buildAgentSkillPrompt({
    catalog: skills,
    selectedSkills: [{
      metadata: skills[0],
      document: { content: '# Selected Redis workflow', digest: 'document-digest' }
    }]
  })
  assert.match(prompt, /custom-redis/)
  assert.match(prompt, /Redis inspection/)
  assert.match(prompt, /Selected Redis workflow/)
  assert.doesNotMatch(prompt, /Disabled Skill/)
})

test('Agent system prompt uses repository-backed Skill selection', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
    'utf8'
  )

  assert.match(source, /buildAgentSkillPrompt/)
  assert.match(source, /selectAgentSkills/)
  assert.doesNotMatch(source, /config\.agentSkills/)
  assert.doesNotMatch(source, /window\.store\.config\?\.agentSkills/)
})
