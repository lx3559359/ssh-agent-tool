const { app } = require('electron')
const axios = require('axios')
const { autoUpdater } = require('electron-updater')
const log = require('../common/log')
const { createProxyAgent } = require('./proxy-agent')
const compareVersions = require('../common/version-compare')
const {
  isWin,
  isMac,
  isArm,
  packInfo
} = require('../common/app-props')
const {
  appendUpdateCacheBuster,
  getUpdateReleaseSources,
  githubFeedConfig
} = require('../common/update-sources')

axios.defaults.proxy = false

const state = {
  configured: false,
  checking: false,
  downloading: false,
  downloaded: false,
  available: false,
  percent: 0,
  version: '',
  error: '',
  updateSource: '',
  updateSourceLabel: ''
}

function cleanVersion (value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/i)
  return match ? match[1] : ''
}

function getUpdateChannel (config = {}) {
  return config.updateChannel === 'beta' ? 'beta' : 'stable'
}

function getWindowsArch () {
  return isArm ? 'arm64' : 'x64'
}

function getWindowsInstallerNames (version) {
  const arch = getWindowsArch()
  return [
    `ShellPilot-${version}-win-${arch}-installer.exe`,
    `AIGShell-${version}-win-${arch}-installer.exe`
  ]
}

function getAssetNames (release = {}) {
  return new Set((release.assets || []).map(asset => asset.name))
}

function hasWindowsUpdateAssets (release, version) {
  const names = getAssetNames(release)
  return getWindowsInstallerNames(version).some(name => {
    return names.has(name) && names.has(`${name}.blockmap`)
  }) && names.has('latest.yml')
}

function getApprovalManifestAsset (release = {}) {
  const assets = release.assets || []
  return assets.find(asset => asset.name === 'shellpilot-update.json') ||
    assets.find(asset => asset.name === 'aigshell-update.json')
}

function isApprovedManifest (manifest, version, config = {}) {
  const compatibleProducts = Array.isArray(manifest?.compatibleProducts)
    ? manifest.compatibleProducts
    : [manifest?.product]
  return Boolean(
    manifest &&
    manifest.publishApproved === true &&
    compatibleProducts.some(product => ['ShellPilot', 'AIGShell'].includes(product)) &&
    manifest.channel === getUpdateChannel(config) &&
    cleanVersion(manifest.version) === version
  )
}

function buildRequestOptions (proxy) {
  const agent = createProxyAgent(proxy)
  return {
    timeout: 15000,
    headers: {
      'User-Agent': 'ShellPilot updater'
    },
    ...(agent ? { httpAgent: agent, httpsAgent: agent } : {})
  }
}

async function fetchJson (url, proxy) {
  const res = await axios.get(url, buildRequestOptions(proxy))
  return res.data
}

async function fetchApprovedReleaseFromSource (source, options = {}) {
  try {
    const release = await fetchJson(appendUpdateCacheBuster(source.releaseApiUrl), options.proxy)
    const version = cleanVersion(release?.tag_name)
    if (!version) {
      return null
    }
    const manifestAsset = getApprovalManifestAsset(release)
    const manifestUrl = manifestAsset?.browser_download_url
    const manifest = manifestUrl ? await fetchJson(appendUpdateCacheBuster(manifestUrl), options.proxy) : null
    return {
      release: {
        ...release,
        updateSource: source.id,
        updateSourceLabel: source.label
      },
      version,
      manifest,
      source
    }
  } catch (error) {
    log.warn('ShellPilot update source failed', {
      source: source.id,
      message: error?.message || String(error)
    })
    return null
  }
}

async function fetchApprovedRelease (options = {}) {
  for (const source of getUpdateReleaseSources()) {
    const result = await fetchApprovedReleaseFromSource(source, options)
    if (result) {
      return result
    }
  }
  return {
    release: null,
    version: '',
    manifest: null,
    source: null
  }
}

