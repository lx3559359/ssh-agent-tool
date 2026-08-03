const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const {
  createWebRequestDecision,
  installWebNavigationGuard
} = require('../../src/app/lib/ai-content/web-navigation-guard')

function createInspector (classes) {
  return async (url, { isOriginGranted }) => {
    const parsed = new URL(url)
    const addressClass = classes[parsed.origin] || 'public'
    const target = {
      origin: parsed.origin,
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

test('allows public resources and an explicitly granted private origin', async () => {
  const decide = createWebRequestDecision({
    inspectTarget: createInspector({
      'http://kb.internal': 'private'
    }),
    isOriginGranted: async ({ origin, readId }) => (
      origin === 'http://kb.internal' &&
      readId === 'read-1'
    )
  })

  assert.deepEqual(await decide({
    url: 'https://cdn.example.com/app.js',
    resourceType: 'script',
    readId: 'read-1'
  }), { action: 'allow' })
  assert.deepEqual(await decide({
    url: 'http://kb.internal/api',
    resourceType: 'xhr',
    readId: 'read-1'
  }), { action: 'allow' })
})

test('challenges private main-frame navigation and blocks unsafe resources', async () => {
  const decide = createWebRequestDecision({
    inspectTarget: createInspector({
      'http://second.internal': 'private',
      'http://169.254.169.254': 'dangerous'
    }),
    isOriginGranted: async () => false
  })

  assert.deepEqual(await decide({
    url: 'http://second.internal/app',
    resourceType: 'mainFrame',
    readId: 'read-1'
  }), {
    action: 'authorization-required',
    code: 'WEB_ACCESS_AUTH_REQUIRED',
    target: {
      origin: 'http://second.internal',
      addressClass: 'private'
    }
  })

  const privateScript = await decide({
    url: 'http://second.internal/app.js',
    resourceType: 'script',
    readId: 'read-1'
  })
  assert.equal(privateScript.action, 'block')
  assert.equal(privateScript.code, 'WEB_ACCESS_BLOCKED')
  assert.equal(privateScript.reason, 'ungranted-private-subresource')

  const metadata = await decide({
    url: 'http://169.254.169.254/latest/meta-data',
    resourceType: 'xhr',
    readId: 'read-1'
  })
  assert.equal(metadata.action, 'block')
  assert.equal(metadata.reason, 'dangerous-target')
})

test('fails closed for non-network protocols and inspection errors', async () => {
  const decide = createWebRequestDecision({
    inspectTarget: async () => {
      const error = new Error('DNS failed')
      error.code = 'WEB_NETWORK_ERROR'
      throw error
    },
    isOriginGranted: async () => false
  })

  for (const url of [
    'file:///etc/passwd',
    'data:text/plain,secret',
    'blob:https://example.com/id',
    'javascript:alert(1)'
  ]) {
    const result = await decide({
      url,
      resourceType: 'mainFrame',
      readId: 'read-1'
    })
    assert.equal(result.action, 'block')
    assert.equal(result.code, 'WEB_ACCESS_BLOCKED')
    assert.equal(result.reason, 'unsupported-protocol')
  }

  const failed = await decide({
    url: 'https://missing.example',
    resourceType: 'mainFrame',
    readId: 'read-1'
  })
  assert.equal(failed.action, 'block')
  assert.equal(failed.code, 'WEB_NETWORK_ERROR')
  assert.equal(failed.reason, 'inspection-failed')
})

class FakeSession extends EventEmitter {
  constructor () {
    super()
    this.beforeRequestRegistrations = 0
    this.webRequest = {
      onBeforeRequest: listener => {
        this.beforeRequestRegistrations += 1
        this.beforeRequestListener = listener
      }
    }
  }

  setPermissionRequestHandler (handler) {
    this.permissionRequestHandler = handler
  }

  setPermissionCheckHandler (handler) {
    this.permissionCheckHandler = handler
  }
}

class FakeWebContents extends EventEmitter {
  constructor (id) {
    super()
    this.id = id
    this.loadedUrls = []
  }

  setWindowOpenHandler (handler) {
    this.windowOpenHandler = handler
  }

  loadURL (url) {
    this.loadedUrls.push(url)
    return Promise.resolve()
  }

  stop () {
    this.stopped = true
  }
}

function runBeforeRequest (session, details) {
  return new Promise(resolve => {
    session.beforeRequestListener(details, resolve)
  })
}

test('installs one shared session guard and disposes per-view listeners', async () => {
  const session = new FakeSession()
  const first = new FakeWebContents(11)
  const second = new FakeWebContents(12)
  const challenges = []
  const blocked = []
  const inspectTarget = createInspector({
    'http://second.internal': 'private',
    'http://169.254.169.254': 'dangerous'
  })

  const disposeFirst = installWebNavigationGuard({
    session,
    webContents: first,
    readId: 'read-1',
    inspectTarget,
    isOriginGranted: async () => false,
    onAuthorizationRequired: target => challenges.push(target),
    onBlocked: result => blocked.push(result)
  })
  const disposeSecond = installWebNavigationGuard({
    session,
    webContents: second,
    readId: 'read-2',
    inspectTarget,
    isOriginGranted: async () => false
  })

  assert.equal(session.beforeRequestRegistrations, 1)
  assert.equal(first.listenerCount('will-navigate'), 1)
  assert.equal(first.listenerCount('did-redirect-navigation'), 1)
  assert.deepEqual(first.windowOpenHandler(), { action: 'deny' })
  assert.equal(session.permissionCheckHandler(), false)
  let permissionResult
  session.permissionRequestHandler(null, 'camera', value => {
    permissionResult = value
  })
  assert.equal(permissionResult, false)

  let preventedDownload = false
  session.emit('will-download', {
    preventDefault: () => {
      preventedDownload = true
    }
  })
  assert.equal(preventedDownload, true)

  assert.deepEqual(await runBeforeRequest(session, {
    webContentsId: first.id,
    url: 'http://second.internal/app',
    resourceType: 'mainFrame'
  }), { cancel: true })
  assert.deepEqual(challenges, [{
    origin: 'http://second.internal',
    addressClass: 'private'
  }])

  assert.deepEqual(await runBeforeRequest(session, {
    webContentsId: first.id,
    url: 'http://169.254.169.254/latest/meta-data',
    resourceType: 'xhr'
  }), { cancel: true })
  assert.equal(blocked.length, 1)

  disposeFirst()
  disposeFirst()
  assert.equal(first.listenerCount('will-navigate'), 0)
  assert.equal(first.listenerCount('did-redirect-navigation'), 0)
  assert.deepEqual(await runBeforeRequest(session, {
    webContentsId: first.id,
    url: 'http://second.internal/app',
    resourceType: 'mainFrame'
  }), {})

  disposeSecond()
  assert.equal(second.listenerCount('will-navigate'), 0)
  assert.equal(second.listenerCount('did-redirect-navigation'), 0)
})

test('prevents unapproved client navigation before asynchronous inspection', async () => {
  const session = new FakeSession()
  const webContents = new FakeWebContents(21)
  let resolveInspection
  const inspection = new Promise(resolve => {
    resolveInspection = resolve
  })
  const dispose = installWebNavigationGuard({
    session,
    webContents,
    readId: 'read-1',
    inspectTarget: async () => inspection,
    isOriginGranted: async () => false
  })

  let prevented = false
  webContents.emit('will-navigate', {
    preventDefault: () => {
      prevented = true
    }
  }, 'https://example.com/next')
  assert.equal(prevented, true)
  assert.deepEqual(webContents.loadedUrls, [])

  resolveInspection({
    decision: 'allow-public',
    target: {
      origin: 'https://example.com',
      addressClass: 'public'
    },
    reason: 'public-target'
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(webContents.loadedUrls, ['https://example.com/next'])
  dispose()
})

test('notification failures cannot leave a blocked request open', async () => {
  const session = new FakeSession()
  const webContents = new FakeWebContents(31)
  const dispose = installWebNavigationGuard({
    session,
    webContents,
    readId: 'read-1',
    inspectTarget: createInspector({
      'http://169.254.169.254': 'dangerous'
    }),
    isOriginGranted: async () => false,
    onBlocked: () => {
      throw new Error('renderer notification failed')
    }
  })

  assert.deepEqual(await runBeforeRequest(session, {
    webContentsId: webContents.id,
    url: 'http://169.254.169.254/latest/meta-data',
    resourceType: 'xhr'
  }), { cancel: true })
  dispose()
})
