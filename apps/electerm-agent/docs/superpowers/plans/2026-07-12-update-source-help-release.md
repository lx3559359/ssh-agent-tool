# ShellPilot Update Source, Help, and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selectable update sources, an in-client Chinese help center, and structured release notes, then publish ShellPilot 0.3.7.

**Architecture:** Keep source ordering in the shared renderer/main update-source modules and pass the persisted preference into both release checks and electron-updater. Add a focused help modal from the existing top bar and make the release script load a versioned Markdown file.

**Tech Stack:** Electron, React, Ant Design, Node.js test runner, electron-updater, GitHub CLI, ModelScope Hub.

---

### Task 1: Update source preference

**Files:**
- Modify: `src/app/common/update-sources.js`
- Modify: `src/client/common/update-sources.js`
- Modify: `src/app/lib/native-updater.js`
- Modify: `src/client/common/update-check.js`
- Modify: `src/client/components/main/upgrade.jsx`
- Modify: `src/client/common/default-setting.js`
- Modify: `src/app/common/default-setting.js`
- Test: `test/unit-ci/update-sources.spec.js`
- Test: `test/unit-ci/update-channel-settings.spec.js`

- [ ] Write tests for `auto`, `modelscope`, and `github` source selection and run them to confirm failure.
- [ ] Add source normalization/filtering and pass the persisted preference through renderer and main update flows.
- [ ] Run the focused update tests and confirm they pass.

### Task 2: Update UI and help center

**Files:**
- Create: `src/client/components/main/help-center-modal.jsx`
- Create: `src/client/components/main/help-center-modal.styl`
- Create: `docs/USER_GUIDE_ZH.md`
- Modify: `src/client/components/main/aigshell-topbar.jsx`
- Modify: `src/client/components/main/update-center-modal.jsx`
- Modify: `src/client/components/setting-panel/setting-common.jsx`
- Test: `test/unit-ci/help-center.spec.js`
- Test: `test/unit-ci/update-center.spec.js`

- [ ] Write source-level UI tests and run them to confirm the controls and help content are missing.
- [ ] Add update-source selectors and the Chinese help modal.
- [ ] Run focused UI tests and confirm they pass.

### Task 3: Structured release notes and 0.3.7 release

**Files:**
- Create: `docs/releases/v0.3.7.md`
- Modify: `build/bin/release-github.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/unit-ci/release-notes.spec.js`

- [ ] Write tests for the three release-note sections and release-script loading, then confirm failure.
- [ ] Add the release notes loader and bump version to 0.3.7.
- [ ] Run full tests, build installer, verify assets, publish GitHub, sync ModelScope, and verify both sources.
