const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  buildOnlineUpdateSourceReport,
  resolveOnlineUpdateVersion
} = require(path.resolve(__dirname, '../../build/bin/verify-online-update-sources'))

function asset (name, extra = {}) {
  return {
    name,
    browser_download_url: `https://example.com/${name}`,
    ...extra
  }
}

function release (version, assets) {
  return {
    tag_name: `v${version}`,
    assets
  }
}

function approvedManifest (version) {
  return {
    product: 'ShellPilot',
    compatibleProducts: ['ShellPilot', 'AIGShell'],
    channel: 'stable',
    publishApproved: true,
    version
  }
}

test('online update source verifier falls back from an invalid domestic source to GitHub', async () => {
  const version = '0.3.5'
  const shellPilotAssets = [
    asset(`ShellPilot-${version}-win-x64-installer.exe`),
    asset(`ShellPilot-${version}-win-x64-installer.exe.blockmap`),
    asset('latest.yml'),
    asset('shellpilot-local.yml'),
    asset('aigshell-update.json'),
    asset('shellpilot-update.json'),
    asset('checksums.json'),
    asset('shellpilot-release.json')
  ]
  const sources = [
    { id: 'modelscope', label: 'ModelScope 国内更新源', releaseApiUrl: 'https://mirror.invalid/release.json' },
    { id: 'github', label: 'GitHub Releases', releaseApiUrl: 'https://github.example/release.json' }
  ]
  const fetchJson = async url => {
    if (url.startsWith('https://mirror.invalid/')) {
      return { Success: false, Message: '文件内容为空' }
    }
    if (url.startsWith('https://github.example/release.json')) {
      return release(version, shellPilotAssets)
    }
    if (url.includes('/shellpilot-update.json')) {
      return approvedManifest(version)
    }
    throw new Error(`unexpected url ${url}`)
  }

  assert.deepEqual(
    await buildOnlineUpdateSourceReport({
      currentVersion: '0.2.12',
      fetchJson,
      sources,
      version
    }),
    {
      ok: true,
      selectedSource: {
        id: 'github',
        label: 'GitHub Releases',
        version
      },
      checked: [
        {
          id: 'modelscope',
          label: 'ModelScope 国内更新源',
          ok: false,
          reason: 'missing-version'
        },
        {
          id: 'github',
          label: 'GitHub Releases',
          ok: true,
          version
        }
      ]
    }
  )
})

test('online update source verifier rejects releases missing automatic update assets', async () => {
  const version = '0.3.5'
  const sources = [
    { id: 'github', label: 'GitHub Releases', releaseApiUrl: 'https://github.example/release.json' }
  ]
  const fetchJson = async url => {
    if (url.startsWith('https://github.example/release.json')) {
      return release(version, [
        asset(`ShellPilot-${version}-win-x64-installer.exe`),
        asset('latest.yml'),
        asset('shellpilot-update.json')
      ])
    }
    if (url.includes('/shellpilot-update.json')) {
      return approvedManifest(version)
    }
    throw new Error(`unexpected url ${url}`)
  }

  const report = await buildOnlineUpdateSourceReport({
    currentVersion: '0.2.12',
    fetchJson,
    sources,
    version
  })

  assert.equal(report.ok, false)
  assert.deepEqual(report.selectedSource, null)
  assert.equal(report.checked[0].reason, 'missing-assets')
  assert.deepEqual(report.checked[0].missingAssets, [
    `ShellPilot-${version}-win-x64-installer.exe.blockmap`,
    'shellpilot-local.yml',
    'aigshell-update.json',
    'checksums.json',
    'shellpilot-release.json'
  ])
})

test('online update source verifier can target an explicit published version from CI', () => {
  assert.equal(
    resolveOnlineUpdateVersion({ AIGSHELL_RELEASE_VERSION: '0.3.5' }, '0.3.4'),
    '0.3.5'
  )
  assert.equal(resolveOnlineUpdateVersion({}, '0.3.4'), '0.3.4')
})
