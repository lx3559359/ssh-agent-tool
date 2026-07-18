const fs = require('fs')
const path = require('path')
const {
  buildReleaseTag,
  getRequiredReleaseAssetNames
} = require('./github-release-utils')
const { sha256File } = require('./update-checksums')
const {
  buildModelScopeAssetUrl,
  modelScopeReleaseManifestName,
  modelScopeResolveBaseUrl
} = require('../../src/app/common/update-sources')

function getFileSize (distDir, name) {
  const filePath = path.join(distDir, name)
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : undefined
}

function getFileSha256 (distDir, name) {
  const filePath = path.join(distDir, name)
  return fs.existsSync(filePath) ? sha256File(filePath) : undefined
}

function getReleaseNotes (version) {
  const notesPath = path.resolve(__dirname, '../../docs/releases', `v${version}.md`)
  if (fs.existsSync(notesPath)) {
    const notes = fs.readFileSync(notesPath, 'utf8').trim()
    if (notes) return notes
  }
  return `# ShellPilot v${version}`
}

function buildUpdateReleaseIndex ({
  version,
  distDir,
  arch,
  body,
  publishedAt = new Date().toISOString()
}) {
  const tag = buildReleaseTag(version)
  return {
    tag_name: tag,
    name: `ShellPilot ${tag}`,
    html_url: 'https://modelscope.cn/models/lx3559359/ShellPilot-Updates/files',
    published_at: publishedAt,
    body: String(body || getReleaseNotes(version)).trim(),
    assets: getRequiredReleaseAssetNames(version, { arch })
      .filter(name => name !== modelScopeReleaseManifestName)
      .map(name => ({
        name,
        size: getFileSize(distDir, name),
        sha256: getFileSha256(distDir, name),
        browser_download_url: buildModelScopeAssetUrl(name)
      }))
  }
}

function writeUpdateReleaseIndex (options = {}) {
  const distDir = options.distDir
  if (!distDir) {
    throw new Error('distDir is required')
  }
  const releaseIndex = buildUpdateReleaseIndex(options)
  const releaseIndexPath = path.join(distDir, modelScopeReleaseManifestName)
  fs.writeFileSync(releaseIndexPath, JSON.stringify(releaseIndex, null, 2) + '\n')
  return {
    releaseIndex,
    releaseIndexPath,
    modelScopeResolveBaseUrl
  }
}

module.exports = {
  buildUpdateReleaseIndex,
  getReleaseNotes,
  writeUpdateReleaseIndex
}
