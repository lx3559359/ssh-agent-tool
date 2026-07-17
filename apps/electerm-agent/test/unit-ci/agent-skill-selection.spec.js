const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-skill-selector.js'
)).href

function metadata (overrides = {}) {
  return {
    id: 'inspect-web-service',
    skillId: 'inspect-web-service',
    enabled: true,
    state: 'enabled',
    valid: true,
    name: 'Inspect web service',
    description: 'Inspect one web service safely.',
    version: '1.2.3',
    triggers: ['web service', 'nginx'],
    implicitMatching: true,
    packageDigest: 'a'.repeat(64),
    ...overrides
  }
}

function clientFor (catalog, reads = new Map()) {
  const calls = []
  return {
    calls,
    async listAgentSkills () {
      calls.push(['list'])
      return catalog
    },
    async getAgentSkillMetadata (id) {
      calls.push(['metadata', id])
      return catalog.find(item => item.skillId === id || item.id === id) || null
    },
    async readAgentSkillFile (id, relativePath) {
      calls.push(['read', id, relativePath])
      if (!reads.has(id)) throw Object.assign(new Error('missing document'), { code: 'SKILL_NOT_FOUND' })
      return {
        path: relativePath,
        content: reads.get(id),
        digest: `${id}-document-digest`
      }
    }
  }
}

test('unrelated prompts request metadata only and never read package contents', async () => {
  const { selectAgentSkills } = await import(moduleUrl)
  const client = clientFor([
    metadata(),
    metadata({ id: 'disabled-skill', skillId: 'disabled-skill', enabled: false, state: 'disabled' })
  ])

  const result = await selectAgentSkills({
    prompt: 'show the current time',
    client
  })

  assert.deepEqual(client.calls, [['list']])
  assert.equal(result.selected.length, 0)
  assert.deepEqual(result.catalog.map(item => item.id), ['inspect-web-service'])
})

test('explicit selection reads only the named Skill and suppresses implicit mixing', async () => {
  const { selectAgentSkills } = await import(moduleUrl)
  const client = clientFor([
    metadata(),
    metadata({
      id: 'generic-web',
      skillId: 'generic-web',
      name: 'Generic web',
      packageDigest: 'b'.repeat(64),
      triggers: ['web']
    })
  ], new Map([
    ['inspect-web-service', '# Exact workflow'],
    ['generic-web', '# Must not load']
  ]))

  const result = await selectAgentSkills({
    prompt: '$inspect-web-service inspect this web endpoint',
    client
  })

  assert.equal(result.explicit, true)
  assert.deepEqual(result.selected.map(item => item.metadata.id), ['inspect-web-service'])
  assert.deepEqual(client.calls, [
    ['list'],
    ['read', 'inspect-web-service', 'SKILL.md']
  ])
  assert.deepEqual(result.skillBindings, [{
    id: 'inspect-web-service',
    version: '1.2.3',
    digest: 'a'.repeat(64)
  }])
})

test('implicit matching is deterministic and respects implicitMatching', async () => {
  const { selectAgentSkills } = await import(moduleUrl)
  const client = clientFor([
    metadata({ id: 'short-match', skillId: 'short-match', triggers: ['web'], packageDigest: 'b'.repeat(64) }),
    metadata({ id: 'best-match', skillId: 'best-match', triggers: ['web service'], packageDigest: 'c'.repeat(64) }),
    metadata({ id: 'disabled-match', skillId: 'disabled-match', triggers: ['web service inspection'], implicitMatching: false, packageDigest: 'd'.repeat(64) })
  ], new Map([['best-match', '# Best workflow']]))

  const result = await selectAgentSkills({
    prompt: 'Run a web service inspection',
    client
  })

  assert.equal(result.explicit, false)
  assert.deepEqual(result.selected.map(item => item.metadata.id), ['best-match'])
  assert.deepEqual(client.calls.slice(1), [['read', 'best-match', 'SKILL.md']])
})

test('explicit missing disabled invalid or unreadable Skills require a user choice', async () => {
  const { selectAgentSkills } = await import(moduleUrl)
  const catalog = [
    metadata({ id: 'disabled-skill', skillId: 'disabled-skill', enabled: false, state: 'disabled' }),
    metadata({ id: 'invalid-skill', skillId: 'invalid-skill', valid: false })
  ]

  for (const [id, reasonCode] of [
    ['missing-skill', 'SKILL_NOT_FOUND'],
    ['disabled-skill', 'SKILL_DISABLED'],
    ['invalid-skill', 'SKILL_INVALID']
  ]) {
    const result = await selectAgentSkills({ prompt: `$${id} run`, client: clientFor(catalog) })
    assert.equal(result.requiresUserChoice, true)
    assert.equal(result.failure.reasonCode, reasonCode)
    assert.equal(result.selected.length, 0)
  }

  const unreadable = clientFor([metadata()])
  const result = await selectAgentSkills({
    prompt: '$inspect-web-service run',
    client: unreadable
  })
  assert.equal(result.requiresUserChoice, true)
  assert.equal(result.failure.reasonCode, 'SKILL_NOT_FOUND')
})
