# ShellPilot v0.4.24 Three-Round Self-Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit ShellPilot v0.4.24 as a real user in three distinct rounds, prove whether current behavior satisfies all retained requirements, and test-drive minimal fixes for every confirmed in-scope defect.

**Architecture:** Treat the user guide, release notes, retained specifications, executable contracts, and runtime behavior as a traceable requirement corpus. Each round produces its own evidence report and runs against the fixes from the previous round; confirmed defects follow root-cause investigation and red-green-refactor before they can be closed.

**Tech Stack:** Electron 41, React 19, Ant Design 6, Node.js test runner, Playwright 1.61, Stylus, Windows Computer Use, local SSH/SFTP fixtures, optional real-model and real-VPS smoke tests.

---

## File map

- Create `docs/audits/2026-08-01-v0.4.24-three-round/source-inventory.md`: authoritative requirement sources and precedence decisions.
- Create `docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md`: requirement-level status and evidence.
- Create `docs/audits/2026-08-01-v0.4.24-three-round/round-1-core-and-requirements.md`: core-journey evidence, defects, fixes, and recheck.
- Create `docs/audits/2026-08-01-v0.4.24-three-round/round-2-boundaries-and-recovery.md`: edge, safety, recovery, and dependency evidence.
- Create `docs/audits/2026-08-01-v0.4.24-three-round/round-3-ux-performance-release.md`: usability, visual matrix, accessibility, performance, and release evidence.
- Create `docs/audits/2026-08-01-v0.4.24-three-round/final-report.md`: final compliance result, change list, remaining external limitations, and release recommendation.
- Modify production and test files only after a defect has a recorded reproduction, root cause, and failing regression test. Exact paths must be added to the corresponding round report before implementation.

## Global defect gate

Every production edit is conditional on this exact sequence:

1. Add a defect row to the active round report with the user-visible symptom, exact steps, expected result, actual result, severity, and evidence path.
2. Trace the root cause and name the responsible module; do not propose a fix while the cause is unknown.
3. Add one minimal test to the nearest existing `test/unit-ci/*.spec.js` or `test/e2e/*.spec.js` file.
4. Run only that test and record the expected failing assertion.
5. Implement one minimal root-cause fix.
6. Run the focused test to green, then its adjacent suite, then repeat the original desktop steps.
7. Commit the test, fix, and report update together with a message beginning `fix:`.

If a defect cannot pass this gate, keep it open; do not silently change expectations or call it fixed.

### Task 1: Freeze the authoritative baseline and requirement corpus

**Files:**
- Create: `docs/audits/2026-08-01-v0.4.24-three-round/source-inventory.md`
- Create: `docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md`
- Reference: `docs/superpowers/specs/2026-08-01-shellpilot-v0.4.24-three-round-self-audit-design.md`
- Reference: `apps/electerm-agent/docs/USER_GUIDE_ZH.md`
- Reference: `apps/electerm-agent/docs/releases/v0.4.24.md`

- [ ] **Step 1: Record the exact baseline identity**

Run from the repository worktree:

```powershell
git status --short --branch
git log -3 --oneline --decorate
git merge-base --is-ancestor 28bfc97 HEAD
node -p "require('./apps/electerm-agent/package.json').version"
```

Expected: branch `codex/self-audit-0.4.24`, clean status before audit artifacts, `28bfc97` is an ancestor, and version is `0.4.24`.

- [ ] **Step 2: Inventory every retained source**

Write `source-inventory.md` with these sections and no omitted files:

```markdown
# ShellPilot v0.4.24 Requirement Source Inventory

## User objective
## Current user-facing contract
## Root specifications
## Application specifications
## Completed implementation plans
## Executable contracts
## Precedence and superseded decisions
```

List all Markdown files under both specification directories. Record the latest user guide and release note separately. Mark a source superseded only when a newer source names the conflicting behavior explicitly.

- [ ] **Step 3: Build atomic requirement rows**

Write `requirements-matrix.md` with this exact schema:

```markdown
| ID | Domain | Requirement | Source | Severity | Evidence | Status | Gap / disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
```

Use the stable domain prefixes `BASE`, `CONN`, `TERM`, `SFTP`, `FLEET`, `OPS`, `AI`, `ART`, `INC`, `SAFE`, `TUN`, `UX`, and `REL`. Split compound prose into independently verifiable rows. Initial status must be `未验证`; historical checkboxes are not proof.

