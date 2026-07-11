const fs = require('fs')
const path = require('path')
const pack = require('../../package.json')
const {
  buildUpdateApprovalManifest,
  normalizeChannel,
  validateUpdateApprovalManifest
} = require('./write-update-approval-manifest')
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

function prepareUpdateAssets (options = {}) {
  const distDir = options.distDir || path.resolve(__dirname, '../../dist')
  const version = options.version || pack.version
  const channel = normalizeChannel(options.channel || process.env.AIGSHELL_UPDATE_CHANNEL)
  const latestPath = path.join(distDir, 'latest.yml')
  const localMetadataPath = findUpdateMetadataPath(distDir, version, options)
  const manifestPath = path.join(distDir, 'aigshell-update.json')
  let releaseIndexPath = ''
  let copiedLatest = false

  fs.mkdirSync(distDir, { recursive: true })

  if (shouldCopyLatestMetadata(latestPath, localMetadataPath, version)) {
    if (!localMetadataPath || !fs.existsSync(localMetadataPath)) {
      throw new Error('Missing update metadata: dist/latest.yml, dist/shellpilot-local.yml, workflow channel yml, or dist/aigshell-local.yml')
    }
    fs.copyFileSync(localMetadataPath, latestPath)
    copiedLatest = true
  }

  const manifest = buildUpdateApprovalManifest(version, { channel })
  validateUpdateApprovalManifest(manifest, version, { channel })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  releaseIndexPath = writeUpdateReleaseIndex({
    distDir,
    version,
    arch: options.arch || process.env.AIGSHELL_RELEASE_ARCH
  }).releaseIndexPath

  return {
    copiedLatest,
    latestPath,
    localMetadataPath,
    manifestPath,
    releaseIndexPath
  }
}

function main () {
  const result = prepareUpdateAssets()
  console.log('ShellPilot online update assets are prepared.')
  console.log(`- latest.yml: ${result.copiedLatest ? `created from ${path.basename(result.localMetadataPath)}` : 'kept existing file'}`)
  console.log('- aigshell-update.json: created and validated')
  console.log('- shellpilot-release.json: created for ModelScope domestic update source')
}

if (require.main === module) {
  main()
}

module.exports = {
  readUpdateMetadataVersion,
  findUpdateMetadataPath,
  shouldCopyLatestMetadata,
  prepareUpdateAssets
}
