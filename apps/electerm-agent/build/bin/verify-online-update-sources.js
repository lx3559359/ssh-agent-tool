const axios = require('axios')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const pack = require('../../package.json')
const {
  appendUpdateCacheBuster,
  buildModelScopeAssetUrl,
  modelScopeReleaseManifestName,
  getUpdateReleaseSources
} = require('../../src/app/common/update-sources')
const {
  getRequiredReleaseAssetNames
} = require('./github-release-utils')
const { sha256File } = require('./update-checksums')

axios.defaults.proxy = false

function cleanVersion (value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/i)
  return match ? match[1] : ''
}

function resolveOnlineUpdateVersion (env = process.env, fallback = pack.version) {
  return env.AIGSHELL_RELEASE_VERSION || fallback
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

function getMissingRequiredAssets (release, version, options = {}) {
  const names = new Set((release.assets || []).map(asset => asset.name))
  return getRequiredReleaseAssetNames(version)
    .filter(name => options.excludeReleaseIndex !== true || name !== modelScopeReleaseManifestName)
    .filter(name => !names.has(name))
}

function isModelScopeReleaseIndexSource (source = {}) {
  if (source.id !== 'modelscope') return false
  try {
    const pathname = new URL(source.releaseApiUrl).pathname
    return pathname.split('/').pop() === modelScopeReleaseManifestName
  } catch (error) {
    return false
  }
}

function getExpectedModelScopeAssetUrl (source, name) {
  if (!source?.releaseApiUrl) return buildModelScopeAssetUrl(name)
  const url = new URL(source.releaseApiUrl)
  const segments = url.pathname.split('/')
  segments[segments.length - 1] = encodeURIComponent(name)
  url.pathname = segments.join('/')
  url.search = ''
  url.hash = ''
  return url.toString()
}

function getInvalidModelScopeAssets (release, version, source, approvedAssets) {
  const byName = new Map((release.assets || []).map(asset => [asset.name, asset]))
  return getRequiredReleaseAssetNames(version)
    .filter(name => name !== modelScopeReleaseManifestName)
    .filter(name => {
      const asset = byName.get(name)
      const approved = approvedAssets?.[name]
      return !asset ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0 ||
        !/^[a-f0-9]{64}$/i.test(String(asset.sha256 || '')) ||
        /^0{64}$/i.test(String(asset.sha256 || '')) ||
        asset.browser_download_url !== getExpectedModelScopeAssetUrl(source, name) ||
        (approved && (
          asset.size !== approved.size ||
          String(asset.sha256).toLowerCase() !== approved.sha256
        ))
    })
}

function buildLocalApprovedAssets ({
  distDir = process.env.AIGSHELL_RELEASE_DIST || path.resolve(__dirname, '../../dist'),
  version
}) {
  const approvedAssets = {}
  for (const name of getRequiredReleaseAssetNames(version)) {
    const filePath = path.join(distDir, name)
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Missing local approved release asset: ${name}`)
    }
    const size = fs.statSync(filePath).size
    const sha256 = sha256File(filePath).toLowerCase()
    if (size <= 0 || !/^[a-f0-9]{64}$/.test(sha256) || /^0{64}$/.test(sha256)) {
      throw new Error(`Invalid local approved release asset: ${name}`)
    }
    approvedAssets[name] = { size, sha256 }
  }
  return approvedAssets
}

function downloadAssetDigest (rawUrl, options = {}, redirectCount = 0) {
  const timeoutMs = options.timeoutMs || 30000
  const maxRedirects = options.maxRedirects ?? 5
  let url
  try {
    url = new URL(rawUrl)
  } catch (error) {
    return Promise.reject(new Error(`Invalid asset URL: ${rawUrl}`))
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return Promise.reject(new Error(`Invalid asset URL protocol: ${url.protocol}`))
  }

  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (handler, value) => {
      if (settled) return
      settled = true
      handler(value)
    }
    const request = transport.get(url, {
      headers: {
        'User-Agent': 'ShellPilot update byte verifier'
      }
    }, response => {
      const statusCode = response.statusCode || 0
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        response.resume()
        if (!response.headers.location) {
          finish(reject, new Error(`Redirect missing Location for ${url}`))
          return
        }
        if (redirectCount >= maxRedirects) {
          finish(reject, new Error(`Too many redirects for ${url}`))
          return
        }
        const redirectUrl = new URL(response.headers.location, url).toString()
        finish(resolve, downloadAssetDigest(redirectUrl, options, redirectCount + 1))
        return
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume()
        finish(reject, new Error(`HTTP ${statusCode} while downloading ${url}`))
        return
      }

      const hash = crypto.createHash('sha256')
      let size = 0
      let ended = false
      response.on('data', chunk => {
        size += chunk.length
        hash.update(chunk)
        if (options.expectedSize && size > options.expectedSize) {
          response.destroy(new Error(`Downloaded asset exceeds approved size for ${url}`))
        }
      })
      response.once('aborted', () => {
        finish(reject, new Error(`Response aborted while downloading ${url}`))
      })
      response.once('error', error => finish(reject, error))
      response.once('end', () => {
        ended = true
        finish(resolve, {
          size,
          sha256: hash.digest('hex')
        })
      })
      response.once('close', () => {
        if (!ended) {
          finish(reject, new Error(`Response closed before completion for ${url}`))
        }
      })
    })
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms for ${url}`))
    })
    request.once('error', error => finish(reject, error))
  })
}

