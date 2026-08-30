# Managed PTY Echo Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep internal managed PTY commands invisible until an authenticated command boundary or an explicit controller cleanup, including on servers whose PTY echo takes longer than five seconds.

**Architecture:** Replace the managed command's fixed suppression timer with an explicit echo-suppression lease in `AttachAddonCustom`. The managed PTY controller owns abnormal cleanup and cancels the lease before sending `Ctrl+C`; the existing authenticated OSC marker owns normal release. The local SSH E2E server will echo privileged commands so the client, rather than the fixture, proves the behavior.

**Tech Stack:** JavaScript, React terminal controller, xterm.js OSC 633 integration, Node.js `node:test`, Playwright Electron E2E, local SSH/SFTP fixture.

---

## File map

- `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js`: own the managed echo-suppression lease, authenticated release, explicit cancellation, and dispose cleanup.
- `apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js`: cancel hidden submission output before interruption and during final cleanup.
- `apps/electerm-agent/src/client/components/terminal/terminal.jsx`: wire the controller cleanup boundary to the attach addon.
- `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js`: reproduce the legacy deadline leak and verify addon cleanup behavior.
- `apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js`: prove cleanup ordering for cancellation and disconnect.
- `apps/electerm-agent/test/e2e/common/local-ssh-server.js`: stop masking privileged command echo.
- `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js`: assert that real echoed privileged commands never enter terminal scrollback.

### Task 1: Make managed echo suppression lifecycle-bound

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js:138-253`
- Modify: `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js:1-120`
- Modify: `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js:380-420`
- Modify: `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js:545-565`

- [ ] **Step 1: Replace the legacy timeout-success test with a failing lifecycle test**

Replace the timeout portion of `managed PTY suppression recovers after timeout and synchronous send failure` with a separate test that compresses the old five-second deadline to five milliseconds while preserving a no-deadline request from the new implementation:

```js
test('managed PTY command echo stays hidden past the legacy deadline', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  term.write = value => writes.push(value)
  const originalStart = addon.startOutputSuppression
  let requestedTimeout
  addon.startOutputSuppression = (timeout, ...args) => {
    requestedTimeout = timeout
    return originalStart(timeout === null ? null : 5, ...args)
  }

  assert.equal(addon.submitManagedPtyCommand(
    'SHELLPILOT_FILE=1 __sp_secret=hidden',
    testTrackerNonce
  ), true)
  addon.writeToTerminal('SHELLPILOT_FILE=1 __sp_first=hidden')
  await new Promise(resolve => setTimeout(resolve, 20))
  addon.writeToTerminal(' __sp_after_legacy_deadline=hidden')

  assert.equal(requestedTimeout, null)
  assert.equal(addon.outputSuppressed, true)
  assert.deepEqual(writes, [])
  assert.equal(addon.cancelManagedPtyEchoSuppression(), true)
  assert.equal(addon.outputSuppressed, false)
  addon.writeToTerminal('ordinary output')
  assert.deepEqual(writes, ['ordinary output'])
  assert.equal(addon.cancelManagedPtyEchoSuppression(), true)
})
```

Keep synchronous send failure as its own test and add assertions that the managed lease is inactive and its buffered command was not replayed:

```js
test('managed PTY suppression clears on synchronous send failure', async () => {
  const { addon } = await createDirectAttachHarness()
  addon._sendData = () => { throw new Error('send failed') }

  assert.throws(
    () => addon.submitManagedPtyCommand('printf failure', testTrackerNonce),
    /send failed/
  )
  assert.equal(addon.outputSuppressed, false)
  assert.equal(addon.managedPtyEchoSuppressionActive, false)
  assert.deepEqual(addon.suppressedData, [])
})
```

- [ ] **Step 2: Run the lifecycle test and verify RED**

Run:

```powershell
node --test --test-name-pattern="managed PTY command echo stays hidden|managed PTY suppression clears" test/unit-ci/terminal-input-stability.spec.js
```

Expected: FAIL because v0.4.46 requests `5000`, releases after the compressed deadline, exposes the late `__sp_*` text, and has no `cancelManagedPtyEchoSuppression` method.

- [ ] **Step 3: Implement the minimal addon lease**

Remove `managedPtyEchoSuppressionTimeout`, add this constructor state, and allow `null` to mean that the generic suppression layer creates no timer:

```js
this.managedPtyEchoSuppressionActive = false
```

```js
const suppressionTimeout = Number(timeout)
if (Number.isFinite(suppressionTimeout) && suppressionTimeout > 0) {
  this.suppressTimeout = setTimeout(() => {
    if (!discardOnTimeout) {
      console.warn('[AttachAddon] Output suppression timeout reached, resuming')
    }
    this.stopOutputSuppression(discardOnTimeout)
  }, suppressionTimeout)
} else {
  this.suppressTimeout = null
}
```

Ensure every normal stop clears the managed flag:

```js
this.outputSuppressed = false
this.managedPtyEchoSuppressionActive = false
```

Add the explicit, idempotent controller boundary:

```js
cancelManagedPtyEchoSuppression = () => {
  if (this.managedPtyEchoSuppressionActive) {
    this.stopOutputSuppression(true)
  }
  return true
}
```

Change managed submission to request no independent deadline and to clean up through the same method on send failure:

```js
this.startOutputSuppression(
  null,
  null,
  true,
  true,
  `${String.fromCharCode(27)}]633;E;${nonce};`
)
this.managedPtyEchoSuppressionActive = true
try {
  this._sendToServerDirect(`${command}\r`)
} catch (error) {
  this.cancelManagedPtyEchoSuppression()
  throw error
}
```

In `dispose`, clear `outputSuppressed`, `managedPtyEchoSuppressionActive`, `suppressedData`, `suppressionReleaseMarker`, `suppressionScanText`, and reset `suppressionDecoder` without replaying data or flushing pending input.

- [ ] **Step 4: Run focused addon tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="managed PTY|AttachAddon exposes password|queues user input" test/unit-ci/terminal-input-stability.spec.js
```

