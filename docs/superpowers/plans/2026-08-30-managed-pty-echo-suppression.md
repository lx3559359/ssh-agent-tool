# Managed PTY Echo Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide ShellPilot-managed PTY command echo without losing authenticated shell lifecycle records or managed protocol output.

**Architecture:** Reuse `AttachAddonCustom` output suppression at the single managed-command submission boundary. Release only on the current tracker session's authenticated `OSC 633;E;<nonce>;` prefix, found with a bounded cross-chunk scanner, and republish data beginning at that exact boundary. This preserves xterm command tracking and raw managed-protocol parsing while discarding the preceding `__sp_*` command text.

**Review hardening:** The initial happy-path implementation searched each received chunk for any OSC 633 prefix. Final implementation additionally passes the active tracker nonce into `submitManagedPtyCommand()`, rejects missing or malformed nonces, ignores wrong-nonce records, preserves at most `marker.length - 1` characters across chunks, and covers string/binary splits plus timeout and synchronous-send recovery.

**Tech Stack:** Electron 41, React renderer, xterm.js 6, Node.js test runner, Playwright Electron E2E.

---

### Task 1: Reproduce the visible managed-command echo in automated tests

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js:138`
- Modify: `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js:47`

- [ ] **Step 1: Add the failing unit regression test**

Insert this test after `AttachAddon exposes controller-only managed submit and interrupt methods`:

```js
test('managed PTY submission hides command echo and republishes the lifecycle remainder', async () => {
  const { addon, sent, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'command /usr/bin/env SHELLPILOT_FILE=1 __sp_secret=hidden'
  const remainder =
    `\u001b]633;C;${testTrackerNonce}\u0007` +
    '\u001b]698;SHELLPILOT_FILE;token;start;MA==;cm9vdA==\u0007'

  assert.equal(addon.submitManagedPtyCommand(command), true)
  assert.equal(addon.outputSuppressed, true)
  assert.deepEqual(sent, [`${command}\r`])

  addon.writeToTerminal(`${command}\r\n`)
  assert.deepEqual(writes, [])
  assert.deepEqual(output, [])

  addon.writeToTerminal(remainder)
  assert.equal(addon.outputSuppressed, false)
  assert.deepEqual(writes, [remainder])
  assert.deepEqual(output, [remainder])
  assert.equal(writes.join('').includes('__sp_secret'), false)
  assert.equal(output.join('').includes('__sp_secret'), false)
})
```

- [ ] **Step 2: Run the unit test and verify RED**

Run:

```powershell
node --test test/unit-ci/terminal-input-stability.spec.js
```

Expected: FAIL in `managed PTY submission hides command echo and republishes the lifecycle remainder` because `submitManagedPtyCommand()` leaves `outputSuppressed` false.

- [ ] **Step 3: Add the failing Electron buffer assertion**

Add these helpers after `activeTerminal()` in `039.operations-pty-identity.spec.js`:

```js
async function terminalBufferText (page) {
  return page.evaluate(() => {
    const terminal = window.refs.get('term-' + window.store.activeTabId)
    return terminal?.getTerminalBufferText?.() || ''
  })
}

async function expectManagedPtyEchoHidden (page) {
  const text = await terminalBufferText(page)
  expect(text).not.toMatch(/SHELLPILOT_FILE|__sp_/)
}
```

Call the helper immediately after the first `expectRemoteFileWorkSettled(page)` at the start of the test:

```js
await waitForRemotePanelReady(page)
await expectRemoteFileWorkSettled(page)
await expectManagedPtyEchoHidden(page)
```

Call it again after the root file cancellation and cleanup assertions, immediately before `const terminal = page.locator('.session-current')`:

```js
await expectManagedPtyEchoHidden(page)

const terminal = page.locator('.session-current')
```

- [ ] **Step 4: Run the Electron regression and verify RED**

Run:

```powershell
npx playwright test test/e2e/039.operations-pty-identity.spec.js --workers=1
```

Expected: FAIL at `expectManagedPtyEchoHidden()` because the local SSH fixture echoes the current `command /usr/bin/env ... SHELLPILOT_FILE ... __sp_*` probe into the xterm buffer.

### Task 2: Suppress only the managed-command echo and preserve the protocol stream

**Files:**
- Modify: `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js:3`
- Test: `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js`
- Test: `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js`

- [ ] **Step 1: Add bounded managed-command suppression state**

Add the timeout constant below `terminalControlFlag`:

```js
const managedPtyEchoSuppressionTimeout = 5000
```

Initialize the release behavior in the constructor after `onSuppressionEndCallback`:

```js
this.publishSuppressionRemainder = false
```

Extend `startOutputSuppression()` so callers can request publication of the post-marker remainder and so a new suppression always replaces an older timer:

```js
startOutputSuppression = (
  timeout = 3000,
  onEnd = null,
  discardOnTimeout = false,
  publishRemainder = false
) => {
  if (this.suppressTimeout) clearTimeout(this.suppressTimeout)
  this.outputSuppressed = true
  this.suppressedData = []
  this.onSuppressionEndCallback = onEnd
  this.publishSuppressionRemainder = publishRemainder === true
  this.suppressTimeout = setTimeout(() => {
    if (!discardOnTimeout) {
      console.warn('[AttachAddon] Output suppression timeout reached, resuming')
    }
    this.stopOutputSuppression(discardOnTimeout)
  }, timeout)
}
```

Reset the release behavior in `stopOutputSuppression()` immediately after setting `outputSuppressed` false:

```js
this.outputSuppressed = false
this.publishSuppressionRemainder = false
```

- [ ] **Step 2: Republish only data at and after the OSC 633 boundary**

Replace the shell-integration branch inside `writeToTerminal()` with:

```js
if (this.checkForShellIntegration(str)) {
  const marker = String.fromCharCode(27) + ']633;'
  const integrationData = str.slice(str.indexOf(marker))
  const publishRemainder = this.publishSuppressionRemainder
  this.onShellIntegrationDetected()
  if (integrationData) {
    if (publishRemainder) this._publishRemoteOutput(integrationData)
    this.writeToTerminalDirect(integrationData)
  }
  return
}
```

This ordering captures the option before `stopOutputSuppression()` resets it, publishes the same post-marker bytes that normal terminal output would publish, and never publishes the preceding command echo.

- [ ] **Step 3: Enable suppression only for managed PTY submissions**

Replace `submitManagedPtyCommand()` with:

```js
submitManagedPtyCommand = (command) => {
  if (!String(command || '').trim()) return false
  this.startOutputSuppression(
    managedPtyEchoSuppressionTimeout,
    null,
    true,
    true
  )
  try {
    this._sendToServerDirect(`${command}\r`)
  } catch (error) {
    this.stopOutputSuppression(true)
    throw error
  }
  return true
}
```

Do not change `submitSafetyCommand()`, `sendToServer()`, password handling, or keepalive suppression.

- [ ] **Step 4: Run the focused unit tests and verify GREEN**

Run:

```powershell
node --test test/unit-ci/terminal-input-stability.spec.js test/unit-ci/managed-pty-task-controller.spec.js test/unit-ci/operations-toolkit-pty-protocol.spec.js test/unit-ci/remote-file-capability.spec.js
```

Expected: PASS with zero failures, including the new same-chunk lifecycle/protocol regression.

- [ ] **Step 5: Run the Electron regression and verify GREEN**

Rebuild the app used by Playwright, then run the target scenario:

```powershell
npm run b
npx playwright test test/e2e/039.operations-pty-identity.spec.js --workers=1
```

Expected: build exits 0; Electron test reports `1 passed`; both terminal-buffer checks exclude `SHELLPILOT_FILE` and `__sp_` while the root/SFTP lifecycle still completes.

- [ ] **Step 6: Commit the tested behavior change**

```powershell
git add -- apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js
git commit -m "fix: hide managed PTY command echo"
```

### Task 3: Verify the full affected surface and production artifact

**Files:**
- Verify: `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js`
- Verify: `apps/electerm-agent/test/unit-ci/*.spec.js`
- Verify: `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js`

- [ ] **Step 1: Run static checks on the changed files**

Run:

```powershell
npx standard src/client/components/terminal/attach-addon-custom.js test/unit-ci/terminal-input-stability.spec.js test/e2e/039.operations-pty-identity.spec.js
git diff --check HEAD^
```

Expected: both commands exit 0 with no lint or whitespace errors.

- [ ] **Step 2: Run the complete unit-ci suite**

Run:

```powershell
npm run test-unit-ci
```

Expected: zero failed, cancelled, or skipped tests attributable to the change.

- [ ] **Step 3: Run a fresh production build**

Run:

```powershell
npm run b
```

Expected: Vite and runtime preparation both exit 0 and report the v0.4.45 baseline.

- [ ] **Step 4: Inspect the final diff and repository state**

Run:

```powershell
git diff HEAD^ -- apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js
git status --short
```

Expected: the diff contains only managed PTY echo suppression and its tests. Generated `work/`, `node_modules/`, and Playwright results remain ignored; no unrelated tracked files are staged.
