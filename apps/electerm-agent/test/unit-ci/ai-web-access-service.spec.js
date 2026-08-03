const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createWebAccessGrants
} = require('../../src/app/lib/ai-content/web-access-grants')
const {
  WebAccessError
} = require('../../src/app/lib/ai-content/web-access-errors')
const {
  createWebAccessService
} = require('../../src/app/lib/ai-content/web-access-service')

function createMemoryRepository () {
  let value = { version: 1, grants: [] }
  return {
    load: async () => structuredClone(value),
    save: async next => {
      value = structuredClone(next)
    }
  }
}

function createInspector (classes) {
  return async (input, { isOriginGranted = async () => false } = {}) => {
    const parsed = new URL(input)
    const addressClass = classes[parsed.origin] || 'public'
    const target = {
      url: parsed.toString(),
      origin: parsed.origin,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
      addresses: [{
        address: addressClass === 'public'
          ? '93.184.216.34'
          : addressClass === 'loopback'
            ? '127.0.0.1'
            : addressClass === 'dangerous'
              ? '169.254.169.254'
              : '10.0.0.10',
        family: 4
      }],
      addressClass
    }
    if (addressClass === 'dangerous') {
      return {
        decision: 'blocked',
        target,
        reason: 'dangerous-target'
      }
    }
    if (addressClass === 'public') {
      return {
        decision: 'allow-public',
        target,
        reason: 'public-target'
      }
    }
    const granted = await isOriginGranted(parsed.origin, target)
    return {
      decision: granted ? 'allow-granted' : 'authorization-required',
      target,
      reason: granted ? 'origin-granted' : 'origin-authorization-required'
    }
  }
}

function createHarness ({
  classes = {},
  staticResult,
  browserRead,
  now = () => 1000,
  tokenTtlMs,
  randomUUID
} = {}) {
  const grants = createWebAccessGrants({
    repository: createMemoryRepository(),
    now: () => new Date('2026-08-03T00:00:00.000Z')
  })
  let sessionClears = 0
  const service = createWebAccessService({
    inspectTarget: createInspector(classes),
    readStatic: async () => staticResult || {
      kind: 'web',
      source: 'static',
      url: 'https://example.com',
      title: 'Static',
      text: 'Useful static content',
      truncated: false,
      requiresBrowser: false,
      browserReason: ''
    },
    browserReader: {
      read: browserRead || (async ({ url }) => ({
        kind: 'web',
        source: 'browser',
        url,
        title: 'Browser',
        text: 'Useful browser content',
        truncated: false
      }))
    },
    clearSessionData: async () => {
      sessionClears += 1
    },
    grants,
    now,
    tokenTtlMs,
    randomUUID: randomUUID || (() => 'token-1')
  })
  return {
    grants,
    service,
    getSessionClears: () => sessionClears
  }
}

test('keeps useful public pages static and falls back for SPA shells', async () => {
  let browserReads = 0
  const staticHarness = createHarness({
    browserRead: async () => {
      browserReads += 1
      throw new Error('browser should not run')
    }
  })
  const staticResult = await staticHarness.service.read({
    url: 'https://example.com/article',
    readId: 'read-static',
    senderId: 17
  })
  assert.equal(staticResult.source, 'static')
  assert.equal(browserReads, 0)

  const browserHarness = createHarness({
    staticResult: {
      kind: 'web',
      source: 'static',
      url: 'https://example.com/app',
      title: 'Application',
      text: 'Loading',
      truncated: false,
      requiresBrowser: true,
      browserReason: 'spa-shell'
    },
    browserRead: async ({ url }) => {
      browserReads += 1
      return {
        kind: 'web',
        source: 'browser',
        url,
        title: 'Application',
        text: 'Rendered application content',
        truncated: false
      }
    }
  })
  const browserResult = await browserHarness.service.read({
    url: 'https://example.com/app',
    readId: 'read-browser',
    senderId: 17
  })
  assert.equal(browserResult.source, 'browser')
  assert.equal(browserReads, 1)
})

test('issues a sender-bound token and accepts it exactly once', async () => {
  const harness = createHarness({
    classes: {
      'http://kb.internal': 'private'
    }
  })
  let token
  await assert.rejects(
    harness.service.read({
      url: 'http://kb.internal/app',
      readId: 'read-1',
      senderId: 17
    }),
    error => {
      assert.equal(error.code, 'WEB_ACCESS_AUTH_REQUIRED')
      token = error.details.authorizationToken
      assert.equal(token, 'token-1')
      assert.equal(error.details.origin, 'http://kb.internal')
      assert.equal(error.details.readId, 'read-1')
      return true
    }
  )

  await assert.rejects(harness.service.authorize({
    authorizationToken: token,
    scope: 'once',
    senderId: 18
  }), { code: 'WEB_ACCESS_BLOCKED' })

  await harness.service.authorize({
    authorizationToken: token,
    scope: 'once',
    senderId: 17
  })
  await assert.rejects(harness.service.authorize({
    authorizationToken: token,
    scope: 'once',
    senderId: 17
  }), { code: 'WEB_ACCESS_BLOCKED' })

  const result = await harness.service.read({
    url: 'http://kb.internal/app',
    readId: 'read-1',
    senderId: 17
  })
  assert.equal(result.source, 'browser')
  assert.equal(await harness.grants.isGranted({
    origin: 'http://kb.internal',
    readId: 'read-1'
  }), false)
})

