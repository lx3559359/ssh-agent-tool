const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

process.env.NODE_ENV = 'development'

const {
  buildUpgradeEndMessage,
  buildUpgradeErrorMessage,
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
