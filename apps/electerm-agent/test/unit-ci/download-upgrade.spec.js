const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

process.env.NODE_ENV = 'development'

const {
  buildUpgradeEndMessage,
  buildUpgradeErrorMessage,
  finishUpgradeDownload,
  getRequiredReleaseAsset,
  selectReleaseAsset
} = require(path.resolve(__dirname, '../../src/app/server/download-upgrade'))

test('upgrade websocket messages use the upgrade channel expected by the client', () => {
  assert.deepEqual(
    buildUpgradeEndMessage('upgrade-1', 'C:\\Temp\\AIGShell.exe'),
    {
      id: 'upgrade:end:upgrade-1',
      data: 'C:\\Temp\\AIGShell.exe'
    }
  )

  const err = new Error('download failed')
  assert.deepEqual(
    buildUpgradeErrorMessage('upgrade-1', err),
    {
      id: 'upgrade:err:upgrade-1',
      error: {
        message: 'download failed',
        stack: err.stack
      }
    }
  )
})

test('selects the Windows installer asset for AIGShell releases before legacy tar archives', () => {
  const release = {
    assets: [
      {
        name: 'AIGShell-3.15.105-win-x64-portable.tar.gz',
        browser_download_url: 'https://example.com/portable.tar.gz'
      },
      {
        name: 'AIGShell-3.15.105-win-x64-installer.exe',
        browser_download_url: 'https://example.com/installer.exe'
      },
      {
        name: 'AIGShell-3.15.105-win-x64-installer.exe.blockmap',
        browser_download_url: 'https://example.com/installer.exe.blockmap'
      }
    ]
  }

  assert.deepEqual(
    selectReleaseAsset(release, {
      isWin: true,
      isMac: false,
      isArm: false,
      installSrc: 'win-x64.tar.gz'
    }),
    release.assets[1]
  )
})

test('selects the Windows installer asset for AIGShell prerelease builds', () => {
  const release = {
    assets: [
      {
        name: 'AIGShell-3.15.106-beta.1-win-x64-installer.exe',
        browser_download_url: 'https://example.com/installer-beta.exe'
      },
      {
        name: 'AIGShell-3.15.106-beta.1-win-x64-installer.exe.blockmap',
        browser_download_url: 'https://example.com/installer-beta.exe.blockmap'
      }
    ]
  }

  assert.deepEqual(
    selectReleaseAsset(release, {
      isWin: true,
      isMac: false,
      isArm: false,
      installSrc: 'win-x64.tar.gz'
    }),
    release.assets[0]
  )
})

test('keeps legacy asset selection as a fallback', () => {
  const release = {
    assets: [
      {
        name: 'AIGShell-3.15.105-win-x64.tar.gz',
        browser_download_url: 'https://example.com/win-x64.tar.gz'
      }
    ]
  }

  assert.deepEqual(
    selectReleaseAsset(release, {
      isWin: true,
      isMac: false,
      isArm: false,
      installSrc: 'win-x64.tar.gz'
    }),
    release.assets[0]
  )
})

test('throws a clear error when the release has no usable asset for this platform', () => {
  const release = {
    tag_name: 'v3.15.106',
    assets: [
      {
        name: 'latest.yml',
        browser_download_url: 'https://example.com/latest.yml'
      }
    ]
  }

  assert.throws(
    () => getRequiredReleaseAsset(release, {
      isWin: true,
      isMac: false,
      isArm: false,
      installSrc: 'win-x64.tar.gz'
    }),
    /未找到适用于当前系统的 AIGShell 更新安装包/
  )
})

test('finishes update downloads only when the installer file is complete', () => {
  const calls = []

  finishUpgradeDownload({
    transferred: 1024,
    expectedSize: 1024,
    onEnd: () => calls.push('end'),
    onError: err => calls.push(err.message)
  })

  finishUpgradeDownload({
    transferred: 128,
    expectedSize: undefined,
    onEnd: () => calls.push('unknown-size-ok'),
    onError: err => calls.push(err.message)
  })

  finishUpgradeDownload({
    transferred: 512,
    expectedSize: 1024,
    onEnd: () => calls.push('bad-end'),
    onError: err => calls.push(err.message)
  })

  assert.deepEqual(calls, [
    'end',
    'unknown-size-ok',
    'AIGShell 更新安装包下载不完整：已下载 512 字节，期望 1024 字节。请重新下载。'
  ])
})
