# SFTP Transfer Progress and Editor Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SFTP upload/download progress visible inside the file manager and eliminate false `Permission denied` failures caused by redundant ownership writes while preserving strict transaction safety.

**Architecture:** Add pure progress aggregation and permission-error presentation modules, render a small observable progress dock inside the existing SFTP workspace, and reuse the existing per-transfer controls for details. Keep the SFTP transaction model fail-closed, but compare actual metadata before invoking `chown` or `chmod`; real ownership mismatches still require successful metadata preservation.

**Tech Stack:** Electron 41, React 19, Manate, Ant Design 6, Node.js 22 test runner, Stylus, existing SSH2/SFTP transport and safety transaction framework.

---

## File map

- Create `src/client/components/sftp/sftp-transfer-progress-model.js`: tab-scoped progress normalization, aggregation, active-item selection, and publish-gate decisions.
- Create `src/client/components/sftp/sftp-transfer-progress-dock.jsx`: observable compact/expanded SFTP progress UI.
- Create `src/client/components/sftp/sftp-editor-permission-error.js`: stage markers and identity-aware permission messages.
- Modify `src/client/components/sftp/sftp-entry.jsx`: mount the progress dock once per active SFTP workspace and normalize editor-save failures.
- Modify `src/client/components/sftp/sftp.styl`: dock placement, responsive layout, and state styling.
- Modify `src/client/components/file-transfer/transfer.jsx`: expose numeric bytes-per-second alongside the existing formatted speed.
- Modify `src/client/components/sidebar/transport-ui.jsx`: accept a compact rendering context without duplicating progress semantics.
- Modify `src/app/server/session-sftp.js`: skip no-op `chown`/`chmod`, then strictly re-read and verify metadata.
- Modify `src/client/components/sftp/sftp-transaction-adapter.js`: apply the same conditional metadata rule to editor staging and tag save phases.
- Modify `src/client/components/sftp/file-item.jsx`: keep editor state on failure and display normalized errors.
- Test `test/unit-ci/sftp-transfer-progress-dock.spec.js`: pure model and UI contract.
- Test `test/unit-ci/sftp-editor-permission.spec.js`: permission classification, stage labels, and editor state contract.
- Modify `test/unit-ci/session-sftp.spec.js`: no-op and mismatched metadata behavior.
- Modify `test/unit-ci/sftp-safety-transaction.spec.js`: editor staging metadata and fail-closed regression.
- Modify `test/unit-ci/transfer-progress-ui.spec.js`: dock mounting, accessible controls, and reuse contract.
- Modify `test/e2e/027.quality-core-flows.spec.js`: local-only upload/download progress visibility.

### Task 1: Conditional metadata preservation in the SFTP server

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/session-sftp.spec.js`
- Modify: `apps/electerm-agent/src/app/server/session-sftp.js`

- [ ] **Step 1: Write failing tests for no-op and required metadata changes**

Add focused cases inside `session-sftp transport flows`:

```js
test('applySftpCopyMetadata skips no-op ownership and mode writes', async () => {
  const sftp = Object.create(Sftp.prototype)
  let chownCalls = 0
  let chmodCalls = 0
  sftp.lstat = async () => ({ uid: 1000, gid: 1000, mode: 0o100640 })
  sftp.chown = async () => { chownCalls += 1; throw new Error('Permission denied') }
  sftp.chmod = async () => { chmodCalls += 1; throw new Error('Permission denied') }

  await sftp.applySftpCopyMetadata('/snapshot.txt', {
    uid: 1000,
    gid: 1000,
    mode: 0o100640
  }, true)

  assert.equal(chownCalls, 0)
  assert.equal(chmodCalls, 0)
})

