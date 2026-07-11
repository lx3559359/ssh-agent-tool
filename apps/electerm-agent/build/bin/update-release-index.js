const fs = require('fs')
const path = require('path')
const {
  buildReleaseTag,
  getRequiredReleaseAssetNames
} = require('./github-release-utils')
const {
  buildModelScopeAssetUrl,
  modelScopeReleaseManifestName,
  modelScopeResolveBaseUrl
} = require('../../src/app/common/update-sources')

function getFileSize (distDir, name) {
  const filePath = path.join(distDir, name)
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : undefined
}

function buildUpdateReleaseIndex ({
  version,
  distDir,
  arch,
  body = '',
  publishedAt = new Date().toISOString()
}) {
  const tag = buildReleaseTag(version)
  return {
    tag_name: tag,
    name: `ShellPilot ${tag}`,
    html_url: 'https://modelscope.cn/models/lx3559359/ShellPilot-Updates/files',
    published_at: publishedAt,
    body,
    assets: getRequiredReleaseAssetNames(version, { arch }).map(name => ({
      name,
      size: getFileSize(distDir, name),
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
  writeUpdateReleaseIndex
}