Expected: all selected tests PASS; no `SHELLPILOT_FILE` or `__sp_*` value reaches `term.write` before the authenticated marker.

- [ ] **Step 5: Commit the addon lease**

```powershell
git add -- apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js
git commit -m "fix: bind managed PTY echo hiding to submission"
```

### Task 2: Let the controller own abnormal cleanup

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js:90-180`
- Modify: `apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js:300-375`
- Modify: `apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js:492-508`
- Modify: `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js:1415-1428`
- Modify: `apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js:100-175`
- Modify: `apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js:260-295`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal.jsx:152-180`

- [ ] **Step 1: Add failing cleanup-order tests**

Extend `createControllerHarness` with observable lifecycle ordering:

```js
const lifecycleEvents = []
```

```js
cancelSubmissionOutput: () => {
  lifecycleEvents.push('cancel-output')
  return true
},
interrupt: () => {
  lifecycleEvents.push('interrupt')
  interrupts += 1
  return true
},
```

Return `lifecycleEvents` from the harness. In the abort test, immediately after aborting, add:

```js
assert.deepEqual(
  harness.lifecycleEvents.slice(0, 2),
  ['cancel-output', 'interrupt']
)
```

In the disconnect test, after `invalidate`, add:

```js
assert.equal(harness.lifecycleEvents.includes('cancel-output'), true)
```

Extend the terminal wiring contract:

```js
assert.match(
  source,
  /cancelSubmissionOutput:\s*\(\)\s*=>\s*this\.attachAddon\?\.cancelManagedPtyEchoSuppression\(\)/
)
```

- [ ] **Step 2: Run controller and wiring tests and verify RED**

Run:

```powershell
node --test test/unit-ci/managed-pty-task-controller.spec.js --test-name-pattern="abort sends|disconnect rejects"
node --test test/unit-ci/terminal-input-stability.spec.js --test-name-pattern="terminal wires managed PTY tasks"
```

Expected: FAIL because the controller ignores `cancelSubmissionOutput`, interruption occurs without prior echo cleanup, and `terminal.jsx` does not wire the method.

- [ ] **Step 3: Add idempotent controller cleanup**

Accept a default no-op boundary in `createManagedPtyTaskController`:

```js
cancelSubmissionOutput = () => true,
```

Add a guarded helper:

```js
function safeCancelSubmissionOutput () {
  try {
    cancelSubmissionOutput()
  } catch {
    // Echo cleanup is best effort; controller recovery remains authoritative.
  }
}
```

Call `safeCancelSubmissionOutput()` from `cleanupExecution` before clearing `active`. Also call it in `requestCancellation` immediately before the first `interrupt()` call:

```js
if (!execution.interruptSent) {
  execution.interruptSent = true
  safeCancelSubmissionOutput()
  try {
    interrupt()
  } catch {
    // Missing prompt recovery below keeps the terminal locked safely.
  }
}
```

This deliberately allows duplicate cleanup during final settlement; the attach addon method is idempotent.

- [ ] **Step 4: Wire terminal ownership**

Add this controller option next to `submitCommand` and `interrupt`:

```js
cancelSubmissionOutput: () => (
  this.attachAddon?.cancelManagedPtyEchoSuppression()
),
```

