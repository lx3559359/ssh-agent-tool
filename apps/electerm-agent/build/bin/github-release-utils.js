const path = require('path')

function buildReleaseTag (version) {
  const value = String(version || '').trim()
  return value.startsWith('v') ? value : `v${value}`
}

function getRequiredReleaseAssetNames (version) {
  const prefix = `AIGShell-${version}-win-x64-installer.exe`
  return [
    prefix,
    `${prefix}.blockmap`,
    'latest.yml'
  ]
}

function selectReleaseAssets (files, version) {
  const wanted = new Set(getRequiredReleaseAssetNames(version))
  return files.filter(file => wanted.has(path.basename(file)))
}

function selectUnexpectedReleaseAssets (assets, version) {
  const required = new Set(getRequiredReleaseAssetNames(version))
  return (assets || []).filter(asset => !required.has(path.basename(asset.name)))
}

function byName (items = []) {
  return new Map(items.map(item => [path.basename(item.name), item]))
}

function buildReleaseAssetReport ({
  localFiles = [],
  remoteAssets = [],
  version
}) {
  const requiredNames = getRequiredReleaseAssetNames(version)
  const localByName = byName(localFiles)
  const remoteByName = byName(remoteAssets)
  const missingLocal = requiredNames.filter(name => !localByName.has(name))
  const missingRemote = requiredNames.filter(name => !remoteByName.has(name))
  const sizeMismatches = requiredNames
    .filter(name => localByName.has(name) && remoteByName.has(name))
    .map(name => ({
      name,
      localSize: Number(localByName.get(name).size),
      remoteSize: Number(remoteByName.get(name).size)
    }))
    .filter(item => item.localSize !== item.remoteSize)
  const unexpectedRemote = selectUnexpectedReleaseAssets(remoteAssets, version)

  return {
    requiredNames,
    missingLocal,
    missingRemote,
    sizeMismatches,
    unexpectedRemote,
    ok: !missingLocal.length &&
      !missingRemote.length &&
      !sizeMismatches.length &&
      !unexpectedRemote.length
  }
}

function buildGitHubReleaseCommands ({
  repo,
  tag,
  title,
  notes,
  assets
}) {
  return [
    ['gh', ['release', 'view', tag, '--repo', repo]],
    ['gh', ['release', 'create', tag, '--repo', repo, '--title', title, '--notes', notes]],
    ['gh', ['release', 'upload', tag, ...assets, '--repo', repo, '--clobber']]
  ]
}

function createSpawnOptions (options = {}) {
  return {
    stdio: 'inherit',
    shell: false,
    ...options
  }
}

module.exports = {
  buildReleaseTag,
  buildReleaseAssetReport,
  getRequiredReleaseAssetNames,
  selectUnexpectedReleaseAssets,
  selectReleaseAssets,
  buildGitHubReleaseCommands,
  createSpawnOptions
}
