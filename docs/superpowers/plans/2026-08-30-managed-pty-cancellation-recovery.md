# Managed PTY Cancellation Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent late managed-command echo from appearing after cancellation and automatically restore SSH keyboard input when the current authenticated shell prompt returns without an OSC 633 command-finished event.

**Architecture:** Keep the managed PTY echo suppression lease active during cancellation, but retarget its release marker from the authenticated command-start record to the current session's authenticated prompt record. Let the controller treat a post-cancellation authenticated prompt as terminal recovery even when Ctrl+C prevents the matching command-finished record, while retaining the existing recovery lock when no trusted prompt arrives.

**Tech Stack:** Electron 41, React renderer, xterm.js 6, JavaScript ES modules, Node.js test runner, Playwright Electron E2E, Windows electron-builder.

---

## File map

All commands below run from `apps/electerm-agent` unless a step explicitly says otherwise. Git pathspecs are therefore relative to that directory.

- `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js`: owns managed echo suppression state and switches its authenticated release marker during cancellation.
- `apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js`: owns cancellation, trusted prompt recovery, terminal lease release, and keyboard gating.
- `apps/electerm-agent/src/client/components/terminal/terminal.jsx`: wires the controller's recovery preparation and hard-cleanup callbacks to the attach addon.
- `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js`: covers late echo hiding, wrong nonce handling, split prompt markers, cleanup, and terminal wiring.
- `apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js`: covers prompt-only cancellation recovery, lifecycle ordering, preserved error classification, and keyboard unlock.
- `apps/electerm-agent/test/e2e/common/local-ssh-server.js`: can reproduce a cancelled shell that emits late internal echo and a new authenticated prompt without emitting `OSC 633;D`.
- `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js`: proves the real Electron terminal hides the late echo and accepts the next user command.
- `apps/electerm-agent/package.json`, `apps/electerm-agent/package-lock.json`, `apps/electerm-agent/docs/releases/v0.4.48.md`: identify the candidate build and document the user-visible fix.

### Task 1: Keep late cancellation echo hidden until the authenticated prompt

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js:225-290`
- Modify: `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js:6-139,409-428,568-590`

- [ ] **Step 1: Write the failing AttachAddon regression test**

Insert after `managed PTY command echo stays hidden past the legacy deadline`:

```js
test('managed PTY cancellation hides late echo until the authenticated prompt', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'SHELLPILOT_FILE=1 __sp_secret=hidden'
  const wrongNonce = 'fedcba0987654321fedcba0987654321'
  const prompt =
    `\u001b]633;A;${testTrackerNonce}\u0007` +
    'root@fixture:# ' +
    `\u001b]633;B;${testTrackerNonce}\u0007`

  assert.equal(addon.submitManagedPtyCommand(command, testTrackerNonce), true)
  addon.writeToTerminal(`${command}\r\n`)
  assert.equal(addon.prepareManagedPtyEchoRecovery(), true)
  addon.writeToTerminal('__sp_cancel_tail=hidden')
  addon.writeToTerminal(`\u001b]633;A;${wrongNonce}\u0007forged prompt`)

  assert.equal(addon.outputSuppressed, true)
  assert.deepEqual(writes, [])
  assert.deepEqual(output, [])

  const split = 12
  addon.writeToTerminal(prompt.slice(0, split))
  assert.equal(addon.outputSuppressed, true)
  addon.writeToTerminal(prompt.slice(split))

  assert.equal(addon.outputSuppressed, false)
  assert.deepEqual(writes, [prompt])
  assert.deepEqual(output, [prompt])
  assert.equal(writes.join('').includes('__sp_cancel_tail'), false)
  assert.equal(output.join('').includes('__sp_cancel_tail'), false)
  assert.equal(addon.cancelManagedPtyEchoSuppression(), true)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run from `apps/electerm-agent`:

```powershell
node --test --test-name-pattern="managed PTY cancellation hides late echo" test/unit-ci/terminal-input-stability.spec.js
```

Expected: FAIL with `addon.prepareManagedPtyEchoRecovery is not a function`.

- [ ] **Step 3: Add the minimal managed-session state and recovery marker switch**

Initialize this property after `managedPtyEchoSuppressionActive` in the constructor:

```js
this.managedPtySessionNonce = ''
```

Clear it in `stopOutputSuppression()` immediately after clearing `managedPtyEchoSuppressionActive`, and in `dispose()` beside the same state:

```js
this.managedPtySessionNonce = ''
```

Add this method immediately before `cancelManagedPtyEchoSuppression`:

```js
prepareManagedPtyEchoRecovery = () => {
  const nonce = this.managedPtySessionNonce
  if (!this.managedPtyEchoSuppressionActive ||
    !managedPtySessionNoncePattern.test(nonce)) return false
  this.suppressionReleaseMarker =
    `${String.fromCharCode(27)}]633;A;${nonce}${String.fromCharCode(7)}`
  this.suppressionScanText = ''
  this.suppressionDecoder = new TextDecoder('utf-8')
  return true
}
```

