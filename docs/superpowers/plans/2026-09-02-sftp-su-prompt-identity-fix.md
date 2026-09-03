# SFTP `su` Identity and Prompt Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SFTP follow the current `su`/`sudo -i` Shell identity without leaking internal commands or adding duplicate prompts to the visible SSH terminal.

**Architecture:** Keep the existing per-operation PTY identity probe and fail-closed backend routing. Make the Bash prompt hook process-local, exclude password input from command-transition tracking, and add an explicit hidden-prompt presentation option for `root-file:*` PTY tasks and current-child-Shell reinjection while still forwarding authenticated OSC lifecycle frames to `CommandTrackerAddon`.

**Tech Stack:** Electron, React class components, xterm.js, OSC 633 Shell Integration, Node.js test runner, Playwright, StandardJS.

---

## File structure

- Modify `apps/electerm-agent/src/client/components/terminal/shell.js`: keep the Bash `PROMPT_COMMAND` hook local to the current Shell process.
- Create `apps/electerm-agent/src/client/components/terminal/terminal-input-mode.js`: pure policy for deciding whether terminal input is protected password input.
- Modify `apps/electerm-agent/src/client/components/terminal/terminal.jsx`: use the password policy before command tracking and use hidden current-Shell reinjection.
- Modify `apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js`: tag only `root-file:*` submissions as hidden-prompt tasks.
- Modify `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js`: preserve OSC lifecycle frames while dropping printable prompt text for explicitly hidden internal tasks.
- Modify `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js`: cover process-local prompt hooks, password input routing, hidden SFTP prompts, hidden child-Shell reinjection, and unchanged ordinary-task behavior.
- Modify `apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js`: prove the controller scopes the hidden-prompt option to `root-file:*` leases.
- Modify `apps/electerm-agent/test/e2e/common/local-ssh-server.js`: model bare `su`, password input, inherited `PROMPT_COMMAND`, and current-Shell reinjection.
- Modify `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js`: reproduce the HikvisionOS sequence, check no visible prompt growth, verify root SFTP, then verify `exit` restores the login identity.
- Modify `apps/electerm-agent/docs/releases/v0.4.49.md`: record both user-visible fixes.

## Task 1: Keep the Bash prompt hook process-local

**Files:**
- Modify: `apps/electerm-agent/src/client/components/terminal/shell.js:77-90`
- Test: `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js:1410-1450`

- [ ] **Step 1: Write the failing Bash Integration test**

Add this test next to the current-child-Shell integration tests:

```js
test('bash shell integration keeps the ShellPilot prompt hook process-local', async () => {
  const { getInlineShellIntegration } = await importShellIntegration()
  const integration = getInlineShellIntegration('bash', testTrackerNonce)
  const assignment = integration.indexOf('PROMPT_COMMAND="__e_cmd"')
  const processLocal = integration.indexOf('export -n PROMPT_COMMAND')

  assert.notEqual(assignment, -1)
  assert.ok(processLocal > assignment)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test --test-name-pattern="process-local" test/unit-ci/terminal-input-stability.spec.js
```

Expected: FAIL because the generated Bash integration contains `PROMPT_COMMAND="__e_cmd"` but not `export -n PROMPT_COMMAND`.

- [ ] **Step 3: Add the minimal process-local hook**

In `getBashInlineIntegration`, keep the assignment and immediately clear any inherited export attribute:

```js
    'trap \'__e_pre\' DEBUG',
    'PROMPT_COMMAND="__e_cmd"',
    'export -n PROMPT_COMMAND',
    'PS1="${PS1}\\[\\e]633;B;${__e_nonce}\\a\\]"',
```

Do not export the `__e_*` functions and do not change `__e_old_prompt_command` evaluation.

- [ ] **Step 4: Run the focused Shell Integration tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="bash shell integration|current child shell integration|shell transition detection" test/unit-ci/terminal-input-stability.spec.js
```

Expected: PASS with 0 failures.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- apps/electerm-agent/src/client/components/terminal/shell.js apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js
git commit -m "fix(terminal): keep prompt hook process local"
```

## Task 2: Preserve the authenticated `su` candidate during password input