test('applySftpCopyMetadata still requires mismatched ownership', async () => {
  const sftp = Object.create(Sftp.prototype)
  sftp.lstat = async () => ({ uid: 1000, gid: 1000, mode: 0o100640 })
  sftp.chown = async () => { throw new Error('Permission denied') }
  sftp.chmod = async () => 1

  await assert.rejects(
    sftp.applySftpCopyMetadata('/snapshot.txt', {
      uid: 0,
      gid: 0,
      mode: 0o100640
    }, true),
    /Permission denied/
  )
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="applySftpCopyMetadata" test/unit-ci/session-sftp.spec.js
```

Expected: the no-op case fails because `applySftpCopyMetadata` calls `chown` and `chmod` unconditionally.

- [ ] **Step 3: Implement conditional writes with strict final verification**

Update `applySftpCopyMetadata` to compare actual metadata first:

```js
async applySftpCopyMetadata (path, stat, preserveOwnership, signal) {
  throwIfSftpOperationAborted(signal)
  const expectedMode = Number(stat.mode) & 0o7777
  let current = await this.lstat(path)
  throwIfSftpOperationAborted(signal)
  if (preserveOwnership) {
    const expected = requiredSftpOwnership(stat)
    const actual = requiredSftpOwnership(current)
    if (actual.uid !== expected.uid || actual.gid !== expected.gid) {
      await this.chown(path, expected.uid, expected.gid)
      throwIfSftpOperationAborted(signal)
      current = await this.lstat(path)
      throwIfSftpOperationAborted(signal)
    }
  }
  if ((Number(current.mode) & 0o7777) !== expectedMode) {
    await this.chmod(path, expectedMode)
    throwIfSftpOperationAborted(signal)
  }
  const copied = await this.lstat(path)
  throwIfSftpOperationAborted(signal)
  const ownershipMatches = !preserveOwnership || (() => {
    const expected = requiredSftpOwnership(stat)
    const actual = requiredSftpOwnership(copied)
    return actual.uid === expected.uid && actual.gid === expected.gid
  })()
  if (!ownershipMatches || (Number(copied.mode) & 0o7777) !== expectedMode) {
    throw new Error('SFTP 复制后的 ownership 或 mode 校验失败。')
  }
}
```

- [ ] **Step 4: Run the SFTP server test file and verify GREEN**

Run:

```powershell
node --test test/unit-ci/session-sftp.spec.js
```

Expected: all session SFTP tests pass, including large binary transfer and copy safety.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- src/app/server/session-sftp.js test/unit-ci/session-sftp.spec.js
git commit -m "fix(sftp): skip redundant metadata writes"
```

### Task 2: Editor staging metadata and permission diagnostics

**Files:**
- Create: `apps/electerm-agent/src/client/components/sftp/sftp-editor-permission-error.js`
- Create: `apps/electerm-agent/test/unit-ci/sftp-editor-permission.spec.js`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-transaction-adapter.js`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx`
- Modify: `apps/electerm-agent/src/client/components/sftp/file-item.jsx`
- Modify: `apps/electerm-agent/test/unit-ci/sftp-safety-transaction.spec.js`

- [ ] **Step 1: Write failing permission-message and transaction tests**

Create tests that require stable phase markers and different guidance for root/non-root identities:

```js
test('formats non-root SFTP permission errors without claiming terminal sudo applies', async () => {
  const { formatSftpEditorSaveError, markSftpEditorStage } = await import(moduleUrl)
  const error = markSftpEditorStage('metadata', new Error('Permission denied'))
  const result = formatSftpEditorSaveError(error, {
    path: '/srv/app/config.ini',
    username: 'deploy'
  })
  assert.match(result.message, /deploy/)
  assert.match(result.message, /属主|元数据/)
  assert.match(result.message, /su|sudo/)
  assert.doesNotMatch(result.message, /\.shellpilot-transactions/)
})

test('formats root SFTP permission errors with server-side restriction guidance', async () => {
  const { formatSftpEditorSaveError } = await import(moduleUrl)
  const result = formatSftpEditorSaveError(new Error('Permission denied'), {
    path: '/etc/app.conf',
    username: 'root'
  })
  assert.match(result.message, /只读|ACL|immutable|SFTP/)
  assert.doesNotMatch(result.message, /重新以 root/)
})
```

Add transaction behavior cases using the existing fake SFTP:

```js
test('editor staging skips chown when the written file already has expected ownership', async () => {
  const sftp = createFakeSftp({
    '/srv/app/config.txt': {
      type: 'file', content: 'old', mode: 0o640, uid: 1000, gid: 1000
    }
  })
  const operation = await buildSftpOperation({
    id: 'editor-noop-ownership',
    action: 'editor-save',
    paths: { target: '/srv/app/config.txt' },
    type: 'file',
    requestedMode: 0o640,
    expected: await digestSftpText('new')
  })
  const adapter = createSftpTransactionAdapter({ getSftp: () => sftp })
  Object.assign(operation, await adapter.prepare(operation))
  let chownCalls = 0
  sftp.chown = async () => {
    chownCalls += 1
    throw new Error('Permission denied')
  }
  await adapter.beforeExecute(operation, { input: { text: 'new' } })
  assert.equal(chownCalls, 0)
  assert.equal(sftp.text('/srv/app/config.txt'), 'new')
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test test/unit-ci/sftp-editor-permission.spec.js test/unit-ci/sftp-safety-transaction.spec.js
```

Expected: the new module is missing and editor staging still invokes `chown` unconditionally.

- [ ] **Step 3: Implement stage tagging and safe user messages**

Create `sftp-editor-permission-error.js` with a machine-readable marker that survives transaction error sanitization:

```js
const marker = 'SFTP_EDITOR_STAGE:'
const stageLabels = Object.freeze({
  transaction: '创建安全事务',
  snapshot: '创建或验证快照',
  staging: '写入暂存文件',
  metadata: '保留文件属主和权限',
  replace: '原子替换目标文件'
})

export function markSftpEditorStage (stage, error) {
  const cause = error instanceof Error ? error : new Error(String(error || ''))
  if (String(cause.message).startsWith(marker)) return cause
  const tagged = new Error(`${marker}${stage}:${cause.message}`)
  tagged.cause = cause
  return tagged
}

export function formatSftpEditorSaveError (error, { path, username } = {}) {
  const raw = String(error?.message || error || '')
  const match = raw.match(/^SFTP_EDITOR_STAGE:([a-z-]+):(.*)$/s)
  const stage = stageLabels[match?.[1]] || '保存远程文件'
  const detail = (match?.[2] || raw).trim()
  if (!/permission denied|eacces|eperm/i.test(detail)) return error
  const identity = String(username || 'unknown')
  const guidance = identity === 'root'
    ? '请检查只读文件系统、ACL、immutable 属性、chroot 或 SFTP 服务端限制。'
    : '终端中的 su/sudo 不会改变 SFTP 身份；请使用具备目标目录写入和属主保留权限的账号重新连接。'
  return new Error(`SFTP 保存权限不足（身份：${identity}，阶段：${stage}，文件：${path}）。${guidance}`)
}
```

- [ ] **Step 4: Apply conditional metadata to editor staging**

In `sftp-transaction-adapter.js`, read `executionPath` metadata after writing. Call `chown` only when uid/gid differ and `chmod` only when mode differs. Wrap staging, metadata, and replacement operations with `markSftpEditorStage`; preserve the existing final `describeEntry` verification and original-state check.

The required comparison is:

```js
let stagedStat = await sftp.lstat(resource.executionPath)
if (resource.original.absent !== true &&
  (Number(stagedStat.uid) !== Number(resource.original.uid) ||
   Number(stagedStat.gid) !== Number(resource.original.gid))) {
  await runProtectedMutation(context, () => sftp.chown(
    resource.executionPath,
    resource.original.uid,
    resource.original.gid
  ))
  stagedStat = await sftp.lstat(resource.executionPath)
}
if (mode !== undefined && (Number(stagedStat.mode) & 0o7777) !== mode) {
  await runProtectedMutation(
    context,
    () => sftp.chmod(resource.executionPath, mode)
  )
}
```

- [ ] **Step 5: Preserve editor state and show the normalized error**

Wrap `saveRemoteEditorFile` so permission failures are formatted with `this.props.tab.username`. In `file-item.jsx`, replace `.catch(window.store.onError)` with an explicit `try/catch`; report the error, return `false`, and only clear `id`, `file`, and `text` when the save result is truthy. Keep the existing `loading: false` update for both paths.

- [ ] **Step 6: Run focused permission tests and verify GREEN**

Run:

```powershell
node --test test/unit-ci/sftp-editor-permission.spec.js test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/agent-sftp-write-text.spec.js
```

Expected: all permission, transaction, and Agent editor routing tests pass.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- src/client/components/sftp/sftp-editor-permission-error.js src/client/components/sftp/sftp-transaction-adapter.js src/client/components/sftp/sftp-entry.jsx src/client/components/sftp/file-item.jsx test/unit-ci/sftp-editor-permission.spec.js test/unit-ci/sftp-safety-transaction.spec.js
git commit -m "fix(sftp): explain and avoid false editor permission failures"
```

### Task 3: Tab-scoped transfer progress model

**Files:**
- Create: `apps/electerm-agent/src/client/components/sftp/sftp-transfer-progress-model.js`
- Create: `apps/electerm-agent/test/unit-ci/sftp-transfer-progress-dock.spec.js`
- Modify: `apps/electerm-agent/src/client/components/file-transfer/transfer.jsx`

- [ ] **Step 1: Write failing aggregation and publish-gate tests**

Cover known totals, unknown totals, tab isolation, clamping, retry rollback, current-task priority, and terminal-state immediate publication:

```js
test('aggregates only the current tab by bytes', async () => {
  const { buildSftpTransferProgress } = await import(modelUrl)
  const result = buildSftpTransferProgress([
    { id: 'a', tabId: 'tab-a', status: 'running', transferred: 40, total: 100, speedBytesPerSecond: 10 },
    { id: 'b', tabId: 'tab-a', status: 'paused', transferred: 50, total: 100, speedBytesPerSecond: 0 },
    { id: 'c', tabId: 'tab-b', status: 'running', transferred: 100, total: 100, speedBytesPerSecond: 99 }
  ], 'tab-a')
  assert.equal(result.transferred, 90)
  assert.equal(result.total, 200)
  assert.equal(result.percent, 45)
  assert.equal(result.speedBytesPerSecond, 10)
  assert.equal(result.count, 2)
  assert.equal(result.current.id, 'a')
})

test('marks progress indeterminate when an active transfer has no total', async () => {
  const { buildSftpTransferProgress } = await import(modelUrl)
  const result = buildSftpTransferProgress([
    { id: 'folder', tabId: 'tab-a', status: 'running', transferred: 12, total: 0 }
  ], 'tab-a')
  assert.equal(result.determinate, false)
  assert.equal(result.percent, null)
})

test('publishes terminal state immediately and throttles byte-only updates', async () => {
  const { shouldPublishSftpProgress } = await import(modelUrl)
  assert.equal(shouldPublishSftpProgress({ previousStatus: 'running', nextStatus: 'running', elapsedMs: 50 }), false)
  assert.equal(shouldPublishSftpProgress({ previousStatus: 'running', nextStatus: 'failed', elapsedMs: 5 }), true)
  assert.equal(shouldPublishSftpProgress({ previousStatus: 'running', nextStatus: 'running', elapsedMs: 100 }), true)
})
```

- [ ] **Step 2: Run the model test and verify RED**

Run:

```powershell
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: import fails because the model does not exist.

- [ ] **Step 3: Implement the pure progress model**

Export `buildSftpTransferProgress(transfers, tabId)` and `shouldPublishSftpProgress(input)`. Normalize totals from `transfer.total` then `transfer.fromFile.size`; clamp transferred bytes to `[0, total]` for determinate files; sum numeric `speedBytesPerSecond`; return `null` percent if any active task has unknown total. Treat `queued`, `running`, `pausing`, `paused`, `resuming`, and `interrupted` as visible states, and prioritize `running` as the current item.

- [ ] **Step 4: Expose numeric speed from file and folder transfers**

In both `onData` and `onFolderData`, compute elapsed seconds once and include:

```js
up.speedBytesPerSecond = transferredValue / elapsedSeconds
```

For folders use `this.transferred` in place of `transferredValue`. Preserve the existing formatted `up.speed` string and task adapter values.

- [ ] **Step 5: Run model and transfer regressions and verify GREEN**

Run:

```powershell
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js test/unit-ci/transfer-progress.spec.js test/unit-ci/transfer-task-adapter.spec.js
```

Expected: all aggregation and transfer event tests pass.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- src/client/components/sftp/sftp-transfer-progress-model.js src/client/components/file-transfer/transfer.jsx test/unit-ci/sftp-transfer-progress-dock.spec.js
git commit -m "feat(sftp): model visible transfer progress"
```

### Task 4: Compact SFTP progress dock

**Files:**
- Create: `apps/electerm-agent/src/client/components/sftp/sftp-transfer-progress-dock.jsx`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-entry.jsx`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp.styl`
- Modify: `apps/electerm-agent/src/client/components/sidebar/transport-ui.jsx`
- Modify: `apps/electerm-agent/test/unit-ci/transfer-progress-ui.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/sftp-transfer-progress-dock.spec.js`

- [ ] **Step 1: Write failing UI contract tests**

Require the SFTP workspace to mount the dock and the dock to expose progress and expansion semantics:

```js
test('SFTP workspace mounts an accessible tab-scoped progress dock', () => {
  const entry = fs.readFileSync(sftpEntryPath, 'utf8')
  const dock = fs.readFileSync(dockPath, 'utf8')
  assert.match(entry, /SftpTransferProgressDock/)
  assert.match(entry, /tabId=\{this\.props\.tab\.id\}/)
  assert.match(dock, /buildSftpTransferProgress/)
  assert.match(dock, /aria-expanded/)
  assert.match(dock, /role='progressbar'/)
  assert.match(dock, /100/)
})
```

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```powershell
node --test test/unit-ci/transfer-progress-ui.spec.js test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: dock source and mounting assertions fail.

- [ ] **Step 3: Implement the observable dock**

Create a Manate `auto` component that reads `window.store.fileTransfers`, builds the current tab summary, and returns `null` when count is zero. The compact row must contain a native accessible progress element, summary text, and a button with `aria-expanded`. Use the existing `Transporter` component for expanded rows with a `compact` prop so pause/resume/cancel behavior remains single-sourced.

Known totals render:

```jsx
<div
  className='sftp-transfer-dock-progress'
  role='progressbar'
  aria-label={e('shellpilotSftpTransferProgress')}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={summary.percent}
>
  <span style={{ width: `${summary.percent}%` }} />
</div>
```

Unknown totals omit `aria-valuenow` and add `sftp-transfer-dock-progress-indeterminate`.

- [ ] **Step 4: Mount and style the dock**

Import the component in `sftp-entry.jsx` and render it after `renderSections()`:

```jsx
<SftpTransferProgressDock
  tabId={this.props.tab.id}
  username={this.props.tab.username}
/>
```

Reserve dock space only while visible. Style it absolute at the bottom of `.sftp-wrap`, above file content, with a bounded expanded height, responsive text truncation, theme tokens, clear failure/paused colors, and keyboard-visible focus. Do not change the global right-click transfer center.

- [ ] **Step 5: Implement the 100ms visual publish gate**

Keep the latest summary in a ref and publish byte-only changes at most every 100ms. Status transitions and first appearance publish synchronously using `shouldPublishSftpProgress`; clear pending timers on unmount. Add a fake-clock model test that verifies one scheduled publish for multiple updates inside the interval.

- [ ] **Step 6: Run UI, accessibility, and responsive tests**

Run:

```powershell
node --test test/unit-ci/transfer-progress-ui.spec.js test/unit-ci/sftp-transfer-progress-dock.spec.js test/unit-ci/ui-accessibility-contract.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- src/client/components/sftp/sftp-transfer-progress-dock.jsx src/client/components/sftp/sftp-entry.jsx src/client/components/sftp/sftp.styl src/client/components/sidebar/transport-ui.jsx test/unit-ci/transfer-progress-ui.spec.js test/unit-ci/sftp-transfer-progress-dock.spec.js
git commit -m "feat(sftp): show transfers in file manager"
```

### Task 5: Local-only integration and regression coverage

**Files:**
- Modify: `apps/electerm-agent/test/e2e/027.quality-core-flows.spec.js`
- Modify: `apps/electerm-agent/test/e2e/common/local-ssh-server.js` only if the existing fixture cannot delay transfer chunks deterministically.

- [ ] **Step 1: Add a failing local integration assertion for upload and download**

Extend the existing local SSH/SFTP quality flow. During a large upload and download, poll `.sftp-transfer-progress-dock` for visibility, assert the accessible progress value increases or the indeterminate state is active, expand details, and verify the direction/file name. Continue using `127.0.0.1` and the temporary fixture only.

The core assertion shape is:

```js
await expect(page.locator('.sftp-transfer-progress-dock')).toBeVisible()
const bar = page.locator('.sftp-transfer-dock-progress')
await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow') || 0))
  .toBeGreaterThan(0)
await page.locator('.sftp-transfer-dock-toggle').click()
await expect(page.locator('.sftp-transfer-dock-details .sftp-transport')).toBeVisible()
```

- [ ] **Step 2: Run the local E2E test and verify RED**

Run:

```powershell
npx playwright test test/e2e/027.quality-core-flows.spec.js --workers=1
```

Expected: the new dock selector is absent before Task 4 or the progress lifecycle assertion exposes an integration gap.

- [ ] **Step 3: Make only the minimal integration adjustment**

If transfers complete before observation, add an optional `sftpChunkDelayMs` to `startLocalSshServer` and delay only SFTP `READ`/`WRITE` replies in the local fixture. Default the option to zero so existing tests remain unchanged. Do not add external hosts, credentials, or network access.

- [ ] **Step 4: Run local integration and focused unit regression**

Run:

```powershell
npx playwright test test/e2e/027.quality-core-flows.spec.js --workers=1
node --test test/unit-ci/session-sftp.spec.js test/unit-ci/sftp-editor-permission.spec.js test/unit-ci/sftp-safety-transaction.spec.js test/unit-ci/sftp-transfer-progress-dock.spec.js test/unit-ci/transfer-progress.spec.js test/unit-ci/transfer-progress-ui.spec.js
```

Expected: local E2E and all focused unit tests pass without any external server configuration.

- [ ] **Step 5: Commit Task 5**

```powershell
git add -- test/e2e/027.quality-core-flows.spec.js test/e2e/common/local-ssh-server.js
git commit -m "test(sftp): cover visible local transfer progress"
```

### Task 6: Full verification and documentation closure

**Files:**
- Modify: `apps/electerm-agent/docs/USER_GUIDE_ZH.md`

- [ ] **Step 1: Update user guidance**

Document that the bottom progress dock appears automatically, the global transfer center remains available, and terminal `su/sudo` does not alter SFTP identity. State that ShellPilot never guesses a sudo password and real root-owned files require an appropriately authenticated SFTP account or server-side permission change.

- [ ] **Step 2: Run formatting and source checks**

Run:

```powershell
npx standard src/client/components/sftp/sftp-transfer-progress-model.js src/client/components/sftp/sftp-transfer-progress-dock.jsx src/client/components/sftp/sftp-editor-permission-error.js src/client/components/sftp/sftp-entry.jsx src/client/components/sftp/file-item.jsx src/client/components/sftp/sftp-transaction-adapter.js src/client/components/file-transfer/transfer.jsx src/client/components/sidebar/transport-ui.jsx src/app/server/session-sftp.js test/unit-ci/sftp-transfer-progress-dock.spec.js test/unit-ci/sftp-editor-permission.spec.js
git diff --check
```

Expected: Standard reports no errors and `git diff --check` is silent.

- [ ] **Step 3: Run the complete unit suite**

Run:

```powershell
npm run test-unit-ci
```

Expected: all unit-ci tests pass.

- [ ] **Step 4: Run local SFTP and client performance verification**

Run:

```powershell
npx playwright test test/e2e/027.quality-core-flows.spec.js test/e2e/038.client-interaction-performance.spec.js --workers=1
```

Expected: both local SFTP quality and client interaction performance tests pass within their existing budgets.

- [ ] **Step 5: Inspect the final diff and commit documentation**

Run:

```powershell
git status --short
git diff --stat HEAD~4..HEAD
git diff --check HEAD~4..HEAD
```

Verify that no user-owned primary-worktree files, credentials, screenshots, build artifacts, or external-server configuration are included.

```powershell
git add -- docs/USER_GUIDE_ZH.md
git commit -m "docs: explain SFTP progress and permission identity"
```

- [ ] **Step 6: Perform final review**

Invoke `requesting-code-review`, fix every confirmed issue with a failing regression test, then invoke `verification-before-completion` and rerun the exact affected checks before reporting completion.
