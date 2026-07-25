const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/operations-toolkit/workspace/parameter-value.js'
)).href

test('normalizes Ant Design Input events without changing Select or number values', async () => {
  const { normalizeOperationsParameterValue } = await import(moduleUrl)

  assert.equal(
    normalizeOperationsParameterValue({ target: { value: 'example.com' } }),
    'example.com'
  )
  assert.equal(normalizeOperationsParameterValue(443), 443)
  assert.deepEqual(normalizeOperationsParameterValue(['eth0', 'ens3']), ['eth0', 'ens3'])
})
