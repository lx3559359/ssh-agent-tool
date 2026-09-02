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
    channel: 'sftp',
    effectiveUsername: 'root',
    path: '/root',
    ...overrides
  }
}

test('directory cache expires, caps LRU and coalesces identical requests', async () => {
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
  let loads = 0
  const first = cache.runRequest(key, async () => {
    loads += 1
    await Promise.resolve()
    return [{ id: '1', name: 'a.txt' }]
  })
  const second = cache.runRequest(key, async () => {
    loads += 1
    return []
  })

  assert.equal(first, second)
  const value = await first
  cache.set(key, value)
  value[0].name = 'mutated.txt'
  assert.equal(loads, 1)
  assert.equal(cache.get(key).value[0].name, 'a.txt')

  const key2 = buildRemoteDirectoryCacheKey(identity({ path: '/var' }))
  const key3 = buildRemoteDirectoryCacheKey(identity({ path: '/srv' }))
  cache.set(key2, [{ id: '2', name: 'var' }])
  cache.get(key)
  cache.set(key3, [{ id: '3', name: 'srv' }])
  assert.equal(cache.get(key2), null)
  assert.equal(cache.get(key).value[0].name, 'a.txt')
  assert.equal(cache.get(key3).value[0].name, 'srv')
  assert.equal(cache.stats().entries, 2)

  now += 30001
  assert.equal(cache.get(key), null)
  assert.equal(cache.stats().coalesced, 1)
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
    identity({ host: 'other.invalid' }),
    identity({ port: 2200 }),
    identity({ username: 'login-user' }),
    identity({ channel: 'pty-root' }),
    identity({ effectiveUsername: 'operator' }),
    identity({ path: '/root/other' })
  ]

  assert.equal(remoteDirectoryCacheTtlMs, 30000)
  assert.equal(remoteDirectoryCacheMaxEntries, 32)
  for (const variant of variants) {
    assert.notEqual(buildRemoteDirectoryCacheKey(variant), baseline)
  }
})

test('rejected coalesced request releases inflight and preserves cached value', async () => {
  const {
    buildRemoteDirectoryCacheKey,
    createRemoteDirectoryCache
  } = await import(moduleUrl)
  const cache = createRemoteDirectoryCache()
  const key = buildRemoteDirectoryCacheKey(identity())
  cache.set(key, [{ id: 'stable', name: 'stable.txt' }])
  let attempts = 0
  const rejected = cache.runRequest(key, async () => {
    attempts += 1
    throw new Error('temporary list failure')
  })
  const coalesced = cache.runRequest(key, async () => {
    attempts += 1
    return []
  })

  assert.equal(rejected, coalesced)
  await assert.rejects(rejected, /temporary list failure/)
  assert.equal(attempts, 1)
  assert.deepEqual(cache.stats(), {
    entries: 1,
    inflight: 0,
    coalesced: 1
  })
  assert.equal(cache.get(key).value[0].name, 'stable.txt')

  const retried = await cache.runRequest(key, async () => {
    attempts += 1
    return [{ id: 'fresh', name: 'fresh.txt' }]
  })
  assert.equal(attempts, 2)
  assert.equal(retried[0].name, 'fresh.txt')
  assert.equal(cache.get(key).value[0].name, 'stable.txt')

  cache.clear()
  assert.deepEqual(cache.stats(), {
    entries: 0,
    inflight: 0,
    coalesced: 1
  })
})
