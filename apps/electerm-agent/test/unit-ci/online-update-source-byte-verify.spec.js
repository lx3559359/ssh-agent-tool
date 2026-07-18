const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const pack = require('../../package.json')
const {
  buildOnlineUpdateSourceReport,
  downloadAssetDigest
} = require('../../build/bin/verify-online-update-sources')
const {
  getRequiredReleaseAssetNames
} = require('../../build/bin/github-release-utils')
const {
  prepareUpdateAssets
} = require('../../build/bin/prepare-update-assets')

function fetchJson (url) {
  return fetch(url).then(async response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })
}

function prepareFixture (version) {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-online-bytes-'))
  fs.writeFileSync(path.join(distDir, 'shellpilot-local.yml'), `version: ${version}\n`)
  fs.writeFileSync(
    path.join(distDir, `ShellPilot-${version}-win-x64-installer.exe`),
    'installer bytes'
  )
  fs.writeFileSync(
    path.join(distDir, `ShellPilot-${version}-win-x64-installer.exe.blockmap`),
    'blockmap bytes'
  )
  prepareUpdateAssets({ distDir, version, channel: 'stable' })
  return distDir
}

async function startReleaseServer ({ version, distDir, tamperedAsset = '', failGitHub = false, invalidMetadata = false }) {
  const releaseState = {}
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/modelscope/shellpilot-release.json') {
      response.setHeader('content-type', 'application/json')
      fs.createReadStream(path.join(distDir, 'shellpilot-release.json')).pipe(response)
      return
    }
    if (url.pathname === '/github/release.json') {
      if (failGitHub) {
        response.writeHead(503)
        response.end('unavailable')
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(releaseState.githubRelease))
      return
    }

    const prefixes = ['/modelscope/', '/github/assets/']
    const prefix = prefixes.find(item => url.pathname.startsWith(item))
    if (!prefix) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    const name = decodeURIComponent(url.pathname.slice(prefix.length))
    if (name === tamperedAsset) {
      response.end('tampered bytes')
      return
    }
    const filePath = path.join(distDir, name)
    if (!fs.existsSync(filePath)) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    fs.createReadStream(filePath).pipe(response)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const releaseIndexPath = path.join(distDir, 'shellpilot-release.json')
  const modelScopeRelease = JSON.parse(fs.readFileSync(releaseIndexPath, 'utf8'))
  modelScopeRelease.assets = modelScopeRelease.assets.map(asset => ({
    ...asset,
    browser_download_url: `${baseUrl}/modelscope/${encodeURIComponent(asset.name)}`
  }))
  if (invalidMetadata) {
    modelScopeRelease.assets.find(asset => asset.name.endsWith('installer.exe')).size = 1
    modelScopeRelease.assets.find(asset => asset.name === 'latest.yml').sha256 = '0'.repeat(64)
  }
  fs.writeFileSync(releaseIndexPath, JSON.stringify(modelScopeRelease, null, 2) + '\n')

  releaseState.githubRelease = {
    tag_name: `v${version}`,
    assets: getRequiredReleaseAssetNames(version).map(name => ({
      name,
      size: fs.statSync(path.join(distDir, name)).size,
      browser_download_url: `${baseUrl}/github/assets/${encodeURIComponent(name)}`
    }))
  }

  return {
    server,
    sources: [
      {
        id: 'modelscope',
        label: 'ModelScope',
        releaseApiUrl: `${baseUrl}/modelscope/shellpilot-release.json`
      },
      {
        id: 'github',
        label: 'GitHub',
        releaseApiUrl: `${baseUrl}/github/release.json`
      }
    ]
  }
}

async function closeServer (server) {
  await new Promise(resolve => server.close(resolve))
}

test('strict release verification streams and verifies every byte from both update sources', async () => {
  const version = '3.15.109'
  const distDir = prepareFixture(version)
  const fixture = await startReleaseServer({ version, distDir })
  try {
    const report = await buildOnlineUpdateSourceReport({
      currentVersion: '3.15.108',
      version,
      distDir,
      sources: fixture.sources,
      fetchJson,
      strictAllSources: true,
      verifyBytes: true
    })

    assert.equal(report.ok, true)
    assert.equal(report.checked.length, 2)
    assert.equal(report.checked.every(result => result.ok), true)
    assert.deepEqual(report.checked.map(result => result.verifiedAssetCount), [8, 8])
  } finally {
    await closeServer(fixture.server)
    fs.rmSync(distDir, { recursive: true, force: true })
  }
})

