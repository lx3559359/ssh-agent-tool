function parseVersion (value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/i)
  if (!match) {
    return null
  }
  return {
    numbers: match.slice(1, 4).map(n => Number(n)),
    prerelease: match[4] || ''
  }
}

function cleanVersion (value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/i)
  return match ? match[1] : ''
}

function comparePrerelease (left, right) {
  const a = left.split('.')
  const b = right.split('.')
  const len = Math.max(a.length, b.length)

  for (let i = 0; i < len; i++) {
    const leftPart = a[i]
    const rightPart = b[i]
    if (leftPart === undefined) {
      return -1
    }
    if (rightPart === undefined) {
      return 1
    }
    if (leftPart === rightPart) {
      continue
    }

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) {
      return leftNumber > rightNumber ? 1 : -1
    }
    if (leftNumber !== null) {
      return -1
    }
    if (rightNumber !== null) {
      return 1
    }
    return leftPart > rightPart ? 1 : -1
  }

  return 0
}

export function compareVersions (left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) {
    return 0
  }

  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] > b.numbers[i]) {
      return 1
    }
    if (a.numbers[i] < b.numbers[i]) {
      return -1
    }
  }
  if (!a.prerelease && b.prerelease) {
    return 1
  }
  if (a.prerelease && !b.prerelease) {
    return -1
  }
  if (a.prerelease && b.prerelease) {
    return comparePrerelease(a.prerelease, b.prerelease)
  }
  return 0
}

function getWindowsUpdateArch (options = {}) {
  return options.arch === 'arm64' ? 'arm64' : 'x64'
}

function isPrereleaseRelease (release, version) {
  return Boolean(release?.prerelease || parseVersion(version || release?.tag_name)?.prerelease)
}

function findApprovalManifest (release) {
  if (release?.updateApproval) {
    return release.updateApproval
  }
  return (release?.assets || [])
    .find(asset => asset.name === 'aigshell-update.json')
    ?.updateApproval
}

export function hasApprovedUpdateManifest (release, options = {}) {
  const manifest = findApprovalManifest(release)
  const version = cleanVersion(options.version || release?.tag_name)
  return Boolean(
    manifest &&
    manifest.product === 'AIGShell' &&
    manifest.channel === 'stable' &&
    manifest.publishApproved === true &&
    cleanVersion(manifest.version) === version
  )
}

export function hasWindowsUpdateAssets (release, version, options = {}) {
  const clean = cleanVersion(version || release?.tag_name)
  if (!clean) {
    return false
  }
  const names = new Set((release?.assets || []).map(asset => asset.name))
  const installer = `AIGShell-${clean}-win-${getWindowsUpdateArch(options)}-installer.exe`
  return names.has(installer) &&
    names.has(`${installer}.blockmap`) &&
    names.has('latest.yml')
}

export function getReleaseUpdate (release, currentVersion, options = {}) {
  const tagName = release?.tag_name
  if (!tagName) {
    return undefined
  }
  if (!options.allowPrerelease && isPrereleaseRelease(release, tagName)) {
    return undefined
  }
  if (compareVersions(tagName, currentVersion) <= 0) {
    return undefined
  }
  if (options.requireWindowsAssets && !hasWindowsUpdateAssets(release, tagName, options)) {
    return undefined
  }
  if (options.requireApprovalManifest && !hasApprovedUpdateManifest(release, { version: tagName })) {
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
  if (!options.allowPrerelease && isPrereleaseRelease(release, tagName)) {
    return {
      status: 'current',
      message: '当前暂无正式稳定版更新。'
    }
  }
  if (compareVersions(tagName, currentVersion) <= 0) {
    return {
      status: 'current',
      message: '当前已经是最新版本。'
    }
  }
  if (options.requireWindowsAssets && !hasWindowsUpdateAssets(release, tagName, options)) {
    return {
      status: 'manualDownloadRequired',
      tag_name: tagName,
      html_url: release.html_url,
      message: `检测到新版本 ${tagName}，但缺少 Windows 自动更新文件，请前往 GitHub Releases 手动下载。`
    }
  }
  if (options.requireApprovalManifest && !hasApprovedUpdateManifest(release, { version: tagName })) {
    return {
      status: 'waitingForApproval',
      tag_name: tagName,
      html_url: release.html_url,
      message: `检测到新版本 ${tagName}，但该版本尚未被标记为正式可更新版本。`
    }
  }
  return {
    status: 'update',
    tag_name: tagName
  }
}
