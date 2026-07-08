const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('detects only newer GitHub release versions as updates', async () => {
  const {
    compareVersions,
    getReleaseUpdate
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/update-version.js')))

  assert.equal(compareVersions('3.15.106', '3.15.105'), 1)
  assert.equal(compareVersions('v3.15.105', '3.15.105'), 0)
  assert.equal(compareVersions('3.15.104', '3.15.105'), -1)
  assert.equal(compareVersions('3.16.0', '3.15.105'), 1)
  assert.equal(compareVersions('4.0.0', '3.15.105'), 1)
  assert.equal(compareVersions('3.15.106', '3.15.106-beta.1'), 1)
  assert.equal(compareVersions('3.15.106-beta.1', '3.15.106'), -1)
  assert.equal(compareVersions('3.15.106-beta.2', '3.15.106-beta.1'), 1)
  assert.equal(compareVersions('3.15.106-beta.1', '3.15.106-beta.2'), -1)

  assert.deepEqual(
    getReleaseUpdate({ tag_name: 'v3.15.106' }, '3.15.105'),
    { tag_name: 'v3.15.106' }
  )
  assert.deepEqual(
    getReleaseUpdate({ tag_name: 'v3.15.106' }, '3.15.106-beta.1'),
    { tag_name: 'v3.15.106' }
  )
  assert.equal(getReleaseUpdate({ tag_name: 'v3.15.105' }, '3.15.105'), undefined)
  assert.equal(getReleaseUpdate({ tag_name: 'v3.15.104' }, '3.15.105'), undefined)
  assert.equal(getReleaseUpdate({ tag_name: 'not-a-version' }, '3.15.105'), undefined)
})

test('requires Windows update assets when validating an automatic update release', async () => {
  const {
    getReleaseUpdate,
    hasWindowsUpdateAssets
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/update-version.js')))

  const completeRelease = {
    tag_name: 'v3.15.106',
    assets: [
      { name: 'AIGShell-3.15.106-win-x64-installer.exe' },
      { name: 'AIGShell-3.15.106-win-x64-installer.exe.blockmap' },
      { name: 'latest.yml' }
    ]
  }
  const incompleteRelease = {
    tag_name: 'v3.15.106',
    assets: [
      { name: 'latest.yml' }
    ]
  }

  assert.equal(hasWindowsUpdateAssets(completeRelease, '3.15.106'), true)
  assert.equal(hasWindowsUpdateAssets(incompleteRelease, '3.15.106'), false)
  assert.deepEqual(
    getReleaseUpdate(completeRelease, '3.15.105', { requireWindowsAssets: true }),
    { tag_name: 'v3.15.106' }
  )
  assert.equal(
    getReleaseUpdate(incompleteRelease, '3.15.105', { requireWindowsAssets: true }),
    undefined
  )
})

test('requires an approved stable release manifest before allowing online updates', async () => {
  const {
    getReleaseUpdate,
    getReleaseUpdateStatus,
    hasApprovedUpdateManifest
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/update-version.js')))

  const baseRelease = {
    tag_name: 'v3.15.106',
    assets: [
      { name: 'AIGShell-3.15.106-win-x64-installer.exe' },
      { name: 'AIGShell-3.15.106-win-x64-installer.exe.blockmap' },
      { name: 'latest.yml' }
    ]
  }
  const approvedRelease = {
    ...baseRelease,
    assets: [
      ...baseRelease.assets,
      {
        name: 'aigshell-update.json',
        browser_download_url: 'https://example.com/aigshell-update.json',
        updateApproval: {
          product: 'AIGShell',
          channel: 'stable',
          publishApproved: true,
          version: '3.15.106'
        }
      }
    ]
  }
  const unapprovedRelease = {
    ...baseRelease,
    assets: [
      ...baseRelease.assets,
      {
        name: 'aigshell-update.json',
        updateApproval: {
          product: 'AIGShell',
          channel: 'stable',
          publishApproved: false,
          version: '3.15.106'
        }
      }
    ]
  }

  assert.equal(hasApprovedUpdateManifest(baseRelease), false)
  assert.equal(hasApprovedUpdateManifest(unapprovedRelease), false)
  assert.equal(hasApprovedUpdateManifest(approvedRelease), true)
  assert.equal(
    getReleaseUpdate(baseRelease, '3.15.105', { requireWindowsAssets: true, requireApprovalManifest: true }),
    undefined
  )
  assert.equal(
    getReleaseUpdate(unapprovedRelease, '3.15.105', { requireWindowsAssets: true, requireApprovalManifest: true }),
    undefined
  )
  assert.deepEqual(
    getReleaseUpdate(approvedRelease, '3.15.105', { requireWindowsAssets: true, requireApprovalManifest: true }),
    { tag_name: 'v3.15.106' }
  )
  assert.deepEqual(
    getReleaseUpdateStatus(baseRelease, '3.15.105', { requireWindowsAssets: true, requireApprovalManifest: true }),
    {
      status: 'waitingForApproval',
      tag_name: 'v3.15.106',
      html_url: undefined,
      message: '检测到新版本 v3.15.106，但该版本尚未被标记为正式可更新版本。'
    }
  )
})

test('ignores prerelease versions unless explicitly allowed', async () => {
  const {
    getReleaseUpdate,
    hasWindowsUpdateAssets
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/update-version.js')))

  const prerelease = {
    tag_name: 'v3.15.106-beta.1',
    assets: [
      { name: 'AIGShell-3.15.106-beta.1-win-x64-installer.exe' },
      { name: 'AIGShell-3.15.106-beta.1-win-x64-installer.exe.blockmap' },
      { name: 'latest.yml' }
    ]
  }

  assert.equal(hasWindowsUpdateAssets(prerelease, prerelease.tag_name), true)
  assert.equal(
    getReleaseUpdate(prerelease, '3.15.105', { requireWindowsAssets: true }),
    undefined
  )
  assert.deepEqual(
    getReleaseUpdate(prerelease, '3.15.105', { requireWindowsAssets: true, allowPrerelease: true }),
    { tag_name: 'v3.15.106-beta.1' }
  )
})

test('recognizes Windows update assets for Windows ARM64 builds', async () => {
  const {
    getReleaseUpdate,
    hasWindowsUpdateAssets
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/update-version.js')))

  const armRelease = {
    tag_name: 'v3.15.106',
    assets: [
      { name: 'AIGShell-3.15.106-win-arm64-installer.exe' },
      { name: 'AIGShell-3.15.106-win-arm64-installer.exe.blockmap' },
      { name: 'latest.yml' }
    ]
  }

  assert.equal(hasWindowsUpdateAssets(armRelease, '3.15.106', { arch: 'arm64' }), true)
  assert.deepEqual(
    getReleaseUpdate(armRelease, '3.15.105', { requireWindowsAssets: true, arch: 'arm64' }),
    { tag_name: 'v3.15.106' }
  )
})

test('classifies release check results for actionable update messages', async () => {
  const {
    getReleaseUpdateStatus
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/update-version.js')))

  const completeRelease = {
    tag_name: 'v3.15.106',
    assets: [
      { name: 'AIGShell-3.15.106-win-x64-installer.exe' },
      { name: 'AIGShell-3.15.106-win-x64-installer.exe.blockmap' },
      { name: 'latest.yml' }
    ]
  }
  const incompleteRelease = {
    tag_name: 'v3.15.106',
    html_url: 'https://github.com/lx3559359/ssh-agent-tool/releases/tag/v3.15.106',
    assets: [
      { name: 'latest.yml' }
    ]
  }

  assert.deepEqual(
    getReleaseUpdateStatus(null, '3.15.105', { requireWindowsAssets: true }),
    {
      status: 'unavailable',
      message: '无法获取版本信息，请检查网络、代理设置，或前往 GitHub Releases 手动查看。'
    }
  )
  assert.deepEqual(
    getReleaseUpdateStatus({ tag_name: 'v3.15.105' }, '3.15.105', { requireWindowsAssets: true }),
    {
      status: 'current',
      message: '当前已经是最新版本。'
    }
  )
  assert.deepEqual(
    getReleaseUpdateStatus(incompleteRelease, '3.15.105', { requireWindowsAssets: true }),
    {
      status: 'manualDownloadRequired',
      tag_name: 'v3.15.106',
      html_url: 'https://github.com/lx3559359/ssh-agent-tool/releases/tag/v3.15.106',
      message: '检测到新版本 v3.15.106，但缺少 Windows 自动更新文件，请前往 GitHub Releases 手动下载。'
    }
  )
  assert.deepEqual(
    getReleaseUpdateStatus(completeRelease, '3.15.105', { requireWindowsAssets: true }),
    {
      status: 'update',
      tag_name: 'v3.15.106'
    }
  )
})

test('upgrade flow uses classified release status for manual update guidance', () => {
  const updateCheckSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/common/update-check.js'),
    'utf8'
  )
  const upgradeSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/upgrade.jsx'),
    'utf8'
  )

  assert.match(updateCheckSource, /getLatestReleaseStatus/)
  assert.match(updateCheckSource, /getReleaseUpdateStatus/)
  assert.match(updateCheckSource, /attachUpdateApprovalManifest/)
  assert.match(updateCheckSource, /requireApprovalManifest:\s*true/)
  assert.match(upgradeSource, /getLatestReleaseStatus/)
  assert.match(upgradeSource, /manualDownloadRequired/)
  assert.match(upgradeSource, /waitingForApproval/)
  assert.match(upgradeSource, /releaseStatus\.message/)
  assert.ok(
    upgradeSource.indexOf("releaseStatus.status === 'waitingForApproval'") <
    upgradeSource.indexOf('const shouldUpgrade = compare(currentVer, latestVer) < 0'),
    'unapproved releases must be stopped before the upgrade modal can be shown'
  )
})

test('upgrade panel hides the automatic upgrade action when only manual download is available', () => {
  const upgradeSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/upgrade.jsx'),
    'utf8'
  )

  assert.match(upgradeSource, /canAutoUpgrade/)
  assert.match(
    upgradeSource,
    /if\s*\([^)]*!canAutoUpgrade[^)]*\)\s*{\s*return\s+this\.renderLinks\(\)/s
  )
})

test('upgrade panel links manual downloads to the concrete release when available', () => {
  const upgradeSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/upgrade.jsx'),
    'utf8'
  )

  assert.match(upgradeSource, /manualDownloadUrl:\s*releaseStatus\.html_url/)
  assert.match(upgradeSource, /manualDownloadUrl\s*=\s*packInfo\.releases/)
  assert.match(upgradeSource, /const\s+links\s*=\s*\[\s*{\s*name:\s*'GitHub Releases',\s*url:\s*manualDownloadUrl\s*}\s*\]/s)
})

test('upgrade panel gives users a rollback hint after manual or automatic updates', () => {
  const upgradeSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/upgrade.jsx'),
    'utf8'
  )

  assert.match(upgradeSource, /renderRollbackHint/)
  assert.match(upgradeSource, /回滚/)
  assert.match(upgradeSource, /上一稳定版本/)
  assert.match(upgradeSource, /覆盖安装/)
  assert.match(upgradeSource, /this\.renderRollbackHint\(\)/)
})

function pathToFileURL (filePath) {
  return new URL(`file://${filePath.replace(/\\/g, '/')}`).href
}
