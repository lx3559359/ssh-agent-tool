const fs = require('fs')
const path = require('path')

function normalizeVersion (value) {
  return String(value || '').trim().replace(/^v/i, '')
}

function readJson (filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readLatestMetadata (filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const versionMatch = content.match(/^version:\s*['"]?([^'"\s]+)['"]?/m)
  const pathMatch = content.match(/^path:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)
  return {
    content,
    installerName: pathMatch ? pathMatch[1].trim() : '',
    version: versionMatch ? versionMatch[1].trim() : ''
  }
}

function assertPackageVersionConsistency ({
  packageVersion,
  lockVersion,
  lockRootVersion
}) {
  const expected = normalizeVersion(packageVersion)
  for (const [label, value] of [
    ['package-lock.json version', lockVersion],
    ['package-lock.json root version', lockRootVersion]
  ]) {
    if (normalizeVersion(value) !== expected) {
      throw new Error(`${label} ${value || '<empty>'} must match package.json ${expected}`)
    }
  }
  return true
}

function assertReleaseVersionConsistencyState (state) {
  const expected = normalizeVersion(state.expectedVersion)
  const errors = []
  const checkVersion = (label, value) => {
    if (normalizeVersion(value) !== expected) {
      errors.push(`${label} ${value || '<empty>'} must match ${expected}`)
    }
  }
  const checkInstaller = (label, value) => {
    if (value !== state.installerName) {
      errors.push(`${label} ${value || '<empty>'} must match ${state.installerName}`)
    }
  }

  checkVersion('latest.yml version', state.latest.version)
  checkInstaller('latest.yml installer', state.latest.installerName)
  checkVersion('shellpilot-local.yml version', state.legacyLatest.version)
  checkInstaller('shellpilot-local.yml installer', state.legacyLatest.installerName)
  state.approvalVersions.forEach((version, index) => {
    checkVersion(`update approval ${index + 1} version`, version)
  })
  checkVersion('checksums.json version', state.checksumsVersion)
  checkVersion('shellpilot-release.json tag', state.releaseTag)

  if (!state.checksumNames.includes(state.installerName)) {
    errors.push(`checksums.json does not include ${state.installerName}`)
  }
  if (!state.releaseAssetNames.includes(state.installerName)) {
    errors.push(`shellpilot-release.json does not include ${state.installerName}`)
  }
  if (state.latest.content !== state.legacyLatest.content) {
    errors.push('latest.yml and shellpilot-local.yml must be identical')
  }
  if (errors.length) {
    throw new Error(`Release version consistency check failed:\n- ${errors.join('\n- ')}`)
  }
  return state
}

function buildReleaseVersionConsistencyState ({
  distDir,
  version,
  arch = 'x64',
  assetPrefix = 'ShellPilot'
}) {
  const installerName = `${assetPrefix}-${version}-win-${arch}-installer.exe`
  const latest = readLatestMetadata(path.join(distDir, 'latest.yml'))
  const legacyLatest = readLatestMetadata(path.join(distDir, 'shellpilot-local.yml'))
  const legacyApproval = readJson(path.join(distDir, 'aigshell-update.json'))
  const approval = readJson(path.join(distDir, 'shellpilot-update.json'))
  const checksums = readJson(path.join(distDir, 'checksums.json'))
  const releaseIndex = readJson(path.join(distDir, 'shellpilot-release.json'))

  return {
    expectedVersion: version,
    installerName,
    latest,
    legacyLatest,
    approvalVersions: [legacyApproval.version, approval.version],
    checksumsVersion: checksums.version,
    checksumNames: Object.keys(checksums.files || {}),
    releaseTag: releaseIndex.tag_name,
    releaseAssetNames: (releaseIndex.assets || []).map(asset => asset.name)
  }
}

function verifyReleaseVersionConsistency (options) {
  return assertReleaseVersionConsistencyState(
    buildReleaseVersionConsistencyState(options)
  )
}

module.exports = {
  assertPackageVersionConsistency,
  assertReleaseVersionConsistencyState,
  buildReleaseVersionConsistencyState,
  normalizeVersion,
  readLatestMetadata,
  verifyReleaseVersionConsistency
}
