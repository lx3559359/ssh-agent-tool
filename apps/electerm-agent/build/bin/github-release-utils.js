const path = require('path')

function buildReleaseTag (version) {
  const value = String(version || '').trim()
  return value.startsWith('v') ? value : `v${value}`
}

function selectReleaseAssets (files, version) {
  const prefix = `AIGShell-${version}-win-x64-installer.exe`
  const wanted = new Set([
    prefix,
    `${prefix}.blockmap`,
    'latest.yml'
  ])
  return files.filter(file => wanted.has(path.basename(file)))
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

module.exports = {
  buildReleaseTag,
  selectReleaseAssets,
  buildGitHubReleaseCommands
}
