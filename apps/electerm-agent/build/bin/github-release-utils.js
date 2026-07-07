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
  getRequiredReleaseAssetNames,
  selectUnexpectedReleaseAssets,
  selectReleaseAssets,
  buildGitHubReleaseCommands,
  createSpawnOptions
}
