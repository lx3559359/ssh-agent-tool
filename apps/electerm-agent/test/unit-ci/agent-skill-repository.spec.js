const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  createAgentSkillRepository
} = require(path.resolve(__dirname, '../../src/app/lib/agent-skill-repository'))

function skillFiles (version = '1.0.0', body = 'Read bounded service evidence.') {
  return {
    'SKILL.md': `---
id: inspect-web-service
name: Inspect Web Service
description: Collect bounded service evidence.
version: ${version}
triggers:
  - web service health
permissions:
  - ssh.read
---

# Workflow

${body}
`
  }
}

async function withRepository (run, options = {}) {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-skill-repository-'))
  const rootPath = path.join(parent, 'agent-skills')
  const repository = createAgentSkillRepository({ rootPath, ...options })
  try {
    await run({ repository, rootPath, parent })
  } finally {
    await fsp.rm(parent, { recursive: true, force: true })
  }
}

test('creates disabled drafts, enables exact digests and preserves released files while editing', async () => {
  const invalidated = []
  await withRepository(async ({ repository }) => {
    const draft = await repository.createDraft(skillFiles())
    assert.equal(draft.enabled, false)
    assert.equal(draft.state, 'draft')

    await assert.rejects(
      repository.enableDraft(draft.id, '0'.repeat(64)),
      error => error.code === 'SKILL_DIGEST_MISMATCH'
    )

    const release = await repository.enableDraft(draft.id, draft.packageDigest)
    assert.equal(release.id, 'inspect-web-service')
    assert.equal(release.enabled, true)
    const releasedDocument = await repository.readDocument(release.id)

    const editedDraft = await repository.updateDraftFile(
      release.id,
      'SKILL.md',
      skillFiles('1.1.0', 'Changed draft workflow.')['SKILL.md']
    )
    assert.equal(editedDraft.enabled, false)
    assert.equal(editedDraft.state, 'draft')
    assert.notEqual(editedDraft.id, release.id)
    assert.equal((await repository.getMetadata(release.id)).packageDigest, release.packageDigest)
    assert.equal((await repository.readDocument(release.id)).content, releasedDocument.content)
    assert.deepEqual(invalidated, [{
      skillId: release.id,
      packageDigest: release.packageDigest
    }])
  }, {
    onDigestInvalidated: binding => invalidated.push(binding)
  })
})

test('snapshots releases, rolls back exact versions and retains history after remove', async () => {
  await withRepository(async ({ repository, rootPath }) => {
    const draftV1 = await repository.createDraft(skillFiles('1.0.0', 'Version one.'))
    const releaseV1 = await repository.enableDraft(draftV1.id, draftV1.packageDigest)
    const draftV2 = await repository.createDraft(skillFiles('2.0.0', 'Version two.'))
    const releaseV2 = await repository.enableDraft(draftV2.id, draftV2.packageDigest)
    assert.notEqual(releaseV1.packageDigest, releaseV2.packageDigest)

    const rolledBack = await repository.rollback(releaseV2.id, releaseV1.packageDigest)
    assert.equal(rolledBack.packageDigest, releaseV1.packageDigest)
    assert.match((await repository.readDocument(rolledBack.id)).content, /Version one/)

    await repository.remove(rolledBack.id)
    assert.equal(await repository.getMetadata(rolledBack.id), null)
    const historyPath = path.join(rootPath, 'history', rolledBack.id, releaseV2.packageDigest)
    assert.equal((await fsp.stat(historyPath)).isDirectory(), true)
  })
})

test('restores the previous release if atomic activation rename fails', async () => {
  let failNextActivation = false
  const rename = async (from, to) => {
    if (failNextActivation &&
      path.basename(path.dirname(to)) === 'enabled' &&
      path.basename(to) === 'inspect-web-service' &&
      path.basename(from).startsWith('.tmp-')) {
      failNextActivation = false
      const error = new Error('injected activation failure')
      error.code = 'EACCES'
      throw error
    }
    return fsp.rename(from, to)
  }

  await withRepository(async ({ repository }) => {
    const v1 = await repository.createDraft(skillFiles('1.0.0', 'Stable version.'))
    const releaseV1 = await repository.enableDraft(v1.id, v1.packageDigest)
    const v2 = await repository.createDraft(skillFiles('2.0.0', 'Failed version.'))
    failNextActivation = true
    await assert.rejects(repository.enableDraft(v2.id, v2.packageDigest), /injected activation failure/)

    assert.equal((await repository.getMetadata(releaseV1.id)).packageDigest, releaseV1.packageDigest)
    assert.match((await repository.readDocument(releaseV1.id)).content, /Stable version/)
  }, { rename })
})

test('serializes concurrent writes per draft and exposes metadata without package contents', async () => {
  await withRepository(async ({ repository }) => {
    const draft = await repository.createDraft(skillFiles())
    await Promise.all([
      repository.updateDraftFile(draft.id, 'references/one.md', 'FIRST_SECRET_CONTENT'),
      repository.updateDraftFile(draft.id, 'references/two.md', 'SECOND_SECRET_CONTENT')
    ])

    assert.equal((await repository.readFile(draft.id, 'references/one.md')).content, 'FIRST_SECRET_CONTENT')
    assert.equal((await repository.readFile(draft.id, 'references/two.md')).content, 'SECOND_SECRET_CONTENT')
    const catalog = await repository.list()
    const serialized = JSON.stringify(catalog)
    assert.equal(serialized.includes('FIRST_SECRET_CONTENT'), false)
    assert.equal(serialized.includes('SECOND_SECRET_CONTENT'), false)
    assert.equal(serialized.includes('Read bounded service evidence'), false)
    assert.equal(catalog[0].state, 'draft')
  })
})
