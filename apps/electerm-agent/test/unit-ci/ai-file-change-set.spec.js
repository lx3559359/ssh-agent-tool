const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/ai-file-change-set.js'
)).href

test('creates a bounded immutable AI file change set', async () => {
  const { createAiFileChangeSet, AI_FILE_DIFF_PREVIEW_MAX_CHARS } =
    await import(moduleUrl)
  const oversizedPreview = 'x'.repeat(AI_FILE_DIFF_PREVIEW_MAX_CHARS + 20)
  const changeSet = createAiFileChangeSet({
    id: 'review-1',
    createdAt: '2026-07-28T08:00:00.000Z',
    files: [{
      path: '/etc/nginx/nginx.conf',
      selected: true,
      originalFingerprint: {
        existed: true,
        size: 20,
        digest: 'before'
      },
      proposedFingerprint: {
        existed: true,
        size: 30,
        digest: 'after'
      },
      diffPreview: oversizedPreview
    }]
  })

  assert.equal(changeSet.schemaVersion, 1)
  assert.equal(changeSet.status, 'reviewing')
  assert.equal(changeSet.files.length, 1)
  assert.equal(
    changeSet.files[0].diffPreview.length,
    AI_FILE_DIFF_PREVIEW_MAX_CHARS
  )
  assert.equal(changeSet.files[0].truncated, true)
  assert.equal(changeSet.files[0].status, 'pending')
  assert.equal(Object.isFrozen(changeSet), true)
  assert.equal(Object.isFrozen(changeSet.files), true)
  assert.equal(Object.isFrozen(changeSet.files[0]), true)
})

test('updates file selection without mutating the reviewed change set', async () => {
  const {
    createAiFileChangeSet,
    setAiFileChangeSelected,
    countSelectedAiFileChanges
  } = await import(moduleUrl)
  const original = createAiFileChangeSet({
    id: 'review-2',
    files: [
      { path: '/tmp/a.conf', selected: true, diffPreview: 'a' },
      { path: '/tmp/b.conf', selected: true, diffPreview: 'b' }
    ]
  })
  const updated = setAiFileChangeSelected(original, '/tmp/a.conf', false)

  assert.notEqual(updated, original)
  assert.equal(original.files[0].selected, true)
  assert.equal(updated.files[0].selected, false)
  assert.equal(updated.files[1], original.files[1])
  assert.equal(countSelectedAiFileChanges(updated), 1)
})

test('rejects duplicate or relative remote file paths', async () => {
  const { createAiFileChangeSet } = await import(moduleUrl)

  assert.throws(() => createAiFileChangeSet({
    files: [{ path: 'relative.conf' }]
  }), error => error.code === 'AI_FILE_CHANGE_PATH_INVALID')

  assert.throws(() => createAiFileChangeSet({
    files: [{ path: '/tmp/a' }, { path: '/tmp/a' }]
  }), error => error.code === 'AI_FILE_CHANGE_PATH_DUPLICATE')
})

test('detects files changed since review using stable fingerprints', async () => {
  const {
    validateAiFileChangeFingerprint
  } = await import(moduleUrl)
  const reviewed = {
    existed: true,
    size: 12,
    digest: 'sha-256-before',
    digestAlgorithm: 'SHELLPILOT-SHA-256-CHAIN-V1'
  }

  assert.deepEqual(validateAiFileChangeFingerprint(reviewed, {
    ...reviewed
  }), { ok: true })

  assert.deepEqual(validateAiFileChangeFingerprint(reviewed, {
    ...reviewed,
    digest: 'sha-256-after'
  }), {
    ok: false,
    code: 'AI_FILE_CHANGED_SINCE_REVIEW'
  })
})