**Files:**
- Create: `apps/electerm-agent/src/client/components/terminal/terminal-input-mode.js`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal.jsx:45-62,1288-1315`
- Test: `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js:8-40,1400-1490,2620-2650`

- [ ] **Step 1: Write failing policy and wiring tests**

Add this import helper near the other dynamic import helpers:

```js
async function importTerminalInputMode () {
  return import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/terminal/terminal-input-mode.js'
  )))
}
```

Add behavior coverage:

```js
test('transport password state blocks ordinary command input tracking', async () => {
  const { isTerminalPasswordInputMode } = await importTerminalInputMode()

  assert.equal(isTerminalPasswordInputMode({
    transportPasswordMode: true,
    suggestionPasswordMode: false
  }), true)
  assert.equal(isTerminalPasswordInputMode({
    transportPasswordMode: false,
    suggestionPasswordMode: true
  }), true)
  assert.equal(isTerminalPasswordInputMode({
    transportPasswordMode: false,
    suggestionPasswordMode: false
  }), false)
})
```

Extend the terminal wiring contract with an ordering assertion:

```js
test('terminal checks real password mode before tracking Enter as a command', () => {
  const source = readClientFile('components/terminal/terminal.jsx')
  const start = source.indexOf('onData = (d) => {')
  const end = source.indexOf('runSafetyCommand =', start)
  const onData = source.slice(start, end)

  assert.match(onData, /attachAddon\?\.isPasswordPromptDetected\?\.\(\)/)
  assert.match(onData, /isTerminalPasswordInputMode/)
  assert.match(onData, /if \(!passwordMode\) \{\s*this\.handleInputEvent\(d\)/)
  assert.ok(onData.indexOf('if (!passwordMode)') <
    onData.indexOf('this.handleInputEvent(d)'))
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="transport password state|checks real password mode" test/unit-ci/terminal-input-stability.spec.js
```

Expected: FAIL because `terminal-input-mode.js` does not exist and `onData` calls `handleInputEvent` before checking password mode.

- [ ] **Step 3: Add the pure password-mode policy**

Create `terminal-input-mode.js`:

```js
export function isTerminalPasswordInputMode ({
  transportPasswordMode = false,
  suggestionPasswordMode = false
} = {}) {
  return transportPasswordMode === true || suggestionPasswordMode === true
}
```

- [ ] **Step 4: Gate command tracking before handling password input**

Import the policy in `terminal.jsx`:

```js
import { isTerminalPasswordInputMode } from './terminal-input-mode.js'
```

Replace `onData` with this ordering while retaining the existing suggestion refresh body:

```js
  onData = (d) => {
    const suggestions = refsStatic.get('terminal-suggestions')
    const passwordMode = isTerminalPasswordInputMode({
      transportPasswordMode:
        this.attachAddon?.isPasswordPromptDetected?.() === true,
      suggestionPasswordMode: suggestions?.state?.passwordMode === true
    })
    if (!passwordMode) {
      this.handleInputEvent(d)
    }
    if (passwordMode) {
      if (d === '\r' || d === '\n') {
        this.closeSuggestions()
      }
      return
    }
    if (!this.props.config.showCmdSuggestions || d === '\r' || d === '\n') {
      this.closeSuggestions()
      return
    }

    clearTimeout(this.timers.suggestionRefresh)
    this.timers.suggestionRefresh = setTimeout(() => {
      const data = this.getCurrentInput()
      if (data) {
        this.openSuggestions(this.getCursorPosition(), data)
      } else {
        this.closeSuggestions()
      }
    }, 50)
  }
```

This must not change Attach Addon password transmission or password-state clearing.

- [ ] **Step 5: Run focused input tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="password|shell transition|terminal invalidates managed PTY" test/unit-ci/terminal-input-stability.spec.js
```

Expected: PASS with 0 failures.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- apps/electerm-agent/src/client/components/terminal/terminal-input-mode.js apps/electerm-agent/src/client/components/terminal/terminal.jsx apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js
git commit -m "fix(terminal): preserve su transition through password"
```

## Task 3: Hide printable prompts for SFTP PTY work and child-Shell reinjection

**Files:**
- Modify: `apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js:660-697`
- Modify: `apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js:15-205,620-880,995-1050`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal.jsx:1846-1920`
- Test: `apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js:280-380`
- Test: `apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js:180-330,1390-1480`

- [ ] **Step 1: Write a failing controller scope test**

Add a test proving only SFTP/root-file leases receive the option:

```js
test('only root-file leases request hidden natural prompt text', async () => {
  for (const [owner, expected] of [
    ['root-file:list:tab-a', true],
    ['operations-system-overview', false]
  ]) {
    const harness = await createControllerHarness()
    const lease = await harness.controller.acquire(owner)
    const running = lease.execute({
      request: { operation: 'probe' },
      protocol: createBoundedProbeProtocol(),
      timeoutMs: 1000
    })

    assert.equal(
      harness.submissions[0].submitOptions?.hidePromptText,
      expected
    )
    harness.emitManagedStart({ uid: '0', username: 'root' })
    harness.emitManagedEnd(0)
    harness.emitCommandFinished(0)
    harness.emitPromptStarted()
    await running
    assert.equal(await lease.release(), true)
  }
})
```

- [ ] **Step 2: Write failing Attach Addon presentation tests**

Add one test for root-file task completion:

```js
test('root-file managed PTY hides natural prompt text but keeps lifecycle frames', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(String(value))
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'printf root-file-probe'
  const commandRecord =
    `\u001b]633;E;${testTrackerNonce};${command}\u0007`
  const result =
    `\u001b]633;C;${testTrackerNonce}\u0007` +
    '\u001b]698;SHELLPILOT_FILE;token;start;MA==;cm9vdA==\u0007'
  const promptFrame = `\u001b]633;A;${testTrackerNonce}\u0007`
  const inputFrame = `\u001b]633;B;${testTrackerNonce}\u0007`

  assert.equal(addon.submitManagedPtyCommand(
    command,
    testTrackerNonce,
    { hidePromptText: true }
  ), true)
  addon.writeToTerminal(commandRecord + result)
  addon.writeToTerminal(promptFrame + 'hik@fixture:$ ' + inputFrame)

  const visible = writes.join('')
  assert.equal(addon.outputSuppressed, false)
  assert.equal(visible.includes(promptFrame), true)
  assert.equal(visible.includes(inputFrame), true)
  assert.equal(visible.includes('hik@fixture:$ '), false)
  assert.equal(output.join('').includes('SHELLPILOT_FILE'), true)
})
```

