const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/sftp/remote-directory-cache.js'
)).href

function identity (overrides = {}) {
  return {
    host: 'example.invalid',
    port: 22,
    username: 'root',
    sshSessionGeneration: 'session-1',
    sshTerminalPid: '100',
    channel: 'sftp',
    effectiveUid: '0',
    effectiveUsername: 'root',
    path: '/root',
    ...overrides
  }
}

test('directory cache expires caps LRU and clones stored values', async () => {
  const {
    buildRemoteDirectoryCacheKey,
    createRemoteDirectoryCache
  } = await import(moduleUrl)
  let now = 1000
  const cache = createRemoteDirectoryCache({
    now: () => now,
    ttlMs: 30000,
    maxEntries: 2
  })
  const key = buildRemoteDirectoryCacheKey(identity())
  const value = [{ id: '1', name: 'a.txt' }]
  cache.set(key, value)
  value[0].name = 'mutated.txt'
  assert.equal(cache.get(key).value[0].name, 'a.txt')

  const key2 = buildRemoteDirectoryCacheKey(identity({ path: '/var' }))
  const key3 = buildRemoteDirectoryCacheKey(identity({ path: '/srv' }))
  cache.set(key2, [{ id: '2', name: 'var' }])
  cache.get(key)
  cache.set(key3, [{ id: '3', name: 'srv' }])
  assert.equal(cache.get(key2), null)
  assert.equal(cache.get(key).value[0].name, 'a.txt')
  assert.equal(cache.get(key3).value[0].name, 'srv')

  now += 30001
  assert.equal(cache.get(key), null)
})

test('directory cache key isolates SSH generations and effective identities', async () => {
  const {
    buildRemoteDirectoryCacheKey,
    remoteDirectoryCacheMaxEntries,
    remoteDirectoryCacheTtlMs
  } = await import(moduleUrl)
  const baseline = buildRemoteDirectoryCacheKey(identity())
  const variants = [
    identity({ sshSessionGeneration: 'session-2' }),
    identity({ sshTerminalPid: '200' }),
    identity({ host: 'other.invalid' }),
    identity({ port: 2200 }),
    identity({ username: 'login-user' }),
    identity({ channel: 'pty-root' }),
    identity({ effectiveUid: '1000' }),
    identity({ effectiveUsername: 'operator' }),
    identity({ path: '/root/other' })
  ]

  assert.equal(remoteDirectoryCacheTtlMs, 30000)
  assert.equal(remoteDirectoryCacheMaxEntries, 32)
  for (const variant of variants) {
    assert.notEqual(buildRemoteDirectoryCacheKey(variant), baseline)
  }
})

test('directory cache exposes no inflight request sharing contract', async () => {
  const { createRemoteDirectoryCache } = await import(moduleUrl)
  const cache = createRemoteDirectoryCache()

  assert.deepEqual(Object.keys(cache).sort(), ['clear', 'get', 'set'])
})
