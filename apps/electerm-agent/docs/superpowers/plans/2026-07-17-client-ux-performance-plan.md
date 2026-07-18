# ShellPilot Client UX and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve AI conversation navigation, simplify API setup, finish Chinese localization, sanitize the crash screen, and reduce the initial renderer bundle.

**Architecture:** Preserve existing stores and configuration schemas. Add small pure helpers for unread state and error diagnostics, keep UI state local to its component, and use React lazy boundaries only around optional feature surfaces.

**Tech Stack:** React, Ant Design, Stylus, Node test runner, Vite.

---

### Task 1: AI unread navigation

**Files:**
- Modify: `src/client/components/ai/ai-chat-scroll.js`
- Modify: `src/client/components/ai/ai-chat-history.jsx`
- Modify: `src/client/components/ai/ai.styl`
- Test: `test/unit-ci/ai-conversation-safety.spec.js`

- [ ] Add failing tests for one-count-per-entry unread tracking and bottom reset.
- [ ] Implement pure unread helpers and the floating “回到最新” button.
- [ ] Run `node --test test/unit-ci/ai-conversation-safety.spec.js`.

### Task 2: Progressive API configuration

**Files:**
- Modify: `src/client/components/ai/ai-config.jsx`
- Modify: `src/client/components/ai/ai.styl`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Test: `test/unit-ci/ai-config-required.spec.js`

- [ ] Add a failing source-contract test for the four visible core controls and collapsed advanced section.
- [ ] Reorder the existing form without changing persisted field names.
- [ ] Run `node --test test/unit-ci/ai-config-required.spec.js`.

### Task 3: Remaining Chinese copy

**Files:**
- Modify: `src/client/components/quick-commands/quick-commands-form-elem.jsx`
- Modify: `src/client/components/quick-commands/quick-commands-list-form.jsx`
- Modify: `src/client/components/text-editor/simple-editor.jsx`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Test: `test/unit-ci/shellpilot-user-facing-copy.spec.js`

- [ ] Add failing assertions for Delay, Label, Templates and text search.
- [ ] Route all four strings through ShellPilot translation keys.
- [ ] Run the focused localization test.

### Task 4: Sanitized crash experience

**Files:**
- Create: `src/client/common/error-diagnostics.js`
- Modify: `src/client/components/main/error-wrapper.jsx`
- Modify: `src/client/common/error-handler.jsx`
- Test: `test/unit-ci/error-diagnostics.spec.js`

- [ ] Add failing tests for stable error IDs, path stripping and stack omission.
- [ ] Render only safe diagnostics while retaining full local logging.
- [ ] Run `node --test test/unit-ci/error-diagnostics.spec.js`.

### Task 5: Optional feature chunks

**Files:**
- Modify: `src/client/components/main/main.jsx`
- Modify: `src/client/components/main/aigshell-topbar.jsx`
- Modify: `src/client/components/side-panel-r/side-panel-r.jsx`
- Create: `src/client/components/side-panel-r/right-side-panel-ai-header.jsx`
- Test: `test/unit-ci/shellpilot-bundle-boundaries.spec.js`

- [ ] Add failing tests for lazy boundaries around AI, status, help and update modules.
- [ ] Introduce lazy imports with null/lightweight fallbacks and preserve modal state.
- [ ] Build and compare the emitted main entry size with the 1.03 MB baseline.

### Task 6: Regression gate

- [ ] Run focused tests for all five areas.
- [ ] Run `npm run test-unit-ci`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build` and record chunk sizes.
- [ ] Run `npm run test-package-smoke` and `git diff --check`.
