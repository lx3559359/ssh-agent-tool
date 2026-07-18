const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { createAgentSkillRepository } = require('../../src/app/lib/agent-skill-repository.js')

async function fixture (run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-skill-migration-'))
  try {
    await run({
      root,
      repository: createAgentSkillRepository({ rootPath: root })
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

const legacy = [
  {
    id: 'redis-check',
    title: 'Redis Check',
    description: 'Investigate Redis health',
    prompt: 'Collect bounded status and logs before proposing a change.'
  }
]

test('legacy prompt Skills migrate once into disabled drafts', async () => {
  await fixture(async ({ root, repository }) => {
    const first = await repository.migrateLegacySkills(legacy)
    const second = await repository.migrateLegacySkills(legacy)
    const catalog = await repository.list()
    const marker = JSON.parse(await fs.readFile(
      path.join(root, 'migration-v1.json'),
      'utf8'
    ))

    assert.equal(first.complete, true)
    assert.deepEqual(second, first)
    assert.equal(marker.complete, true)
    assert.equal(catalog.length, 1)
    assert.equal(catalog[0].state, 'draft')
    assert.equal(catalog[0].enabled, false)
    assert.equal(catalog[0].skillId, 'redis-check')
  })
})

test('migration resolves conflicting IDs deterministically and never enables them', async () => {
  await fixture(async ({ repository }) => {
    await repository.createDraft({
      'SKILL.md': [
        '---',
        'id: redis-check',
        'name: Existing Redis Check',
        'description: Existing draft',
        'version: 1.0.0',
        'triggers:',
        '  - existing redis check',
        '---',
        '',
        '# Existing'
      ].join('\n')
    })
    const result = await repository.migrateLegacySkills(legacy)
    const catalog = await repository.list()
    const migrated = catalog.find(item => item.name === 'Redis Check')

    assert.equal(result.complete, true)
    assert.match(migrated.skillId, /^redis-check-legacy-[a-f0-9]{8}$/)
    assert.equal(migrated.state, 'draft')
    assert.ok(result.warnings.some(item => item.code === 'SKILL_MIGRATION_ID_CONFLICT'))
  })
})

test('migration marker is not committed when an atomic draft write fails', async () => {
  await fixture(async ({ root }) => {
    let renames = 0
    const repository = createAgentSkillRepository({
      rootPath: root,
      rename: async (source, target) => {
        renames += 1
        if (renames === 1) throw new Error('simulated rename failure')
        return fs.rename(source, target)
      }
    })

    await assert.rejects(repository.migrateLegacySkills(legacy))
    await assert.rejects(fs.access(path.join(root, 'migration-v1.json')))
  })
})

test('main-process Skill IPC accounts for legacy profile rows before repository access', () => {
  const ipc = require('node:fs').readFileSync(path.resolve(
    __dirname,
    '../../src/app/lib/ipc.js'
  ), 'utf8')

  assert.match(ipc, /ensureAgentSkillsMigrated/)
  assert.match(ipc, /config\.agentSkills/)
  assert.match(ipc, /config\.aiProfiles/)
  assert.match(ipc, /migrateLegacySkills/)
})
