const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  buildOnlineUpdateSourceReport,
  resolveOnlineUpdateVersion
} = require(path.resolve(__dirname, '../../build/bin/verify-online-update-sources'))
const {
  prepareUpdateAssets
} = require(path.resolve(__dirname, '../../build/bin/prepare-update-assets'))

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

function prepareRealModelScopeRelease (version) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-modelscope-index-'))
  fs.writeFileSync(path.join(tempDir, 'shellpilot-local.yml'), `version: ${version}\n`)
  fs.writeFileSync(path.join(tempDir, `ShellPilot-${version}-win-x64-installer.exe`), 'installer')
  fs.writeFileSync(path.join(tempDir, `ShellPilot-${version}-win-x64-installer.exe.blockmap`), 'blockmap')
  prepareUpdateAssets({
    distDir: tempDir,
    version,
    channel: 'stable'
  })
  return {
    tempDir,
    releaseIndex: JSON.parse(fs.readFileSync(path.join(tempDir, 'shellpilot-release.json'), 'utf8')),
    approval: JSON.parse(fs.readFileSync(path.join(tempDir, 'shellpilot-update.json'), 'utf8'))
  }
}

test('online update source verifier accepts the real generated ModelScope release index without self-reference', async () => {
  const version = '3.15.107'
  const fixture = prepareRealModelScopeRelease(version)
  const source = {
    id: 'modelscope',
    label: 'ModelScope domestic update source',
    releaseApiUrl: 'https://modelscope.cn/models/lx3559359/ShellPilot-Updates/resolve/master/shellpilot-release.json'
  }
  try {
    assert.equal(fixture.releaseIndex.assets.some(item => item.name === 'shellpilot-release.json'), false)
    const report = await buildOnlineUpdateSourceReport({
      currentVersion: '3.15.106',
      version,
      sources: [source],
      fetchJson: async url => {
        if (url.startsWith(source.releaseApiUrl)) return fixture.releaseIndex
        if (url.includes('/shellpilot-update.json')) return fixture.approval
        throw new Error(`unexpected url ${url}`)
      }
    })

    assert.deepEqual(report, {
      ok: true,
      selectedSource: {
        id: 'modelscope',
        label: source.label,
        version
      },
      checked: [{
        id: 'modelscope',
        label: source.label,
        ok: true,
        version
      }]
    })
  } finally {
    fs.rmSync(fixture.tempDir, { recursive: true, force: true })
  }
})

test('online update source verifier rejects incomplete ModelScope asset metadata', async () => {
  const version = '3.15.107'
  const fixture = prepareRealModelScopeRelease(version)
  const source = {
    id: 'modelscope',
    label: 'ModelScope domestic update source',
    releaseApiUrl: 'https://modelscope.cn/models/lx3559359/ShellPilot-Updates/resolve/master/shellpilot-release.json'
  }
  try {
    const installer = fixture.releaseIndex.assets.find(item => item.name.endsWith('installer.exe'))
    const latest = fixture.releaseIndex.assets.find(item => item.name === 'latest.yml')
    const checksums = fixture.releaseIndex.assets.find(item => item.name === 'checksums.json')
    installer.size = 0
    latest.sha256 = 'not-a-sha256'
    checksums.browser_download_url = 'https://example.com/checksums.json'

    const report = await buildOnlineUpdateSourceReport({
      currentVersion: '3.15.106',
      version,
      sources: [source],
      fetchJson: async url => {
        if (url.startsWith(source.releaseApiUrl)) return fixture.releaseIndex
        if (url.includes('/shellpilot-update.json')) return fixture.approval
        throw new Error(`unexpected url ${url}`)
      }
    })

    assert.equal(report.ok, false)
    assert.equal(report.checked[0].reason, 'invalid-assets')
    assert.deepEqual(report.checked[0].invalidAssets, [
      `ShellPilot-${version}-win-x64-installer.exe`,
      'latest.yml',
      'checksums.json'
    ])
  } finally {
    fs.rmSync(fixture.tempDir, { recursive: true, force: true })
  }
})