In `submitManagedPtyCommand()`, record the validated nonce immediately after activating managed suppression and before sending the command:

```js
this.managedPtyEchoSuppressionActive = true
this.managedPtySessionNonce = nonce
```

- [ ] **Step 4: Run the AttachAddon tests and verify GREEN**

Run:

```powershell
node --test test/unit-ci/terminal-input-stability.spec.js
```

Expected: all tests pass; the new test proves wrong-nonce prompts remain hidden and only the exact current-session `A` record releases output.

- [ ] **Step 5: Commit the tested AttachAddon behavior**

```powershell
git add -- src/client/components/terminal/attach-addon-custom.js test/unit-ci/terminal-input-stability.spec.js
git commit -m "fix: retain managed PTY echo suppression during cancel"
```

### Task 2: Recover the controller from a post-cancellation prompt without command finish

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js:105-218,309-383`
- Modify: `apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js:118-170,216-304,329-354,430-451`

- [ ] **Step 1: Extend the controller harness and write the failing recovery test**

Pass this callback immediately before `cancelSubmissionOutput` in `createControllerHarness()`:

```js
prepareSubmissionOutputRecovery: () => {
  lifecycleEvents.push('prepare-output-recovery')
  return true
},
```

Add this test after `abort sends one Ctrl+C and waits for tracked prompt recovery`:

```js
test('cancelled command unlocks on a new prompt without command finish', async () => {
  const harness = await createControllerHarness({ recoveryTimeoutMs: 100 })
  const signalController = new AbortController()
  const lease = await harness.controller.acquire('operations-prompt-recovery')
  const running = lease.execute({
    taskId: 'prompt-recovery-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })
  harness.emitManagedStart()

  signalController.abort()
  assert.deepEqual(
    harness.lifecycleEvents.slice(0, 2),
    ['prepare-output-recovery', 'interrupt']
  )
  assert.equal(harness.emitPromptStarted(), true)

  await assert.rejects(running, error => {
    assert.equal(error.name, 'AbortError')
    assert.equal(error.code, 'PTY_TASK_CANCELLED')
    return true
  })
  assert.deepEqual(harness.lifecycleEvents.slice(0, 3), [
    'prepare-output-recovery',
    'interrupt',
    'cancel-output'
  ])
  assert.equal(await lease.release(), true)
  assert.equal(harness.controller.isBusy(), false)
  assert.deepEqual(
    harness.controller.handleUserInput('x'),
    { handled: false, send: false }
  )
})
```

Update the existing abort ordering assertion to expect:

```js
['prepare-output-recovery', 'interrupt']
```

- [ ] **Step 2: Run the controller test and verify RED**

```powershell
node --test --test-name-pattern="cancelled command unlocks|abort sends one Ctrl" test/unit-ci/managed-pty-task-controller.spec.js
```

Expected: FAIL because the controller does not call `prepareSubmissionOutputRecovery` and rejects the prompt when `commandFinished` is false.

- [ ] **Step 3: Add recovery preparation and the post-cancel prompt sequence**

Add the dependency with a safe default immediately before `cancelSubmissionOutput`:

```js
prepareSubmissionOutputRecovery = () => true,
cancelSubmissionOutput = () => true,
```

Add the safe wrapper before `safeCancelSubmissionOutput()`:

```js
function safePrepareSubmissionOutputRecovery () {
  try {
    prepareSubmissionOutputRecovery()
  } catch {
    // Prompt recovery remains authoritative even if echo retargeting fails.
  }
}
```

Initialize this field on each execution after `cancelError`:

```js
cancelRequestedPromptSequence: 0,
```

In `requestCancellation()`, record the boundary after assigning `cancelError` and before clearing the command timer:

```js
execution.cancelRequestedPromptSequence = promptSequence
```

Replace the pre-interrupt hard cleanup call with recovery preparation:

```js
if (!execution.interruptSent) {
  execution.interruptSent = true
  safePrepareSubmissionOutputRecovery()
  try {
    interrupt()
  } catch {
    // Missing prompt recovery below keeps the terminal locked safely.
  }
}
```

Replace `handlePromptStarted()` with:

```js
function handlePromptStarted () {
  promptSequence += 1
  const execution = active
  if (!execution) return false
  if (execution.cancelRequested) {
    if (promptSequence <= execution.cancelRequestedPromptSequence) return false
  } else if (!execution.commandFinished ||
    promptSequence <= execution.commandFinishedPromptSequence) {
    return false
  }
  execution.promptReturned = true
  settleIfComplete(execution)
  return true
}
```

Finally, let cancellation settle from the trusted prompt alone:

```js
if (execution.cancelRequested) {
  if (execution.promptReturned) {
    rejectExecution(execution, execution.cancelError)
  }
  return
}
```

- [ ] **Step 4: Run the controller suite and verify GREEN**

```powershell
node --test test/unit-ci/managed-pty-task-controller.spec.js
```

Expected: all controller tests pass, including the unchanged no-prompt test that still returns `CancellationUnknownError` and keeps the lease locked.

- [ ] **Step 5: Commit the tested controller behavior**

```powershell
git add -- src/client/components/terminal/managed-pty-task-controller.js test/unit-ci/managed-pty-task-controller.spec.js
git commit -m "fix: unlock managed PTY on authenticated cancel prompt"
```

### Task 3: Wire recovery preparation separately from hard cleanup

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js:1456-1470`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal.jsx:152-179`

- [ ] **Step 1: Add the failing source-contract assertion**

In `terminal wires managed PTY tasks through authenticated tracker lifecycle`, insert before the existing hard-cleanup assertion:

```js
assert.match(source, /prepareSubmissionOutputRecovery:\s*\(\)\s*=>\s*this\.attachAddon\?\.prepareManagedPtyEchoRecovery\(\)/)
```

- [ ] **Step 2: Run the contract test and verify RED**

```powershell
node --test --test-name-pattern="terminal wires managed PTY" test/unit-ci/terminal-input-stability.spec.js
```

Expected: FAIL because `terminal.jsx` only wires `cancelSubmissionOutput`.

- [ ] **Step 3: Wire both callbacks with distinct responsibilities**

Insert this property immediately before `cancelSubmissionOutput` in `terminal.jsx`:

```js
prepareSubmissionOutputRecovery: () => (
  this.attachAddon?.prepareManagedPtyEchoRecovery()
),
cancelSubmissionOutput: () => this.attachAddon?.cancelManagedPtyEchoSuppression(),
```

- [ ] **Step 4: Run the affected unit tests and verify GREEN**

```powershell
node --test test/unit-ci/terminal-input-stability.spec.js test/unit-ci/managed-pty-task-controller.spec.js test/unit-ci/operations-toolkit-effective-identity.spec.js
```

Expected: all tests pass with zero failures.

- [ ] **Step 5: Commit the terminal wiring**

```powershell
git add -- src/client/components/terminal/terminal.jsx test/unit-ci/terminal-input-stability.spec.js
git commit -m "fix: wire managed PTY prompt recovery"
```

### Task 4: Reproduce the real VPS cancellation ordering in Electron E2E

**Files:**
- Modify: `apps/electerm-agent/test/e2e/common/local-ssh-server.js:485-557`
- Modify: `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js:377-384,648-731`

- [ ] **Step 1: Add a fixture mode that emits late echo and omits cancelled command finish**

In the active privileged request's cancellation `finally` block, replace the current marker/finish block with:

```js
if (!stream.destroyed) {
  if (options.managedPtyCancellationEchoTail) {
    stream.write(String(options.managedPtyCancellationEchoTail))
  }
  stream.write(privilegedFileMarker(request.token, 'end', '130'))
  if (options.omitManagedPtyCancellationCommandFinish) {
    options.scheduleFixtureTimer(() => {
      if (!stream.destroyed) {
        writeTrackedPrompt(stream, nonce, { leadingNewline: true })
      }
    }, 20)
  } else {
    finishShellCommand(
      stream,
      nonce,
      130,
      options.scheduleFixtureTimer
    )
  }
}
```

- [ ] **Step 2: Enable the fixture behavior in the full root/SFTP scenario**

Add these options to `startLocalSshServer()` beside `rootDownloadDelayMs`:

```js
rootDownloadDelayMs: 30000,
omitManagedPtyCancellationCommandFinish: true,
managedPtyCancellationEchoTail:
  'SHELLPILOT_FILE=1 __sp_cancel_tail=hidden'
```

- [ ] **Step 3: Assert the input lease is released and a normal command works**

Immediately after `await expectManagedPtyEchoHidden(page)` in the cancellation section, add:

```js
await expect.poll(() => page.evaluate(() => {
  const terminal = window.refs.get('term-' + window.store.activeTabId)
  return terminal?.operationsPtyTaskController?.isBusy?.() === true
})).toBe(false)
await sendTerminalLine(page, 'echo shellpilot-e2e')
await expect.poll(() => terminalBufferText(page)).toContain('shellpilot-e2e')
await expectManagedPtyEchoHidden(page)
```

- [ ] **Step 4: Build and run the Electron regression**

```powershell
npm run b
npx playwright test test/e2e/039.operations-pty-identity.spec.js --workers=1
```

Expected: build exits 0 and Playwright reports `1 passed`; the cancelled request emits no `OSC 633;D`, the fake internal tail never enters the terminal buffer, controller busy becomes false, and `echo shellpilot-e2e` reaches the server and terminal.

- [ ] **Step 5: Commit the realistic cancellation regression**

```powershell
git add -- test/e2e/common/local-ssh-server.js test/e2e/039.operations-pty-identity.spec.js
git commit -m "test: cover prompt-only managed PTY cancellation recovery"
```

### Task 5: Prepare and verify the v0.4.48 candidate

**Files:**
- Modify: `apps/electerm-agent/package.json:3`
- Modify: `apps/electerm-agent/package-lock.json:3,9`
- Create: `apps/electerm-agent/docs/releases/v0.4.48.md`
- Verify: all files changed since `origin/master`

- [ ] **Step 1: Set the candidate version without creating a tag**

```powershell
npm version 0.4.48 --no-git-tag-version --ignore-scripts
```

Expected: only `package.json` and the two root version fields in `package-lock.json` change from `0.4.47` to `0.4.48`.

- [ ] **Step 2: Add exact release notes**

Create `docs/releases/v0.4.48.md` with:

```markdown
# ShellPilot v0.4.48

## [修复]

- 修复受控 SFTP/root 命令取消后，SSH 提示符已经返回但终端仍被判定为“释放状态未知”，导致键盘输入持续失效的问题。
- 修复取消瞬间可能显示 `SHELLPILOT_*` / `__sp_*` 内部命令尾部的问题。

## [改动]

- 取消后继续隐藏内部回显，直到收到当前 Shell Integration 会话认证的新提示符。
- 认证提示符可以在缺少命令结束事件时安全恢复终端；始终收不到可信提示符时仍要求重连。
```

- [ ] **Step 3: Run focused checks, lint, and the complete unit suite**

```powershell
node --test test/unit-ci/managed-pty-task-controller.spec.js test/unit-ci/terminal-input-stability.spec.js test/unit-ci/agent-task-recovery.spec.js test/unit-ci/remote-file-capability.spec.js
npx standard src/client/components/terminal/attach-addon-custom.js src/client/components/terminal/managed-pty-task-controller.js src/client/components/terminal/terminal.jsx test/unit-ci/managed-pty-task-controller.spec.js test/unit-ci/terminal-input-stability.spec.js test/e2e/common/local-ssh-server.js test/e2e/039.operations-pty-identity.spec.js
npm run test-unit-ci
git diff --check origin/master
```

Expected: every command exits 0; unit-ci reports zero failures; StandardJS and whitespace checks emit no errors.

- [ ] **Step 4: Rebuild and rerun the realistic Electron test from clean generated output**

```powershell
npm run clean
npm run b
npx playwright test test/e2e/039.operations-pty-identity.spec.js --workers=1
```

Expected: clean production build exits 0 and the Electron scenario reports `1 passed`.

- [ ] **Step 5: Package and smoke-test the unpacked Windows candidate**

```powershell
npm run package:win:dir
npm run test-package-smoke
```

Expected: `dist/win-unpacked/ShellPilot.exe` is created with ProductVersion `0.4.48.0`; packaged smoke exits 0.

- [ ] **Step 6: Commit the candidate metadata**

```powershell
git add -- package.json package-lock.json docs/releases/v0.4.48.md
git commit -m "chore: prepare ShellPilot v0.4.48"
```

- [ ] **Step 7: Inspect the final branch and launch the isolated candidate for user validation**

```powershell
git status --short --branch
git log --oneline origin/master..HEAD
$candidateProfile = Join-Path ([IO.Path]::GetTempPath()) ("ShellPilot-v0.4.48-profile-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $candidateProfile | Out-Null
$env:DATA_PATH = $candidateProfile
Start-Process -FilePath (Resolve-Path 'dist/win-unpacked/ShellPilot.exe') -WorkingDirectory (Resolve-Path 'dist/win-unpacked')
```

Expected: tracked worktree is clean, the branch contains only the design/plan/fix/tests/version commits, and a visible v0.4.48 candidate opens with isolated local data. Do not tag, merge, or publish until the user validates the real VPS flow.
