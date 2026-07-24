const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

test('release metadata must use one version and installer name', () => {
  const {
    assertReleaseVersionConsistencyState
  } = require(path.join(root, 'build/bin/release-version-consistency'))

  assert.doesNotThrow(() => assertReleaseVersionConsistencyState({
    expectedVersion: '0.4.9',
    installerName: 'ShellPilot-0.4.9-win-x64-installer.exe',
    latest: {
      version: '0.4.9',
      installerName: 'ShellPilot-0.4.9-win-x64-installer.exe'
    },
    legacyLatest: {
      version: '0.4.9',
      installerName: 'ShellPilot-0.4.9-win-x64-installer.exe'
    },
    approvalVersions: ['0.4.9', '0.4.9'],
    checksumsVersion: '0.4.9',
    checksumNames: ['ShellPilot-0.4.9-win-x64-installer.exe'],
    releaseTag: 'v0.4.9',
    releaseAssetNames: ['ShellPilot-0.4.9-win-x64-installer.exe']
  }))
})

test('release metadata rejects stale package and update versions', () => {
  const {
    assertReleaseVersionConsistencyState
  } = require(path.join(root, 'build/bin/release-version-consistency'))

  assert.throws(() => assertReleaseVersionConsistencyState({
    expectedVersion: '0.4.9',
    installerName: 'ShellPilot-0.4.9-win-x64-installer.exe',
    latest: {
      version: '0.4.8',
      installerName: 'ShellPilot-0.4.8-win-x64-installer.exe'
    },
    legacyLatest: {
      version: '0.4.9',
      installerName: 'ShellPilot-0.4.9-win-x64-installer.exe'
    },
    approvalVersions: ['0.4.9', '0.4.8'],
    checksumsVersion: '0.4.8',
    checksumNames: ['ShellPilot-0.4.8-win-x64-installer.exe'],
    releaseTag: 'v0.4.8',
    releaseAssetNames: ['ShellPilot-0.4.8-win-x64-installer.exe']
  }), /0\.4\.8[\s\S]*0\.4\.9/)
})

test('package lock version must match package version', () => {
  const {
    assertPackageVersionConsistency
  } = require(path.join(root, 'build/bin/release-version-consistency'))

  assert.doesNotThrow(() => assertPackageVersionConsistency({
    packageVersion: '0.4.9',
    lockVersion: '0.4.9',
    lockRootVersion: '0.4.9'
  }))
  assert.throws(() => assertPackageVersionConsistency({
    packageVersion: '0.4.9',
    lockVersion: '0.4.8',
    lockRootVersion: '0.4.9'
  }), /package-lock\.json[\s\S]*0\.4\.8[\s\S]*0\.4\.9/)
})

test('all upload paths run the release version consistency gate first', () => {
  const githubRelease = fs.readFileSync(
    path.join(root, 'build/bin/release-github.js'),
    'utf8'
  )
  const modelScopeRelease = fs.readFileSync(
    path.join(root, 'build/bin/sync-modelscope-release.js'),
    'utf8'
  )
  const modelScopeWorkflow = fs.readFileSync(
    path.resolve(root, '../../.github/workflows/modelscope-release-sync.yml'),
    'utf8'
  )

  assert.match(githubRelease, /verifyLocalReleaseArtifacts\(/)
  assert.match(modelScopeRelease, /verifyLocalReleaseArtifacts\(/)

  const downloadIndex = modelScopeWorkflow.indexOf('name: Download approved GitHub release assets')
  const verifyIndex = modelScopeWorkflow.indexOf('npm run release:local:verify')
  const mirrorIndex = modelScopeWorkflow.indexOf('name: Mirror release assets to ModelScope')
  assert.ok(downloadIndex !== -1 && verifyIndex > downloadIndex)
  assert.ok(mirrorIndex !== -1 && verifyIndex < mirrorIndex)
})
