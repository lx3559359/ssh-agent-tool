const path = require('path')

function buildReleaseTag (version) {
  const value = String(version || '').trim()
  return value.startsWith('v') ? value : `v${value}`
}

function getReleaseArch (options = {}) {
  return options.arch === 'arm64' ? 'arm64' : 'x64'
}

function getRequiredReleaseAssetNames (version, options = {}) {
  const prefix = `AIGShell-${version}-win-${getReleaseArch(options)}-installer.exe`
  return [
    prefix,
    `${prefix}.blockmap`,
    'latest.yml'
  ]
}

function selectReleaseAssets (files, version, options = {}) {
  const wanted = new Set(getRequiredReleaseAssetNames(version, options))
  return files.filter(file => wanted.has(path.basename(file)))
}

function selectUnexpectedReleaseAssets (assets, version, options = {}) {
  const required = new Set(getRequiredReleaseAssetNames(version, options))
  return (assets || []).filter(asset => !required.has(path.basename(asset.name)))
}

function byName (items = []) {
  return new Map(items.map(item => [path.basename(item.name), item]))
}

function buildLocalReleaseAssetReport ({
  localFiles = [],
  version,
  arch
}) {
  const options = { arch }
  const requiredNames = getRequiredReleaseAssetNames(version, options)
  const localByName = byName(localFiles)
  const missingLocal = requiredNames.filter(name => !localByName.has(name))
  const emptyLocal = requiredNames
    .filter(name => localByName.has(name))
    .filter(name => Number(localByName.get(name).size) <= 0)

  return {
    requiredNames,
    missingLocal,
    emptyLocal,
    ok: !missingLocal.length && !emptyLocal.length
  }
}

function buildValidatedLocalReleaseAssets ({
  distDir,
  localFiles = [],
  version,
  arch
}) {
  const report = buildLocalReleaseAssetReport({
    localFiles,
    version,
    arch
  })
  const errors = []

  if (report.missingLocal.length) {
    errors.push(`缺少本地发布文件：${report.missingLocal.join(', ')}`)
  }
  if (report.emptyLocal.length) {
    errors.push(`本地发布文件为空：${report.emptyLocal.join(', ')}`)
  }
  if (errors.length) {
    throw new Error(errors.join('\n'))
  }

  return report.requiredNames.map(name => path.join(distDir, name))
}

function buildReleaseAssetReport ({
  localFiles = [],
  remoteAssets = [],
  version,
  arch
}) {
  const options = { arch }
  const requiredNames = getRequiredReleaseAssetNames(version, options)
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
  const unexpectedRemote = selectUnexpectedReleaseAssets(remoteAssets, version, options)

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
  buildLocalReleaseAssetReport,
  buildReleaseTag,
  buildReleaseAssetReport,
  buildValidatedLocalReleaseAssets,
  getRequiredReleaseAssetNames,
  selectUnexpectedReleaseAssets,
  selectReleaseAssets,
  buildGitHubReleaseCommands,
  createSpawnOptions
}
