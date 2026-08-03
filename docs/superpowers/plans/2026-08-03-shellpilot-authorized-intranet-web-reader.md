# ShellPilot Authorized Intranet Web Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Let users explicitly authorize ShellPilot to read reachable private-network and localhost HTTP/HTTPS pages, including authenticated JavaScript-rendered SPAs, while preserving strict blocks for dangerous targets and isolating browser session data.

**Architecture:** Keep the existing DNS-pinned static public-page reader as the fast path. Add a structured network policy and per-origin grant store in the main process, then route authorized private/localhost targets and low-quality SPA responses through a dedicated Electron WebContentsView using the persist:shellpilot-ai-web partition. The renderer can request authorization but cannot manufacture grants; the main process binds short-lived authorization tokens to the sender, normalized origin, address class, and logical read ID.

**Tech Stack:** Electron 41, Node.js CommonJS main-process modules, React/Ant Design renderer components, node:test unit tests, Playwright Electron E2E, StandardJS.

---

## Approved constraints

- Public HTTP/HTTPS pages remain readable without a prompt.
- Private and localhost origins require per-origin user authorization: once for one logical read, or always.
- localhost is authorizable but receives a stronger warning than an ordinary private origin.
- Link-local, cloud metadata, multicast, unspecified, reserved, and non-HTTP(S) targets are always blocked.
- Credentials embedded in URLs are always blocked.
- Chromium uses an isolated persistent partition; it does not import Chrome or Edge cookies.
- The remote page has sandboxing and context isolation enabled, Node integration disabled, no ShellPilot preload, and no direct IPC.
- Downloads, popups, external protocols, and browser permissions are denied.
- Only final URL, title, visible body text, source, and truncation state may leave the reader.
- The first release has no wildcard domain grants, CIDR grants, or global allow-all switch.

## File map

### Main-process policy and persistence

- Create apps/electerm-agent/src/app/lib/ai-content/web-access-errors.js
  - Define stable WEB_* error creation and serialization helpers.
- Create apps/electerm-agent/src/app/lib/ai-content/web-access-policy.js
  - Parse URLs, resolve DNS, classify every address, normalize origins, and return structured decisions.
- Modify apps/electerm-agent/src/app/lib/ai-content/url-safety.js
  - Preserve the public-only compatibility API by delegating to the new policy.
- Create apps/electerm-agent/src/app/lib/ai-content/web-access-grants.js
  - Manage logical-read grants in memory and permanent grants in an atomic local JSON repository.
- Modify apps/electerm-agent/src/app/lib/ai-content/web-reader.js
  - Add static-content quality analysis and browser-fallback metadata without weakening DNS pinning.

### Isolated browser path

- Create apps/electerm-agent/src/app/lib/ai-content/web-navigation-guard.js
  - Guard main-frame navigation, redirects, subresources, popups, downloads, and permissions.
- Create apps/electerm-agent/src/app/lib/ai-content/electron-web-reader-adapter.js
  - Encapsulate BrowserWindow, WebContentsView, session, sizing, and toolbar IPC.
- Create apps/electerm-agent/src/app/lib/ai-content/authenticated-web-reader.js
  - Load pages hidden first, expose a visible login/read window when needed, extract bounded visible text, and clean up.
- Create apps/electerm-agent/src/app/preload/ai-web-reader-preload.js
  - Expose only complete and cancel toolbar actions to the trusted local reader shell.
- Create apps/electerm-agent/src/app/lib/ai-content/web-access-service.js
  - Orchestrate policy, tokens, grants, static reading, browser fallback, and settings operations.

### IPC and renderer

- Modify apps/electerm-agent/src/app/lib/ipc.js
  - Add sender-aware web-access operations and preserve sanitized structured WEB_* errors.
- Create apps/electerm-agent/src/client/components/ai/ai-web-access-client.js
  - Run read/authorize/retry logic while retaining a logical read ID.
- Create apps/electerm-agent/src/client/components/ai/ai-web-access-modal.jsx
  - Render the once/always/cancel authorization prompt.
- Modify apps/electerm-agent/src/client/components/ai/ai-attachments.js
  - Use the web-access client for URL attachments and preserve error codes.
- Modify apps/electerm-agent/src/client/components/ai/ai-chat.jsx
  - Host the authorization promise and modal without changing file/SFTP attachment behavior.

### Settings, localization, and documentation

- Modify apps/electerm-agent/src/client/common/constants.js
- Modify apps/electerm-agent/src/client/common/setting-list.js
- Modify apps/electerm-agent/src/client/common/setting-search-index.js
- Modify apps/electerm-agent/src/client/components/setting-panel/tab-settings.jsx
- Create apps/electerm-agent/src/client/components/setting-panel/setting-ai-web-access.jsx
- Modify apps/electerm-agent/src/client/components/setting-panel/setting.styl
- Modify apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js
- Modify apps/electerm-agent/docs/USER_GUIDE_ZH.md

### Tests and fixtures

- Create apps/electerm-agent/test/unit-ci/ai-web-access-policy.spec.js
- Create apps/electerm-agent/test/unit-ci/ai-web-access-grants.spec.js
- Create apps/electerm-agent/test/unit-ci/ai-web-reader-routing.spec.js
- Create apps/electerm-agent/test/unit-ci/ai-web-navigation-guard.spec.js
- Create apps/electerm-agent/test/unit-ci/ai-authenticated-web-reader.spec.js
- Create apps/electerm-agent/test/unit-ci/ai-web-access-service.spec.js
- Create apps/electerm-agent/test/unit-ci/ai-web-access-ipc.spec.js
- Create apps/electerm-agent/test/unit-ci/ai-web-access-ui.spec.js
- Create apps/electerm-agent/test/unit-ci/ai-web-access-settings.spec.js
- Create apps/electerm-agent/test/e2e/common/ai-web-fixture.js
- Create apps/electerm-agent/test/e2e/036.ai-web-access.spec.js
- Modify apps/electerm-agent/test/unit-ci/ai-content-ingestion.spec.js
- Modify apps/electerm-agent/test/unit-ci/ai-attachments.spec.js
- Modify apps/electerm-agent/test/unit-ci/setting-search-index.spec.js

