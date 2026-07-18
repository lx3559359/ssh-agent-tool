const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  createAgentSkillRepository
} = require('../../src/app/lib/agent-skill-repository')

function skillDocument (version, body) {
  return [
    '---',
    'id: retained-skill',
    'name: Retained Skill',
    'description: Exercise history retention.',
    `version: ${version}`,
    'triggers:',
    '  - retained workflow',
    '---',
    '',
    '# Workflow',
    '',
    body
  ].join('\n')
}

async function release (repository, version, body, currentId) {
  const draft = currentId
    ? await repository.updateDraftFile(currentId, 'SKILL.md', skillDocument(version, body))
    : await repository.createDraft({ 'SKILL.md': skillDocument(version, body) })
  return repository.enableDraft(draft.id, draft.packageDigest)
}

test('Skill cleanup keeps referenced history and removes only unreferenced expired versions', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'shellpilot-skill-retention-'))
  try {
    const repository = createAgentSkillRepository({ rootPath: root })
    const v1 = await release(repository, '1.0.0', 'First version.')
    const v2 = await release(repository, '2.0.0', 'Second version.', v1.id)
    await release(repository, '3.0.0', 'Third version.', v2.id)
    const old = new Date('2025-01-01T00:00:00.000Z')
    for (const digest of [v1.packageDigest, v2.packageDigest]) {
      await fsp.utimes(path.join(root, 'history', v1.id, digest), old, old)
    }

    const result = await repository.cleanupHistory({
      expiresBefore: new Date('2026-01-01T00:00:00.000Z'),
      references: [{
        type: 'skill-history',
        skillId: v1.id,
        digest: v1.packageDigest
      }]
    })
    assert.deepEqual(result.retained, [{ skillId: v1.id, digest: v1.packageDigest }])
    assert.deepEqual(result.removed, [{ skillId: v1.id, digest: v2.packageDigest }])
    await assert.doesNotReject(repository.rollback(v1.id, v1.packageDigest))
    await assert.rejects(
      repository.rollback(v1.id, v2.packageDigest),
      error => error.code === 'SKILL_HISTORY_NOT_FOUND'
    )
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

test('low disk blocks a new history snapshot before replacing the enabled Skill', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'shellpilot-skill-disk-'))
  let freeBytes = Number.POSITIVE_INFINITY
  try {
    const repository = createAgentSkillRepository({
      rootPath: root,
      getFreeBytes: async () => freeBytes,
      minimumFreeBytes: 4096
    })
    const v1 = await release(repository, '1.0.0', 'Stable version.')
    const draft = await repository.updateDraftFile(
      v1.id,
      'SKILL.md',
      skillDocument('2.0.0', 'Replacement version.')
    )
    freeBytes = 1024
    await assert.rejects(
      repository.enableDraft(draft.id, draft.packageDigest),
      error => error.code === 'AGENT_STORAGE_INSUFFICIENT'
    )
    const current = await repository.getMetadata(v1.id)
    assert.equal(current.packageDigest, v1.packageDigest)
    assert.equal(current.enabled, true)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})
