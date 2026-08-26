# SSH Tunnel Complete Detection and Beginner Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the misleading listener-only SSH tunnel test with evidence-based layered detection, then make every tunnel explain how to use it and how to recover safely when it fails.

**Architecture:** SSH tunnel controllers expose type-specific `probe()` methods and structured evidence events. The runtime owns probe serialization, automatic checks, stale-result invalidation, and safe state serialization; renderer-only pure modules generate access instructions and diagnostics, while focused React components render runtime cards and a beginner guide. Existing tunnel definitions and bookmarks remain compatible through an optional `usageProfile` field.

**Tech Stack:** Node.js 20+/CommonJS server modules, `@electerm/ssh2`, Node `net`, React 19, Ant Design 6, Stylus, Node test runner, Playwright Electron E2E, ShellPilot bilingual i18n overrides.

---

## File map

- Create `apps/electerm-agent/src/app/server/ssh-tunnel-probe.js`: canonical stage/result constructors, verdict calculation, timeout wrapper, and error-to-stage mapping.
- Modify `apps/electerm-agent/src/app/server/ssh-tunnel.js`: controller-level probes and structured evidence for local, remote, and dynamic forwarding.
- Modify `apps/electerm-agent/src/app/server/ssh-tunnel-runtime.js`: serialized probe execution, automatic checks, evidence consumption, and stale-result invalidation.
- Modify `apps/electerm-agent/src/app/server/session-ssh.js`: remove the listener-only probe and let controllers perform accurate checks.
- Modify `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-definition.js`: persist the optional `usageProfile` without changing legacy IDs.
- Create `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-usage.js`: pure access-instruction model for all tunnel types and templates.
- Create `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-diagnostics.js`: safe, copy-only diagnostics keyed by backend error code.
- Create `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx`: availability, access instructions, layered evidence, diagnostics, and actions.
- Create `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx`: scenario-first beginner guide with type/error deep links.
- Modify `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx`: orchestration only; set `usageProfile`, open the guide, and render runtime cards.
- Modify `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.styl`: responsive cards, stages, access panel, diagnostics, and guide layout.
- Modify `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`: complete Chinese and English copy.
- Modify `apps/electerm-agent/docs/USER_GUIDE_ZH.md`: offline beginner guide and administrator troubleshooting.
- Add or modify tunnel unit/E2E tests listed per task below.

### Task 1: Define canonical layered probe results

**Files:**
- Create: `apps/electerm-agent/src/app/server/ssh-tunnel-probe.js`
- Create: `apps/electerm-agent/test/unit-ci/ssh-tunnel-probe.spec.js`

- [ ] **Step 1: Write failing tests for verdict precedence and error staging**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createProbeResult,
  createProbeStage,
  probeStagesForError,
  withProbeTimeout
} = require('../../src/app/server/ssh-tunnel-probe')

test('probe result only passes when every required stage passed', () => {
  const result = createProbeResult([
    createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常', 1),
    createProbeStage('ssh-forwarding', 'limited', 'SSH_TUNNEL_FORWARDING_PROHIBITED', 'SSH 服务器禁止端口转发'),
    createProbeStage('target-service', 'unverified', 'SSH_TUNNEL_STAGE_NOT_REACHED', '尚未检测目标服务')
  ], { checkedAt: 123 })

  assert.equal(result.verdict, 'limited')
  assert.equal(result.checkedAt, 123)
  assert.equal(result.ok, false)
  assert.equal(result.stages[1].status, 'limited')
})

test('forwarding prohibition leaves the target stage unverified', () => {
  const error = Object.assign(new Error('administratively prohibited'), {
    code: 'SSH_TUNNEL_FORWARDING_PROHIBITED'
  })
  assert.deepEqual(
    probeStagesForError('forwardLocalToRemote', error),
    [
      createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
      createProbeStage('ssh-forwarding', 'limited', 'SSH_TUNNEL_FORWARDING_PROHIBITED', 'SSH 服务器禁止端口转发'),
      createProbeStage('target-service', 'unverified', 'SSH_TUNNEL_STAGE_NOT_REACHED', 'SSH 转发失败，尚未检测目标服务')
    ]
  )
})

