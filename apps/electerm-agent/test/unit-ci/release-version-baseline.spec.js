const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

test('rejects a build whose package version is older than the canonical branch', () => {
  const {
    assertVersionBaselineState
  } = require(path.join(root, 'build/bin/release-version-baseline'))

  assert.throws(() => assertVersionBaselineState({
    currentVersion: '0.4.4',
    baselineVersion: '0.4.6',
    baselineRef: 'origin/master',
    baselineIsAncestor: false,
    currentRef: 'codex/old-worktree'
  }), /0\.4\.4[\s\S]*0\.4\.6[\s\S]*旧版本/)
})

test('rejects a branch that does not contain the canonical release baseline', () => {
  const {
    assertVersionBaselineState
  } = require(path.join(root, 'build/bin/release-version-baseline'))

  assert.throws(() => assertVersionBaselineState({
    currentVersion: '0.4.7',
    baselineVersion: '0.4.6',
    baselineRef: 'origin/master',
    baselineIsAncestor: false,
    currentRef: 'codex/feature-from-old-base'
  }), /不包含[\s\S]*origin\/master[\s\S]*先同步/)
})

test('accepts a build at or above the canonical version when the baseline is an ancestor', () => {
  const {
    assertVersionBaselineState
  } = require(path.join(root, 'build/bin/release-version-baseline'))

  assert.doesNotThrow(() => assertVersionBaselineState({
    currentVersion: '0.4.6',
    baselineVersion: '0.4.6',
    baselineRef: 'origin/master',
    baselineIsAncestor: true,
    currentRef: 'master'
  }))
  assert.doesNotThrow(() => assertVersionBaselineState({
    currentVersion: '0.4.7',
    baselineVersion: '0.4.6',
    baselineRef: 'origin/master',
    baselineIsAncestor: true,
    currentRef: 'codex/next-release'
  }))
})

test('all local build and release entry points enforce the canonical version baseline', () => {
  for (const file of [
    'build/bin/vite-build.js',
    'build/bin/build-win-nsis.js',
    'build/bin/prepare-update-assets.js',
    'build/bin/release-github.js',
    'build/bin/sync-modelscope-release.js'
  ]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert.match(source, /assertCurrentReleaseBaseline\(\)/, `${file} must enforce the release baseline`)
  }
})