test('strict release verification rejects downloaded bytes that differ from local approvals', async () => {
  const version = '3.15.109'
  const distDir = prepareFixture(version)
  const tamperedAsset = `ShellPilot-${version}-win-x64-installer.exe`
  const fixture = await startReleaseServer({ version, distDir, tamperedAsset })
  try {
    const report = await buildOnlineUpdateSourceReport({
      currentVersion: '3.15.108',
      version,
      distDir,
      sources: fixture.sources,
      fetchJson,
      strictAllSources: true,
      verifyBytes: true
    })

    assert.equal(report.ok, false)
    assert.equal(report.checked.every(result => result.reason === 'byte-verification-failed'), true)
    assert.equal(report.checked.every(result => result.assetErrors.some(error => error.name === tamperedAsset)), true)
  } finally {
    await closeServer(fixture.server)
    fs.rmSync(distDir, { recursive: true, force: true })
  }
})

test('strict release verification does not let one successful source mask another source failure', async () => {
  const version = '3.15.109'
  const distDir = prepareFixture(version)
  const fixture = await startReleaseServer({ version, distDir, failGitHub: true })
  try {
    const report = await buildOnlineUpdateSourceReport({
      currentVersion: '3.15.108',
      version,
      distDir,
      sources: fixture.sources,
      fetchJson,
      strictAllSources: true,
      verifyBytes: true
    })

    assert.equal(report.ok, false)
    assert.equal(report.checked.length, 2)
    assert.equal(report.checked[0].ok, true)
    assert.equal(report.checked[1].ok, false)
    assert.equal(report.checked[1].reason, 'fetch-failed')
  } finally {
    await closeServer(fixture.server)
    fs.rmSync(distDir, { recursive: true, force: true })
  }
})

test('strict release verification rejects size-one metadata and all-zero hashes', async () => {
  const version = '3.15.109'
  const distDir = prepareFixture(version)
  const fixture = await startReleaseServer({ version, distDir, invalidMetadata: true })
  try {
    const report = await buildOnlineUpdateSourceReport({
      currentVersion: '3.15.108',
      version,
      distDir,
      sources: [fixture.sources[0]],
      fetchJson,
      strictAllSources: true,
      verifyBytes: true
    })

    assert.equal(report.ok, false)
    assert.equal(report.checked[0].reason, 'invalid-assets')
    assert.deepEqual(report.checked[0].invalidAssets, [
      `ShellPilot-${version}-win-x64-installer.exe`,
      'latest.yml'
    ])
  } finally {
    await closeServer(fixture.server)
    fs.rmSync(distDir, { recursive: true, force: true })
  }
})

test('stream verifier handles redirects and fails closed on bad URLs status timeout and early close', async () => {
  const bytes = Buffer.from('verified bytes')
  const server = http.createServer((request, response) => {
    if (request.url === '/bytes') return response.end(bytes)
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/bytes' })
      return response.end()
    }
    if (request.url === '/error') {
      response.writeHead(503)
      return response.end('unavailable')
    }
    if (request.url === '/timeout') return
    if (request.url === '/close') {
      response.writeHead(200, { 'content-length': 100 })
      response.write('partial')
      return response.socket.destroy()
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  try {
    const result = await downloadAssetDigest(`${baseUrl}/redirect`, { timeoutMs: 200 })
    assert.equal(result.size, bytes.length)
    assert.match(result.sha256, /^[a-f0-9]{64}$/)
    await assert.rejects(downloadAssetDigest('not a URL'), /invalid|url/i)
    await assert.rejects(downloadAssetDigest(`${baseUrl}/error`, { timeoutMs: 200 }), /HTTP 503/)
    await assert.rejects(downloadAssetDigest(`${baseUrl}/timeout`, { timeoutMs: 30 }), /timed out/i)
    await assert.rejects(downloadAssetDigest(`${baseUrl}/close`, { timeoutMs: 200 }), /closed|aborted|socket/i)
  } finally {
    await closeServer(server)
  }
})

test('the release package script always enables strict all-source byte verification', () => {
  assert.match(pack.scripts['release:update-sources:verify'], /--strict-all/)
  assert.match(pack.scripts['release:update-sources:verify'], /--verify-bytes/)
})
