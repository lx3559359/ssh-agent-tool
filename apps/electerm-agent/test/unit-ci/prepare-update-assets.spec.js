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
    fs.writeFileSync(path.join(tempDir, 'aigshell-local.yml'), 'version: 3.15.107\n')

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

test('does not overwrite existing latest.yml while preparing approval metadata', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-update-assets-'))
  try {
    fs.writeFileSync(path.join(tempDir, 'aigshell-local.yml'), 'version: local\n')
    fs.writeFileSync(path.join(tempDir, 'latest.yml'), 'version: published\n')

    const result = prepareUpdateAssets({
      distDir: tempDir,
      version: '3.15.107',
      channel: 'beta'
    })

    assert.equal(result.copiedLatest, false)
    assert.equal(fs.readFileSync(path.join(tempDir, 'latest.yml'), 'utf8'), 'version: published\n')

    const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, 'aigshell-update.json'), 'utf8'))
    assert.doesNotThrow(() => validateUpdateApprovalManifest(manifest, '3.15.107', { channel: 'beta' }))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
