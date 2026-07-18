const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const endpointGuardUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/endpoint-guard.js'
)).href

test('projects complete verified SSH identity without credentials', async () => {
  const { projectEndpoint } = await import(endpointGuardUrl)
  const endpoint = projectEndpoint({
    tabId: 'tab-a',
    pid: 'pid-a',
    terminalPid: 'term-a',
    sessionType: 'ssh',
    host: 'srv.test',
    port: 22,
    username: 'ops',
    hostKeyFingerprint: 'SHA256:abc',
    password: 'secret',
    privateKey: 'secret-key'
  })

  assert.deepEqual(endpoint, {
    host: 'srv.test',
    port: 22,
    username: 'ops',
    tabId: 'tab-a',
    pid: 'pid-a',
    terminalPid: 'term-a',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:abc'
  })
  assert.doesNotMatch(JSON.stringify(endpoint), /secret/)
})

test('rejects an incomplete or unverified SSH identity', async () => {
  const { projectEndpoint } = await import(endpointGuardUrl)
  const endpoint = {
    tabId: 'tab-a',
    pid: 'pid-a',
    terminalPid: 'term-a',
    sessionType: 'ssh',
    host: 'srv.test',
    port: 22,
    username: 'ops',
    hostKeyFingerprint: 'SHA256:abc'
  }

  for (const field of [
    'tabId',
    'pid',
    'terminalPid',
    'sessionType',
    'hostKeyFingerprint'
  ]) {
    assert.throws(
      () => projectEndpoint({ ...endpoint, [field]: '' }),
      undefined,
      field
    )
  }
})
