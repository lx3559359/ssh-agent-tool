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

  assert.deepEqual(
    getReleaseUpdate({ tag_name: 'v3.15.106' }, '3.15.105'),
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

test('recognizes Windows update assets for prerelease versions', async () => {
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
  assert.deepEqual(
    getReleaseUpdate(prerelease, '3.15.105', { requireWindowsAssets: true }),
    { tag_name: 'v3.15.106-beta.1' }
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
  assert.match(upgradeSource, /getLatestReleaseStatus/)
  assert.match(upgradeSource, /manualDownloadRequired/)
  assert.match(upgradeSource, /releaseStatus\.message/)
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

function pathToFileURL (filePath) {
  return new URL(`file://${filePath.replace(/\\/g, '/')}`).href
}
