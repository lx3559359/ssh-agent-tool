const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const {
  parseQuickConnect
} = require(path.resolve(__dirname, '../../src/app/common/parse-quick-connect'))

test('app quick connect decodes URL-encoded SSH username and password', () => {
  const result = parseQuickConnect('ssh://deploy%2Bops:p%40ss%3Aword@10.0.1.23:22')

  assert.equal(result.username, 'deploy+ops')
  assert.equal(result.password, 'p@ss:word')
  assert.equal(result.host, '10.0.1.23')
  assert.equal(result.port, 22)
})

test('client quick connect decodes URL-encoded SSH username and password', async () => {
  const {
    parseQuickConnect: parseClientQuickConnect
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/parse-quick-connect.js')))

  const result = parseClientQuickConnect('ssh://deploy%2Bops:p%40ss%3Aword@10.0.1.23:22')

  assert.equal(result.username, 'deploy+ops')
  assert.equal(result.password, 'p@ss:word')
  assert.equal(result.host, '10.0.1.23')
  assert.equal(result.port, 22)
})