Add a second test for current-child-Shell reinjection:

```js
test('current child shell reinjection hides its replacement prompt text', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  term.write = value => writes.push(String(value))
  let ended = false
  const promptFrame = `\u001b]633;A;${testTrackerNonce}\u0007`
  const inputFrame = `\u001b]633;B;${testTrackerNonce}\u0007`

  addon.startCurrentShellIntegrationSuppression(
    testTrackerNonce,
    1000,
    () => { ended = true }
  )
  addon.writeToTerminal(
    'hidden reinjection echo\r\n' +
    promptFrame + 'root@fixture:# ' + inputFrame
  )

  assert.equal(ended, true)
  assert.equal(writes.join('').includes(promptFrame), true)
  assert.equal(writes.join('').includes(inputFrame), true)
  assert.equal(writes.join('').includes('root@fixture:# '), false)
})
```

Keep the existing ordinary managed PTY test that expects `fixture:#` to remain visible; it is the negative scope guard.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="hidden natural prompt|hides natural prompt text|reinjection hides" test/unit-ci/managed-pty-task-controller.spec.js test/unit-ci/terminal-input-stability.spec.js
```

Expected: FAIL because `hidePromptText` is not propagated, natural prompt text is written, and `startCurrentShellIntegrationSuppression` does not exist.

- [ ] **Step 4: Scope the controller option to root-file leases**

Extend the `submitCommand` options in `submitExecutionFrame`:

```js
    const transport = submitCommand(frame.command, {
      holdSuppression: execution.plan.frames.length > 1 &&
        frame.executesOperation !== true && options.cleanup !== true,
      cleanup: options.cleanup === true,
      hidePromptText: execution.owner.startsWith('root-file:')
    })
```

Do not infer this flag from UID, username, operation name, or protocol output.

- [ ] **Step 5: Add explicit hidden-prompt state to Attach Addon**

Initialize and reset the new state with the other managed suppression fields:

```js
    this.managedPtyHidePromptText = false
