const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  assertSkillId,
  normalizeSkillRelativePath,
  resolveSkillEntry
} = require(path.resolve(__dirname, '../../src/app/lib/agent-skill-path'))

test('accepts only normalized descendants of a skill package root', async () => {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-skill-path-'))
  const root = path.join(parent, 'skill')
  await fsp.mkdir(path.join(root, 'references'), { recursive: true })
  await fsp.writeFile(path.join(root, 'SKILL.md'), '# Safe', 'utf8')
  await fsp.writeFile(path.join(root, 'references', 'guide.md'), 'guide', 'utf8')

  try {
    assert.equal(
      resolveSkillEntry(root, 'references/guide.md'),
      path.join(root, 'references', 'guide.md')
    )
    assert.equal(normalizeSkillRelativePath('references\\guide.md'), 'references/guide.md')

    for (const unsafe of [
      '../outside.txt',
      'references/../../outside.txt',
      '/etc/passwd',
      'C:\\Windows\\win.ini',
      '\\\\server\\share\\secret.txt',
      'references//guide.md',
      'references/./guide.md',
      'references/guide.md\0secret'
    ]) {
      assert.throws(
        () => resolveSkillEntry(root, unsafe, { allowMissing: true }),
        error => error.code === 'SKILL_PATH_ESCAPE' || error.code === 'SKILL_PATH_INVALID'
      )
    }
  } finally {
    await fsp.rm(parent, { recursive: true, force: true })
  }
})

test('rejects symlinks that can escape the selected package', async (t) => {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-skill-link-'))
  const root = path.join(parent, 'skill')
  const outside = path.join(parent, 'outside')
  await fsp.mkdir(root, { recursive: true })
  await fsp.mkdir(outside, { recursive: true })
  await fsp.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8')

  try {
    try {
      await fsp.symlink(outside, path.join(root, 'linked'), 'junction')
    } catch (error) {
      t.skip(`symlink fixture unavailable: ${error.code}`)
      return
    }
    assert.throws(
      () => resolveSkillEntry(root, 'linked/secret.txt'),
      error => error.code === 'SKILL_PATH_SYMLINK'
    )
  } finally {
    await fsp.rm(parent, { recursive: true, force: true })
  }
})

test('validates canonical kebab-case skill identifiers', () => {
  assert.equal(assertSkillId('inspect-web-service'), 'inspect-web-service')
  for (const invalid of ['', 'Inspect-Web', 'inspect_web', '-inspect', 'inspect-', 'a..b']) {
    assert.throws(() => assertSkillId(invalid), error => error.code === 'SKILL_ID_INVALID')
  }
})
