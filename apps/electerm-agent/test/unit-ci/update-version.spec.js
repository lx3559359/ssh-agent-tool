const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

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

function pathToFileURL (filePath) {
  return new URL(`file://${filePath.replace(/\\/g, '/')}`).href
}
