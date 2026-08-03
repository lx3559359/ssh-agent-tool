const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const {
  buildRemoteViewOptions,
  buildShellWindowOptions,
  buildToolbarHtml
} = require('../../src/app/lib/ai-content/electron-web-reader-adapter')
const {
  createAuthenticatedWebReader,
  extractVisiblePage
} = require('../../src/app/lib/ai-content/authenticated-web-reader')

test('uses an isolated sandboxed partition without a remote preload', () => {
  const options = buildRemoteViewOptions()
  assert.equal(
    options.webPreferences.partition,
    'persist:shellpilot-ai-web'
  )
  assert.equal(options.webPreferences.sandbox, true)
  assert.equal(options.webPreferences.contextIsolation, true)
  assert.equal(options.webPreferences.nodeIntegration, false)
  assert.equal(options.webPreferences.webSecurity, true)
  assert.equal(Object.hasOwn(options.webPreferences, 'preload'), false)

  const shell = buildShellWindowOptions('C:/app/reader-preload.js')
  assert.equal(shell.show, false)
  assert.equal(shell.webPreferences.sandbox, true)
  assert.equal(shell.webPreferences.contextIsolation, true)
  assert.equal(shell.webPreferences.nodeIntegration, false)
  assert.equal(shell.webPreferences.preload, 'C:/app/reader-preload.js')
})

test('toolbar HTML escapes the origin and exposes only bounded actions', () => {
  const html = buildToolbarHtml('http://localhost/<script>alert(1)</script>')
  assert.doesNotMatch(html, /localhost\/<script>/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /shellPilotWebReader\.complete\(\)/)
  assert.match(html, /shellPilotWebReader\.cancel\(\)/)
  assert.match(html, /Content-Security-Policy/)
})

test('trusted preload exposes no generic Electron or filesystem bridge', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    '../../src/app/preload/ai-web-reader-preload.js'
  ), 'utf8')
  assert.match(source, /shellPilotWebReader/)
  assert.match(source, /ai-web-reader-action/)
  assert.doesNotMatch(
    source,
    /runGlobalAsync|filesystem|readFile|writeFile|cookie|localStorage/
  )
})

test('extracts only bounded visible page fields', async () => {
  let script
  const result = await extractVisiblePage({
    getURL: () => 'http://kb.internal/app#/sharingPath',
    executeJavaScript: async value => {
      script = value
      return {
        title: 'Knowledge Base',
        text: 'visible text '.repeat(9000)
      }
    }
  })

  assert.match(script, /document\.body/)
  assert.doesNotMatch(
    script,
    /document\.cookie|localStorage|sessionStorage/
  )
  assert.equal(result.kind, 'web')
  assert.equal(result.source, 'browser')
  assert.equal(result.url, 'http://kb.internal/app#/sharingPath')
  assert.equal(result.text.length, 80000)
  assert.equal(result.truncated, true)
  assert.deepEqual(Object.keys(result).sort(), [
    'kind',
    'source',
    'text',
    'title',
    'truncated',
    'url'
  ])
})

class FakeRemote extends EventEmitter {
  constructor ({
    url = 'http://kb.internal/app',
    results = [],
    load = 'finish'
  } = {}) {
    super()
    this.url = url
    this.results = [...results]
    this.load = load
  }

  loadURL (url) {
    this.url = url
    if (this.load === 'finish') {
      setImmediate(() => this.emit('did-finish-load'))
    } else if (this.load === 'certificate') {
      setImmediate(() => this.emit(
        'did-fail-load',
        {},
        -202,
        'ERR_CERT_AUTHORITY_INVALID',
        url,
        true
      ))
    } else if (this.load === 'network') {
      setImmediate(() => this.emit(
        'did-fail-load',
        {},
        -105,
        'ERR_NAME_NOT_RESOLVED',
        url,
        true
      ))
    }
    return Promise.resolve()
  }

  getURL () {
    return this.url
  }

  executeJavaScript () {
    return Promise.resolve(this.results.shift() || {
      title: '',
      text: ''
    })
  }
}

class FakeShell extends EventEmitter {
  constructor (options = {}) {
    super()
    this.remote = new FakeRemote(options)
    this.session = {}
    this.ready = options.readyError
      ? Promise.reject(new Error('shell failed'))
      : Promise.resolve()
    this.showCount = 0
    this.closeCount = 0
    this.statuses = []
  }

  show () {
    this.showCount += 1
  }

  focus () {}

  updateStatus (status) {
    this.statuses.push(status)
  }

  onAction (handler) {
    this.actionHandler = handler
    return () => {
      this.actionHandler = null
    }
  }

  action (value) {
    this.actionHandler?.(value)
  }

  close () {
    this.closeCount += 1
  }
}

function createHarness (options = {}) {
  const shell = new FakeShell(options)
  let guardOptions
  let guardDisposals = 0
  const reader = createAuthenticatedWebReader({
    adapter: {
      createShell: () => shell
    },
    installGuard: options => {
      guardOptions = options
      return () => {
        guardDisposals += 1
      }
    },
    delay: async () => {},
    loadTimeoutMs: options.loadTimeoutMs || 100,
    interactiveTimeoutMs: options.interactiveTimeoutMs || 100
  })
  return {
    reader,
    shell,
    getGuardOptions: () => guardOptions,
    getGuardDisposals: () => guardDisposals
  }
}