async function validateApprovedRelease (options = {}) {
  const currentVersion = cleanVersion(options.currentVersion || packInfo.version)
  const {
    release,
    version,
    manifest,
    source
  } = await fetchApprovedRelease(options)

  if (!version) {
    return {
      status: 'unavailable',
      message: '无法获取更新版本信息。'
    }
  }
  if (compareVersions('v' + version, 'v' + currentVersion) <= 0) {
    return {
      status: 'current',
      version,
      message: '当前已经是最新版本。'
    }
  }
  if (isWin && !hasWindowsUpdateAssets(release, version)) {
    return {
      status: 'manualDownloadRequired',
      version,
      message: '新版本缺少 Windows 自动更新文件。'
    }
  }
  if (!isApprovedManifest(manifest, version, options.config)) {
    return {
      status: 'waitingForApproval',
      version,
      message: '检测到新版本，但该版本尚未被标记为正式可更新版本。'
    }
  }
  return {
    status: 'update',
    version,
    release,
    source
  }
}

function cloneState (extra = {}) {
  return {
    ...state,
    ...extra
  }
}

function updateState (updates) {
  Object.assign(state, updates)
  log.info('ShellPilot native update state', cloneState())
  return cloneState()
}

function configureNativeUpdater (feedConfig = githubFeedConfig) {
  if (!state.configured) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = log
    autoUpdater.on('checking-for-update', () => {
      updateState({
        checking: true,
        error: ''
      })
    })
    autoUpdater.on('update-available', info => {
      updateState({
        checking: false,
        available: true,
        version: cleanVersion(info?.version || state.version)
      })
    })
    autoUpdater.on('update-not-available', () => {
      updateState({
        checking: false,
        available: false,
        downloading: false
      })
    })
    autoUpdater.on('download-progress', progress => {
      updateState({
        downloading: true,
        percent: Math.max(0, Math.min(progress?.percent || 0, 100))
      })
    })
    autoUpdater.on('update-downloaded', info => {
      updateState({
        downloading: false,
        downloaded: true,
        percent: 100,
        version: cleanVersion(info?.version || state.version)
      })
    })
    autoUpdater.on('error', err => {
      updateState({
        checking: false,
        downloading: false,
        error: err?.message || '自动更新失败'
      })
    })
    state.configured = true
  }
  autoUpdater.setFeedURL(feedConfig)
}

function isNativeUpdaterSupported () {
  return (isWin || isMac) && app.isPackaged
}

async function nativeUpdateCheck (options = {}) {
  if (!isNativeUpdaterSupported()) {
    return cloneState({
      status: 'unsupported',
      message: '当前运行环境不支持客户端内自动更新。'
    })
  }
  const approved = await validateApprovedRelease(options)
  if (approved.status !== 'update') {
    updateState({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      error: ''
    })
    return {
      ...cloneState(),
      ...approved
    }
  }
  configureNativeUpdater(approved.source?.feedConfig)
  updateState({
    checking: true,
    available: true,
    version: approved.version,
    updateSource: approved.source?.id || '',
    updateSourceLabel: approved.source?.label || '',
    error: ''
  })
  await autoUpdater.checkForUpdates()
  return cloneState({
    status: 'update',
    version: approved.version
  })
}

async function nativeUpdateDownload (options = {}) {
  if (!isNativeUpdaterSupported()) {
    return cloneState({
      status: 'unsupported',
      message: '当前运行环境不支持客户端内自动更新。'
    })
  }
  const approved = await validateApprovedRelease(options)
  if (approved.status !== 'update') {
    return {
      ...cloneState(),
      ...approved
    }
  }
  configureNativeUpdater(approved.source?.feedConfig)
  updateState({
    available: true,
    downloading: true,
    downloaded: false,
    percent: 0,
    version: approved.version,
    updateSource: approved.source?.id || '',
    updateSourceLabel: approved.source?.label || '',
    error: ''
  })
  await autoUpdater.downloadUpdate()
  return cloneState({
    status: 'downloading',
    version: approved.version
  })
}

function nativeUpdateInstall () {
  if (!state.downloaded) {
    return cloneState({
      status: 'notDownloaded',
      message: '更新文件尚未下载完成。'
    })
  }
  autoUpdater.quitAndInstall(true, true)
  return cloneState({
    status: 'installing'
  })
}

function nativeUpdateState () {
  return cloneState()
}

module.exports = {
  cleanVersion,
  configureNativeUpdater,
  feedConfig: githubFeedConfig,
  fetchApprovedRelease,
  getWindowsInstallerNames,
  hasWindowsUpdateAssets,
  isApprovedManifest,
  nativeUpdateCheck,
  nativeUpdateDownload,
  nativeUpdateInstall,
  nativeUpdateState,
  validateApprovedRelease
}
