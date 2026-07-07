function parseVersion (value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i)
  if (!match) {
    return null
  }
  return match.slice(1, 4).map(n => Number(n))
}

function cleanVersion (value) {
  const version = parseVersion(value)
  return version ? version.join('.') : ''
}

export function compareVersions (left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) {
    return 0
  }

  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) {
      return 1
    }
    if (a[i] < b[i]) {
      return -1
    }
  }
  return 0
}

export function hasWindowsUpdateAssets (release, version) {
  const clean = cleanVersion(version || release?.tag_name)
  if (!clean) {
    return false
  }
  const names = new Set((release?.assets || []).map(asset => asset.name))
  const installer = `AIGShell-${clean}-win-x64-installer.exe`
  return names.has(installer) &&
    names.has(`${installer}.blockmap`) &&
    names.has('latest.yml')
}

export function getReleaseUpdate (release, currentVersion, options = {}) {
  const tagName = release?.tag_name
  if (!tagName) {
    return undefined
  }
  if (compareVersions(tagName, currentVersion) <= 0) {
    return undefined
  }
  if (options.requireWindowsAssets && !hasWindowsUpdateAssets(release, tagName)) {
    return undefined
  }
  return {
    tag_name: tagName
  }
}

export function getReleaseUpdateStatus (release, currentVersion, options = {}) {
  const tagName = release?.tag_name
  if (!tagName) {
    return {
      status: 'unavailable',
      message: '无法获取版本信息，请检查网络、代理设置，或前往 GitHub Releases 手动查看。'
    }
  }
  if (compareVersions(tagName, currentVersion) <= 0) {
    return {
      status: 'current',
      message: '当前已经是最新版本。'
    }
  }
  if (options.requireWindowsAssets && !hasWindowsUpdateAssets(release, tagName)) {
    return {
      status: 'manualDownloadRequired',
      tag_name: tagName,
      html_url: release.html_url,
      message: `检测到新版本 ${tagName}，但缺少 Windows 自动更新文件，请前往 GitHub Releases 手动下载。`
    }
  }
  return {
    status: 'update',
    tag_name: tagName
  }
}