- [ ] **Step 4: Verify source and matrix completeness**

Run:

```powershell
rg -n "未验证|已满足|部分满足|未满足|无法验证|已废止" docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md
rg -n "TBD|TODO|待定|稍后补充" docs/audits/2026-08-01-v0.4.24-three-round
git diff --check
```

Expected: every matrix row has one allowed status, the placeholder search returns no matches, and `git diff --check` exits 0.

- [ ] **Step 5: Commit the audit corpus**

```powershell
git add docs/audits/2026-08-01-v0.4.24-three-round/source-inventory.md docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md
git commit -m "docs: inventory v0.4.24 audit requirements"
```

### Task 2: Establish build, lint, unit, and harness health

**Files:**
- Modify: `docs/audits/2026-08-01-v0.4.24-three-round/round-1-core-and-requirements.md`
- Verify: `apps/electerm-agent/package.json`
- Verify: `apps/electerm-agent/test/e2e/common/app-options.js`
- Verify: `apps/electerm-agent/test/e2e/common/isolated-electron-app.js`

- [ ] **Step 1: Create the round-one report skeleton**

Use this exact section order:

```markdown
# Round 1 — Core Journeys And Requirement Compliance

## Environment
## Automated baseline
## Desktop journey results
## Confirmed defects
## Fix evidence
## Requirement matrix updates
## Round conclusion
```

- [ ] **Step 2: Run lint**

From `apps/electerm-agent` run:

```powershell
npm run lint
```

Expected: exit 0 with no StandardJS errors.

- [ ] **Step 3: Run the complete unit suite**

```powershell
npm run test-unit-ci
```

Expected baseline: `3071` tests, `0` failures, and only the six environment-dependent skips already observed. Any count change must be explained by committed tests.

- [ ] **Step 4: Build the production application**

```powershell
npm run b
```

Expected: Vite and Electron preparation exit 0 and produce `work/app/app.js` without renderer compilation errors.

- [ ] **Step 5: Verify the isolated Electron harness**

```powershell
npx playwright test test/e2e/00181.layout.spec.js test/e2e/00182.workspace.spec.js --workers=1
```

Expected: the application starts with isolated `DATA_PATH`, the shell is ready, and layout/workspace smoke tests pass without renderer page errors.

- [ ] **Step 6: Record evidence and commit**

Update the report with commands, exit codes, counts, durations, and any warnings. Then run `git diff --check` and commit:

```powershell
git add docs/audits/2026-08-01-v0.4.24-three-round/round-1-core-and-requirements.md
git commit -m "test: record v0.4.24 audit baseline"
```

### Task 3: Execute round one core journeys as a real user

**Files:**
- Modify: `docs/audits/2026-08-01-v0.4.24-three-round/round-1-core-and-requirements.md`
- Modify: `docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md`
- Verify: `apps/electerm-agent/test/e2e/005.basic-ssh.spec.js`
- Verify: `apps/electerm-agent/test/e2e/008.basic.file-manager.spec.js`
- Verify: `apps/electerm-agent/test/e2e/005.ai-config.spec.js`
- Verify: `apps/electerm-agent/test/e2e/034.incident-archive-foundation.spec.js`

- [ ] **Step 1: Read Computer Use safety and API guidance**

Initialize the bundled Computer Use runtime, then read `guidance`, `confirmations`, and `api`. Target only the isolated ShellPilot window. Do not interact with unrelated user applications.

- [ ] **Step 2: Run the disconnected and connection-management journey**

With a fresh isolated profile, inspect first-run copy, help, settings, language preview/apply/cancel, theme preview/apply/cancel, new connection, quick connection, save, group, search, edit, move, and delete. Record exact visible labels and whether each action has a clear completion or error state.

Run the matching automated paths:

```powershell
npx playwright test test/e2e/007.basic.bookmarks.spec.js test/e2e/021.basic.bookmarks-groups.spec.js test/e2e/02.2.init.setting.spec.js test/e2e/021.secondary-ui-state.spec.js --workers=1
```

- [ ] **Step 3: Run terminal and SFTP journeys**

Use local SSH/SFTP fixtures for host verification, connect, command input, search, reconnect, terminal log, local/remote navigation, preview, upload, download, rename, conflict handling, keyboard operations, and transfer progress.

