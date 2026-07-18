const path = require('path')
const { modelScopeReleaseManifestName } = require('../../src/app/common/update-sources')

function buildReleaseTag (version) {
  const value = String(version || '').trim()
  return value.startsWith('v') ? value : `v${value}`
}

function getReleaseArch (options = {}) {
  return options.arch === 'arm64' ? 'arm64' : 'x64'
}

function getReleaseAssetPrefix (options = {}) {
  return options.assetPrefix || require('../../package.json').productName || 'ShellPilot'
}

function getRequiredReleaseAssetNames (version, options = {}) {
  const prefix = `${getReleaseAssetPrefix(options)}-${version}-win-${getReleaseArch(options)}-installer.exe`
  return [
    prefix,
    `${prefix}.blockmap`,
    'latest.yml',
    'shellpilot-local.yml',
    'aigshell-update.json',
    'shellpilot-update.json',
    'checksums.json',
    modelScopeReleaseManifestName
  ]
}

function getAllowedGitHubReleaseAssetNames (version, options = {}) {
  return [
    ...getRequiredReleaseAssetNames(version, options),
    `${getReleaseAssetPrefix(options)}-${version}-win-${getReleaseArch(options)}-portable.zip`
  ]
}

function getRequiredChecksumAssetNames (version, options = {}) {
  return getRequiredReleaseAssetNames(version, options)
    .filter(name => !['checksums.json', modelScopeReleaseManifestName].includes(name))
}

function selectReleaseAssets (files, version, options = {}) {
  const wanted = new Set(getAllowedGitHubReleaseAssetNames(version, options))
  return files.filter(file => wanted.has(path.basename(file)))
}

function selectUnexpectedReleaseAssets (assets, version, options = {}) {
  const required = new Set(getAllowedGitHubReleaseAssetNames(version, options))
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
  const requiredNames = getAllowedGitHubReleaseAssetNames(version, options)
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

function buildValidatedLocalUpdateAssets ({
  distDir,
  localFiles = [],
  version,
  arch
}) {
  const requiredNames = getRequiredReleaseAssetNames(version, { arch })
  const localByName = byName(localFiles)
  const missing = requiredNames.filter(name => !localByName.has(name))
  const empty = requiredNames
    .filter(name => localByName.has(name))
    .filter(name => Number(localByName.get(name).size) <= 0)
  if (missing.length || empty.length) {
    throw new Error([
      missing.length ? `Missing local update assets: ${missing.join(', ')}` : '',
      empty.length ? `Empty local update assets: ${empty.join(', ')}` : ''
    ].filter(Boolean).join('\n'))
  }
  return requiredNames.map(name => path.join(distDir, name))
}

function buildReleaseAssetReport ({
  localFiles = [],
  remoteAssets = [],
  version,
  arch
}) {
  const options = { arch }
  const requiredNames = getAllowedGitHubReleaseAssetNames(version, options)
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
    ['gh', ['release', 'create', tag, '--repo', repo, '--draft', '--title', title, '--notes', notes]],
    ['gh', ['release', 'edit', tag, '--repo', repo, '--title', title, '--notes', notes]],
    ['gh', ['release', 'upload', tag, ...assets, '--repo', repo, '--clobber']],
    ['gh', ['release', 'edit', tag, '--repo', repo, '--draft=false']]
  ]
}

function createSpawnOptions (options = {}) {
  return {
    stdio: 'inherit',
    shell: false,
    ...options
  }
}

function getSpawnStatus (result, command, args = []) {
  if (result?.error) {
    throw new Error(`${command} ${args.join(' ')} failed to start: ${result.error.message || result.error}`)
  }
  if (!Number.isInteger(result?.status)) {
    throw new Error(`${command} ${args.join(' ')} returned an invalid process status`)
  }
  return result.status
}

function assertSpawnSuccess (result, command, args = []) {
  const status = getSpawnStatus(result, command, args)
  if (status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(' ')} failed with status ${status}`)
  }
  return status
}

module.exports = {
  assertSpawnSuccess,
  buildLocalReleaseAssetReport,
  buildReleaseTag,
  buildReleaseAssetReport,
  buildValidatedLocalReleaseAssets,
  buildValidatedLocalUpdateAssets,
  getAllowedGitHubReleaseAssetNames,
  getRequiredChecksumAssetNames,
  getRequiredReleaseAssetNames,
  getSpawnStatus,
  selectUnexpectedReleaseAssets,
  selectReleaseAssets,
  buildGitHubReleaseCommands,
  createSpawnOptions
}
