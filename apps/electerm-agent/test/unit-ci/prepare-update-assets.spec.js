const test = require('node:test')
const assert = require('node:assert/strict')
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

    const result = prepareUpdateAssets({
      distDir: tempDir,
      version: '3.15.107',
      channel: 'stable'
    })

    assert.equal(result.copiedLatest, true)
    assert.equal(fs.readFileSync(path.join(tempDir, 'latest.yml'), 'utf8'), 'version: 3.15.107\n')

    const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, 'aigshell-update.json'), 'utf8'))
    assert.doesNotThrow(() => validateUpdateApprovalManifest(manifest, '3.15.107', { channel: 'stable' }))
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