test('rejects expired tokens and DNS classes that changed before approval', async () => {
  let clock = 1000
  let currentClass = 'private'
  const grants = createWebAccessGrants({
    repository: createMemoryRepository()
  })
  const service = createWebAccessService({
    inspectTarget: async (input, options) => createInspector({
      'http://kb.internal': currentClass
    })(input, options),
    readStatic: async () => {
      throw new Error('not public')
    },
    browserReader: {
      read: async () => {
        throw new Error('not authorized')
      }
    },
    clearSessionData: async () => {},
    grants,
    now: () => clock,
    tokenTtlMs: 50,
    randomUUID: (() => {
      let index = 0
      return () => 'token-' + (++index)
    })()
  })

  let expiredToken
  await assert.rejects(service.read({
    url: 'http://kb.internal/app',
    readId: 'read-expired',
    senderId: 17
  }), error => {
    expiredToken = error.details.authorizationToken
    return true
  })
  clock = 1100
  await assert.rejects(service.authorize({
    authorizationToken: expiredToken,
    scope: 'once',
    senderId: 17
  }), { code: 'WEB_ACCESS_BLOCKED' })

  clock = 1200
  let reboundToken
  await assert.rejects(service.read({
    url: 'http://kb.internal/app',
    readId: 'read-rebound',
    senderId: 17
  }), error => {
    reboundToken = error.details.authorizationToken
    return true
  })
  currentClass = 'dangerous'
  await assert.rejects(service.authorize({
    authorizationToken: reboundToken,
    scope: 'always',
    senderId: 17
  }), { code: 'WEB_ACCESS_BLOCKED' })
  assert.deepEqual(await grants.list(), [])
})

test('returns a token for a newly encountered private browser origin', async () => {
  const classes = {
    'http://first.internal': 'private',
    'http://second.internal': 'private'
  }
  const grants = createWebAccessGrants({
    repository: createMemoryRepository()
  })
  await grants.load()
  await grants.authorize({
    origin: 'http://first.internal',
    addressClass: 'private',
    scope: 'always',
    readId: 'seed'
  })
  const service = createWebAccessService({
    inspectTarget: createInspector(classes),
    readStatic: async () => {
      throw new Error('not public')
    },
    browserReader: {
      read: async options => {
        const challenge = await options.onAuthorizationRequired({
          origin: 'http://second.internal',
          addressClass: 'private'
        })
        throw new WebAccessError(
          'WEB_ACCESS_AUTH_REQUIRED',
          'Authorization required.',
          {
            ...challenge,
            origin: 'http://second.internal',
            addressClass: 'private',
            readId: options.readId
          }
        )
      }
    },
    clearSessionData: async () => {},
    grants,
    now: () => 1000,
    randomUUID: () => 'redirect-token'
  })

  await assert.rejects(service.read({
    url: 'http://first.internal/app',
    readId: 'read-redirect',
    senderId: 17
  }), error => {
    assert.equal(error.code, 'WEB_ACCESS_AUTH_REQUIRED')
    assert.equal(error.details.origin, 'http://second.internal')
    assert.equal(
      error.details.authorizationToken,
      'redirect-token'
    )
    return true
  })
})

test('bounds repeated authorization challenges for one logical read', async () => {
  let tokenIndex = 0
  const harness = createHarness({
    classes: {
      'http://kb.internal': 'private'
    },
    randomUUID: () => 'token-' + (++tokenIndex)
  })

  for (let index = 0; index < 4; index += 1) {
    await assert.rejects(harness.service.read({
      url: 'http://kb.internal/app',
      readId: 'read-loop',
      senderId: 17
    }), { code: 'WEB_ACCESS_AUTH_REQUIRED' })
  }
  await assert.rejects(harness.service.read({
    url: 'http://kb.internal/app',
    readId: 'read-loop',
    senderId: 17
  }), { code: 'WEB_REDIRECT_LIMIT' })
})

test('cancels logical reads and delegates grant and session management', async () => {
  const harness = createHarness()
  await harness.grants.load()
  await harness.grants.authorize({
    origin: 'http://router.internal',
    addressClass: 'private',
    scope: 'always',
    readId: 'seed'
  })

  assert.equal((await harness.service.listGrants()).length, 1)
  assert.equal(await harness.service.revokeGrant({
    origin: 'http://router.internal'
  }), true)
  assert.deepEqual(await harness.service.listGrants(), [])

  await harness.grants.authorize({
    origin: 'http://router.internal',
    addressClass: 'private',
    scope: 'always',
    readId: 'seed'
  })
  await harness.service.clearGrants()
  assert.deepEqual(await harness.service.listGrants(), [])

  await harness.service.clearSessionData()
  assert.equal(harness.getSessionClears(), 1)
  assert.deepEqual(await harness.service.cancelRead({
    readId: 'read-cancel',
    senderId: 17
  }), { cancelled: true })
})
