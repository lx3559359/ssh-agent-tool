# SFTP Visible Transfer Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing SFTP upload/download progress dock visibly prominent and show the current transfer direction without changing transfer behavior.

**Architecture:** Keep the existing tab-scoped aggregation and throttled publish gate. Add a pure direction classifier to the progress model, render its localized label in the dock summary, and strengthen only the dock's active visual contract in Stylus. Continue reusing `Transporter` for expanded task controls.

**Tech Stack:** React 19, Manate, Stylus, Node.js built-in test runner, StandardJS, Playwright/Electron quality E2E.

---

## File map

- Modify `apps/electerm-agent/src/client/components/sftp/sftp-transfer-progress-model.js`: classify the current task as upload, download, or generic transfer.
- Modify `apps/electerm-agent/src/client/components/sftp/sftp-transfer-progress-dock.jsx`: render the localized direction label in the summary row.
- Modify `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`: provide Chinese and English direction labels.
- Modify `apps/electerm-agent/src/client/components/sftp/sftp.styl`: increase dock and progress-bar prominence and style active states.
- Modify `apps/electerm-agent/test/unit-ci/sftp-transfer-progress-dock.spec.js`: cover direction behavior, rendering contracts, and visual contracts.

### Task 1: Add a transfer-direction label to the dock summary

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/sftp-transfer-progress-dock.spec.js`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-transfer-progress-model.js`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp-transfer-progress-dock.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`

- [ ] **Step 1: Write the failing direction-classification test**

Add this test after the current aggregation tests in `sftp-transfer-progress-dock.spec.js`:

```js
test('SFTP progress classifies upload and download direction', async () => {
  const { getSftpTransferDirection } = await importModel()

  assert.equal(getSftpTransferDirection({
    typeFrom: 'local',
    typeTo: 'remote'
  }), 'upload')
  assert.equal(getSftpTransferDirection({
    typeFrom: 'remote',
    typeTo: 'local'
  }), 'download')
  assert.equal(getSftpTransferDirection({
    typeFrom: 'remote',
    typeTo: 'remote'
  }), 'transfer')
  assert.equal(getSftpTransferDirection(), 'transfer')
})
```

Extend the existing `SFTP workspace mounts an accessible tab-scoped progress dock` test with these source contracts:

```js
  const i18n = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/common/shellpilot-i18n-overrides.js'
  ), 'utf8')

  assert.match(dock, /getSftpTransferDirection/)
  assert.match(dock, /sftp-transfer-dock-direction/)
  assert.match(i18n, /shellpilotSftpTransferUploading/)
  assert.match(i18n, /shellpilotSftpTransferDownloading/)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
cd F:\SSH工具开发\apps\electerm-agent
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: FAIL because `getSftpTransferDirection` is not exported and the dock source does not contain `sftp-transfer-dock-direction`.

- [ ] **Step 3: Implement the pure direction classifier**

Add this export before `buildSftpTransferProgress` in `sftp-transfer-progress-model.js`:

```js
export function getSftpTransferDirection (current = {}) {
  if (current.typeFrom === 'local' && current.typeTo === 'remote') {
    return 'upload'
  }
  if (current.typeFrom === 'remote' && current.typeTo === 'local') {
    return 'download'
  }
  return 'transfer'
}
```

- [ ] **Step 4: Render a localized direction label**

Extend the model import in `sftp-transfer-progress-dock.jsx`:

```js
import {
  buildSftpTransferProgress,
  createSftpProgressPublishGate,
  getSftpTransferDirection
} from './sftp-transfer-progress-model.js'
```

Add this mapping below `const e = window.translate`:

```js
const directionTranslationKeys = {
  upload: 'shellpilotSftpTransferUploading',
  download: 'shellpilotSftpTransferDownloading',
  transfer: 'shellpilotSftpTransferring'
}
```

After `const speedText = formatSpeed(...)`, derive the label:

```js
  const direction = getSftpTransferDirection(published.current)
  const directionText = e(directionTranslationKeys[direction])
```

Replace the standalone count span with a leading group:

```jsx
        <span className='sftp-transfer-dock-leading'>
          <span className={`sftp-transfer-dock-direction is-${direction}`}>
            {directionText}
          </span>
          <span className='sftp-transfer-dock-count'>{countText}</span>
        </span>
```

- [ ] **Step 5: Add Chinese and English labels**

In the Chinese SFTP transfer group in `shellpilot-i18n-overrides.js`, add:

```js
    shellpilotSftpTransferUploading: '上传中',
    shellpilotSftpTransferDownloading: '下载中',
    shellpilotSftpTransferring: '传输中',
```

In the matching English group, add:

```js
    shellpilotSftpTransferUploading: 'Uploading',
    shellpilotSftpTransferDownloading: 'Downloading',
    shellpilotSftpTransferring: 'Transferring',
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```powershell
cd F:\SSH工具开发\apps\electerm-agent
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: all tests in the file PASS with zero failures.

- [ ] **Step 7: Commit the direction behavior**

```powershell
git add -- src/client/components/sftp/sftp-transfer-progress-model.js src/client/components/sftp/sftp-transfer-progress-dock.jsx src/client/common/shellpilot-i18n-overrides.js test/unit-ci/sftp-transfer-progress-dock.spec.js
git commit -m "feat(sftp): label upload and download progress"
```