```

In `stopOutputSuppression`, reset it to `false`. In `submitManagedPtyCommand`, bind it to the submission and require a continuing plan to keep the same value:

```js
    const hidePromptText = options.hidePromptText === true
    const continuingPlan = this.managedPtyEchoSuppressionActive &&
      this.managedPtySessionNonce === nonce &&
      this.managedPtyHidePromptText === hidePromptText &&
      (this.managedPtyHoldSuppression || options.cleanup === true)
```

After submission validation and before transport submission:

```js
    this.managedPtyHidePromptText = hidePromptText
```

- [ ] **Step 6: Drop only printable prompt text at final release**

In `_writeManagedPtyHiddenOutput`, snapshot the flag before `onShellIntegrationDetected()` resets state, and use the authenticated input frame instead of the printable prompt tail only when the task requested hiding:

```js
    const hidePromptText = this.managedPtyHidePromptText
    const terminalReleaseData = hidePromptText && promptReleaseReady
      ? inputFrame
      : releaseData
    this.onShellIntegrationDetected()
    if (terminalReleaseData.length > 0) {
      if (terminalReleaseData instanceof Uint8Array) {
        this._writeBinaryOutput(terminalReleaseData, false)
      } else {
        this.writeToTerminalDirect(terminalReleaseData)
      }
    }
```

Leave protocol publication to `_remoteOutputListeners` unchanged. The already-forwarded authenticated `A` plus the final authenticated `B` must still reach xterm/`CommandTrackerAddon`.

- [ ] **Step 7: Reuse the same boundary for current-Shell reinjection**

Add this narrow Attach Addon method:

```js
  startCurrentShellIntegrationSuppression = (nonce, timeout, onEnd) => {
    const sessionNonce = String(nonce || '')
    if (!managedPtySessionNoncePattern.test(sessionNonce)) {
      throw new Error('Shell Integration session nonce is invalid')
    }
    const promptFrame =
      `${String.fromCharCode(27)}]633;A;${sessionNonce}` +
      String.fromCharCode(7)
    this.startOutputSuppression(
      timeout,
      onEnd,
      true,
      false,
      promptFrame
    )
    this.managedPtyEchoSuppressionActive = true
    this.managedPtySessionNonce = sessionNonce
    this.managedPtyExpectedCommand = ''
    this.managedPtyHoldSuppression = false
    this.managedPtyHidePromptText = true
    this.consumeManagedPtyCommandRecord = false
    return true
  }
```

In `injectShellIntegration`, retain the nonce used to build the current-Shell command and choose the narrow suppression method only for `forceCurrentShell`:

```js
    let integrationCmd
    let currentShellNonce = ''
    if (forceCurrentShell) {
      if (!this.isSsh()) {
        throw new Error('仅 SSH 终端支持重装当前子 Shell 命令跟踪。')
      }
      currentShellNonce = this.cmdAddon.getSessionNonce()
      integrationCmd = getCurrentShellIntegrationCommand(currentShellNonce)
    } else {
      // Keep the existing shell detection and initial integration command.
    }
```

Inside the existing `onInitialData` callback:

```js
          const onSuppressionEnd = () => {
            this.shellInjected = true
            resolve()
          }
          if (forceCurrentShell) {
            this.attachAddon.startCurrentShellIntegrationSuppression(
              currentShellNonce,
              suppressionTimeout,
              onSuppressionEnd
            )
          } else {
            this.attachAddon.startOutputSuppression(
              suppressionTimeout,
              onSuppressionEnd
            )
          }
          this.attachAddon._sendData(integrationCmd)
```

- [ ] **Step 8: Run controller and Attach Addon tests and verify GREEN**

Run:

```powershell
node --test test/unit-ci/managed-pty-task-controller.spec.js test/unit-ci/terminal-input-stability.spec.js
```

Expected: PASS with 0 failures; ordinary managed PTY tests still show their final prompt, while root-file and current-Shell reinjection tests do not.

- [ ] **Step 9: Commit Task 3**

```powershell
git add -- apps/electerm-agent/src/client/components/terminal/managed-pty-task-controller.js apps/electerm-agent/src/client/components/terminal/attach-addon-custom.js apps/electerm-agent/src/client/components/terminal/terminal.jsx apps/electerm-agent/test/unit-ci/managed-pty-task-controller.spec.js apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js
git commit -m "fix(sftp): hide internal terminal prompts"
```

## Task 4: Reproduce bare `su` with a password in Electron/SSH E2E

**Files:**
- Modify: `apps/electerm-agent/test/e2e/common/local-ssh-server.js:35-60,925-1040,1048-1120,1423-1470`
- Modify: `apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js:1-120,377-540,830-890`

- [ ] **Step 1: Extend the E2E scenario before changing the server fixture**

Import `node:path` and create two nested ordinary directories before starting the server:

```js
const path = require('node:path')
```

```js
  const fixture = await createLocalSftpFixture()
  await fs.mkdir(path.join(
    fixture.root,
    'home',
    'shellpilot',
    'folder-a',
    'folder-b'
  ), { recursive: true })