test('probe timeout rejects with a stable code', async () => {
  await assert.rejects(
    withProbeTimeout(new Promise(() => {}), 5, 'target-service'),
    error => error.code === 'SSH_TUNNEL_TEST_TIMEOUT' && error.stage === 'target-service'
  )
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run from `apps/electerm-agent`:

```powershell
node --test test/unit-ci/ssh-tunnel-probe.spec.js
```

Expected: FAIL with `Cannot find module '../../src/app/server/ssh-tunnel-probe'`.

- [ ] **Step 3: Implement the probe result module**

```js
const verdictOrder = ['passed', 'unverified', 'limited', 'failed']

function safeText (value, fallback = '') {
  return String(value || fallback)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
}

function createProbeStage (id, status, code, message, latencyMs) {
  const stage = {
    id: safeText(id, 'unknown'),
    status: ['passed', 'limited', 'failed', 'unverified'].includes(status)
      ? status
      : 'failed',
    code: safeText(code, 'SSH_TUNNEL_PROBE_STAGE'),
    message: safeText(message, status)
  }
  if (Number.isFinite(latencyMs)) stage.latencyMs = Math.max(0, latencyMs)
  return stage
}

function createProbeResult (stages, options = {}) {
  const safeStages = Array.isArray(stages) ? stages.map(stage => ({ ...stage })) : []
  const verdict = safeStages.length
    ? safeStages.reduce((current, stage) => (
        verdictOrder.indexOf(stage.status) > verdictOrder.indexOf(current)
          ? stage.status
          : current
      ), 'passed')
    : 'unverified'
  const decisive = safeStages.find(stage => stage.status === verdict)
  return {
    ok: verdict === 'passed',
    verdict,
    summary: safeText(options.summary || decisive?.message, verdict),
    checkedAt: Number.isFinite(options.checkedAt) ? options.checkedAt : Date.now(),
    ...(Number.isFinite(options.latencyMs) ? { latencyMs: options.latencyMs } : {}),
    stages: safeStages
  }
}

function probeStagesForError (type, error = {}) {
  const code = String(error.code || 'SSH_TUNNEL_TEST_FAILED')
  const message = safeText(error.message, 'SSH 隧道检测失败')
  if (type === 'forwardLocalToRemote') {
    const prohibited = code === 'SSH_TUNNEL_FORWARDING_PROHIBITED'
    return [
      createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
      createProbeStage('ssh-forwarding', prohibited ? 'limited' : 'passed', prohibited ? code : 'SSH_TUNNEL_FORWARDING_READY', prohibited ? message : 'SSH 转发通道已建立'),
      createProbeStage('target-service', prohibited ? 'unverified' : 'failed', prohibited ? 'SSH_TUNNEL_STAGE_NOT_REACHED' : code, prohibited ? 'SSH 转发失败，尚未检测目标服务' : message)
    ]
  }
  return [createProbeStage('tunnel', code === 'SSH_TUNNEL_FORWARDING_PROHIBITED' ? 'limited' : 'failed', code, message)]
}

function withProbeTimeout (promise, timeoutMs, stage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('SSH 隧道连通性检测超时')
      error.code = 'SSH_TUNNEL_TEST_TIMEOUT'
      error.stage = stage
      reject(error)
    }, timeoutMs)
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) }
    )
  })
}

exports.createProbeResult = createProbeResult
exports.createProbeStage = createProbeStage
exports.probeStagesForError = probeStagesForError
exports.withProbeTimeout = withProbeTimeout
```

- [ ] **Step 4: Run the test and verify GREEN**

```powershell
node --test test/unit-ci/ssh-tunnel-probe.spec.js
```

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Commit the probe primitives**

```powershell
git add apps/electerm-agent/src/app/server/ssh-tunnel-probe.js apps/electerm-agent/test/unit-ci/ssh-tunnel-probe.spec.js
git commit -m "feat(tunnel): define layered probe results"
```

### Task 2: Make controllers produce real evidence and invalidate stale success

**Files:**
- Modify: `apps/electerm-agent/src/app/server/ssh-tunnel.js`
- Modify: `apps/electerm-agent/src/app/server/ssh-tunnel-runtime.js`
- Modify: `apps/electerm-agent/src/app/server/session-ssh.js:691-737`
- Modify: `apps/electerm-agent/test/unit-ci/ssh-tunnel-runtime.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ssh-tunnel-api-contract.spec.js`

- [ ] **Step 1: Add failing controller tests that reproduce the screenshot bug**

Add these tests to `ssh-tunnel-runtime.spec.js`:

```js
test('local probe waits for forwardOut and reports policy prohibition instead of listener success', async () => {
  const conn = new EventEmitter()
  let finishForward
  conn.forwardOut = (srcHost, srcPort, host, port, callback) => {
    finishForward = callback
  }
  const netImpl = {
    createServer: handler => {
      const server = createServer(handler)
      server.address = () => ({ address: '127.0.0.1', port: 16060 })
      return server
    }
  }
  const controller = await forwardLocalToRemote({
    id: 'policy-test',
    conn,
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 16060,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 6060,
    netImpl
  })
  let settled = false
  const probing = controller.probe().finally(() => { settled = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  finishForward(Object.assign(new Error('administratively prohibited'), { reason: 1 }))
  const result = await probing
  assert.equal(result.verdict, 'limited')
  assert.equal(result.ok, false)
  assert.equal(result.stages[1].code, 'SSH_TUNNEL_FORWARDING_PROHIBITED')
  await controller.close()
})

test('runtime removes stale passed evidence when a controller later fails', async () => {
  const controller = new EventEmitter()
  controller.descriptor = { id: 'stale', sshTunnel: 'forwardLocalToRemote' }
  controller.close = async () => {}
  controller.probe = async () => ({
    ok: true,
    verdict: 'passed',
    checkedAt: 10,
    summary: '完整链路正常',
    stages: []
  })
  const runtime = createSshTunnelRuntime({ startController: async () => controller })
  await runtime.start(controller.descriptor)
  await runtime.test('stale')
  assert.equal(runtime.list()[0].lastTest.verdict, 'passed')
  controller.emit('error', Object.assign(new Error('SSH 服务器禁止端口转发'), {
    code: 'SSH_TUNNEL_FORWARDING_PROHIBITED'
  }))
  assert.notEqual(runtime.list()[0].lastTest?.verdict, 'passed')
})
```

- [ ] **Step 2: Run the focused runtime tests and verify RED**

```powershell
node --test test/unit-ci/ssh-tunnel-runtime.spec.js test/unit-ci/ssh-tunnel-api-contract.spec.js
```

Expected: FAIL because `controller.probe` is missing and the runtime retains `lastTest.verdict === 'passed'`.

- [ ] **Step 3: Add type-specific controller probes and evidence events**

In `ssh-tunnel.js`, import the probe helpers and extend `createController`:

```js
const {
  createProbeResult,
  createProbeStage,
  probeStagesForError,
  withProbeTimeout
} = require('./ssh-tunnel-probe')

function createController ({ descriptor, close, probe, lifecycle = new EventEmitter() }) {
  let closed = false
  lifecycle.state = 'running'
  lifecycle.descriptor = descriptor
  if (typeof probe === 'function') lifecycle.probe = probe
  lifecycle.close = async () => {
    if (closed) return
    closed = true
    await close()
  }
  return lifecycle
}
```

Pass this probe when creating the local-forward controller:

```js
probe: async () => {
  const startedAt = Date.now()
  try {
    const remoteSocket = await withProbeTimeout(new Promise((resolve, reject) => {
      conn.forwardOut(
        sshTunnelLocalHost,
        sshTunnelLocalPort,
        sshTunnelRemoteHost,
        sshTunnelRemotePort,
        (error, stream) => error ? reject(normalizeForwardingError(error)) : resolve(stream)
      )
    }), 3000, 'target-service')
    destroySocket(remoteSocket)
    return createProbeResult([
      createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
      createProbeStage('ssh-forwarding', 'passed', 'SSH_TUNNEL_FORWARDING_READY', 'SSH 转发通道已建立'),
      createProbeStage('target-service', 'passed', 'SSH_TUNNEL_TARGET_READY', '目标服务可连接')
    ], { latencyMs: Date.now() - startedAt })
  } catch (error) {
    return createProbeResult(probeStagesForError('forwardLocalToRemote', error), {
      latencyMs: Date.now() - startedAt
    })
  }
}
```

For SOCKS5, add a `probeSocksHandshake(host, port, netImpl)` helper that connects locally, writes `Buffer.from([5, 1, 0])`, requires the first two response bytes to equal `[5, 0]`, and returns:

```js
createProbeResult([
  createProbeStage('local-listener', 'passed', 'SSH_TUNNEL_LOCAL_LISTENER_READY', '本机监听正常'),
  createProbeStage('proxy-protocol', 'passed', 'SSH_TUNNEL_SOCKS_READY', 'SOCKS5 协议响应正常'),
  createProbeStage('proxy-traffic', 'unverified', 'SSH_TUNNEL_WAITING_FOR_TRAFFIC', '等待实际网站流量验证')
])
```

On the first successful SOCKS `forwardOut`, emit an `evidence` event with all three stages passed. Do not include `info.dstAddr`, URL, or payload in the event.

For remote forwarding, make `probe()` return `server-listener: passed`, a real local-target `net.connect` result, and `end-to-end: unverified`. When a real incoming forwarded connection reaches the local target's `connect` event, emit `evidence` with all three stages passed.

- [ ] **Step 4: Serialize probes and invalidate old results in the runtime**

Add `testState` and `probePromise` to each runtime entry. Attach an evidence handler and replace `testTunnel` with a deduplicated runner:

```js
const {
  createProbeResult,
  createProbeStage,
  probeStagesForError
} = require('./ssh-tunnel-probe')

function invalidateProbe (entry, error) {
  entry.testState = 'idle'
  entry.lastTestAt = null
  entry.lastTest = error
    ? createProbeResult(probeStagesForError(entry.definition.sshTunnel, error))
    : null
}

async function runProbe (entry) {
  if (entry.probePromise) return entry.probePromise
  entry.testState = 'checking'
  entry.probePromise = Promise.resolve().then(async () => {
    if (typeof entry.controller.probe !== 'function') {
      return createProbeResult([
        createProbeStage('tunnel', 'unverified', 'SSH_TUNNEL_PROBE_UNAVAILABLE', '当前运行时不支持完整检测')
      ])
    }
    return entry.controller.probe()
  }).then(result => {
    entry.lastTestAt = now()
    entry.lastTest = { ...result, checkedAt: result.checkedAt || now() }
    return { id: entry.definition.id, ...entry.lastTest }
  }).finally(() => {
    entry.testState = 'idle'
    entry.probePromise = null
  })
  return entry.probePromise
}

async function testTunnel (id) {
  const key = String(id || '')
  const entry = controllers.get(key)
  if (!entry) {
    throw tunnelError('SSH_TUNNEL_NOT_FOUND', '未找到正在运行的 SSH 隧道')
  }
  return runProbe(entry)
}
```

Add `testState` to `serializableState`. In `handleControllerFailure`, call `invalidateProbe(entry, error)` before recording the failure. In `reconnect`, clear prior evidence and schedule `runProbe(entry)` after the new controller is attached. The controller `evidence` handler sets `lastTest`, `lastTestAt`, and `testState` without changing the SSH terminal.

After `start()` records `SSH_TUNNEL_STARTED`, queue `runProbe(entry)` with `queueMicrotask`; do not await it from `start()`.

- [ ] **Step 5: Remove the listener-only session probe**

Delete `probeSshTunnel()` from `session-ssh.js` and remove `probe: definition => this.probeSshTunnel(definition)` from `createSshTunnelRuntime`. Update the API contract test: replace “probes the local tunnel endpoint” with an assertion that `ensureSshTunnelRuntime()` delegates probing to controller capabilities and no `net.connect` listener-only test remains.

- [ ] **Step 6: Run runtime tests and verify GREEN**

```powershell
node --test test/unit-ci/ssh-tunnel-probe.spec.js test/unit-ci/ssh-tunnel-runtime.spec.js test/unit-ci/ssh-tunnel-health.spec.js test/unit-ci/ssh-tunnel-api-contract.spec.js
```

Expected: all focused tests pass and no assertion accepts listener-only success.

- [ ] **Step 7: Commit controller and runtime evidence**

```powershell
git add apps/electerm-agent/src/app/server/ssh-tunnel.js apps/electerm-agent/src/app/server/ssh-tunnel-runtime.js apps/electerm-agent/src/app/server/session-ssh.js apps/electerm-agent/test/unit-ci/ssh-tunnel-runtime.spec.js apps/electerm-agent/test/unit-ci/ssh-tunnel-api-contract.spec.js
git commit -m "fix(tunnel): verify the complete forwarding path"
```

### Task 3: Persist usage profiles and generate access instructions

**Files:**
- Modify: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-definition.js`
- Create: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-usage.js`
- Modify: `apps/electerm-agent/test/unit-ci/ssh-tunnel-definition.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/ssh-tunnel-usage.spec.js`

- [ ] **Step 1: Write failing tests for every usage profile and legacy fallback**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

test('web usage produces a safe local URL without requiring a proxy', async () => {
  const { getTunnelUsage } = await importModule('src/client/components/ssh-tunnel/ssh-tunnel-usage.js')
  assert.deepEqual(getTunnelUsage({
    sshTunnel: 'forwardLocalToRemote',
    usageProfile: 'https',
    sshTunnelLocalHost: '0.0.0.0',
    sshTunnelLocalPort: 16060,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 6060
  }), {
    kind: 'web',
    profile: 'https',
    host: '127.0.0.1',
    port: 16060,
    url: 'https://127.0.0.1:16060',
    requiresProxy: false,
    canOpen: true
  })
})

test('SOCKS5 usage requires application proxy configuration', async () => {
  const { getTunnelUsage } = await importModule('src/client/components/ssh-tunnel/ssh-tunnel-usage.js')
  const usage = getTunnelUsage({
    sshTunnel: 'dynamicForward',
    sshTunnelLocalHost: '::',
    sshTunnelLocalPort: 1080
  })
  assert.equal(usage.endpoint, '[::1]:1080')
  assert.equal(usage.requiresProxy, true)
  assert.equal(usage.canOpen, false)
})

test('unknown legacy local forward stays generic instead of guessing HTTPS', async () => {
  const { getTunnelUsage } = await importModule('src/client/components/ssh-tunnel/ssh-tunnel-usage.js')
  const usage = getTunnelUsage({
    sshTunnel: 'forwardLocalToRemote',
    name: 'Custom Admin',
    sshTunnelLocalPort: 8443
  })
  assert.equal(usage.kind, 'tcp')
  assert.equal(usage.canOpen, false)
})
```

Also extend `ssh-tunnel-definition.spec.js` to assert `getTunnelTemplate('https').usageProfile === 'https'`, bookmark serialization preserves `usageProfile`, and stable IDs do not change when the optional profile is added.

- [ ] **Step 2: Run the usage tests and verify RED**

```powershell
node --test test/unit-ci/ssh-tunnel-definition.spec.js test/unit-ci/ssh-tunnel-usage.spec.js
```

Expected: FAIL because `ssh-tunnel-usage.js` and template `usageProfile` values do not exist.

- [ ] **Step 3: Add optional usage profiles to definitions**

Add `usageProfile` to every `templateSource` item, normalize it through an allow-list, and leave `stableTunnelId()` unchanged:

```js
const usageProfiles = new Set([
  'http', 'https', 'mysql', 'postgresql', 'redis', 'socks5', 'generic'
])

function normalizeUsageProfile (value) {
  const profile = String(value || '').trim().toLowerCase()
  return usageProfiles.has(profile) ? profile : undefined
}
```

In `normalizeTunnel`, set `usageProfile: normalizeUsageProfile(input.usageProfile)`. Existing serialization already preserves non-runtime keys, so no migration is needed.

- [ ] **Step 4: Implement the pure usage model**

```js
const legacyProfiles = new Map([
  ['http', 'http'],
  ['https', 'https'],
  ['mysql', 'mysql'],
  ['postgresql', 'postgresql'],
  ['redis', 'redis'],
  ['socks5', 'socks5']
])

function accessHost (host) {
  const value = String(host || '127.0.0.1').trim().toLowerCase()
  if (['0.0.0.0', '*'].includes(value)) return '127.0.0.1'
  if (['::', '[::]'].includes(value)) return '[::1]'
  return value.includes(':') && !value.startsWith('[') ? `[${value}]` : value
}

function profileFor (definition = {}) {
  if (definition.sshTunnel === 'dynamicForward') return 'socks5'
  if (definition.usageProfile) return definition.usageProfile
  return legacyProfiles.get(String(definition.name || '').trim().toLowerCase()) || 'generic'
}

export function getTunnelUsage (definition = {}) {
  const profile = profileFor(definition)
  if (definition.sshTunnel === 'forwardRemoteToLocal') {
    const host = accessHost(definition.sshTunnelRemoteHost)
    const port = Number(definition.sshTunnelRemotePort)
    return { kind: 'remote', profile: 'generic', host, port, endpoint: `${host}:${port}`, requiresProxy: false, canOpen: false }
  }
  const host = accessHost(definition.sshTunnelLocalHost)
  const port = Number(definition.sshTunnelLocalPort)
  if (profile === 'socks5') {
    return { kind: 'proxy', profile, host, port, endpoint: `${host}:${port}`, requiresProxy: true, canOpen: false }
  }
  if (profile === 'http' || profile === 'https') {
    return { kind: 'web', profile, host, port, url: `${profile}://${host}:${port}`, requiresProxy: false, canOpen: true }
  }
  if (['mysql', 'postgresql', 'redis'].includes(profile)) {
    return { kind: 'database', profile, host, port, endpoint: `${host}:${port}`, requiresProxy: false, canOpen: false }
  }
  return { kind: 'tcp', profile: 'generic', host, port, endpoint: `${host}:${port}`, requiresProxy: false, canOpen: false }
}
```

- [ ] **Step 5: Run usage tests and verify GREEN**

```powershell
node --test test/unit-ci/ssh-tunnel-definition.spec.js test/unit-ci/ssh-tunnel-usage.spec.js
```

Expected: all definition and usage tests pass.

- [ ] **Step 6: Commit usage profiles and instructions**

```powershell
git add apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-definition.js apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-usage.js apps/electerm-agent/test/unit-ci/ssh-tunnel-definition.spec.js apps/electerm-agent/test/unit-ci/ssh-tunnel-usage.spec.js
git commit -m "feat(tunnel): generate beginner access instructions"
```

### Task 4: Build safe, copy-only diagnostics

**Files:**
- Create: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-diagnostics.js`
- Create: `apps/electerm-agent/test/unit-ci/ssh-tunnel-diagnostics.spec.js`

- [ ] **Step 1: Write failing diagnostics tests**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

test('policy diagnostics are read-only and scoped to the requested target', async () => {
  const { getTunnelDiagnostic } = await importModule('src/client/components/ssh-tunnel/ssh-tunnel-diagnostics.js')
  const diagnostic = getTunnelDiagnostic({
    code: 'SSH_TUNNEL_FORWARDING_PROHIBITED',
    message: 'SSH 服务器禁止端口转发'
  }, {
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 6060
  })
  assert.equal(diagnostic.layer, 'ssh-forwarding')
  assert.equal(diagnostic.helpSection, 'forwarding-prohibited')
  assert.match(diagnostic.checksText, /sshd -T/)
  assert.match(diagnostic.configExample, /PermitOpen 127\.0\.0\.1:6060/)
  assert.doesNotMatch(`${diagnostic.checksText}\n${diagnostic.configExample}`, /systemctl\s+(?:restart|reload)|sudo\s+sed|password|private.?key/i)
})

test('destination refusal points at the remote server perspective', async () => {
  const { getTunnelDiagnostic } = await importModule('src/client/components/ssh-tunnel/ssh-tunnel-diagnostics.js')
  const diagnostic = getTunnelDiagnostic({ code: 'SSH_TUNNEL_DESTINATION_REFUSED' }, {
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 6060
  })
  assert.equal(diagnostic.layer, 'target-service')
  assert.match(diagnostic.checksText, /ss -lntp/)
  assert.match(diagnostic.checksText, /6060/)
})
```

- [ ] **Step 2: Run diagnostics tests and verify RED**

```powershell
node --test test/unit-ci/ssh-tunnel-diagnostics.spec.js
```

Expected: FAIL because the diagnostics module does not exist.

- [ ] **Step 3: Implement a structured diagnostic catalog**

Export `getTunnelDiagnostic(error, definition)` and return this stable shape:

```js
{
  code,
  layer: 'local-listener' | 'ssh-forwarding' | 'target-service' | 'proxy' | 'unknown',
  severity: 'warning' | 'error',
  titleKey,
  summaryKey,
  helpSection,
  steps: [{ key, values }],
  checksText,
  configExample
}
```

Implement exact cases for `SSH_TUNNEL_FORWARDING_PROHIBITED`, `SSH_TUNNEL_DESTINATION_REFUSED`, `EADDRINUSE`/`SSH_TUNNEL_PORT_IN_USE`, `SSH_TUNNEL_TEST_TIMEOUT`, and the default. Build numeric ports with `Number()` and safe hosts with a control-character/whitespace rejecting helper. Policy `checksText` contains only this read-only command:

```text
sudo sshd -T | grep -Ei 'allowtcpforwarding|permitopen|disableforwarding'
```

Policy `configExample` is a separate copy target so it cannot be mistaken for a shell command:

```text
# Minimal scoped example; replace ssh-login-user before use:
Match User ssh-login-user
    AllowTcpForwarding local
    PermitOpen 127.0.0.1:6060
```

Target refusal places `ss -lntp | grep ':6060'` in `checksText`. Port conflict places `Get-NetTCPConnection -LocalPort 16060 -ErrorAction SilentlyContinue` in `checksText`. The default `configExample` is an empty string. None are executed by this module.

- [ ] **Step 4: Run diagnostics tests and verify GREEN**

```powershell
node --test test/unit-ci/ssh-tunnel-diagnostics.spec.js
```

Expected: all diagnostics tests pass.

- [ ] **Step 5: Commit diagnostics**

```powershell
git add apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-diagnostics.js apps/electerm-agent/test/unit-ci/ssh-tunnel-diagnostics.spec.js
git commit -m "feat(tunnel): add safe forwarding diagnostics"
```

### Task 5: Render a focused runtime card and complete beginner guide

**Files:**
- Create: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx`
- Create: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx`
- Modify: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.styl`
- Modify: `apps/electerm-agent/test/unit-ci/ssh-tunnel-ui.spec.js`

- [ ] **Step 1: Write failing UI source contracts for the focused components**

Add tests that read both new files and assert:

```js
test('SSH tunnel runtime card explains access, evidence, and recovery', () => {
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')
  assert.match(card, /getTunnelUsage/)
  assert.match(card, /getTunnelDiagnostic/)
  assert.match(card, /entry\.lastTest\.stages/)
  assert.match(card, /window\.openLink\(usage\.url\)/)
  assert.match(card, /onOpenGuide/)
  assert.doesNotMatch(card, /runCmd|sendText|\.write\(/)
})

test('SSH tunnel guide starts from user scenarios and covers post-start access', () => {
  const guide = source('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx')
  for (const key of [
    'shellpilotTunnelGuideChooseType',
    'shellpilotTunnelGuideLocalScenario',
    'shellpilotTunnelGuideHowToAccess',
    'shellpilotTunnelGuideSocksBrowser',
    'shellpilotTunnelGuideRemoteSafety',
    'shellpilotTunnelGuideErrors',
    'shellpilotTunnelGuideGlossary'
  ]) assert.match(guide, new RegExp(key))
  assert.match(guide, /activeSection/)
})
```

- [ ] **Step 2: Run the UI unit test and verify RED**

```powershell
node --test test/unit-ci/ssh-tunnel-ui.spec.js
```

Expected: FAIL because the two focused components do not exist.

- [ ] **Step 3: Implement `SshTunnelRuntimeCard`**

The component accepts exactly these props:

```js
{
  entry,
  busy,
  onTest,
  onEdit,
  onEditAndRestart,
  onStop,
  onOpenGuide,
  onShowHistory
}
```

Use `getTunnelUsage(entry.definition)` and `getTunnelDiagnostic(latestFailure, entry.definition)`. Derive the availability label with this order:

```js
function availabilityFor (entry) {
  if (['failed', 'port-conflict', 'session-lost'].includes(entry.state)) return 'failed'
  if (entry.testState === 'checking') return 'checking'
  return entry.lastTest?.verdict || 'unverified'
}
```

Render web usage with explicit “无需配置浏览器代理”, proxy usage with “需要在浏览器或应用中设置 SOCKS5 代理”, database profiles with host/port fields, and generic TCP without an open button. Call `window.openLink(usage.url)` only when `usage.canOpen === true`; copy uses the existing clipboard helper.

Render every stage with `data-stage={stage.id}` and a translated status label. If a diagnostic exists, render separate copy-only buttons for non-empty `checksText` and `configExample`, and call `onOpenGuide(diagnostic.helpSection)` for the explanation. Never concatenate the configuration example into a shell command block.

- [ ] **Step 4: Implement `SshTunnelGuideModal`**

Use an Ant Design `Modal` with these section IDs:

```js
const guideSections = [
  'choose-type',
  'local-forward',
  'how-to-access',
  'socks-browser',
  'remote-safety',
  'errors',
  'glossary'
]
```

Props are `{ open, activeSection = 'choose-type', context = {}, onClose }`. The left navigation changes the active section; opening with an error section selects that section. The content includes the approved local-forward example `127.0.0.1:16060 → SSH → server 127.0.0.1:6060`, browser URLs, database parameters, Firefox/Chrome/Edge SOCKS5 guidance, remote-forward boundaries, error explanations, and the `127.0.0.1` glossary. No button executes a command.

- [ ] **Step 5: Add responsive styles**

Add these concrete class groups to `ssh-tunnel-modal.styl`:

```stylus
.ssh-tunnel-access-panel
  padding 12px
  margin 10px 0
  border 1px solid rgba(22, 119, 255, .24)
  border-radius var(--sp-radius-small)
  background rgba(22, 119, 255, .07)

.ssh-tunnel-stage-grid
  display grid
  grid-template-columns repeat(3, minmax(0, 1fr))
  gap 8px
  margin-bottom 10px

.ssh-tunnel-stage
  padding 8px
  border-radius var(--sp-radius-small)
  background var(--sp-flat-background)

.ssh-tunnel-guide-layout
  display grid
  grid-template-columns 220px minmax(0, 1fr)
  gap 16px

@media (max-width: 760px)
  .ssh-tunnel-stage-grid,
  .ssh-tunnel-guide-layout
    grid-template-columns 1fr
```

Add status modifiers for passed, limited, failed, and unverified using existing theme-safe greens, amber, red, and neutral colors.

- [ ] **Step 6: Run UI contracts and verify GREEN**

```powershell
node --test test/unit-ci/ssh-tunnel-ui.spec.js
```

Expected: all SSH tunnel UI contracts pass.

- [ ] **Step 7: Commit focused UI components**

```powershell
git add apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.styl apps/electerm-agent/test/unit-ci/ssh-tunnel-ui.spec.js
git commit -m "feat(tunnel): add runtime guidance and beginner help"
```

### Task 6: Wire the modal and bilingual copy

**Files:**
- Modify: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/ssh-tunnel-ui.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js`

- [ ] **Step 1: Write failing wiring and bilingual parity tests**

Assert that `ssh-tunnel-modal.jsx` imports both focused components, passes runtime callbacks, sets `usageProfile` in `applyTemplate`, and exposes the guide from the editor. Add the following keys to a parity list tested with `getShellPilotTranslation(key, 'zh_cn')` and `'en_us'`:

```js
[
  'shellpilotTunnelAvailabilityChecking',
  'shellpilotTunnelAvailabilityPassed',
  'shellpilotTunnelAvailabilityLimited',
  'shellpilotTunnelAvailabilityFailed',
  'shellpilotTunnelAvailabilityUnverified',
  'shellpilotTunnelHowToUse',
  'shellpilotTunnelNoBrowserProxy',
  'shellpilotTunnelNeedsSocksProxy',
  'shellpilotTunnelOpenBrowser',
  'shellpilotTunnelCopyAddress',
  'shellpilotTunnelCopyChecks',
  'shellpilotTunnelFullGuide',
  'shellpilotTunnelGuideChooseType',
  'shellpilotTunnelGuideLocalScenario',
  'shellpilotTunnelGuideHowToAccess',
  'shellpilotTunnelGuideSocksBrowser',
  'shellpilotTunnelGuideRemoteSafety',
  'shellpilotTunnelGuideErrors',
  'shellpilotTunnelGuideGlossary'
]
```

- [ ] **Step 2: Run UI and i18n tests and verify RED**

```powershell
node --test test/unit-ci/ssh-tunnel-ui.spec.js test/unit-ci/secondary-ui-contract.spec.js
```

Expected: FAIL on missing modal imports/usage profile wiring and missing bilingual keys.

- [ ] **Step 3: Refactor modal orchestration**

Add state:

```js
const [guide, setGuide] = useState({ open: false, section: 'choose-type', context: {} })
```

In `applyTemplate`, use:

```js
setDraft({
  ...next,
  id: '',
  name: tunnelTemplates[templateName].name,
  usageProfile: templateName
})
```

In `selectType`, set `usageProfile: sshTunnel === 'dynamicForward' ? 'socks5' : 'generic'`. Replace the inline running-card JSX with:

```jsx
<SshTunnelRuntimeCard
  key={entry.id}
  entry={entry}
  busy={actionId === entry.id}
  onTest={() => handleTest(entry.id)}
  onEdit={() => handleEdit(entry)}
  onEditAndRestart={() => handleEditAndRestart(entry)}
  onStop={() => handleStop(entry.id)}
  onShowHistory={() => showDisconnectHistory(entry)}
  onOpenGuide={section => setGuide({ open: true, section, context: entry.definition })}
/>
```

Add an editor-level “完整使用说明” button and render `SshTunnelGuideModal` once at the modal root. Update `handleTest` to branch on `result.verdict`, never `result.ok` alone; only `passed` gets a success toast.

- [ ] **Step 4: Add exact Chinese and English copy**

Add every key from Step 1 to both catalogs. Use the approved Chinese terms `检测中`, `可用`, `受限`, `不可用`, `未验证`, `现在这样使用`, `无需配置浏览器代理`, `需要在浏览器或应用中设置 SOCKS5 代理`, and natural English equivalents `Checking`, `Available`, `Limited`, `Unavailable`, `Not verified`, `How to use`, `No browser proxy required`, and `Configure this SOCKS5 proxy in your browser or app`.

Add guide body keys for the three scenarios, all field explanations, web/database access, SOCKS5 Firefox and Chrome/Edge instructions, remote safety, five error families, certificate warnings, and glossary definitions. Ensure `getShellPilotCatalogKeys('zh_cn')` and `getShellPilotCatalogKeys('en_us')` remain equal.

- [ ] **Step 5: Run UI and catalog parity tests and verify GREEN**

```powershell
node --test test/unit-ci/ssh-tunnel-ui.spec.js test/unit-ci/secondary-ui-contract.spec.js
```

Expected: all tests pass, including complete Chinese/English key parity.

- [ ] **Step 6: Commit modal wiring and copy**

```powershell
git add apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/ssh-tunnel-ui.spec.js apps/electerm-agent/test/unit-ci/secondary-ui-contract.spec.js
git commit -m "feat(tunnel): wire layered status and bilingual guidance"
```

### Task 7: Prove the user-visible behavior in Electron

**Files:**
- Modify: `apps/electerm-agent/test/e2e/033.ssh-tunnel-manager.spec.js`

- [ ] **Step 1: Extend the fake session with layered scenarios**

Replace the fake test response with `state.testScenario`, supporting `passed`, `prohibited`, `refused`, and `unverified`. A prohibited response must be:

```js
{
  id: request.tunnelId,
  ok: false,
  verdict: 'limited',
  summary: 'SSH 服务器禁止端口转发',
  checkedAt: Date.now(),
  stages: [
    { id: 'local-listener', status: 'passed', code: 'SSH_TUNNEL_LOCAL_LISTENER_READY', message: '本机监听正常' },
    { id: 'ssh-forwarding', status: 'limited', code: 'SSH_TUNNEL_FORWARDING_PROHIBITED', message: 'SSH 服务器禁止端口转发' },
    { id: 'target-service', status: 'unverified', code: 'SSH_TUNNEL_STAGE_NOT_REACHED', message: '尚未检测目标服务' }
  ]
}
```

Persist the returned object into the matching fake runtime entry's `lastTest`, and set the entry state to `failed` for prohibited/refused scenarios so refreshes preserve the card.

- [ ] **Step 2: Write failing E2E assertions for access and the stale-green regression**

Add a test that:

1. starts an HTTPS profile at local port 16060;
2. injects a `passed` layered result;
3. expects `https://127.0.0.1:16060` and `无需配置浏览器代理`;
4. switches the same entry to `prohibited`;
5. expects `SSH_TUNNEL_FORWARDING_PROHIBITED`, `SSH 服务器禁止端口转发`, and `尚未检测目标服务`;
6. asserts the card does not contain `最近测试正常` or a `可用` availability tag;
7. opens the error guide and sees `AllowTcpForwarding`, `PermitOpen`, and a statement that ShellPilot will not change server configuration.

Add a second path that starts SOCKS5, expects `SOCKS5 127.0.0.1:1080`, `需要在浏览器或应用中设置`, and opens the browser setup section.

- [ ] **Step 3: Run the Electron test and verify RED**

```powershell
npx playwright test test/e2e/033.ssh-tunnel-manager.spec.js --workers=1
```

Expected: FAIL before the UI wiring is complete or if stale green evidence remains.

- [ ] **Step 4: Make only E2E fixture adjustments required by the new API shape**

Update existing assertions from the old generic `运行中`/`ok: true` behavior to the new `testState` and `lastTest.verdict` shape. Do not weaken prohibited/refused assertions and do not hide the running card after a probe failure; users still need its diagnosis and Stop action.

- [ ] **Step 5: Run the Electron test and verify GREEN**

```powershell
npx playwright test test/e2e/033.ssh-tunnel-manager.spec.js --workers=1
```

Expected: all SSH tunnel manager E2E tests pass.

- [ ] **Step 6: Commit E2E coverage**

```powershell
git add apps/electerm-agent/test/e2e/033.ssh-tunnel-manager.spec.js
git commit -m "test(tunnel): cover access guidance and policy failures"
```

### Task 8: Replace the short manual section with a complete beginner guide

**Files:**
- Modify: `apps/electerm-agent/docs/USER_GUIDE_ZH.md:626-655`
- Modify: `apps/electerm-agent/src/client/components/main/help-center-modal.jsx:330-350`
- Modify: `apps/electerm-agent/test/unit-ci/ssh-tunnel-ui.spec.js`

- [ ] **Step 1: Write a failing documentation contract**

Extend the help test to require all of these phrases across the in-client help and offline guide:

```js
[
  '我想访问服务器上的网页或数据库',
  '直接在本机浏览器打开，不需要设置代理',
  'SOCKS5 需要在浏览器或应用中设置代理',
  '不会修改 Windows 全局代理',
  '远程目标地址相对于 SSH 服务器',
  'AllowTcpForwarding',
  'PermitOpen',
  'DisableForwarding',
  'no-port-forwarding',
  'GatewayPorts',
  'HTTPS 证书警告不等于隧道失败',
  'SSH_TUNNEL_FORWARDING_PROHIBITED',
  'SSH_TUNNEL_DESTINATION_REFUSED'
]
```

- [ ] **Step 2: Run the documentation contract and verify RED**

```powershell
node --test test/unit-ci/ssh-tunnel-ui.spec.js
```

Expected: FAIL because the current manual has only brief lifecycle and error notes.

- [ ] **Step 3: Expand Section 14 of the Chinese manual**

Use this exact section order:

```markdown
## 14. SSH 隧道与端口转发
### 14.1 三秒选择正确类型
### 14.2 本地转发：访问服务器网页和数据库
### 14.3 本地转发启动后怎么访问
### 14.4 SOCKS5：让浏览器或应用流量经过服务器
### 14.5 Firefox、Chrome 和 Edge 的 SOCKS5 设置
### 14.6 远程转发：从服务器访问本机服务
### 14.7 三层检测结果怎么看
### 14.8 服务器禁止转发的安全检查
### 14.9 目标拒绝、端口占用、超时和证书警告
### 14.10 安全清单与术语
```

Include complete field/value examples for HTTP/HTTPS, MySQL, PostgreSQL, Redis, SOCKS5, and remote forwarding. State explicitly which machine owns each `127.0.0.1`, what to open after start, whether a proxy is required, and what successful/failed stage evidence means. Include only read-only commands and the scoped `Match User` configuration example; tell readers to validate with `sshd -t` and ask an administrator to apply/reload changes rather than offering an automated action.

- [ ] **Step 4: Update the general help-center summary**

Keep the main Help Center concise and point users to the dedicated tunnel guide. Add the approved distinctions: local forwarding needs no browser proxy, SOCKS5 does, remote forwarding has `GatewayPorts`/firewall boundaries, and layered detection distinguishes listener/SSH/target.

- [ ] **Step 5: Run documentation tests and verify GREEN**

```powershell
node --test test/unit-ci/ssh-tunnel-ui.spec.js test/unit-ci/help-center.spec.js
```

Expected: all help and SSH tunnel UI documentation contracts pass.

- [ ] **Step 6: Commit the complete guide**

```powershell
git add apps/electerm-agent/docs/USER_GUIDE_ZH.md apps/electerm-agent/src/client/components/main/help-center-modal.jsx apps/electerm-agent/test/unit-ci/ssh-tunnel-ui.spec.js
git commit -m "docs(tunnel): add complete beginner usage guide"
```

### Task 9: Full regression, visual inspection, and real-server evidence

**Files:**
- Modify only if a verification failure exposes a requirement gap; follow a new RED/GREEN cycle for that exact gap.
- Evidence: command output and screenshots from the approved test environments.

- [ ] **Step 1: Run all SSH tunnel unit tests**

```powershell
node --test test/unit-ci/ssh-tunnel-*.spec.js
```

Expected: all tunnel unit tests pass with 0 failures.

- [ ] **Step 2: Run cross-cutting UI and catalog contracts**

```powershell
node --test test/unit-ci/secondary-ui-contract.spec.js test/unit-ci/help-center.spec.js test/unit-ci/glacier-silver-ui-style-contract.spec.js
```

Expected: bilingual catalogs match and responsive/theme contracts pass.

- [ ] **Step 3: Run the SSH tunnel Electron E2E suite**

```powershell
npx playwright test test/e2e/033.ssh-tunnel-manager.spec.js --workers=1
```

Expected: all tunnel UI lifecycle, guidance, and failure scenarios pass.

- [ ] **Step 4: Run lint and the complete unit suite**

```powershell
npm run lint
npm run test-unit-ci
```

Expected: both commands exit 0. If unrelated pre-existing failures occur, capture the exact failing tests and prove the tunnel-focused suites still pass; do not label the full suite green.

- [ ] **Step 5: Build the application**

```powershell
npm run compile
```

Expected: exit 0 with renderer and Electron bundles produced successfully.

- [ ] **Step 6: Inspect the built UI at supported sizes**

Start the desktop development app with the repository's local launcher, then inspect the SSH tunnel modal at 1366×768 and 1920×1080 in light and dark themes. Verify keyboard focus, access panel wrapping, three-stage wrapping, guide navigation, copy buttons, and that the Stop action remains reachable on failed cards. Capture screenshots for the task handoff.

- [ ] **Step 7: Run authorized real-server acceptance**

```powershell
npx playwright test test/e2e/034.real-server-external-acceptance.spec.js --workers=1
```

Expected when configured credentials are available: local target success/refusal, remote forwarding, SOCKS5, and cleanup pass. A shared server that allows forwarding must not be reconfigured merely to manufacture prohibition; policy prohibition remains covered by controller/runtime/E2E tests unless a dedicated authorized endpoint exists.

- [ ] **Step 8: Verify the original screenshot regression explicitly**

Using the mocked prohibited scenario or an authorized policy-restricted endpoint, confirm all of the following on one card:

```text
SSH_TUNNEL_FORWARDING_PROHIBITED is visible
SSH forwarding stage is limited/failed
Target service stage is unverified
No green overall availability is visible
No “最近测试正常” text remains
Copy-only checks and the beginner guide are reachable
```

- [ ] **Step 9: Review the final diff against the specification**

```powershell
git diff de355e4...HEAD --check
git diff de355e4...HEAD --stat
git status --short
```

Expected: no whitespace errors; only planned tunnel, test, i18n, and guide files are changed by this feature. Existing unrelated user changes remain untouched.

- [ ] **Step 10: Commit any verification-only fixture updates**

If Step 6 or 7 required a real-server fixture change already proven through RED/GREEN, commit only that exact fixture:

```powershell
git add apps/electerm-agent/test/e2e/034.real-server-external-acceptance.spec.js
git commit -m "test(tunnel): complete acceptance coverage"
```

If no fixture update was needed, do not create an empty commit.
