# ShellPilot Disconnected Homepage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sparse disconnected homepage with the approved “recent connections first” workspace without changing SSH, SFTP, history, quick-connect, or AI behavior.

**Architecture:** Keep `NoSessionPanel` as the only disconnected-home entry point and preserve its public props and existing callbacks. Recompose its markup into heading, action grid, and recent-connections sections; reuse `QuickConnect` and `HistoryPanel`, and add an opt-in empty state to `HistoryPanel` so the regular sidebar remains unchanged.

**Tech Stack:** React 19, Ant Design 6, Stylus, Node test runner, Playwright Electron.

---

## File Map

- Modify `src/client/components/tabs/no-session.jsx`: approved homepage structure and existing action callbacks.
- Modify `src/client/components/tabs/no-session.styl`: theme-aware desktop layout and responsive rules.
- Modify `src/client/components/sidebar/history.jsx`: optional empty text used only by the disconnected homepage.
- Modify `src/client/common/shellpilot-i18n-overrides.js`: Chinese and English labels for the workspace and empty state.
- Create `test/unit-ci/no-session-home.spec.js`: source contract for structure, behavior preservation, and responsive styling.
- Modify `test/e2e/008.basic-terminal.spec.js`: verify the new homepage is visible before opening a local terminal.

### Task 1: Lock The Homepage Contract

**Files:**
- Create: `test/unit-ci/no-session-home.spec.js`

- [ ] **Step 1: Write the failing source-contract test**

```js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'src/client/components/tabs/no-session.jsx'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'src/client/components/tabs/no-session.styl'), 'utf8')

test('disconnected home uses the approved workspace structure', () => {
  assert.match(source, /no-session-heading/)
  assert.match(source, /no-session-actions/)
  assert.match(source, /no-session-recents/)
  assert.match(source, /<QuickConnect batch=\{batch\}/)
  assert.match(source, /<HistoryPanel sort emptyText=/)
  assert.match(source, /add-new-tab-btn/)
  assert.doesNotMatch(source, /LogoElem/)
})

test('disconnected home is theme-aware and responsive', () => {
  assert.match(styles, /var\(--main\)/)
  assert.match(styles, /var\(--text\)/)
  assert.match(styles, /grid-template-columns repeat\(4/)
  assert.match(styles, /@media \(max-width: 900px\)/)
  assert.match(styles, /@media \(max-width: 560px\)/)
  assert.doesNotMatch(styles, /top 320px/)
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node --test test/unit-ci/no-session-home.spec.js
```

Expected: FAIL because the current component still imports `LogoElem` and does not contain the approved section classes.

- [ ] **Step 3: Commit the failing test**

```powershell
git add test/unit-ci/no-session-home.spec.js
git commit -m "test: define disconnected homepage contract"
```

### Task 2: Implement The Approved Homepage Structure

**Files:**
- Modify: `src/client/components/tabs/no-session.jsx`
- Modify: `src/client/components/sidebar/history.jsx`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Test: `test/unit-ci/no-session-home.spec.js`

- [ ] **Step 1: Replace the logo block with the workspace composition**

Use Ant Design icons `PlusOutlined`, `CodeOutlined`, `RobotOutlined`, `ThunderboltOutlined`, `HistoryOutlined`, and `DisconnectOutlined`. Preserve these exact behaviors:

```jsx
onNewSsh()
onNewTab()
window.store.onNewSshAI()
<QuickConnect batch={batch} />
<HistoryPanel sort emptyText={e('shellpilotHomeNoRecentConnections')} />
```

Keep `.no-sessions` on the root and `.add-new-tab-btn` on the local-terminal action.

- [ ] **Step 2: Add an opt-in empty state to `HistoryPanel`**

Render the existing rows unchanged. When `arr.length === 0` and `props.emptyText` exists, render:

```jsx
<div className='history-empty'>
  {props.emptyText}
</div>
```

Do not show this empty state in the normal history sidebar unless the caller supplies `emptyText`.

- [ ] **Step 3: Add localized homepage labels**

Add these keys to both the Chinese and English ShellPilot override objects:

```js
shellpilotHomeWorkspace: '连接工作台',
shellpilotHomeRecentConnections: '最近连接',
shellpilotHomeNoRecentConnections: '暂无最近连接',
shellpilotHomeNewConnectionHint: 'SSH、RDP、VNC',
shellpilotHomeLocalTerminalHint: 'PowerShell、CMD',
shellpilotHomeAiConnectionHint: '智能生成配置',
shellpilotHomeQuickConnectHint: '地址直连'
```

