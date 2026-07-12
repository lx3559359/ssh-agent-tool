const axios = require('axios')
const pack = require('../../package.json')
const {
  appendUpdateCacheBuster,
  getUpdateReleaseSources
} = require('../../src/app/common/update-sources')
const {
  getRequiredReleaseAssetNames
} = require('./github-release-utils')

axios.defaults.proxy = false

function cleanVersion (value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/i)
  return match ? match[1] : ''
}

function compareVersions (left, right) {
  const a = cleanVersion(left).split('.').map(Number)
  const b = cleanVersion(right).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return 1
    if ((a[i] || 0) < (b[i] || 0)) return -1
  }
  return 0
}

function getApprovalManifestAsset (release = {}) {
  const assets = release.assets || []
  return assets.find(asset => asset.name === 'shellpilot-update.json') ||
    assets.find(asset => asset.name === 'aigshell-update.json')
}

function isApprovedManifest (manifest, version) {
  const compatibleProducts = Array.isArray(manifest?.compatibleProducts)
    ? manifest.compatibleProducts
    : [manifest?.product]
  return Boolean(
    manifest &&
    manifest.publishApproved === true &&
    compatibleProducts.some(product => ['ShellPilot', 'AIGShell'].includes(product)) &&
    manifest.channel === 'stable' &&
    cleanVersion(manifest.version) === version
  )
}

function getMissingRequiredAssets (release, version) {
  const names = new Set((release.assets || []).map(asset => asset.name))
  return getRequiredReleaseAssetNames(version)
    .filter(name => !names.has(name))
}

async function defaultFetchJson (url) {
  const res = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'ShellPilot update verifier'
    }
  })
  return res.data
}

async function checkOnlineUpdateSource ({
  source,
  currentVersion,
  fetchJson = defaultFetchJson,
  version
}) {
  try {
    const release = await fetchJson(appendUpdateCacheBuster(source.releaseApiUrl))
    const releaseVersion = cleanVersion(release?.tag_name)
    if (!releaseVersion) {
      return {
        id: source.id,
        label: source.label,
        ok: false,
        reason: 'missing-version'
      }
    }
    if (version && releaseVersion !== cleanVersion(version)) {
      return {
        id: source.id,
        label: source.label,
        ok: false,
        reason: 'unexpected-version',
        version: releaseVersion
      }
    }
    if (compareVersions(releaseVersion, currentVersion) <= 0) {
      return {
        id: source.id,
        label: source.label,
        ok: false,
        reason: 'not-newer',
        version: releaseVersion
      }
    }

    const missingAssets = getMissingRequiredAssets(release, releaseVersion)
    if (missingAssets.length) {
      return {
        id: source.id,
        label: source.label,
        ok: false,
        reason: 'missing-assets',
        version: releaseVersion,
        missingAssets
      }
    }

    const manifestAsset = getApprovalManifestAsset(release)
    const manifest = manifestAsset?.browser_download_url
      ? await fetchJson(appendUpdateCacheBuster(manifestAsset.browser_download_url))
      : null
    if (!isApprovedManifest(manifest, releaseVersion)) {
      return {
        id: source.id,
        label: source.label,
        ok: false,
        reason: 'not-approved',
        version: releaseVersion
      }
    }

    return {
      id: source.id,
      label: source.label,
      ok: true,
      version: releaseVersion
    }
  } catch (error) {
    return {
      id: source.id,
      label: source.label,
      ok: false,
      reason: 'fetch-failed',
      message: error?.message || String(error)
    }
  }
}

async function buildOnlineUpdateSourceReport ({
  currentVersion = '0.2.12',
  fetchJson = defaultFetchJson,
  sources = getUpdateReleaseSources(),
  version = pack.version
} = {}) {
  const checked = []
  for (const source of sources) {
    const result = await checkOnlineUpdateSource({
      source,
      currentVersion,
      fetchJson,
      version
    })
    checked.push(result)
    if (result.ok) {
      return {
        ok: true,
        selectedSource: {
          id: result.id,
          label: result.label,
          version: result.version
        },
        checked
      }
    }
  }
  return {
    ok: false,
    selectedSource: null,
    checked
  }
}

async function main () {
  const report = await buildOnlineUpdateSourceReport()
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) {
    process.exit(1)
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || error)
    process.exit(1)
  })
}

module.exports = {
  buildOnlineUpdateSourceReport,
  checkOnlineUpdateSource,
  cleanVersion,
  getMissingRequiredAssets,
  isApprovedManifest
}