async function verifySourceAssetBytes ({
  release,
  source,
  version,
  approvedAssets,
  downloadAsset = downloadAssetDigest
}) {
  const remoteAssets = new Map((release.assets || []).map(asset => [asset.name, asset]))
  if (source.id === 'modelscope') {
    remoteAssets.set(modelScopeReleaseManifestName, {
      name: modelScopeReleaseManifestName,
      browser_download_url: source.releaseApiUrl
    })
  }

  const assetErrors = []
  let verifiedAssetCount = 0
  for (const name of getRequiredReleaseAssetNames(version)) {
    const approved = approvedAssets?.[name]
    const remote = remoteAssets.get(name)
    if (!approved || !remote?.browser_download_url) {
      assetErrors.push({ name, reason: !approved ? 'missing-local-approval' : 'missing-download-url' })
      continue
    }
    if (remote.size !== undefined && remote.size !== approved.size) {
      assetErrors.push({
        name,
        reason: 'declared-size-mismatch',
        expectedSize: approved.size,
        actualSize: remote.size
      })
      continue
    }
    if (remote.sha256 && String(remote.sha256).toLowerCase() !== approved.sha256) {
      assetErrors.push({ name, reason: 'declared-sha256-mismatch' })
      continue
    }
    try {
      const actual = await downloadAsset(remote.browser_download_url, {
        expectedSize: approved.size
      })
      if (actual.size !== approved.size || actual.sha256.toLowerCase() !== approved.sha256) {
        assetErrors.push({
          name,
          reason: 'downloaded-bytes-mismatch',
          expectedSize: approved.size,
          actualSize: actual.size
        })
      } else {
        verifiedAssetCount += 1
      }
    } catch (error) {
      assetErrors.push({
        name,
        reason: 'download-failed',
        message: error?.message || String(error)
      })
    }
  }
  return { assetErrors, verifiedAssetCount }
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
  version,
  approvedAssets,
  downloadAsset = downloadAssetDigest,
  verifyBytes = false
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

    const isModelScope = source.id === 'modelscope'
    if (isModelScope && !isModelScopeReleaseIndexSource(source)) {
      return {
        id: source.id,
        label: source.label,
        ok: false,
        reason: 'missing-release-index',
        version: releaseVersion
      }
    }

    const missingAssets = getMissingRequiredAssets(release, releaseVersion, {
      excludeReleaseIndex: isModelScope
    })
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

    if (isModelScope) {
      const invalidAssets = getInvalidModelScopeAssets(
        release,
        releaseVersion,
        source,
        verifyBytes ? approvedAssets : undefined
      )
      if (invalidAssets.length) {
        return {
          id: source.id,
          label: source.label,
          ok: false,
          reason: 'invalid-assets',
          version: releaseVersion,
          invalidAssets
        }
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

    if (verifyBytes) {
      const verification = await verifySourceAssetBytes({
        release,
        source,
        version: releaseVersion,
        approvedAssets,
        downloadAsset
      })
      if (verification.assetErrors.length) {
        return {
          id: source.id,
          label: source.label,
          ok: false,
          reason: 'byte-verification-failed',
          version: releaseVersion,
          ...verification
        }
      }
      return {
        id: source.id,
        label: source.label,
        ok: true,
        version: releaseVersion,
        verifiedAssetCount: verification.verifiedAssetCount
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
  distDir = process.env.AIGSHELL_RELEASE_DIST || path.resolve(__dirname, '../../dist'),
  downloadAsset = downloadAssetDigest,
  fetchJson = defaultFetchJson,
  sources = getUpdateReleaseSources(),
  strictAllSources = false,
  verifyBytes = false,
  version = resolveOnlineUpdateVersion(process.env, pack.version)
} = {}) {
  let approvedAssets
  if (verifyBytes) {
    try {
      approvedAssets = buildLocalApprovedAssets({ distDir, version: cleanVersion(version) })
    } catch (error) {
      return {
        ok: false,
        selectedSource: null,
        checked: sources.map(source => ({
          id: source.id,
          label: source.label,
          ok: false,
          reason: 'local-approval-failed',
          message: error?.message || String(error)
        }))
      }
    }
  }
  const checked = []
  for (const source of sources) {
    const result = await checkOnlineUpdateSource({
      source,
      currentVersion,
      approvedAssets,
      downloadAsset,
      fetchJson,
      verifyBytes,
      version
    })
    checked.push(result)
    if (result.ok && !strictAllSources) {
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
  if (strictAllSources && checked.length > 0 && checked.every(result => result.ok)) {
    const selected = checked[0]
    return {
      ok: true,
      selectedSource: {
        id: selected.id,
        label: selected.label,
        version: selected.version
      },
      checked
    }
  }
  return {
    ok: false,
    selectedSource: null,
    checked
  }
}

async function main () {
  const report = await buildOnlineUpdateSourceReport({
    strictAllSources: process.argv.includes('--strict-all'),
    verifyBytes: process.argv.includes('--verify-bytes')
  })
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
  buildLocalApprovedAssets,
  buildOnlineUpdateSourceReport,
  checkOnlineUpdateSource,
  cleanVersion,
  downloadAssetDigest,
  getExpectedModelScopeAssetUrl,
  getInvalidModelScopeAssets,
  getMissingRequiredAssets,
  isModelScopeReleaseIndexSource,
  isApprovedManifest,
  resolveOnlineUpdateVersion,
  verifySourceAssetBytes
}