English values:

```js
shellpilotHomeWorkspace: 'Connection Workspace',
shellpilotHomeRecentConnections: 'Recent Connections',
shellpilotHomeNoRecentConnections: 'No recent connections',
shellpilotHomeNewConnectionHint: 'SSH, RDP, VNC',
shellpilotHomeLocalTerminalHint: 'PowerShell, CMD',
shellpilotHomeAiConnectionHint: 'Generate configuration',
shellpilotHomeQuickConnectHint: 'Connect by address'
```

- [ ] **Step 4: Run the focused contract test**

Run:

```powershell
node --test test/unit-ci/no-session-home.spec.js
```

Expected: structure test passes; style test still fails until Task 3.

### Task 3: Build The Theme-Aware Responsive Layout

**Files:**
- Modify: `src/client/components/tabs/no-session.styl`
- Test: `test/unit-ci/no-session-home.spec.js`

- [ ] **Step 1: Replace absolute-positioned content with bounded workspace layout**

Implement:

- Root scrolling within the available terminal area.
- A centered `.no-session-shell` with `max-width: 960px`.
- Four-column `.no-session-actions`.
- A full-width bordered `.no-session-recents`.
- Theme colors from existing variables such as `--main`, `--text`, `--text-light`, `--border`, and `--primary`.
- Radius no greater than `8px`.
- No gradient, blob, fixed `top: 320px`, or fixed-width `400px` history body.

- [ ] **Step 2: Add responsive rules**

At `900px`, use two action columns and reduce outer padding. At `560px`, use one action column and stack the heading status. Ensure labels wrap without horizontal overflow.

- [ ] **Step 3: Run the focused test**

Run:

```powershell
node --test test/unit-ci/no-session-home.spec.js
```

Expected: PASS.

- [ ] **Step 4: Run lint**

Run:

```powershell
npm run lint
```

Expected: PASS with no StandardJS errors.

- [ ] **Step 5: Commit implementation**

```powershell
git add src/client/components/tabs/no-session.jsx src/client/components/tabs/no-session.styl src/client/components/sidebar/history.jsx src/client/common/shellpilot-i18n-overrides.js test/unit-ci/no-session-home.spec.js
git commit -m "feat: redesign disconnected connection workspace"
```

### Task 4: Protect Startup And Terminal Behavior

**Files:**
- Modify: `test/e2e/008.basic-terminal.spec.js`

- [ ] **Step 1: Extend the existing disconnected-home E2E assertions**

After `.no-sessions` becomes visible, assert:

```js
await expect(client.locator('.no-session-heading')).toBeVisible()
await expect(client.locator('.no-session-actions')).toBeVisible()
await expect(client.locator('.no-session-recents')).toBeVisible()
await expect(client.locator('.add-new-tab-btn')).toBeVisible()
```

Keep the existing title-bar double-click and local-terminal command flow unchanged.

- [ ] **Step 2: Run the focused E2E**

Run:

```powershell
npx playwright test test/e2e/008.basic-terminal.spec.js --workers=1
```

Expected: PASS; the app starts disconnected, then opens a working local terminal on demand.

- [ ] **Step 3: Commit the E2E protection**

```powershell
git add test/e2e/008.basic-terminal.spec.js
git commit -m "test: cover redesigned disconnected workspace"
```

### Task 5: Full Verification And Local Package

**Files:**
- No source changes expected.

- [ ] **Step 1: Run the complete unit CI suite**

Run:

```powershell
npm run test-unit-ci
```

Expected: all tests pass; existing skips remain skips.

- [ ] **Step 2: Build the renderer**

Run:

```powershell
npm run vite-build
```

Expected: Vite build succeeds without missing chunks.

- [ ] **Step 3: Run package smoke verification**

Run:

```powershell
npm run test-package-smoke
```

Expected: packaged application smoke checks pass.

- [ ] **Step 4: Inspect real layouts**

Launch the packaged app and capture the disconnected homepage at 1366×768 and 1920×1080 in both day and night themes. Confirm:

- No text overlap or horizontal clipping.
- The recent list remains above the bottom edge at 1366×768.
- The AI panel does not cover the workspace.
- The page does not show the removed logo blob or duplicate version.

- [ ] **Step 5: Record the final executable**

Report the absolute path, version, timestamp, and file size of:

```text
F:\SSH工具开发\apps\electerm-agent\dist\win-unpacked\ShellPilot.exe
```
