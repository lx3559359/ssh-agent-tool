# ShellPilot Server Status Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand, read-only server status center that discovers system health, installed services, multi-service platforms, networking, firewall/security and containers for the active SSH session.

**Architecture:** Fixed read-only probes run through the existing `runCmd` API with per-probe timeout and output bounds. Pure parsers normalize results into one snapshot, a grouping engine derives platform service groups, and a dedicated modal renders the snapshot and routes bounded reports to clipboard, downloads and AI.

**Tech Stack:** React, Ant Design, Stylus, existing Electerm terminal APIs, Node test runner, StandardJS.

---

### Task 1: Snapshot model, health rules and report formatting

**Files:**
- Create: `src/client/components/server-status/server-status-model.js`
- Create: `src/client/components/server-status/server-status-report.js`
- Test: `test/unit-ci/server-status-model.spec.js`

- [ ] **Step 1: Write failing tests for normalized snapshots and health thresholds**

Test that disk/inode 80 and 90 percent thresholds, memory available ratio, CPU-normalized load and failed service severity produce deterministic alerts and an overall worst status.

- [ ] **Step 2: Run the focused test and confirm missing module failure**

Run: `node --test test/unit-ci/server-status-model.spec.js`
Expected: FAIL because the model and report modules do not exist.

- [ ] **Step 3: Implement the snapshot model and bounded Markdown/JSON report formatters**

Expose `createServerStatusSnapshot`, `deriveServerStatusHealth`, `buildServerStatusMarkdown` and `buildServerStatusJson`. Cap service, process, port and raw-output collections before formatting.

- [ ] **Step 4: Run the focused test**

Run: `node --test test/unit-ci/server-status-model.spec.js`
Expected: PASS.

### Task 2: Read-only probe registry, runner and parsers

**Files:**
- Create: `src/client/components/server-status/server-status-probes.js`
- Create: `src/client/components/server-status/server-status-parsers.js`
- Test: `test/unit-ci/server-status-probes.spec.js`

- [ ] **Step 1: Write failing tests for probe safety and representative Linux outputs**

Assert every registered command is fixed and read-only, each probe has timeout/output limits, and parsers handle Ubuntu/Debian and CentOS/Rocky samples plus missing-command and permission-denied output.

- [ ] **Step 2: Run the focused test and confirm missing module failure**

Run: `node --test test/unit-ci/server-status-probes.spec.js`
Expected: FAIL because probe modules do not exist.

- [ ] **Step 3: Implement probe definitions, bounded concurrency and result classification**

Expose `serverStatusProbes`, `runServerStatusProbes` and parser functions. Use at most three concurrent `runCmd` calls, a client-side timeout, fixed commands, and output truncation. Return structured `success`, `unsupported`, `permission`, `timeout` or `error` results without failing the whole scan.

- [ ] **Step 4: Run focused tests and StandardJS**

Run: `node --test test/unit-ci/server-status-probes.spec.js && npx standard src/client/components/server-status/*.js`
Expected: PASS.

### Task 3: Platform and service-group discovery

**Files:**
- Create: `src/client/components/server-status/server-status-platforms.js`
- Test: `test/unit-ci/server-status-platforms.spec.js`

- [ ] **Step 1: Write failing grouping tests**

Cover known platform rules, common service-name prefixes, shared `/opt` or `/www/server` roots, Docker Compose labels, confidence scoring, custom rules and an “other system services” fallback.

- [ ] **Step 2: Run the focused test and confirm missing module failure**

Run: `node --test test/unit-ci/server-status-platforms.spec.js`
Expected: FAIL because the grouping module does not exist.

- [ ] **Step 3: Implement deterministic grouping and safe custom-rule normalization**

Expose `groupServerPlatforms`, `normalizePlatformRules` and `defaultPlatformRules`. Reject invalid or overly broad custom patterns and include evidence in every inferred group.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/unit-ci/server-status-platforms.spec.js`
Expected: PASS.

### Task 4: Server status modal and topbar entry

**Files:**
- Create: `src/client/components/server-status/server-status-modal.jsx`
- Create: `src/client/components/server-status/server-status-modal.styl`
- Modify: `src/client/components/main/aigshell-topbar.jsx`
- Test: `test/unit-ci/server-status-center.spec.js`

- [ ] **Step 1: Write failing UI wiring tests**

Assert the topbar shows “服务器状态”, disables the action without a connected SSH session, opens the modal, shows refresh/loading/partial-failure states and renders tabs for overview, platforms, resources, network, security, containers and raw results.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test test/unit-ci/server-status-center.spec.js`
Expected: FAIL because the modal and topbar action are absent.

- [ ] **Step 3: Implement the modal using the approved independent wide-panel layout**

Resolve the active terminal through `refs`, require a complete SSH endpoint match, scan only on open or explicit refresh, cache snapshots by tab ID in component memory, and render real unknown/permission/timeout states rather than placeholders.

- [ ] **Step 4: Add responsive styling and stable scroll regions**

Keep the modal usable at 1366x768 and 1920x1080. Prevent text overlap, give service/platform lists independent vertical scrolling, and preserve light/dark theme contrast.

- [ ] **Step 5: Run UI tests and lint**

Run: `node --test test/unit-ci/server-status-center.spec.js && npm run lint`
Expected: PASS.

### Task 5: Clipboard, export and AI handoff

**Files:**
- Modify: `src/client/components/server-status/server-status-modal.jsx`
- Modify: `src/client/components/ai/ai-chat.jsx`
- Create: `src/client/components/server-status/server-status-ai-context.js`
- Test: `test/unit-ci/server-status-actions.spec.js`

- [ ] **Step 1: Write failing action tests**

Assert copy uses bounded Markdown, export downloads Markdown/JSON, and AI handoff opens the assistant with a bounded structured context tied to the exact SSH endpoint.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --test test/unit-ci/server-status-actions.spec.js`
Expected: FAIL because the action adapters do not exist.

- [ ] **Step 3: Implement copy/export/AI adapters with explicit user action**

Reuse existing clipboard and download helpers. Do not send data to AI until the user clicks “发送给 AI”. Strip raw output beyond configured bounds and exclude credentials.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/unit-ci/server-status-actions.spec.js`
Expected: PASS.

### Task 6: Help content and complete verification

**Files:**
- Modify: `src/client/components/main/help-center-modal.jsx`
- Modify: `build/bin/smoke-ssh-sftp.js`
- Test: `test/unit-ci/help-center.spec.js`
- Test: `test/unit-ci/real-server-smoke-script.spec.js`

- [ ] **Step 1: Add failing help and read-only regression assertions**

Require the help center to describe every server-status tab, platform grouping, confidence and permission states. Extend the real-server smoke definition with before/after fingerprints for service, firewall, routes and a controlled filesystem sentinel check.

- [ ] **Step 2: Implement help copy and a server-status read-only regression mode**

Run the same fixed probes used by the client, capture before/after fingerprints, and fail if service state, firewall rules, route configuration or controlled filesystem state changes.

- [ ] **Step 3: Run all local verification**

Run: `npm run test-unit-ci && npm run lint && npm run vite-build && git diff --check`
Expected: all tests pass, StandardJS exits 0, Vite production build succeeds, and diff check reports no whitespace errors.

- [ ] **Step 4: Run the real-server regression**

Run: `npm run smoke:ssh-sftp` with credentials supplied only through ephemeral environment variables.
Expected: SSH/SFTP regression and the new read-only status scan pass, before/after fingerprints match, temporary test data is removed, and no credentials appear in source or logs.