### Task 2: Strengthen the dock's visual prominence

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/sftp-transfer-progress-dock.spec.js`
- Modify: `apps/electerm-agent/src/client/components/sftp/sftp.styl`

- [ ] **Step 1: Write the failing visual-contract test**

Add this test to `sftp-transfer-progress-dock.spec.js`:

```js
test('SFTP transfer dock keeps an obvious active progress presentation', () => {
  const styles = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp.styl'
  ), 'utf8')

  assert.match(styles, /height calc\(100% - 64px\) !important/)
  assert.match(styles, /\.sftp-transfer-progress-dock\s+[\s\S]*?min-height 50px/)
  assert.match(styles, /\.sftp-transfer-dock-leading\s+[\s\S]*?display flex/)
  assert.match(styles, /\.sftp-transfer-dock-direction\s+[\s\S]*?background var\(--sp-primary-soft\)/)
  assert.match(styles, /\.sftp-transfer-dock-progress\s+[\s\S]*?height 8px/)
  assert.match(styles, /\.sftp-transfer-progress-dock-running,[\s\S]*?border-color var\(--sp-primary\)/)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
cd F:\SSH工具开发\apps\electerm-agent
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: FAIL because the current section reserve is `54px`, dock minimum height is `42px`, and the progress track is `5px`.

- [ ] **Step 3: Implement the prominent active style**

Update the opening progress styles in `sftp.styl` to the following values and add the new direction styles:

```stylus
.sftp-wrap
  display flex
  flex-direction row
  &:has(> .sftp-transfer-progress-dock)
    .sftp-section
      height calc(100% - 64px) !important
.sftp-transfer-progress-dock
  position absolute
  z-index 20
  left 10px
  right 10px
  bottom 8px
  min-height 50px
  color var(--sp-text)
  background-color var(--sp-surface-elevated)
  background-image var(--sp-overlay-background)
  border 1px solid var(--sp-border)
  border-radius var(--sp-radius-card)
  box-shadow inset 0 1px 0 var(--sp-highlight), var(--sp-shadow-lg)
  overflow hidden
.sftp-transfer-dock-summary
  display grid
  grid-template-columns auto minmax(80px, 1fr) auto auto
  align-items center
  gap 10px
  min-height 40px
  padding 5px 10px
.sftp-transfer-dock-leading
  display flex
  align-items center
  gap 7px
  min-width 0
.sftp-transfer-dock-direction
  padding 2px 7px
  color var(--sp-primary)
  background var(--sp-primary-soft)
  border-radius var(--sp-radius-control)
  font-weight 650
  white-space nowrap
```

Change the existing progress track height:

```stylus
.sftp-transfer-dock-progress
  position relative
  height 8px
  background var(--sp-surface-soft)
  overflow hidden
```

Add active-state emphasis immediately before the paused/interrupted rules:

```stylus
.sftp-transfer-progress-dock-running,
.sftp-transfer-progress-dock-resuming,
.sftp-transfer-progress-dock-pausing,
.sftp-transfer-progress-dock-queued
  border-color var(--sp-primary)
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
cd F:\SSH工具开发\apps\electerm-agent
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: all tests in the file PASS with zero failures.

- [ ] **Step 5: Commit the visual emphasis**

```powershell
git add -- src/client/components/sftp/sftp.styl test/unit-ci/sftp-transfer-progress-dock.spec.js
git commit -m "style(sftp): emphasize transfer progress dock"
```

### Task 3: Run regression verification

**Files:**
- Verify only; no planned production changes.

- [ ] **Step 1: Run both progress-focused unit suites**

```powershell
cd F:\SSH工具开发\apps\electerm-agent
node --test test/unit-ci/sftp-transfer-progress-dock.spec.js test/unit-ci/transfer-progress-ui.spec.js
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run targeted StandardJS checks**

```powershell
npx standard src/client/components/sftp/sftp-transfer-progress-model.js src/client/components/sftp/sftp-transfer-progress-dock.jsx src/client/common/shellpilot-i18n-overrides.js test/unit-ci/sftp-transfer-progress-dock.spec.js
```

Expected: exit code 0 with no lint errors.

- [ ] **Step 3: Run the complete unit-CI suite**

```powershell
npm run test-unit-ci
```

Expected: exit code 0 and zero failed tests. If an unrelated pre-existing failure occurs, record the exact failing test and confirm the focused SFTP suites remain green.

- [ ] **Step 4: Build the client**

```powershell
npm run vite-build
```

Expected: exit code 0 and generated client assets without compile errors.

- [ ] **Step 5: Run the local quality E2E covering upload and download progress**

```powershell
npx playwright test test/e2e/027.quality-core-flows.spec.js --workers=1
```

Expected: the isolated Electron flow passes, including visible upload and download progress, non-zero `aria-valuenow`, expandable transfer details, and matching transferred file hashes.

- [ ] **Step 6: Review the scoped diff and repository state**

```powershell
git diff --check HEAD~2..HEAD
git status --short
```

Expected: no whitespace errors; only pre-existing user-owned working-tree changes remain unstaged.
