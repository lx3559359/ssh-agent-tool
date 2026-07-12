const fs = require('fs')
const path = require('path')
const pack = require('../../package.json')
const {
  buildUpdateApprovalManifest,
  normalizeChannel,
  validateUpdateApprovalManifest
} = require('./write-update-approval-manifest')
const {
  getRequiredChecksumAssetNames
} = require('./github-release-utils')
const { writeChecksums } = require('./update-checksums')
const { writeUpdateReleaseIndex } = require('./update-release-index')

function readUpdateMetadataVersion (filePath) {
  if (!fs.existsSync(filePath)) {
    return ''
  }
  const content = fs.readFileSync(filePath, 'utf8')
  const match = content.match(/^version:\s*['"]?([^'"\s]+)['"]?/m)
  return match ? match[1] : ''
}

function shouldCopyLatestMetadata (latestPath, localMetadataPath, version) {
  if (!fs.existsSync(latestPath)) {
    return true
  }
  if (readUpdateMetadataVersion(latestPath) !== version) {
    return true
  }
  if (!fs.existsSync(localMetadataPath)) {
    return false
  }
  return fs.readFileSync(latestPath, 'utf8') !== fs.readFileSync(localMetadataPath, 'utf8')
}

function uniqueNames (names) {
  return [...new Set(names.filter(Boolean))]
}

function findUpdateMetadataPath (distDir, version, options = {}) {
  const names = uniqueNames([
    ...(options.metadataNames || []),
    process.env.WORKFLOW_NAME ? `${process.env.WORKFLOW_NAME}.yml` : '',
    'shellpilot-local.yml',
    'aigshell-local.yml'
  ])
  const existing = names
    .map(name => path.join(distDir, name))
    .filter(filePath => fs.existsSync(filePath))
  return existing.find(filePath => readUpdateMetadataVersion(filePath) === version) || existing[0] || ''
}

function ensureLegacyElectronUpdaterMetadata (latestPath, legacyMetadataPath) {
  const latestContent = fs.readFileSync(latestPath, 'utf8')
  if (
    !fs.existsSync(legacyMetadataPath) ||
    fs.readFileSync(legacyMetadataPath, 'utf8') !== latestContent
  ) {
    fs.writeFileSync(legacyMetadataPath, latestContent)
    return true
  }
  return false
}

function prepareUpdateAssets (options = {}) {
  const distDir = options.distDir || path.resolve(__dirname, '../../dist')
  const version = options.version || pack.version
  const channel = normalizeChannel(options.channel || process.env.AIGSHELL_UPDATE_CHANNEL)
  const latestPath = path.join(distDir, 'latest.yml')
  const legacyElectronUpdaterMetadataPath = path.join(distDir, 'shellpilot-local.yml')
  const localMetadataPath = findUpdateMetadataPath(distDir, version, options)
  const legacyManifestPath = path.join(distDir, 'aigshell-update.json')
  const manifestPath = path.join(distDir, 'shellpilot-update.json')
  let checksumsPath = ''
  let releaseIndexPath = ''
  let copiedLatest = false
  let copiedLegacyElectronUpdaterMetadata = false

  fs.mkdirSync(distDir, { recursive: true })

  if (shouldCopyLatestMetadata(latestPath, localMetadataPath, version)) {
    if (!localMetadataPath || !fs.existsSync(localMetadataPath)) {
      throw new Error('Missing update metadata: dist/latest.yml, dist/shellpilot-local.yml, workflow channel yml, or dist/aigshell-local.yml')
    }
    fs.copyFileSync(localMetadataPath, latestPath)
    copiedLatest = true
  }
  copiedLegacyElectronUpdaterMetadata = ensureLegacyElectronUpdaterMetadata(
    latestPath,
    legacyElectronUpdaterMetadataPath
  )

  const manifest = buildUpdateApprovalManifest(version, { channel })
  validateUpdateApprovalManifest(manifest, version, { channel })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  fs.writeFileSync(legacyManifestPath, JSON.stringify(manifest, null, 2) + '\n')
  checksumsPath = writeChecksums({
    distDir,
    version,
    channel,
    files: getRequiredChecksumAssetNames(version, {
      arch: options.arch || process.env.AIGSHELL_RELEASE_ARCH
    })
  }).checksumsPath
  releaseIndexPath = writeUpdateReleaseIndex({
    distDir,
    version,
    arch: options.arch || process.env.AIGSHELL_RELEASE_ARCH
  }).releaseIndexPath

  return {
    copiedLatest,
    copiedLegacyElectronUpdaterMetadata,
    latestPath,
    legacyElectronUpdaterMetadataPath,
    localMetadataPath,
    legacyManifestPath,
    manifestPath,
    checksumsPath,
    releaseIndexPath
  }
}

function main () {
  const result = prepareUpdateAssets()
  console.log('ShellPilot online update assets are prepared.')
  console.log(`- latest.yml: ${result.copiedLatest ? `created from ${path.basename(result.localMetadataPath)}` : 'kept existing file'}`)
  console.log(`- shellpilot-local.yml: ${result.copiedLegacyElectronUpdaterMetadata ? 'synced for legacy in-app updates' : 'kept existing file'}`)
  console.log('- shellpilot-update.json and aigshell-update.json: created and validated')
  console.log('- checksums.json: created')
  console.log('- shellpilot-release.json: created for ModelScope domestic update source')
}

if (require.main === module) {
  main()
}

module.exports = {
  ensureLegacyElectronUpdaterMetadata,
  readUpdateMetadataVersion,
  findUpdateMetadataPath,
  shouldCopyLatestMetadata,
  prepareUpdateAssets
}