```

After the first remote panel is ready, assert two directory navigations do not change visible terminal text:

```js
    const terminalBeforeDirectoryNavigation = await terminalBufferText(page)
    for (const name of ['folder-a', 'folder-b']) {
      const requestEpoch = await remoteRequestEpoch(page)
      await page.locator(
        `.session-current .file-list.remote .sftp-item[title="${name}"]`
      ).dblclick()
      await waitForRemoteRequestCycle(page, requestEpoch)
    }
    expect(await terminalBufferText(page))
      .toBe(terminalBeforeDirectoryNavigation)
    await gotoRemotePath(page, '/home/shellpilot')
```

Replace `su root` with the real password flow:

```js
    await sendTerminalLine(page, 'su')
    await expect.poll(() => terminalBufferText(page))
      .toContain('Password:')
    await sendTerminalLine(page, sshServer.password)
```

After root SFTP becomes ready, add:

```js
    const rootTerminalText = await terminalBufferText(page)
    expect(rootTerminalText).not.toContain('__e_cmd: command not found')
    expect(rootTerminalText).not.toContain(sshServer.password)
    expect(rootTerminalText.match(/root@fixture:# /g)?.length || 0).toBe(1)
    expect(sshServer.state.commandEvents.some(
      event => event.command === sshServer.password
    )).toBe(false)
```

Keep the existing root editor, mkdir, upload, rename, cancel/recovery, and `exit` assertions unchanged.

- [ ] **Step 2: Run E2E and verify RED**

Run:

```powershell
.\node_modules\.bin\playwright.cmd test test/e2e/039.operations-pty-identity.spec.js --workers=1
```

Expected: FAIL because the local SSH server does not yet implement bare `su` password mode; before Task 3 it would also fail the terminal snapshot equality.

- [ ] **Step 3: Model a process-local prompt hook and root activation**

When the fixture parses an integration command, record whether it contains the new process-local safeguard:

```js
    shellState.promptCommandProcessLocal =
      /export -n PROMPT_COMMAND/.test(command)
    state.promptCommandProcessLocal = shellState.promptCommandProcessLocal
```

Add a single root activation helper:

```js
function activateRootShell (stream, state, shellState, options) {
  shellState.identity = { uid: '0', username: 'root' }
  shellState.shellIntegrationActive = false
  state.effectiveIdentity = { ...shellState.identity }
  options.scheduleFixtureTimer(() => {
    if (stream.destroyed) return
    if (!shellState.promptCommandProcessLocal) {
      stream.write('bash: __e_cmd: command not found\r\n')
    }
    stream.write('root shell active\r\nroot@fixture:# ')
  }, 30)
}
```

Use it for the existing `su root` fast path and add a password wait for bare `su`:

```js
  if (command === 'su') {
    shellState.pendingSuPassword = true
    stream.write('Password: ')
    return
  }
  if (command === 'su root') {
    activateRootShell(stream, state, shellState, options)
    return
  }
```

- [ ] **Step 4: Consume password input without echo or command dispatch**

Initialize these fields in `shellState`:

```js
    shellIntegrationActive: false,
    promptCommandProcessLocal: false,
    pendingSuPassword: false
```

In the character loop, do not add password characters to `echoed` while `pendingSuPassword` is true. Replace the existing Enter branch's `stream.write` / `runCommand` / `line = ''` block with the password-first dispatch below so exactly one newline is written:

```js
        const submittedLine = line
        line = ''
        if (shellState.pendingSuPassword) {
          shellState.pendingSuPassword = false
          stream.write('\r\n')
          if (submittedLine === TEST_PASSWORD) {
            activateRootShell(stream, state, shellState, options)
          } else {
            stream.write('su: Authentication failure\r\n')
            if (shellState.shellIntegrationActive) {
              stream.write(osc633(shellState.shellIntegrationNonce, 'D', '1'))
              writeTrackedPrompt(stream, shellState.shellIntegrationNonce)
            } else {
              writePrompt(stream)
            }
          }
          continue
        }
        runCommand(
          stream,
          submittedLine.trim(),
          state,
          sessionId,
          shellState,
          options
        )
```

For ordinary characters:

```js
      line += char
      if (!shellState.pendingSuPassword) echoed += char
```

Keep editing and cancellation private too: the Backspace branch still updates `line`, but writes `\b \b` only outside password mode; the Ctrl+C branch sets `shellState.pendingSuPassword = false` before clearing the line. This prevents both password length leakage and a cancelled password prompt from consuming the next command.

Expose `promptCommandProcessLocal: false` in the server state so failed E2E diagnostics are inspectable.

- [ ] **Step 5: Run the full identity E2E and verify GREEN**

Run:

```powershell
.\node_modules\.bin\playwright.cmd test test/e2e/039.operations-pty-identity.spec.js --workers=1
```

Expected: PASS; the ordinary directory terminal snapshot is unchanged, bare `su` reaches root SFTP, no `__e_cmd` error or duplicate root prompt is visible, and `exit` restores the login identity.

- [ ] **Step 6: Commit Task 4**

```powershell
git add -- apps/electerm-agent/test/e2e/common/local-ssh-server.js apps/electerm-agent/test/e2e/039.operations-pty-identity.spec.js
git commit -m "test(sftp): cover password su and hidden prompts"
```

## Task 5: Release note and complete verification

**Files:**
- Modify: `apps/electerm-agent/docs/releases/v0.4.49.md:5-25`

- [ ] **Step 1: Add exact release-note bullets**

Under `## [修复]`, add:

```markdown
- 修复 SFTP 浏览每次打开或双击目录都会向可见 SSH 终端追加一份提示符的问题；内部身份探测仍保留严格校验，但不再污染终端缓冲区。
- 修复裸 `su` 密码回车覆盖已认证 Shell 切换状态、以及子 Shell 继承失效 `PROMPT_COMMAND` 后导致 root 文件身份无法确认的问题；SFTP 现在可随当前 Shell 在登录用户与 root 之间安全切换。
```

- [ ] **Step 2: Run the focused regression suite**

Run:

```powershell
node --test test/unit-ci/terminal-input-stability.spec.js test/unit-ci/managed-pty-task-controller.spec.js test/unit-ci/remote-file-capability.spec.js test/unit-ci/sftp-effective-identity-ui.spec.js test/unit-ci/sftp-effective-file-routing.spec.js
```

Expected: PASS with 0 failures.

- [ ] **Step 3: Run the Electron/SSH identity regression**

Run:

```powershell
.\node_modules\.bin\playwright.cmd test test/e2e/039.operations-pty-identity.spec.js --workers=1
```

Expected: PASS with 0 failures.

- [ ] **Step 4: Run the full unit suite**

Run:

```powershell
npm run test-unit-ci
```

Expected: exit code 0 and 0 failed tests.

- [ ] **Step 5: Run StandardJS lint**

Run:

```powershell
npm run lint
```

Expected: exit code 0 with no lint errors.

- [ ] **Step 6: Run the production renderer build**

Run:

```powershell
npm run vite-build
```

Expected: exit code 0 and a completed production build.

- [ ] **Step 7: Check patch hygiene and final state**

Run:

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` prints nothing. `git status --short` shows only the release note before the documentation commit plus the pre-existing untracked `docs/superpowers/plans/2026-09-01-lazy-privileged-staging.md`; no test artifacts or unrelated files are added.

- [ ] **Step 8: Commit Task 5**

```powershell
git add -- apps/electerm-agent/docs/releases/v0.4.49.md
git commit -m "docs: record sftp su prompt fix"
```

- [ ] **Step 9: Capture final evidence**

Run:

```powershell
git status --short
git log -6 --oneline --decorate
```

Expected: the only remaining untracked item is the pre-existing `docs/superpowers/plans/2026-09-01-lazy-privileged-staging.md`; the latest commits correspond to Tasks 1-5.
