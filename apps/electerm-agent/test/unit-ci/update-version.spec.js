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

function pathToFileURL (filePath) {
  return new URL(`file://${filePath.replace(/\\/g, '/')}`).href
}