test('ModelScope verification requires shellpilot-release.json as the fetched top-level index', async () => {
  const version = '3.15.107'
  const fixture = prepareRealModelScopeRelease(version)
  const source = {
    id: 'modelscope',
    label: 'ModelScope domestic update source',
    releaseApiUrl: 'https://modelscope.cn/models/lx3559359/ShellPilot-Updates/resolve/master/release.json'
  }
  try {
    const report = await buildOnlineUpdateSourceReport({
      currentVersion: '3.15.106',
      version,
      sources: [source],
      fetchJson: async url => {
        if (url.startsWith(source.releaseApiUrl)) return fixture.releaseIndex
        if (url.includes('/shellpilot-update.json')) return fixture.approval
        throw new Error(`unexpected url ${url}`)
      }
    })

    assert.equal(report.ok, false)
    assert.equal(report.checked[0].reason, 'missing-release-index')
  } finally {
    fs.rmSync(fixture.tempDir, { recursive: true, force: true })
  }
})

test('ModelScope verification still requires every nested update asset and exact release version', async () => {
  const version = '3.15.107'
  const fixture = prepareRealModelScopeRelease(version)
  const source = {
    id: 'modelscope',
    label: 'ModelScope domestic update source',
    releaseApiUrl: 'https://modelscope.cn/models/lx3559359/ShellPilot-Updates/resolve/master/shellpilot-release.json'
  }
  try {
    fixture.releaseIndex.assets = fixture.releaseIndex.assets.filter(item => !item.name.endsWith('.blockmap'))
    const missingReport = await buildOnlineUpdateSourceReport({
      currentVersion: '3.15.106',
      version,
      sources: [source],
      fetchJson: async url => {
        if (url.startsWith(source.releaseApiUrl)) return fixture.releaseIndex
        if (url.includes('/shellpilot-update.json')) return fixture.approval
        throw new Error(`unexpected url ${url}`)
      }
    })
    assert.equal(missingReport.checked[0].reason, 'missing-assets')
    assert.deepEqual(missingReport.checked[0].missingAssets, [
      `ShellPilot-${version}-win-x64-installer.exe.blockmap`
    ])

    fixture.releaseIndex.tag_name = 'v3.15.108'
    const versionReport = await buildOnlineUpdateSourceReport({
      currentVersion: '3.15.106',
      version,
      sources: [source],
      fetchJson: async url => {
        if (url.startsWith(source.releaseApiUrl)) return fixture.releaseIndex
        throw new Error(`unexpected url ${url}`)
      }
    })
    assert.equal(versionReport.checked[0].reason, 'unexpected-version')
    assert.equal(versionReport.checked[0].version, '3.15.108')
  } finally {
    fs.rmSync(fixture.tempDir, { recursive: true, force: true })
  }
})

test('GitHub Releases still requires shellpilot-release.json as a separately uploaded asset', async () => {
  const version = '3.15.107'
  const source = {
    id: 'github',
    label: 'GitHub Releases',
    releaseApiUrl: 'https://github.example/release.json'
  }
  const assets = [
    asset(`ShellPilot-${version}-win-x64-installer.exe`),
    asset(`ShellPilot-${version}-win-x64-installer.exe.blockmap`),
    asset('latest.yml'),
    asset('shellpilot-local.yml'),
    asset('aigshell-update.json'),
    asset('shellpilot-update.json'),
    asset('checksums.json')
  ]
  const report = await buildOnlineUpdateSourceReport({
    currentVersion: '3.15.106',
    version,
    sources: [source],
    fetchJson: async url => {
      if (url.startsWith(source.releaseApiUrl)) return release(version, assets)
      throw new Error(`unexpected url ${url}`)
    }
  })

  assert.equal(report.checked[0].reason, 'missing-assets')
  assert.deepEqual(report.checked[0].missingAssets, ['shellpilot-release.json'])
})

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
