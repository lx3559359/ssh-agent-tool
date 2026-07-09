const fs = require('fs')
const path = require('path')
const pack = require('../../package.json')
const {
  buildUpdateApprovalManifest,
  normalizeChannel,
  validateUpdateApprovalManifest
} = require('./write-update-approval-manifest')

function readUpdateMetadataVersion (filePath) {
  if (!fs.existsSync(filePath)) {
    return ''
  }
  const content = fs.readFileSync(filePath, 'utf8')
  const match = content.match(/^version:\s*['"]?([^'"\s]+)['"]?/m)
  return match ? match[1] : ''
}

function prepareUpdateAssets (options = {}) {
  const distDir = options.distDir || path.resolve(__dirname, '../../dist')
  const version = options.version || pack.version
  const channel = normalizeChannel(options.channel || process.env.AIGSHELL_UPDATE_CHANNEL)
  const latestPath = path.join(distDir, 'latest.yml')
  const localMetadataPath = path.join(distDir, 'aigshell-local.yml')
  const manifestPath = path.join(distDir, 'aigshell-update.json')
  let copiedLatest = false

  fs.mkdirSync(distDir, { recursive: true })

  if (!fs.existsSync(latestPath) || readUpdateMetadataVersion(latestPath) !== version) {
    if (!fs.existsSync(localMetadataPath)) {
      throw new Error('Missing update metadata: dist/latest.yml or dist/aigshell-local.yml')
    }
    fs.copyFileSync(localMetadataPath, latestPath)
    copiedLatest = true
  }

  const manifest = buildUpdateApprovalManifest(version, { channel })
  validateUpdateApprovalManifest(manifest, version, { channel })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

  return {
    copiedLatest,
    latestPath,
    manifestPath
  }
}

function main () {
  const result = prepareUpdateAssets()
  console.log('AIGShell online update assets are prepared.')
  console.log(`- latest.yml: ${result.copiedLatest ? 'created from aigshell-local.yml' : 'kept existing file'}`)
  console.log('- aigshell-update.json: created and validated')
}

if (require.main === module) {
  main()
}

module.exports = {
  readUpdateMetadataVersion,
  prepareUpdateAssets
}