All commands below run from:

    F:\SSH工具开发\.worktrees\intranet-web-reader\apps\electerm-agent

## Task 1: Introduce structured target classification

**Files:**

- Create: src/app/lib/ai-content/web-access-errors.js
- Create: src/app/lib/ai-content/web-access-policy.js
- Modify: src/app/lib/ai-content/url-safety.js
- Create: test/unit-ci/ai-web-access-policy.spec.js
- Modify: test/unit-ci/ai-content-ingestion.spec.js

- [ ] Step 1: Write failing classification tests

Add table-driven tests for public, private, loopback, and permanently blocked addresses. Inject DNS so tests never depend on the host network.

~~~js
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  classifyAddress,
  inspectWebTarget,
  normalizeWebOrigin
} = require('../../src/app/lib/ai-content/web-access-policy')

test('classifies public private loopback and dangerous targets', async () => {
  const cases = [
    ['8.8.8.8', 'public'],
    ['10.2.3.4', 'private'],
    ['100.64.2.3', 'private'],
    ['127.0.0.1', 'loopback'],
    ['::1', 'loopback'],
    ['169.254.169.254', 'dangerous'],
    ['0.0.0.0', 'dangerous'],
    ['224.0.0.1', 'dangerous'],
    ['fe80::1', 'dangerous'],
    ['ff02::1', 'dangerous']
  ]
  for (const [address, expected] of cases) {
    assert.equal(classifyAddress(address), expected, address)
  }
})

test('uses the strictest DNS result and returns a normalized origin', async () => {
  const result = await inspectWebTarget(
    'http://router.internal:8080/admin?secret=x#panel',
    {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.1.1', family: 4 }
      ],
      isOriginGranted: async () => false
    }
  )

  assert.equal(result.decision, 'authorization-required')
  assert.equal(result.target.addressClass, 'private')
  assert.equal(result.target.origin, 'http://router.internal:8080')
  assert.equal(
    normalizeWebOrigin('https://Example.com:443/path'),
    'https://example.com'
  )
})
~~~

Also test:

- localhost by name and 127.0.0.0/8 produce loopback.
- IPv6 ULA produces private.
- IPv4-mapped IPv6 uses the embedded IPv4 classification.
- Empty DNS results produce WEB_NETWORK_ERROR.
- file:, ftp:, javascript:, data:, blob:, URL credentials, and port 0 produce WEB_ACCESS_BLOCKED.
- A DNS answer containing any dangerous address is blocked even when other answers are public.
- A valid permanent grant changes private/loopback from authorization-required to allow-granted but never changes dangerous to allowed.
- Returned error details contain origin and addressClass only; path, query, hash, username, and password are absent.

- [ ] Step 2: Run the policy tests and verify RED

Run:

    node --test test/unit-ci/ai-web-access-policy.spec.js

Expected: FAIL with MODULE_NOT_FOUND for web-access-policy.js.

- [ ] Step 3: Implement error and policy primitives

web-access-errors.js must expose:

~~~js
class WebAccessError extends Error {
  constructor (code, message, details = {}) {
    super(message)
    this.name = 'WebAccessError'
    this.code = code
    this.details = sanitizeWebErrorDetails(details)
  }
}

function sanitizeWebErrorDetails (details = {}) {
  return {
    ...(details.origin ? { origin: String(details.origin) } : {}),
    ...(details.addressClass
      ? { addressClass: String(details.addressClass) }
      : {}),
    ...(details.authorizationToken
      ? { authorizationToken: String(details.authorizationToken) }
      : {}),
    ...(details.readId ? { readId: String(details.readId) } : {})
  }
}
~~~

web-access-policy.js must:

1. Parse only HTTP/HTTPS URLs.
2. Reject URL credentials and effective port 0.
3. Resolve literals without DNS and hostnames with lookup(hostname, { all: true, verbatim: true }).
4. Classify every result.
5. Choose the strictest class with dangerous > loopback > private > public.
6. Normalize an origin as scheme + lowercase host + effective non-default port.
7. Return this stable shape:

~~~js
{
  decision: 'allow-public',
  target: {
    url: parsed.toString(),
    origin,
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
    addresses,
    addressClass
  },
  reason: 'public-target'
}
~~~

Use explicit byte/range checks rather than substring matching. Treat these ranges as private: RFC1918, 100.64.0.0/10, and fc00::/7. Treat loopback separately. Treat unspecified, link-local, multicast, benchmark/documentation/reserved, and cloud metadata ranges as dangerous.

- [ ] Step 4: Preserve the public-only compatibility wrapper

Change assertSafePublicUrl in url-safety.js to call inspectWebTarget and accept only allow-public. Preserve its current return contract:

~~~js
{
  url: new URL(result.target.url),
  addresses: result.target.addresses
}
~~~

Re-export isPrivateAddress as true for private, loopback, and dangerous so existing callers and tests retain their conservative meaning.

- [ ] Step 5: Run policy and ingestion tests and verify GREEN

Run:

    node --test test/unit-ci/ai-web-access-policy.spec.js test/unit-ci/ai-content-ingestion.spec.js

Expected: all tests pass, including the existing private/local rejection tests for assertSafePublicUrl.

- [ ] Step 6: Commit Task 1

    git add src/app/lib/ai-content/web-access-errors.js src/app/lib/ai-content/web-access-policy.js src/app/lib/ai-content/url-safety.js test/unit-ci/ai-web-access-policy.spec.js test/unit-ci/ai-content-ingestion.spec.js
    git commit -m "feat: classify authorized web targets"

## Task 2: Add scoped and permanent origin grants

**Files:**

- Create: src/app/lib/ai-content/web-access-grants.js
- Create: test/unit-ci/ai-web-access-grants.spec.js

- [ ] Step 1: Write failing grant lifecycle tests

