const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  prepareUpdateAssets
} = require(path.resolve(__dirname, '../../build/bin/prepare-update-assets'))
const {
  validateUpdateApprovalManifest
} = require(path.resolve(__dirname, '../../build/bin/write-update-approval-manifest'))

test('prepares approved online update assets from the local electron-builder metadata', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-update-assets-'))
  try {
    fs.writeFileSync(path.join(tempDir, 'shellpilot-local.yml'), 'version: 3.15.107\n')
    fs.writeFileSync(path.join(tempDir, 'ShellPilot-3.15.107-win-x64-installer.exe'), 'installer')
    fs.writeFileSync(path.join(tempDir, 'ShellPilot-3.15.107-win-x64-installer.exe.blockmap'), 'blockmap')

    const result = prepareUpdateAssets({
      distDir: tempDir,
      version: '3.15.107',
      channel: 'stable'
    })

    assert.equal(result.copiedLatest, true)
    assert.equal(fs.readFileSync(path.join(tempDir, 'latest.yml'), 'utf8'), 'version: 3.15.107\n')

    const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, 'aigshell-update.json'), 'utf8'))
    assert.doesNotThrow(() => validateUpdateApprovalManifest(manifest, '3.15.107', { channel: 'stable' }))
    const shellPilotManifest = JSON.parse(fs.readFileSync(path.join(tempDir, 'shellpilot-update.json'), 'utf8'))
    assert.deepEqual(
      {
        ...shellPilotManifest,
        generatedAt: '<dynamic>'
      },
      {
        ...manifest,
        generatedAt: '<dynamic>'
      }
    )

    const checksums = JSON.parse(fs.readFileSync(path.join(tempDir, 'checksums.json'), 'utf8'))
    assert.equal(checksums.product, 'ShellPilot')
    assert.equal(checksums.version, '3.15.107')
    assert.ok(checksums.files['latest.yml'].sha256)
    assert.ok(checksums.files['shellpilot-local.yml'].sha256)
    assert.ok(checksums.files['aigshell-update.json'].sha256)
    assert.ok(checksums.files['shellpilot-update.json'].sha256)

    const releaseIndex = JSON.parse(fs.readFileSync(path.join(tempDir, 'shellpilot-release.json'), 'utf8'))
    assert.equal(releaseIndex.tag_name, 'v3.15.107')
    assert.deepEqual(
      releaseIndex.assets.map(asset => asset.name),
      [
        'ShellPilot-3.15.107-win-x64-installer.exe',
        'ShellPilot-3.15.107-win-x64-installer.exe.blockmap',
        'latest.yml',
        'shellpilot-local.yml',
        'aigshell-update.json',
        'shellpilot-update.json',
        'checksums.json'
      ]
    )
    for (const asset of releaseIndex.assets) {
      const assetPath = path.join(tempDir, asset.name)
      assert.equal(asset.size, fs.statSync(assetPath).size, `${asset.name} size`)
      assert.equal(
        asset.sha256,
        crypto.createHash('sha256').update(fs.readFileSync(assetPath)).digest('hex'),
        `${asset.name} sha256`
      )
    }
    assert.match(
      releaseIndex.assets[0].browser_download_url,
      /modelscope\.cn\/models\/lx3559359\/ShellPilot-Updates\/resolve\/master\/ShellPilot-3\.15\.107-win-x64-installer\.exe/
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('prepares update assets from legacy aigshell-local metadata as a fallback', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-update-assets-'))
  try {
    fs.writeFileSync(path.join(tempDir, 'aigshell-local.yml'), 'version: 3.15.107\n')

    const result = prepareUpdateAssets({
      distDir: tempDir,
      version: '3.15.107',
      channel: 'stable'
    })

    assert.equal(result.copiedLatest, true)
    assert.equal(path.basename(result.localMetadataPath), 'aigshell-local.yml')
    assert.equal(fs.readFileSync(path.join(tempDir, 'latest.yml'), 'utf8'), 'version: 3.15.107\n')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('ModelScope release index embeds the versioned Markdown release notes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-update-assets-'))
  try {
    fs.writeFileSync(path.join(tempDir, 'shellpilot-local.yml'), 'version: 0.4.6\n')
    fs.writeFileSync(path.join(tempDir, 'ShellPilot-0.4.6-win-x64-installer.exe'), 'installer')
    fs.writeFileSync(path.join(tempDir, 'ShellPilot-0.4.6-win-x64-installer.exe.blockmap'), 'blockmap')

    prepareUpdateAssets({
      distDir: tempDir,
      version: '0.4.6',
      channel: 'stable'
    })

    const releaseIndex = JSON.parse(fs.readFileSync(path.join(tempDir, 'shellpilot-release.json'), 'utf8'))
    const notes = fs.readFileSync(path.resolve(__dirname, '../../docs/releases/v0.4.6.md'), 'utf8').trim()
    assert.equal(releaseIndex.body, notes)
    assert.notEqual(releaseIndex.body, '')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('prepares update assets from the CI workflow metadata when present', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-update-assets-'))
  const oldWorkflowName = process.env.WORKFLOW_NAME
  process.env.WORKFLOW_NAME = 'windows-electerm-agent'
  try {
    fs.writeFileSync(path.join(tempDir, 'windows-electerm-agent.yml'), 'version: 3.15.109\n')

    const result = prepareUpdateAssets({
      distDir: tempDir,
      version: '3.15.109',
      channel: 'stable'
    })

    assert.equal(result.copiedLatest, true)
    assert.equal(path.basename(result.localMetadataPath), 'windows-electerm-agent.yml')
    assert.equal(fs.readFileSync(path.join(tempDir, 'latest.yml'), 'utf8'), 'version: 3.15.109\n')
    assert.equal(fs.readFileSync(path.join(tempDir, 'shellpilot-local.yml'), 'utf8'), 'version: 3.15.109\n')
  } finally {
    if (oldWorkflowName === undefined) {
      delete process.env.WORKFLOW_NAME
    } else {
      process.env.WORKFLOW_NAME = oldWorkflowName
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('does not overwrite matching latest.yml while preparing approval metadata', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-update-assets-'))
  try {
    fs.writeFileSync(path.join(tempDir, 'shellpilot-local.yml'), 'version: 3.15.107\n')
    fs.writeFileSync(path.join(tempDir, 'latest.yml'), 'version: 3.15.107\n')

    const result = prepareUpdateAssets({
      distDir: tempDir,
      version: '3.15.107',
      channel: 'beta'
    })

    assert.equal(result.copiedLatest, false)
    assert.equal(fs.readFileSync(path.join(tempDir, 'latest.yml'), 'utf8'), 'version: 3.15.107\n')

    const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, 'aigshell-update.json'), 'utf8'))
    assert.doesNotThrow(() => validateUpdateApprovalManifest(manifest, '3.15.107', { channel: 'beta' }))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('replaces stale latest.yml when same version metadata changed after repackaging', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-update-assets-'))
  try {
    fs.writeFileSync(
      path.join(tempDir, 'shellpilot-local.yml'),
      'version: 3.15.108\npath: ShellPilot-3.15.108-win-x64-installer.exe\nsha512: new\nsize: 2\n'
    )
    fs.writeFileSync(
      path.join(tempDir, 'latest.yml'),
      'version: 3.15.108\npath: ShellPilot-3.15.108-win-x64-installer.exe\nsha512: old\nsize: 1\n'
    )

    const result = prepareUpdateAssets({
      distDir: tempDir,
      version: '3.15.108',
      channel: 'stable'
    })

    assert.equal(result.copiedLatest, true)
    assert.equal(
      fs.readFileSync(path.join(tempDir, 'latest.yml'), 'utf8'),
      'version: 3.15.108\npath: ShellPilot-3.15.108-win-x64-installer.exe\nsha512: new\nsize: 2\n'
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('replaces stale latest.yml when preparing a new release version', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-update-assets-'))
  try {
    fs.writeFileSync(path.join(tempDir, 'shellpilot-local.yml'), 'version: 3.15.108\n')
    fs.writeFileSync(path.join(tempDir, 'latest.yml'), 'version: 3.15.107\n')

    const result = prepareUpdateAssets({
      distDir: tempDir,
      version: '3.15.108',
      channel: 'stable'
    })

    assert.equal(result.copiedLatest, true)
    assert.equal(fs.readFileSync(path.join(tempDir, 'latest.yml'), 'utf8'), 'version: 3.15.108\n')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