test('returns useful hidden content without showing the shell', async () => {
  const harness = createHarness({
    results: [{
      title: 'Operations',
      text: 'Useful operational content '.repeat(20)
    }]
  })
  const result = await harness.reader.read({
    url: 'http://kb.internal/app',
    readId: 'read-1',
    isOriginGranted: async () => true
  })

  assert.equal(result.source, 'browser')
  assert.match(result.text, /Useful operational content/)
  assert.equal(harness.shell.showCount, 0)
  assert.equal(harness.shell.closeCount, 1)
  assert.equal(harness.getGuardDisposals(), 1)
  assert.equal(harness.shell.listenerCount('closed'), 0)
})

test('shows the shell for login and completes from the trusted toolbar', async () => {
  const harness = createHarness({
    url: 'http://kb.internal/login',
    results: [
      { title: 'Sign in', text: 'Sign in' },
      {
        title: 'Knowledge Base',
        text: 'Authenticated knowledge '.repeat(20)
      }
    ]
  })
  const operation = harness.reader.read({
    url: 'http://kb.internal/login',
    readId: 'read-1',
    isOriginGranted: async () => true
  })
  while (!harness.shell.showCount) {
    await new Promise(resolve => setImmediate(resolve))
  }
  harness.shell.action('complete')

  const result = await operation
  assert.equal(result.title, 'Knowledge Base')
  assert.match(result.text, /Authenticated knowledge/)
  assert.equal(harness.shell.closeCount, 1)
  assert.equal(harness.getGuardDisposals(), 1)
})

test('returns structured cancellation and empty-page errors', async () => {
  const cancelled = createHarness({
    results: [{ title: 'Sign in', text: 'Sign in' }]
  })
  const cancelOperation = cancelled.reader.read({
    url: 'http://kb.internal/login',
    readId: 'read-1',
    isOriginGranted: async () => true
  })
  while (!cancelled.shell.showCount) {
    await new Promise(resolve => setImmediate(resolve))
  }
  cancelled.shell.action('cancel')
  await assert.rejects(cancelOperation, {
    code: 'WEB_ACCESS_CANCELLED'
  })
  assert.equal(cancelled.shell.closeCount, 1)

  const empty = createHarness({
    results: [
      { title: '', text: '' },
      { title: '', text: '' }
    ]
  })
  const emptyOperation = empty.reader.read({
    url: 'http://kb.internal/app',
    readId: 'read-2',
    isOriginGranted: async () => true
  })
  while (!empty.shell.showCount) {
    await new Promise(resolve => setImmediate(resolve))
  }
  empty.shell.action('complete')
  await assert.rejects(emptyOperation, { code: 'WEB_READ_EMPTY' })
  assert.equal(empty.shell.closeCount, 1)
})

test('maps load timeout certificate and network failures', async () => {
  const shellFailure = createHarness({ readyError: true })
  await assert.rejects(shellFailure.reader.read({
    url: 'http://kb.internal/app',
    readId: 'read-shell',
    isOriginGranted: async () => true
  }), { code: 'WEB_NETWORK_ERROR' })
  assert.equal(shellFailure.shell.closeCount, 1)

  const timeout = createHarness({
    load: 'pending',
    loadTimeoutMs: 20
  })
  await assert.rejects(timeout.reader.read({
    url: 'http://kb.internal/app',
    readId: 'read-timeout',
    isOriginGranted: async () => true
  }), { code: 'WEB_READ_TIMEOUT' })
  assert.equal(timeout.shell.closeCount, 1)

  const certificate = createHarness({ load: 'certificate' })
  await assert.rejects(certificate.reader.read({
    url: 'https://kb.internal/app',
    readId: 'read-certificate',
    isOriginGranted: async () => true
  }), { code: 'WEB_CERTIFICATE_ERROR' })
  assert.equal(certificate.shell.closeCount, 1)

  const network = createHarness({ load: 'network' })
  await assert.rejects(network.reader.read({
    url: 'http://kb.internal/app',
    readId: 'read-network',
    isOriginGranted: async () => true
  }), { code: 'WEB_NETWORK_ERROR' })
  assert.equal(network.shell.closeCount, 1)
})

test('surfaces navigation authorization challenges with safe details', async () => {
  const harness = createHarness({ load: 'pending' })
  const operation = harness.reader.read({
    url: 'http://first.internal/app',
    readId: 'read-1',
    isOriginGranted: async () => true
  })
  while (!harness.getGuardOptions()) {
    await new Promise(resolve => setImmediate(resolve))
  }
  harness.shell.remote.emit(
    'did-fail-load',
    {},
    -20,
    'ERR_BLOCKED_BY_CLIENT',
    'http://second.internal/app',
    true
  )
  harness.getGuardOptions().onAuthorizationRequired({
    origin: 'http://second.internal',
    addressClass: 'private',
    url: 'http://second.internal/path?token=secret'
  })

  await assert.rejects(operation, error => {
    assert.equal(error.code, 'WEB_ACCESS_AUTH_REQUIRED')
    assert.deepEqual(error.details, {
      origin: 'http://second.internal',
      addressClass: 'private',
      readId: 'read-1'
    })
    assert.doesNotMatch(JSON.stringify(error), /token=secret/)
    return true
  })
  assert.equal(harness.shell.closeCount, 1)
  assert.equal(harness.getGuardDisposals(), 1)
})
