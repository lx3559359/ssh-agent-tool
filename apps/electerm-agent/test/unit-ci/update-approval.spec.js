const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

test('loads update approval manifest from release assets', async () => {
  const {
    attachUpdateApprovalManifest,
    findUpdateApprovalAsset
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/update-approval.js')))

  const release = {
    tag_name: 'v3.15.106',
    assets: [
      { name: 'latest.yml', browser_download_url: 'https://example.com/latest.yml' },
      { name: 'aigshell-update.json', browser_download_url: 'https://example.com/aigshell-update.json' }
    ]
  }
  const calls = []
  const result = await attachUpdateApprovalManifest(release, async url => {
    calls.push(url)
    return {
      product: 'AIGShell',
      channel: 'stable',
      publishApproved: true,
      version: '3.15.106'
    }
  })

  assert.deepEqual(findUpdateApprovalAsset(release), release.assets[1])
  assert.deepEqual(calls, ['https://example.com/aigshell-update.json'])
  assert.deepEqual(result.updateApproval, {
    product: 'AIGShell',
    channel: 'stable',
    publishApproved: true,
    version: '3.15.106'
  })
})

test('keeps release unchanged when approval manifest is missing or cannot be fetched', async () => {
  const {
    attachUpdateApprovalManifest
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/update-approval.js')))

  const release = {
    tag_name: 'v3.15.106',
    assets: [
      { name: 'latest.yml', browser_download_url: 'https://example.com/latest.yml' }
    ]
  }
  const missing = await attachUpdateApprovalManifest(release, async () => {
    throw new Error('should not fetch')
  })
  const failed = await attachUpdateApprovalManifest({
    ...release,
    assets: [
      ...release.assets,
      { name: 'aigshell-update.json', browser_download_url: 'https://example.com/aigshell-update.json' }
    ]
  }, async () => {
    throw new Error('network failed')
  })

  assert.equal(missing.updateApproval, undefined)
  assert.equal(failed.updateApproval, undefined)
})

function pathToFileURL (filePath) {
  return new URL(`file://${filePath.replace(/\\/g, '/')}`).href
}
