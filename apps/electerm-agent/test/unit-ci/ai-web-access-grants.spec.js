const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  createWebAccessGrantRepository,
  createWebAccessGrants
} = require('../../src/app/lib/ai-content/web-access-grants')

function createMemoryRepository (initial = { version: 1, grants: [] }) {
  let stored = structuredClone(initial)
  return {
    async load () {
      return structuredClone(stored)
    },
    async save (value) {
      stored = structuredClone(value)
    },
    snapshot () {
      return structuredClone(stored)
    }
  }
}

function createClock (...values) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]
}

test('once grants survive retries for one read and are removed on finish', async () => {
  const repository = createMemoryRepository()
  const grants = createWebAccessGrants({
    repository,
    now: createClock(
      new Date('2026-08-03T00:00:00.000Z'),
      new Date('2026-08-03T00:01:00.000Z')
    )
  })
  await grants.load()
  await grants.authorize({
    origin: 'http://Router.Internal:8080/path',
    addressClass: 'private',
    scope: 'once',
    readId: 'read-1'
  })

  assert.equal(await grants.isGranted({
    origin: 'http://router.internal:8080',
    readId: 'read-1'
  }), true)
  assert.equal(await grants.isGranted({
    origin: 'http://router.internal:8080',
    readId: 'read-2'
  }), false)
  assert.deepEqual(await grants.list(), [])
  assert.deepEqual(repository.snapshot().grants, [])

  grants.finishRead('read-1')
  assert.equal(await grants.isGranted({
    origin: 'http://router.internal:8080',
    readId: 'read-1'
  }), false)
})

test('permanent grants persist without page or credential data', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-grants-'))
  const filePath = path.join(root, 'ai-web-access', 'grants.json')
  t.after(async () => {
    assert.ok(root.startsWith(os.tmpdir()))
    await fs.rm(root, { recursive: true, force: true })
  })

  const repository = createWebAccessGrantRepository({ filePath })
  const first = createWebAccessGrants({
    repository,
    now: createClock(
      new Date('2026-08-03T00:00:00.000Z'),
      new Date('2026-08-03T00:05:00.000Z')
    )
  })
  await first.load()
  await first.authorize({
    origin: 'https://KB.Internal:443/private?token=secret#section',
    addressClass: 'private',
    scope: 'always',
    readId: 'read-1'
  })
  assert.equal(await first.isGranted({
    origin: 'https://kb.internal/another',
    readId: 'read-2'
  }), true)

  const second = createWebAccessGrants({ repository })
  await second.load()
  assert.equal(await second.isGranted({
    origin: 'https://kb.internal',
    readId: 'read-3'
  }), true)

  const serialized = await fs.readFile(filePath, 'utf8')
  const parsed = JSON.parse(serialized)
  assert.equal(parsed.version, 1)
  assert.equal(parsed.grants.length, 1)
  assert.deepEqual(Object.keys(parsed.grants[0]).sort(), [
    'addressClass',
    'createdAt',
    'lastUsedAt',
    'origin'
  ])
  assert.equal(parsed.grants[0].origin, 'https://kb.internal')
  assert.doesNotMatch(
    serialized,
    /cookie|password|token=secret|#section|pageText|private\?/i
  )
  await assert.rejects(fs.access(filePath + '.tmp'))
})

test('permanent grants are isolated by scheme host and effective port', async () => {
  const grants = createWebAccessGrants({
    repository: createMemoryRepository()
  })
  await grants.load()
  await grants.authorize({
    origin: 'https://kb.internal',
    addressClass: 'private',
    scope: 'always',
    readId: 'read-1'
  })

  assert.equal(await grants.isGranted({
    origin: 'https://KB.Internal:443/path',
    readId: 'read-2'
  }), true)
  assert.equal(await grants.isGranted({
    origin: 'http://kb.internal',
    readId: 'read-2'
  }), false)
  assert.equal(await grants.isGranted({
    origin: 'https://kb.internal:8443',
    readId: 'read-2'
  }), false)
})

test('lists revokes and clears permanent grants with stable timestamps', async () => {
  const repository = createMemoryRepository()
  const grants = createWebAccessGrants({
    repository,
    now: createClock(
      new Date('2026-08-03T00:00:00.000Z'),
      new Date('2026-08-03T00:01:00.000Z'),
      new Date('2026-08-03T00:02:00.000Z')
    )
  })
  await grants.load()
  await grants.authorize({
    origin: 'http://localhost:3000',
    addressClass: 'loopback',
    scope: 'always',
    readId: 'read-1'
  })
  await grants.authorize({
    origin: 'http://router.internal',
    addressClass: 'private',
    scope: 'always',
    readId: 'read-2'
  })

  const listed = await grants.list()
  assert.deepEqual(listed.map(item => item.origin), [
    'http://localhost:3000',
    'http://router.internal'
  ])
  assert.equal(listed[0].createdAt, '2026-08-03T00:00:00.000Z')
  listed[0].origin = 'mutated'
  assert.equal((await grants.list())[0].origin, 'http://localhost:3000')

  assert.equal(await grants.revoke('http://LOCALHOST:3000/path'), true)
  assert.equal(await grants.revoke('http://localhost:3000'), false)
  assert.deepEqual(
    (await grants.list()).map(item => item.origin),
    ['http://router.internal']
  )

  await grants.clear()
  assert.deepEqual(await grants.list(), [])
  assert.deepEqual(repository.snapshot(), { version: 1, grants: [] })
})

test('recovers from malformed or unsafe persisted grants', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-grants-'))
  const filePath = path.join(root, 'grants.json')
  t.after(async () => {
    assert.ok(root.startsWith(os.tmpdir()))
    await fs.rm(root, { recursive: true, force: true })
  })

  await fs.writeFile(filePath, '{not valid json', 'utf8')
  const repository = createWebAccessGrantRepository({ filePath })
  const malformed = createWebAccessGrants({ repository })
  await malformed.load()
  assert.deepEqual(await malformed.list(), [])

  await fs.writeFile(filePath, JSON.stringify({
    version: 1,
    grants: [
      {
        origin: 'http://router.internal/path',
        addressClass: 'private',
        createdAt: '2026-08-03T00:00:00.000Z',
        lastUsedAt: '2026-08-03T00:00:00.000Z',
        password: 'must-not-survive'
      },
      {
        origin: 'http://169.254.169.254',
        addressClass: 'dangerous',
        createdAt: '2026-08-03T00:00:00.000Z',
        lastUsedAt: '2026-08-03T00:00:00.000Z'
      }
    ]
  }), 'utf8')
  const sanitized = createWebAccessGrants({ repository })
  await sanitized.load()
  assert.deepEqual(await sanitized.list(), [{
    origin: 'http://router.internal',
    addressClass: 'private',
    createdAt: '2026-08-03T00:00:00.000Z',
    lastUsedAt: '2026-08-03T00:00:00.000Z'
  }])
})

test('rejects invalid scopes classes origins and missing read IDs', async () => {
  const grants = createWebAccessGrants({
    repository: createMemoryRepository()
  })
  await grants.load()
  const base = {
    origin: 'http://router.internal',
    addressClass: 'private',
    scope: 'once',
    readId: 'read-1'
  }

  for (const update of [
    { scope: 'all' },
    { addressClass: 'dangerous' },
    { addressClass: 'public' },
    { origin: 'file:///etc/passwd' },
    { readId: '' }
  ]) {
    await assert.rejects(
      grants.authorize({ ...base, ...update }),
      error => {
        assert.equal(error.code, 'WEB_ACCESS_BLOCKED')
        return true
      }
    )
  }
})