```powershell
npx playwright test test/e2e/005.local-ssh-lifecycle.spec.js test/e2e/008.basic-terminal.spec.js test/e2e/008.basic.file-manager.spec.js test/e2e/018.file-transfer.spec.js test/e2e/018.file-transfer-conflict.spec.js test/e2e/019.file-select.spec.js --workers=1
```

- [ ] **Step 4: Run status, operations, safety, and tunnel journeys**

Check Fleet, connected-server status, quick commands, operations workspace, safety-center records, tunnel create/test/stop/error feedback, and disconnect cleanup.

```powershell
npx playwright test test/e2e/006.server-status.spec.js test/e2e/023.fleet-status.spec.js test/e2e/025.fleet-service-selector.spec.js test/e2e/032.operations-toolkit.spec.js test/e2e/033.ssh-tunnel-manager.spec.js --workers=1
```

- [ ] **Step 5: Run AI, artifact, and incident journeys**

With a local stub or existing isolated model configuration, inspect model configuration, connection test, chat send/stop/clear, terminal context, artifact entry, artifact workspace, incident list/detail/export, and handoff. Never copy real credentials into the report.

```powershell
npx playwright test test/e2e/005.ai-config.spec.js test/e2e/006.ai-chat.spec.js test/e2e/006.ai-explain.spec.js test/e2e/022.ai-language-terminal-context.spec.js test/e2e/026.ai-takeover.spec.js test/e2e/026.agent-skill-manager.spec.js test/e2e/034.incident-archive-foundation.spec.js --workers=1
```

- [ ] **Step 6: Classify and fix every confirmed round-one defect**

Apply the Global defect gate one defect at a time. After each fix, rerun the failing test, the containing command from Steps 2–5, and the original desktop steps. Do not batch unrelated fixes.

- [ ] **Step 7: Close round one**

Update every covered requirement row from `未验证` to an evidence-backed status. Record exact counts of satisfied, partial, failed, and unverified requirements. Run `git diff --check` and commit report-only closure changes:

```powershell
git add docs/audits/2026-08-01-v0.4.24-three-round/round-1-core-and-requirements.md docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md
git commit -m "docs: close v0.4.24 audit round one"
```

### Task 4: Execute round two boundary, safety, and recovery audit

**Files:**
- Create: `docs/audits/2026-08-01-v0.4.24-three-round/round-2-boundaries-and-recovery.md`
- Modify: `docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md`
- Verify: focused `apps/electerm-agent/test/unit-ci` safety, AI, SFTP, persistence, and update tests
- Verify: `apps/electerm-agent/test/e2e/028.crash-recovery.spec.js`

- [ ] **Step 1: Create the round-two report**

Use these sections:

```markdown
# Round 2 — Boundaries, Safety, And Recovery

## Invalid and extreme inputs
## Concurrency and stale state
## Disconnect, cancellation, and restart
## Safety and redaction
## Dependency audit
## Real external smoke tests
## Confirmed defects and fixes
## Requirement matrix updates
## Round conclusion
```

- [ ] **Step 2: Exercise invalid and extreme inputs**

As a user, check empty and oversized form fields, invalid ports and paths, duplicate actions, repeated submit, invalid attachment types, long text, file conflicts, and unavailable services. Verify that failures happen before remote or model dispatch and identify the affected field and next action.

Run:

```powershell
node --test test/unit-ci/quick-connect.spec.js test/unit-ci/sftp-file-name-validation.spec.js test/unit-ci/ai-attachments.spec.js test/unit-ci/ai-content-ingestion.spec.js test/unit-ci/ai-empty-response-consumers.spec.js test/unit-ci/operations-parameter-value.spec.js
```

- [ ] **Step 3: Exercise cancellation, stale state, and crash recovery**

Check AI stop, Agent stop, SFTP pause/resume/cancel, SSH disconnect, tab closure, task-state convergence, application restart, orphan recovery, and the rule that unknown remote commands are never replayed.

