# ShellPilot Startup And Chat Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native-style top-bar double-click maximize/restore, open the disconnected home screen by default, and hide unfinished MCP/CLI references from the AI composer.

**Architecture:** Reuse the current Electron window IPC and `store.isMaximized`; do not add another window state. Change both main-process and renderer default settings to avoid creating an implicit local tab, while preserving explicit startup sessions. Remove only the MCP/CLI action descriptors from the AI chat render list so underlying integrations remain intact.

**Tech Stack:** Electron 41, React 19, Manate store, Node test runner, Playwright, StandardJS.

---

### Task 1: Native Title-Bar Double Click

**Files:**
- Modify: `src/client/components/main/aigshell-topbar.jsx`
- Test: `test/unit-ci/window-controls.spec.js`

- [ ] **Step 1: Write the failing title-bar test**

Extend `window-controls.spec.js` to require:

```js
assert.match(topbarSource, /onDoubleClick=\{handleTitleBarDoubleClick\}/)
assert.match(topbarSource, /closest\(['"]button,\s*a,\s*input,\s*textarea,\s*select/)
assert.match(topbarSource, /runGlobalAsync\('maximize'\)/)
assert.match(topbarSource, /runGlobalAsync\('unmaximize'\)/)
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test test/unit-ci/window-controls.spec.js
```

Expected: the new top-bar behavior test fails because the handler is absent.

- [ ] **Step 3: Implement the smallest safe handler**

Add a handler to `AIGShellTopBar` that ignores interactive/no-drag descendants and toggles the existing window state:

```jsx
function handleTitleBarDoubleClick (event) {
  if (event.target.closest('button, a, input, textarea, select, [role="button"], .window-controls')) return
  if (store.isMaximized) {
    window.pre.runGlobalAsync('unmaximize')
  } else {
    window.pre.runGlobalAsync('maximize')
  }
}
```

Bind it only to `.aigshell-topbar`.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
node --test test/unit-ci/window-controls.spec.js
```

Expected: all window-control tests pass.

### Task 2: Disconnected Home By Default

**Files:**
- Modify: `src/app/common/default-setting.js`
- Modify: `src/client/common/default-setting.js`
- Test: `test/unit-ci/startup-home-default.spec.js`

- [ ] **Step 1: Write the failing startup-default test**

Create a source contract test that imports or reads both default-setting modules and asserts:

```js
assert.match(mainDefaults, /initDefaultTabOnStart:\s*false/)
assert.match(rendererDefaults, /initDefaultTabOnStart:\s*false/)
```

Also assert that `load-data.js` still checks `onStartSessions` before the default-tab branch, preserving explicit startup sessions.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test test/unit-ci/startup-home-default.spec.js
```

Expected: both default values are still `true`.

- [ ] **Step 3: Change only the defaults**

Set `initDefaultTabOnStart: false` in both default-setting files. Do not remove the setting and do not change `openInitSessions`; explicit workspaces, startup bookmarks and users who opt in remain supported.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
node --test test/unit-ci/startup-home-default.spec.js
```

Expected: the startup contract passes.

### Task 3: Hide MCP And CLI Composer Actions

**Files:**
- Modify: `src/client/components/ai/ai-chat.jsx`
- Test: `test/unit-ci/ai-chat-context-actions.spec.js`

- [ ] **Step 1: Write the failing visibility test**

Read `ai-chat.jsx`, isolate the `renderContextActions` item array, and assert terminal, selection, file and command keys remain while `mcp` and `cli` keys are absent.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test test/unit-ci/ai-chat-context-actions.spec.js
```

Expected: the test fails because MCP and CLI descriptors are visible.

- [ ] **Step 3: Remove only the visible descriptors**

Delete the two action descriptors:

```js
{ key: 'mcp', ... }
{ key: 'cli', ... }
```

Keep handler functions, configuration modules, Agent tools and persisted data unchanged.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
node --test test/unit-ci/ai-chat-context-actions.spec.js
```

Expected: context action tests pass.

### Task 4: Regression And Local Package Verification

**Files:**
- Verify all files changed by Tasks 1-3.

- [ ] **Step 1: Run focused unit tests**

```powershell
node --test test/unit-ci/window-controls.spec.js test/unit-ci/startup-home-default.spec.js test/unit-ci/ai-chat-context-actions.spec.js
```

Expected: zero failures.

- [ ] **Step 2: Run focused E2E**

```powershell
npx playwright test test/e2e/008.basic-terminal.spec.js test/e2e/026.ai-takeover.spec.js --workers=1
```

Expected: manually created local terminal and AI takeover remain functional.

- [ ] **Step 3: Run full unit and static checks**

```powershell
npm run test-unit-ci
npx standard src/client/components/main/aigshell-topbar.jsx src/app/common/default-setting.js src/client/common/default-setting.js src/client/components/ai/ai-chat.jsx test/unit-ci/window-controls.spec.js test/unit-ci/startup-home-default.spec.js test/unit-ci/ai-chat-context-actions.spec.js
git diff --check
```

Expected: zero failures and zero lint errors.

- [ ] **Step 4: Compile and package locally**

```powershell
npm run compile
npm run prepare-file
npx electron-builder --win --x64 --dir
npm run test-package-smoke
```

Expected: `dist/win-unpacked/ShellPilot.exe` exists and package smoke passes.

- [ ] **Step 5: Commit verified implementation**

```powershell
git add src/client/components/main/aigshell-topbar.jsx src/app/common/default-setting.js src/client/common/default-setting.js src/client/components/ai/ai-chat.jsx test/unit-ci/window-controls.spec.js test/unit-ci/startup-home-default.spec.js test/unit-ci/ai-chat-context-actions.spec.js
git commit -m "feat: simplify startup and AI composer"
```