- [ ] **Step 5: Run focused controller and terminal tests and verify GREEN**

Run:

```powershell
node --test test/unit-ci/managed-pty-task-controller.spec.js test/unit-ci/terminal-input-stability.spec.js
```

Expected: 81 or more tests PASS, including cancellation-before-interrupt, disconnect cleanup, authenticated marker release, split marker handling, and ordinary input transparency.

- [ ] **Step 6: Commit controller ownership**

```powershell
git add -- apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js apps/electerm-agent/src/client/components/terminal/terminal.jsx apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js
git commit -m "fix: clean managed PTY echo on controller exit"
```

### Task 3: Make Electron/SSH E2E exercise real PTY echo

**Files:**
- Modify: `apps/electerm-agent/test/e2e/common/local-ssh-server.js:999-1060`
- Modify: `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js:59-69`
- Modify: `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js:390-725`

- [ ] **Step 1: Remove fixture-side privileged echo masking**

Delete the prefix check that assigns `shellState.suppressLineEcho`, delete the reset after command execution, and make ordinary character handling always append to the echo buffer:

```js
line += char
echoed += char
```

The fixture must now write the complete `SHELLPILOT_TOKEN` or `__sp_token` command back to the websocket before emitting its authenticated OSC command boundary, matching a normal echo-enabled PTY.

- [ ] **Step 2: Strengthen the terminal buffer assertion**

Make the helper cover every internal prefix used by the privileged protocol:

```js
async function expectManagedPtyEchoHidden (page) {
  const text = await terminalBufferText(page)
  expect(text).not.toMatch(
    /SHELLPILOT_FILE|SHELLPILOT_TOKEN|SHELLPILOT_ARG_|__sp_/
  )
}
```

Keep the existing checks after initial remote-panel work and after the full root file/cancellation sequence. Add one more call immediately after the first successful root-only browse settles so the assertion cannot depend only on final scrollback state.

```js
await gotoRemotePath(page, '/root-only')
await expect(page.locator('.sftp-file-identity')).toContainText(
  '文件操作：root（当前终端）'
)
await expectRemoteFileWorkSettled(page)
await expectManagedPtyEchoHidden(page)
```

- [ ] **Step 3: Run Electron/SSH E2E with real echo**

Run:

```powershell
npx playwright test test/e2e/039.operations-pty-identity.spec.js --workers=1
```

Expected: 1 test PASS; the fixture records privileged commands and root identity operations, while terminal scrollback contains none of the internal command prefixes.

- [ ] **Step 4: Run fixture hygiene tests**

Run:

```powershell
node --test test/unit-ci/real-server-e2e-hygiene.spec.js test/unit-ci/terminal-input-stability.spec.js
```

Expected: all tests PASS; no hygiene contract requires server-side privileged echo suppression.

- [ ] **Step 5: Commit the truthful E2E fixture**

```powershell
git add -- apps/electerm-agent/test/e2e/common/local-ssh-server.js apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js
git commit -m "test: exercise real managed PTY command echo"
```

### Task 4: Run regression and production verification

**Files:**
- Verify only; no planned production edits.

- [ ] **Step 1: Run focused terminal and privileged file suites**

Run:

```powershell
node --test test/unit-ci/managed-pty-task-controller.spec.js test/unit-ci/terminal-input-stability.spec.js test/unit-ci/remote-file-backends.spec.js test/unit-ci/remote-file-capability.spec.js test/unit-ci/real-server-e2e-hygiene.spec.js
```

Expected: all selected tests PASS with zero failures.

- [ ] **Step 2: Run the complete unit suite**

Run:

```powershell
npm run test-unit-ci
```

Expected: all non-environment-skipped tests PASS with zero failures.

- [ ] **Step 3: Run StandardJS**

Run:

```powershell
npm run lint
```

Expected: exit code 0 and no StandardJS errors.

- [ ] **Step 4: Re-run the real Electron/SSH acceptance test**

Run:

```powershell
npx playwright test test/e2e/039.operations-pty-identity.spec.js --workers=1
```

Expected: 1 test PASS on a fresh application profile with real fixture echo enabled.

- [ ] **Step 5: Run the production build**

Run:

```powershell
npm run b
```

Expected: renderer build, packaging preparation, and runtime package verification all exit successfully.

- [ ] **Step 6: Check final repository state**

Run:

```powershell
git diff --check origin/master...HEAD
git status --short
git log --oneline origin/master..HEAD
```

Expected: no whitespace errors, no uncommitted files, and only the approved design, plan, fix, and test commits above `origin/master`.