```powershell
node --test test/unit-ci/ai-run-cancellation.spec.js test/unit-ci/agent-cancellation.spec.js test/unit-ci/agent-cancellation-status.spec.js test/unit-ci/state-persistence-queue.spec.js test/unit-ci/client-recovery-state.spec.js test/unit-ci/crash-recovery-ui.spec.js test/unit-ci/transfer-operation-queue.spec.js test/unit-ci/sftp-safety-recovery.spec.js
npx playwright test test/e2e/027.quality-core-flows.spec.js test/e2e/028.crash-recovery.spec.js --workers=1
```

- [ ] **Step 4: Exercise safety and credential redaction**

Verify readonly operations avoid confirmation, mutations show exact target/effect/recovery, cancellation is not rollback, and secrets do not enter logs, exports, errors, histories, or reports.

```powershell
node --test test/unit-ci/data-security-matrix.spec.js test/unit-ci/log-redaction.spec.js test/unit-ci/session-log-redaction.spec.js test/unit-ci/agent-risk-delegation.spec.js test/unit-ci/agent-risk-execution.spec.js test/unit-ci/safety-release-matrix.spec.js test/unit-ci/renderer-error-report.spec.js
```

- [ ] **Step 5: Audit production dependencies without changing them**

```powershell
npm audit --omit=dev --json
npm ls --omit=dev --all
```

Record advisory IDs, dependency paths, runtime callers, patched versions, and whether a same-major compatible upgrade exists. Do not run `npm audit fix --force`. If a safe fix exists, process it through the Global defect gate and rerun Office, archive, build, and package tests.

- [ ] **Step 6: Run real external smoke tests within the safety envelope**

When isolated credentials are available:

```powershell
npm run smoke:ai
npm run smoke:ssh-sftp
npx playwright test test/e2e/030.real-server-regression.spec.js test/e2e/031.agent-readonly-real-server.spec.js --workers=1
```

Expected: only redacted summaries are retained; SSH/Agent operations are readonly; SFTP writes stay under a randomized `/tmp/.shellpilot-*` directory and its `finally` cleanup is verified. If credentials or services are unavailable, record `无法验证` plus the local failure-handling evidence.

- [ ] **Step 7: Fix confirmed round-two defects and close the round**

Apply the Global defect gate separately to each defect. Update the report and matrix, run `git diff --check`, and commit closure documentation:

```powershell
git add docs/audits/2026-08-01-v0.4.24-three-round/round-2-boundaries-and-recovery.md docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md
git commit -m "docs: close v0.4.24 audit round two"
```

### Task 5: Execute round three usability, visual, performance, and release audit

**Files:**
- Create: `docs/audits/2026-08-01-v0.4.24-three-round/round-3-ux-performance-release.md`
- Modify: `docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md`
- Verify: `apps/electerm-agent/test/e2e/022.secondary-ui-visual-matrix.spec.js`
- Verify: `apps/electerm-agent/test/e2e/026.primary-workspace-regression.spec.js`
- Verify: `apps/electerm-agent/test/e2e/029.performance-baseline.spec.js`

- [ ] **Step 1: Create the round-three report**

Use these sections:

```markdown
# Round 3 — Usability, Visual, Performance, And Release Quality

## First-use and information architecture
## Language, theme, zoom, and keyboard matrix
## Aurora release-claim verification
## Performance and capacity
## Build, package, and update verification
## Confirmed defects and fixes
## Requirement matrix updates
## Round conclusion
```

- [ ] **Step 2: Run the real desktop usability matrix**

Using Computer Use and fresh isolated profiles, inspect Chinese and English, light and dark, 1366×768 and 1920×1080, Windows 100%/125%/150%, keyboard-only focus, disabled states, Escape behavior, side panels, AI panel, terminal/SFTP split, settings, and primary dialogs. Capture screenshots only into ignored audit output and link redacted comparisons from the report.

- [ ] **Step 3: Run visual and accessibility contracts**

```powershell
npx playwright test test/e2e/022.secondary-ui-visual-matrix.spec.js test/e2e/026.primary-workspace-regression.spec.js --workers=1
node --test test/unit-ci/ui-theme-tokens.spec.js test/unit-ci/shellpilot-theme-constraints.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js test/unit-ci/ui-localization-coverage.spec.js test/unit-ci/visible-chinese-copy.spec.js
```

Expected: no clipping, document overflow, hidden primary actions, missing focus, low-contrast disabled states, theme leakage into the terminal canvas, or translation gaps.

- [ ] **Step 4: Run performance and capacity checks**