Use a temporary directory under os.tmpdir() and verify both memory and disk behavior.

~~~js
test('once grants survive retries for one read and are removed on finish', async () => {
  const grants = createWebAccessGrants({ repository: memoryRepository() })
  await grants.load()
  await grants.authorize({
    origin: 'http://router.internal:8080',
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

  grants.finishRead('read-1')
  assert.equal(await grants.isGranted({
    origin: 'http://router.internal:8080',
    readId: 'read-1'
  }), false)
})

test('permanent grants persist without page or credential data', async () => {
  const first = createWebAccessGrants({ repository })
  await first.load()
  await first.authorize({
    origin: 'https://kb.internal',
    addressClass: 'private',
    scope: 'always',
    readId: 'read-1'
  })

  const second = createWebAccessGrants({ repository })
  await second.load()
  assert.equal(await second.isGranted({
    origin: 'https://kb.internal',
    readId: 'read-2'
  }), true)

  const serialized = await fs.readFile(filePath, 'utf8')
  assert.doesNotMatch(serialized, /cookie|password|query|hash|pageText/i)
})
~~~

Also test list, revoke, clear, createdAt, lastUsedAt, malformed-file recovery, duplicate normalization, and rejection of dangerous or unsupported address classes.

- [ ] Step 2: Run the grant tests and verify RED

    node --test test/unit-ci/ai-web-access-grants.spec.js

Expected: FAIL with MODULE_NOT_FOUND for web-access-grants.js.

- [ ] Step 3: Implement the repository and grant manager

Persist this versioned shape under app.getPath('userData')/ai-web-access/grants.json:

~~~js
{
  version: 1,
  grants: [{
    origin: 'https://kb.internal',
    addressClass: 'private',
    createdAt: '2026-08-03T00:00:00.000Z',
    lastUsedAt: '2026-08-03T00:00:00.000Z'
  }]
}
~~~

Implementation requirements:

- Repository dependencies are injectable: filePath, fs, and now.
- Writes create the parent directory, write grants.json.tmp, and rename it over grants.json.
- A missing file loads as an empty list.
- Invalid JSON is treated as empty and never executed or interpolated.
- Once grants live only in a Map keyed by readId and normalized origin.
- finishRead(readId) removes all once grants for that logical read.
- authorize accepts only once or always and only private or loopback.
- list returns permanent grants only and returns defensive copies.
- revoke and clear update disk atomically.

- [ ] Step 4: Run the grant tests and verify GREEN

    node --test test/unit-ci/ai-web-access-grants.spec.js

Expected: all grant tests pass.

- [ ] Step 5: Commit Task 2

    git add src/app/lib/ai-content/web-access-grants.js test/unit-ci/ai-web-access-grants.spec.js
    git commit -m "feat: persist per-origin web access grants"

## Task 3: Detect static shells and preserve the public fast path

**Files:**

- Modify: src/app/lib/ai-content/web-reader.js
- Create: test/unit-ci/ai-web-reader-routing.spec.js
- Modify: test/unit-ci/ai-content-ingestion.spec.js

- [ ] Step 1: Write failing routing tests

~~~js
test('routes useful static content without a browser', () => {
  const result = evaluateWebContentQuality({
    url: 'https://example.com/article',
    html: '<html><title>Report</title><body><h1>Report</h1><p>' +
      'Operational detail '.repeat(30) + '</p></body></html>',
    text: 'Report\n' + 'Operational detail '.repeat(30)
  })
  assert.equal(result.requiresBrowser, false)
})

test('routes SPA shells hash routes and login shells to the browser', () => {
  const cases = [
    {
      url: 'https://example.com/app',
      html: '<div id="root"></div><script src="/app.js"></script>',
      text: ''
    },
    {
      url: 'https://example.com/app#/sharingPath',
      html: '<div id="app">Loading...</div>',
      text: 'Loading...'
    },
    {
      url: 'https://example.com/login',
      html: '<form><input type="password"></form>',
      text: 'Sign in'
    }
  ]
  for (const input of cases) {
    assert.equal(evaluateWebContentQuality(input).requiresBrowser, true)
  }
})
~~~

- [ ] Step 2: Run the routing tests and verify RED

    node --test test/unit-ci/ai-web-reader-routing.spec.js

Expected: FAIL because evaluateWebContentQuality is not exported.

- [ ] Step 3: Implement conservative quality analysis

Export evaluateWebContentQuality and make readPublicWebPage return:

~~~js
{
  kind: 'web',
  source: 'static',
  url: safe.url.toString(),
  title,
  text,
  truncated,
  requiresBrowser,
  browserReason
}
~~~

Use a combined signal rather than text length alone:

- Hash-router path plus missing matching body content.
- root/app mount node plus script-heavy, short body.
- Password input or sign-in/login text plus short body.
- JavaScript-required/loading-only shell.
- Empty or less than 200 meaningful characters with SPA shell evidence.

A short but meaningful plain-text response must stay on the static path. Parse the HTML title before falling back to the first text line. Keep the existing 2 MB, 80,000 character, three-redirect, 12-second, and pinned-DNS limits unchanged.

- [ ] Step 4: Run routing and regression tests and verify GREEN

    node --test test/unit-ci/ai-web-reader-routing.spec.js test/unit-ci/ai-content-ingestion.spec.js

Expected: all tests pass and the pinned lookup tests remain unchanged.

- [ ] Step 5: Commit Task 3

    git add src/app/lib/ai-content/web-reader.js test/unit-ci/ai-web-reader-routing.spec.js test/unit-ci/ai-content-ingestion.spec.js
    git commit -m "feat: route dynamic pages to browser reading"

## Task 4: Build a reusable navigation and resource guard

**Files:**

- Create: src/app/lib/ai-content/web-navigation-guard.js
- Create: test/unit-ci/ai-web-navigation-guard.spec.js

- [ ] Step 1: Write failing pure-decision tests

~~~js
test('allows public resources and an explicitly granted private origin', async () => {
  const decide = createWebRequestDecision({
    inspectTarget: fakeInspector({
      'https://cdn.example.com': 'allow-public',
      'http://kb.internal': 'allow-granted'
    }),
    isOriginGranted: async origin => origin === 'http://kb.internal'
  })

  assert.equal((await decide({
    url: 'https://cdn.example.com/app.js',
    resourceType: 'script',
    readId: 'read-1'
  })).action, 'allow')
  assert.equal((await decide({
    url: 'http://kb.internal/api',
    resourceType: 'xhr',
    readId: 'read-1'
  })).action, 'allow')
})

test('challenges private main-frame navigation and blocks unsafe resources', async () => {
  const privateNavigation = await decide({
    url: 'http://second.internal/app',
    resourceType: 'mainFrame',
    readId: 'read-1'
  })
  assert.equal(privateNavigation.action, 'authorization-required')

  const privateScript = await decide({
    url: 'http://second.internal/app.js',
    resourceType: 'script',
    readId: 'read-1'
  })
  assert.equal(privateScript.action, 'block')

  const metadata = await decide({
    url: 'http://169.254.169.254/latest/meta-data',
    resourceType: 'xhr',
    readId: 'read-1'
  })
  assert.equal(metadata.action, 'block')
})
~~~

Also test non-HTTP(S), data/blob/file, popups, downloads, and every permission request.

- [ ] Step 2: Run the navigation tests and verify RED

    node --test test/unit-ci/ai-web-navigation-guard.spec.js

Expected: FAIL with MODULE_NOT_FOUND for web-navigation-guard.js.

- [ ] Step 3: Implement the pure decision layer

createWebRequestDecision must return one of:

~~~js
{ action: 'allow' }
{ action: 'block', code: 'WEB_ACCESS_BLOCKED', reason: 'dangerous-target' }
{
  action: 'authorization-required',
  code: 'WEB_ACCESS_AUTH_REQUIRED',
  target: { origin, addressClass }
}
~~~

Rules:

- Public resources are allowed.
- A private/loopback resource is allowed only when its exact origin is granted for the current read.
- An ungranted private/loopback main-frame request returns authorization-required.
- An ungranted private/loopback subresource is blocked without opening a prompt.
- Dangerous targets and non-HTTP(S) protocols are blocked.

- [ ] Step 4: Implement Electron listener registration through an adapter

Export installWebNavigationGuard with injected session and webContents. It must:

- Register the remote webContents ID and read context in a shared registry.
- Use session.webRequest.onBeforeRequest once per isolated session and route by details.webContentsId.
- Listen for will-navigate and did-redirect-navigation for main-frame defense in depth.
- Set setWindowOpenHandler to deny.
- Cancel will-download.
- Set permission request and permission check handlers to false.
- Return a dispose function that removes the read context and webContents listeners.

Do not register one session-wide webRequest callback per read; Electron keeps only one listener for that event.

- [ ] Step 5: Run navigation tests and verify GREEN

    node --test test/unit-ci/ai-web-navigation-guard.spec.js

Expected: all tests pass, including disposal and no-listener-leak assertions.

- [ ] Step 6: Commit Task 4

    git add src/app/lib/ai-content/web-navigation-guard.js test/unit-ci/ai-web-navigation-guard.spec.js
    git commit -m "feat: guard isolated web navigation"

## Task 5: Implement the isolated authenticated browser reader

**Files:**

- Create: src/app/lib/ai-content/electron-web-reader-adapter.js
- Create: src/app/lib/ai-content/authenticated-web-reader.js
- Create: src/app/preload/ai-web-reader-preload.js
- Create: test/unit-ci/ai-authenticated-web-reader.spec.js

- [ ] Step 1: Write failing security-option and extraction tests

~~~js
test('uses an isolated sandboxed partition without a remote preload', () => {
  const options = buildRemoteViewOptions()
  assert.equal(options.webPreferences.partition, 'persist:shellpilot-ai-web')
  assert.equal(options.webPreferences.sandbox, true)
  assert.equal(options.webPreferences.contextIsolation, true)
  assert.equal(options.webPreferences.nodeIntegration, false)
  assert.equal(options.webPreferences.webSecurity, true)
  assert.equal(Object.hasOwn(options.webPreferences, 'preload'), false)
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
  assert.doesNotMatch(script, /document\.cookie|localStorage|sessionStorage/)
  assert.equal(result.kind, 'web')
  assert.equal(result.source, 'browser')
  assert.equal(result.url, 'http://kb.internal/app#/sharingPath')
  assert.equal(result.text.length, 80000)
  assert.equal(result.truncated, true)
  assert.deepEqual(Object.keys(result).sort(), [
    'kind', 'source', 'text', 'title', 'truncated', 'url'
  ])
})
~~~

- [ ] Step 2: Write failing lifecycle tests with a fake Electron adapter

Cover:

- Hidden load returns automatically when visible text passes quality checks.
- Login/empty content calls shell.show() and waits for a trusted toolbar complete action.
- Cancel returns WEB_ACCESS_CANCELLED.
- Timeout returns WEB_READ_TIMEOUT.
- Certificate failure returns WEB_CERTIFICATE_ERROR without bypassing it.
- Navigation authorization challenge is surfaced with origin/addressClass only.
- Window close, success, cancellation, and timeout all dispose guards, listeners, view, and window exactly once.

- [ ] Step 3: Run the reader tests and verify RED

    node --test test/unit-ci/ai-authenticated-web-reader.spec.js

Expected: FAIL because the adapter and reader modules do not exist.

- [ ] Step 4: Implement the trusted shell preload

ai-web-reader-preload.js must expose only:

~~~js
contextBridge.exposeInMainWorld('shellPilotWebReader', {
  complete: () => ipcRenderer.send('ai-web-reader-action', 'complete'),
  cancel: () => ipcRenderer.send('ai-web-reader-action', 'cancel')
})
~~~

No generic invoke, filesystem API, Node object, cookie API, or navigation API may be exposed.

- [ ] Step 5: Implement the Electron adapter

Use:

- BrowserWindow for a trusted local toolbar shell.
- WebContentsView for the untrusted remote page.
- session.fromPartition('persist:shellpilot-ai-web').
- A data:text/html shell with a restrictive CSP, target origin label, loading status, Read Current Page, and Cancel.
- Shell webPreferences with sandbox, contextIsolation, nodeIntegration false, webSecurity true, and only ai-web-reader-preload.js.
- Remote view webPreferences from buildRemoteViewOptions with no preload.

Map shell webContents.id to the active reader instance. The ai-web-reader-action handler must resolve actions only for that exact trusted sender. Resize the remote view below the toolbar and remove it before destroying the parent window.

- [ ] Step 6: Implement authenticated reader behavior

createAuthenticatedWebReader accepts an adapter, navigation guard factory, quality evaluator, and timeouts. Its read contract is:

~~~js
await reader.read({
  url,
  readId,
  isOriginGranted,
  onAuthorizationRequired
})
~~~

Behavior:

1. Create a hidden shell and remote view.
2. Install the guard before loadURL.
3. Load the target and wait for did-finish-load plus a bounded DOM-settle interval.
4. Extract visible text.
5. Return immediately if quality passes and no login shell is detected.
6. Otherwise show and focus the shell so the user can log in or navigate.
7. On Read Current Page, extract again and reject with WEB_READ_EMPTY only if no useful visible text exists.
8. Always close the shell while retaining the persistent partition.

- [ ] Step 7: Run reader tests and verify GREEN

    node --test test/unit-ci/ai-authenticated-web-reader.spec.js test/unit-ci/ai-web-navigation-guard.spec.js

Expected: all tests pass and fake-adapter listener counts return to zero.

- [ ] Step 8: Commit Task 5

    git add src/app/lib/ai-content/electron-web-reader-adapter.js src/app/lib/ai-content/authenticated-web-reader.js src/app/preload/ai-web-reader-preload.js test/unit-ci/ai-authenticated-web-reader.spec.js
    git commit -m "feat: read authenticated pages in isolation"

## Task 6: Orchestrate authorization, retries, and structured IPC

**Files:**

- Create: src/app/lib/ai-content/web-access-service.js
- Modify: src/app/lib/ipc.js
- Create: test/unit-ci/ai-web-access-service.spec.js
- Create: test/unit-ci/ai-web-access-ipc.spec.js

- [ ] Step 1: Write failing service tests

~~~js
test('issues a sender-bound token and accepts it once', async () => {
  const service = createWebAccessService(dependencies)

  await assert.rejects(
    service.read({
      url: 'http://kb.internal/app',
      readId: 'read-1',
      senderId: 17
    }),
    error => {
      assert.equal(error.code, 'WEB_ACCESS_AUTH_REQUIRED')
      token = error.details.authorizationToken
      assert.equal(error.details.origin, 'http://kb.internal')
      return true
    }
  )

  await assert.rejects(
    service.authorize({
      authorizationToken: token,
      scope: 'once',
      senderId: 18
    }),
    { code: 'WEB_ACCESS_BLOCKED' }
  )

  await service.authorize({
    authorizationToken: token,
    scope: 'once',
    senderId: 17
  })
  const result = await service.read({
    url: 'http://kb.internal/app',
    readId: 'read-1',
    senderId: 17
  })
  assert.equal(result.source, 'browser')
})
~~~

Also test:

- Token expiry, replay, wrong origin, wrong address class, wrong read ID, and wrong sender.
- Public useful static page stays on the static reader.
- Public SPA shell falls back to browser.
- Authorized private/loopback goes directly to browser.
- Browser redirect to a new private origin creates a new challenge bound to the same read ID.
- Dangerous DNS reclassification blocks a previously permanent origin.
- Success/cancel explicitly finishes once grants and token state.
- Permanent grants remain after logical reads.
- list/revoke/clear grants and clear session data delegate correctly.

- [ ] Step 2: Run service tests and verify RED

    node --test test/unit-ci/ai-web-access-service.spec.js

Expected: FAIL with MODULE_NOT_FOUND for web-access-service.js.

- [ ] Step 3: Implement the service

Use randomUUID tokens with a five-minute TTL. Store token records only in memory:

~~~js
{
  token,
  senderId,
  readId,
  origin,
  addressClass,
  expiresAt,
  consumed: false
}
~~~

Public read sequence:

1. Inspect target.
2. Run readPublicWebPage.
3. Return useful static content.
4. Otherwise run authenticated reader.

Private/loopback sequence:

1. Inspect target and re-resolve DNS.
2. Check grants with the read ID.
3. If absent, create and throw a sanitized challenge.
4. If present, run authenticated reader.

For a private cross-origin browser navigation, authenticated reader invokes onAuthorizationRequired; the service issues a new token for the same sender and read ID and fails the current attempt with WEB_ACCESS_AUTH_REQUIRED. The isolated partition retains login state, and the renderer authorizes then retries the logical read.

- [ ] Step 4: Write failing IPC contract tests

Verify source contracts and exported helpers:

- safeAIContentResult preserves only WEB_* code, safe message, and sanitized details.
- Non-WEB errors remain AI_CONTENT_READ_FAILED.
- ingestAIContent and web management operations receive event.sender.id.
- Unknown renderer fields cannot inject senderId.
- No IPC result contains addresses, query, hash, cookies, request headers, or body text on an error path.

- [ ] Step 5: Run IPC tests and verify RED

    node --test test/unit-ci/ai-web-access-ipc.spec.js

Expected: FAIL because ipc.js still flattens errors and has no sender-aware web globals.

- [ ] Step 6: Wire a lazy service into ipc.js

Create one service after Electron app readiness using:

- app.getPath('userData')/ai-web-access/grants.json
- BrowserWindow, WebContentsView, session, and ipcMain in the actual adapter
- Existing readPublicWebPage

Keep ordinary asyncGlobals unchanged. Add contextual globals:

~~~js
const contextualAsyncGlobals = {
  ingestAIContent: (event, payload) => safeAIContentResult(
    () => ingestAIContent(payload, event.sender.id)
  ),
  authorizeAIWebTarget: (event, payload) => safeAIContentResult(
    () => getWebAccessService().authorize({
      ...payload,
      senderId: event.sender.id
    })
  )
}
~~~

Add listAIWebGrants, revokeAIWebGrant, clearAIWebGrants, clearAIWebSessionData, and cancelAIWebRead through the same sender-aware path. The generic async handler selects contextualAsyncGlobals[name] first and never trusts senderId from args.

For URL payloads, ingestAIContent calls service.read with payload.url and payload.readId. File ingestion remains byte-for-byte on the existing code path.

- [ ] Step 7: Run service, IPC, and ingestion tests and verify GREEN

    node --test test/unit-ci/ai-web-access-service.spec.js test/unit-ci/ai-web-access-ipc.spec.js test/unit-ci/ai-content-ingestion.spec.js

Expected: all tests pass.

- [ ] Step 8: Commit Task 6

    git add src/app/lib/ai-content/web-access-service.js src/app/lib/ipc.js test/unit-ci/ai-web-access-service.spec.js test/unit-ci/ai-web-access-ipc.spec.js
    git commit -m "feat: authorize web reads through main IPC"

## Task 7: Add the renderer authorization flow

**Files:**

- Create: src/client/components/ai/ai-web-access-client.js
- Create: src/client/components/ai/ai-web-access-modal.jsx
- Modify: src/client/components/ai/ai-attachments.js
- Modify: src/client/components/ai/ai-chat.jsx
- Modify: src/client/components/ai/ai.styl
- Create: test/unit-ci/ai-web-access-ui.spec.js
- Modify: test/unit-ci/ai-attachments.spec.js

- [ ] Step 1: Write failing client retry tests

~~~js
test('authorizes and retries with one stable logical read ID', async () => {
  const calls = []
  const result = await readAIWebContent({
    url: 'http://kb.internal/app',
    readId: 'read-1',
    invoke: async (name, payload) => {
      calls.push([name, payload])
      if (name === 'ingestAIContent' && calls.length === 1) {
        return {
          ok: false,
          error: {
            code: 'WEB_ACCESS_AUTH_REQUIRED',
            message: 'Authorization required.',
            details: {
              origin: 'http://kb.internal',
              addressClass: 'private',
              authorizationToken: 'token-1',
              readId: 'read-1'
            }
          }
        }
      }
      if (name === 'authorizeAIWebTarget') return { ok: true, value: {} }
      return {
        ok: true,
        value: { kind: 'web', source: 'browser', text: 'visible content' }
      }
    },
    requestAuthorization: async challenge => {
      assert.equal(challenge.origin, 'http://kb.internal')
      return 'once'
    }
  })

  assert.equal(result.text, 'visible content')
  assert.equal(calls[0][1].readId, 'read-1')
  assert.equal(calls[2][1].readId, 'read-1')
})
~~~

Also test:

- always scope.
- cancel calls cancelAIWebRead and returns a recognized WEB_ACCESS_CANCELLED error.
- four consecutive cross-origin challenges stop with WEB_REDIRECT_LIMIT.
- malformed or missing challenge details fail closed.
- non-authorization errors are not retried.

- [ ] Step 2: Run client tests and verify RED

    node --test test/unit-ci/ai-web-access-ui.spec.js

Expected: FAIL with MODULE_NOT_FOUND for ai-web-access-client.js.

- [ ] Step 3: Implement the client helper and preserve structured errors

unwrapIngestionResult must create an Error carrying result.error.code and a defensive result.error.details copy. ai-web-access-client.js owns the bounded read/authorize/retry loop. It invokes only:

- ingestAIContent
- authorizeAIWebTarget
- cancelAIWebRead

createWebAttachment must assign one readId with uid() and retain it across submit retries.

- [ ] Step 4: Implement the controlled authorization modal

The modal receives challenge, activeAIName, open, onDecision, and onCancel. It must display:

- Normalized origin.
- Private or localhost classification.
- Stronger localhost warning.
- The current AI configuration name and a statement that visible page text will be sent to it.
- Buttons with data-testid values ai-web-allow-once, ai-web-allow-always, and ai-web-cancel.

The page itself cannot trigger this modal; only a structured main-process challenge can populate it.

- [ ] Step 5: Integrate the modal with AIChat and attachments

AIChat keeps one pending resolver:

~~~js
const [webAccessChallenge, setWebAccessChallenge] = useState(null)
const webAccessResolverRef = useRef(null)

function requestWebAccessAuthorization (challenge) {
  return new Promise(resolve => {
    webAccessResolverRef.current = resolve
    setWebAccessChallenge(challenge)
  })
}
~~~

Resolve and clear it for once, always, cancel, component unmount, and conversation close. Pass requestWebAccessAuthorization and activeAIConfig.nameAI into buildAttachmentAIContent. Do not change local file or SFTP handling.

User cancellation:

- Does not call window.store.onError.
- Does not add a failed chat record.
- Leaves a concise warning only when other attachments also failed.

- [ ] Step 6: Run UI and attachment tests and verify GREEN

    node --test test/unit-ci/ai-web-access-ui.spec.js test/unit-ci/ai-attachments.spec.js test/unit-ci/ai-chat-submit.spec.js

Expected: all tests pass; local, browser-file, archive, SFTP, and URL attachments retain their existing behavior.

- [ ] Step 7: Commit Task 7

    git add src/client/components/ai/ai-web-access-client.js src/client/components/ai/ai-web-access-modal.jsx src/client/components/ai/ai-attachments.js src/client/components/ai/ai-chat.jsx src/client/components/ai/ai.styl test/unit-ci/ai-web-access-ui.spec.js test/unit-ci/ai-attachments.spec.js
    git commit -m "feat: prompt for private web access"

## Task 8: Add grant and isolated-session settings

**Files:**

- Modify: src/client/common/constants.js
- Modify: src/client/common/setting-list.js
- Modify: src/client/common/setting-search-index.js
- Modify: src/client/components/setting-panel/tab-settings.jsx
- Create: src/client/components/setting-panel/setting-ai-web-access.jsx
- Modify: src/client/components/setting-panel/setting.styl
- Modify: src/client/common/shellpilot-i18n-overrides.js
- Modify: docs/USER_GUIDE_ZH.md
- Create: test/unit-ci/ai-web-access-settings.spec.js
- Modify: test/unit-ci/setting-search-index.spec.js

- [ ] Step 1: Write failing settings contract tests

Verify:

- settingAiWebAccessId equals setting-ai-web-access.
- The setting list and search index expose Chinese and English web-access terms.
- tab-settings renders SettingAiWebAccess for that ID.
- The component calls list, revoke, clear grants, and clear session data through runGlobalAsync.
- Revoke, clear-all grants, and clear-login-data actions require confirmation.
- The grant table renders origin, address class, created time, and last-used time.
- i18n contains all new keys in zh_cn and en_us.
- The previous public-only shellpilotAiWebUrlHint text is replaced.

- [ ] Step 2: Run settings tests and verify RED

    node --test test/unit-ci/ai-web-access-settings.spec.js test/unit-ci/setting-search-index.spec.js

Expected: FAIL because the setting ID and component do not exist.

- [ ] Step 3: Add the setting route and search metadata

Add:

~~~js
export const settingAiWebAccessId = 'setting-ai-web-access'
~~~

Add it after the AI configuration item. Update the explicit actualItemIds set in setting-search-index.spec.js so the contract remains closed and intentional.

- [ ] Step 4: Implement the settings component

On mount, list permanent grants. Render an empty state or a compact table. Operations:

- Revoke one origin, then refresh.
- Clear all permanent grants, then refresh.
- Clear isolated session data independently.

Disable repeated clicks while an operation is in flight. Show success and failure feedback through the existing message helper. Do not display resolved IPs, cookies, or page paths.

- [ ] Step 5: Add bilingual copy and user guide content

Add Chinese and English labels for:

- AI web access grants.
- private network and localhost classifications.
- once/always/cancel actions.
- visible text sent to active AI warning.
- stronger localhost warning.
- revoke and clear confirmations.
- isolated login-data clearing.
- browser login/read toolbar.
- all WEB_* user-facing messages.

Update docs/USER_GUIDE_ZH.md to explain:

1. Public static fast path.
2. Per-origin private/localhost authorization.
3. Isolated login session.
4. Settings revocation and login-data clearing.
5. Permanently blocked target categories.

- [ ] Step 6: Run settings, localization, and guide tests and verify GREEN

    node --test test/unit-ci/ai-web-access-settings.spec.js test/unit-ci/setting-search-index.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/shellpilot-help-content.spec.js

Expected: all tests pass with no missing Chinese or English key.

- [ ] Step 7: Commit Task 8

    git add src/client/common/constants.js src/client/common/setting-list.js src/client/common/setting-search-index.js src/client/components/setting-panel/tab-settings.jsx src/client/components/setting-panel/setting-ai-web-access.jsx src/client/components/setting-panel/setting.styl src/client/common/shellpilot-i18n-overrides.js docs/USER_GUIDE_ZH.md test/unit-ci/ai-web-access-settings.spec.js test/unit-ci/setting-search-index.spec.js
    git commit -m "feat: manage AI web access grants"

## Task 9: Prove localhost login, SPA rendering, and session reuse end to end

**Files:**

- Create: test/e2e/common/ai-web-fixture.js
- Create: test/e2e/036.ai-web-access.spec.js

- [ ] Step 1: Create a deterministic local HTTP fixture

ai-web-fixture.js starts on 127.0.0.1 with an ephemeral port and exposes:

- GET /static: meaningful static HTML.
- GET /app: login form when auth cookie is absent.
- POST /login: set HttpOnly auth cookie and redirect to /app#/sharingPath.
- GET /app with cookie: SPA shell whose JavaScript replaces Loading with a unique visible knowledge-base sentence.
- GET /logout: clear the auth cookie.
- GET /redirect: redirect to a second fixture origin.
- GET /blocked-subresource.js: increment an in-memory request counter so the test can assert whether it was fetched.
- snapshot(): return request counters without exposing request headers.
- close(): await server shutdown.

The fixture binds only to 127.0.0.1 and never accepts a configurable filesystem path or shell command.

- [ ] Step 2: Write the failing Electron E2E

Use an isolated profile following test/e2e/006.ai-chat.spec.js and common/isolated-electron-app.js.

Test sequence:

1. Configure the existing local AI API fixture and open AI chat.
2. Add the localhost /app#/sharingPath URL.
3. Submit and assert the authorization modal shows the normalized origin and localhost warning.
4. Click Allow Once.
5. Find the ShellPilot web reader window and complete the fixture login.
6. Wait until the remote WebContentsView contains the unique SPA sentence.
7. Click Read Current Page in the trusted toolbar.
8. Assert the AI prompt/history contains the visible SPA sentence but not the password, cookie name, or login request body.
9. Start another logical read, authorize as Always, and verify the existing isolated cookie allows hidden automatic extraction.
10. Revoke the permanent grant in settings and verify the next read prompts again.
11. Clear isolated login data, reauthorize, and verify the login window appears again.

Add a second test that:

- Authorizes the first localhost origin.
- Redirects to a second localhost origin.
- Receives a second authorization challenge.
- Cancels it.
- Confirms the second origin response body and blocked subresource counter were never read.

- [ ] Step 3: Run the E2E and verify RED

Build first so work/app contains the new preload and renderer:

    npm run vite-build
    npx playwright test test/e2e/036.ai-web-access.spec.js --workers=1

Expected before implementation integration is complete: FAIL at the first authorization-modal assertion.

- [ ] Step 4: Add only the selectors and lifecycle hooks required by the E2E

Use stable data-testid attributes rather than translated text for automation. Ensure every fixture server, AI server, reader window, Electron app, and isolated profile is closed in afterEach/finally. Validate the resolved temporary profile path before recursive cleanup using the same safety pattern as 006.ai-chat.spec.js.

- [ ] Step 5: Run the E2E and verify GREEN

    npm run vite-build
    npx playwright test test/e2e/036.ai-web-access.spec.js --workers=1

Expected: both localhost browser-read tests pass.

- [ ] Step 6: Commit Task 9

    git add test/e2e/common/ai-web-fixture.js test/e2e/036.ai-web-access.spec.js
    git commit -m "test: cover authorized local web reading"

## Task 10: Complete regression, security, and build verification

**Files:**

- Modify only files required by a failing verification command.

- [ ] Step 1: Run the focused web-access suite

    node --test test/unit-ci/ai-web-access-policy.spec.js test/unit-ci/ai-web-access-grants.spec.js test/unit-ci/ai-web-reader-routing.spec.js test/unit-ci/ai-web-navigation-guard.spec.js test/unit-ci/ai-authenticated-web-reader.spec.js test/unit-ci/ai-web-access-service.spec.js test/unit-ci/ai-web-access-ipc.spec.js test/unit-ci/ai-web-access-ui.spec.js test/unit-ci/ai-web-access-settings.spec.js test/unit-ci/ai-content-ingestion.spec.js test/unit-ci/ai-attachments.spec.js

Expected: all focused tests pass.

- [ ] Step 2: Run static security checks

    rg -n "nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false" src/app/lib/ai-content src/app/preload/ai-web-reader-preload.js
    rg -n "document\.cookie|localStorage|sessionStorage|Authorization" src/app/lib/ai-content/authenticated-web-reader.js src/app/lib/ai-content/electron-web-reader-adapter.js
    rg -n "shell\.openExternal|setPermissionRequestHandler.*true|setWindowOpenHandler.*allow" src/app/lib/ai-content

Expected:

- The first command has no matches in the new reader path.
- The second command has no matches.
- The third command has no matches.

- [ ] Step 3: Lint every changed JavaScript and JSX file

    npx standard src/app/lib/ai-content/web-access-errors.js src/app/lib/ai-content/web-access-policy.js src/app/lib/ai-content/url-safety.js src/app/lib/ai-content/web-access-grants.js src/app/lib/ai-content/web-reader.js src/app/lib/ai-content/web-navigation-guard.js src/app/lib/ai-content/electron-web-reader-adapter.js src/app/lib/ai-content/authenticated-web-reader.js src/app/lib/ai-content/web-access-service.js src/app/preload/ai-web-reader-preload.js src/app/lib/ipc.js src/client/components/ai/ai-web-access-client.js src/client/components/ai/ai-web-access-modal.jsx src/client/components/ai/ai-attachments.js src/client/components/ai/ai-chat.jsx src/client/common/constants.js src/client/common/setting-list.js src/client/common/setting-search-index.js src/client/components/setting-panel/tab-settings.jsx src/client/components/setting-panel/setting-ai-web-access.jsx test/unit-ci/ai-web-access-policy.spec.js test/unit-ci/ai-web-access-grants.spec.js test/unit-ci/ai-web-reader-routing.spec.js test/unit-ci/ai-web-navigation-guard.spec.js test/unit-ci/ai-authenticated-web-reader.spec.js test/unit-ci/ai-web-access-service.spec.js test/unit-ci/ai-web-access-ipc.spec.js test/unit-ci/ai-web-access-ui.spec.js test/unit-ci/ai-web-access-settings.spec.js test/e2e/common/ai-web-fixture.js test/e2e/036.ai-web-access.spec.js

Expected: exit code 0.

- [ ] Step 4: Run the complete unit-CI suite

    npm run test-unit-ci

Expected: exit code 0 with no pre-existing AI attachment, settings, IPC, localization, or security regression.

- [ ] Step 5: Run the production renderer/main build

    npm run vite-build

Expected: exit code 0 and work/app contains the reader preload required by the E2E.

- [ ] Step 6: Rerun the isolated Electron acceptance test

    npx playwright test test/e2e/036.ai-web-access.spec.js --workers=1

Expected: both tests pass from a fresh isolated profile.

- [ ] Step 7: Inspect the final diff and repository hygiene

    git diff --check
    git status --short
    git log --oneline --decorate -12

Expected:

- git diff --check prints nothing.
- No generated work/app, node_modules, profile, cookie, grant JSON, screenshot, or fixture output is staged.
- Every task has one focused commit.

- [ ] Step 8: Perform a final acceptance matrix review

Confirm each approved acceptance criterion has automated evidence:

| Criterion | Evidence |
| --- | --- |
| Public static pages retain fast path | ai-web-reader-routing.spec.js, ai-web-access-service.spec.js |
| Private and localhost require user authorization | ai-web-access-policy.spec.js, ai-web-access-ui.spec.js, E2E |
| Once and always semantics | ai-web-access-grants.spec.js, E2E |
| Login and SPA visible text extraction | ai-authenticated-web-reader.spec.js, E2E |
| Isolated cookie reuse and clearing | ai-authenticated-web-reader.spec.js, ai-web-access-settings.spec.js, E2E |
| Dangerous target blocks survive grants | ai-web-access-policy.spec.js, ai-web-access-service.spec.js |
| Redirect and subresource revalidation | ai-web-navigation-guard.spec.js, E2E |
| No cookie/password/storage leakage | ai-authenticated-web-reader.spec.js, ai-web-access-ipc.spec.js, E2E |
| Popup/download/permission denial | ai-web-navigation-guard.spec.js |
| Grant revocation and settings management | ai-web-access-settings.spec.js, E2E |
| Existing content ingestion remains stable | ai-content-ingestion.spec.js, ai-attachments.spec.js |
| Lint, full unit suite, and production build | Task 10 command logs |

If a verification command fails, return to the task that owns that behavior,
add or tighten its failing regression test, make the smallest correction, rerun
that task's complete GREEN command, and amend it with a new focused fix commit.
Do not create an empty verification commit.