```powershell
npm run test-performance-e2e
node --test test/unit-ci/performance-metrics.spec.js test/unit-ci/shellpilot-client-ux-performance.spec.js test/unit-ci/ai-history-window.spec.js test/unit-ci/agent-output-backpressure.spec.js
```

Expected: all existing thresholds pass without edits. One network-only retry is allowed with identical source and thresholds; deterministic misses require root-cause analysis.

- [ ] **Step 5: Run release-quality verification**

```powershell
npm run lint
npm run test-unit-ci
npm run b
npm run package:win:dir
npm run test-package-smoke
npm run release:github:dry
npm run release:update-sources:verify
```

Expected: local build and package checks pass. Online byte verification may fail closed when unpublished `0.4.24` assets or approval manifests are absent; record the exact publication precondition and do not publish.

- [ ] **Step 6: Fix confirmed round-three defects and close the round**

Apply the Global defect gate one issue at a time. Repeat the exact failed viewport, theme, language, zoom, keyboard, or performance condition after each fix. Update the report and matrix, then commit:

```powershell
git add docs/audits/2026-08-01-v0.4.24-three-round/round-3-ux-performance-release.md docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md
git commit -m "docs: close v0.4.24 audit round three"
```

### Task 6: Complete requirement-by-requirement closure and final verification

**Files:**
- Create: `docs/audits/2026-08-01-v0.4.24-three-round/final-report.md`
- Modify: `docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md`
- Review: every file changed since `28bfc97`

- [ ] **Step 1: Remove unsupported completion states**

Search the matrix for `未验证`, `部分满足`, and `未满足`. For each match, either gather the missing current-state evidence, implement an in-scope fix through the Global defect gate, or retain `无法验证` with a concrete external condition. Do not convert uncertainty into `已满足`.

```powershell
rg -n "未验证|部分满足|未满足" docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md
```

Expected at completion: no `未验证`; no unexplained `部分满足` or `未满足` for the current user guide or v0.4.24 release promises.

- [ ] **Step 2: Write the final report**

Use this exact structure:

```markdown
# ShellPilot v0.4.24 Three-Round Self-Audit Final Report

## Executive result
## Requirement compliance totals
## Round-one findings and fixes
## Round-two findings and fixes
## Round-three findings and fixes
## Verification evidence
## External limitations
## Remaining P3 observations
## Release recommendation
```

Every fix entry must link to its regression test and commit. Every external limitation must name the unavailable dependency and the local behavior that was still verified.

- [ ] **Step 3: Run fresh full verification**

From `apps/electerm-agent` run:

```powershell
npm run lint
npm run test-unit-ci
npm run test-quality-e2e
npm run test-performance-e2e
npm run b
npm run package:win:dir
npm run test-package-smoke
npm audit --omit=dev
```

Also run every focused regression command added by confirmed defects. Record fresh exit codes, test counts, skips, durations, audit results, and package path in `final-report.md`.

- [ ] **Step 4: Audit the final diff and secrets**

```powershell
git diff 28bfc97 --check
git diff 28bfc97 --stat
git log --oneline 28bfc97..HEAD
git status --short --branch
git grep -n -I -E "Authorization:|BEGIN (RSA |OPENSSH )?PRIVATE KEY|api[_-]?key[[:space:]]*[:=][[:space:]]*['\"][^$<{]" -- ':!package-lock.json'
```

Expected: diff check exits 0, status contains only the final report before its commit, no generated app/profile/test artifacts are tracked, and the secret scan returns no real credentials. Inspect every diff, not just the stat.

- [ ] **Step 5: Request independent code review**

Use the `requesting-code-review` skill. Review all changes from base `28bfc97` to `HEAD`, address every P0/P1/P2 finding, and rerun affected verification before continuing.

- [ ] **Step 6: Commit the final evidence**

```powershell
git add docs/audits/2026-08-01-v0.4.24-three-round/final-report.md docs/audits/2026-08-01-v0.4.24-three-round/requirements-matrix.md
git commit -m "docs: finalize v0.4.24 three-round self-audit"
```

- [ ] **Step 7: Verify the committed state**

```powershell
git status --short --branch
git diff 28bfc97 --check
git log -1 --oneline
```

Expected: clean working tree on `codex/self-audit-0.4.24`, zero diff-check errors, and the final audit commit at `HEAD`.
