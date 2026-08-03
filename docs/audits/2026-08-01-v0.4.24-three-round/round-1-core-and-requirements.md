# Round 1 — Core Journeys And Requirement Compliance

## Environment

- Audit date: 2026-08-01 (Asia/Shanghai)
- Platform: Windows, PowerShell
- Isolated worktree: `F:\SSH工具开发\.worktrees\release-0.4.24`
- Audit branch: `codex/self-audit-0.4.24`
- Audited base: `28bfc97` (`origin/master` at audit start)
- Product version: `0.4.24`
- Electron E2E profile: a per-run temporary directory whose `data` child is passed as `DATA_PATH`; the normal ShellPilot profile is not reused.
- Remote safety: no production server was mutated. Local SSH/SFTP fixtures were preferred; configured external credentials were absent.

## Automated baseline

| Gate | Command | Result | Evidence / notes |
| --- | --- | --- | --- |
| Lint | `npm run lint` | PASS | Exit code 0. Repeated after every round-one production fix. |
| Unit and component tests | `npm test` | PASS | 3071 tests: 3065 passed, 0 failed, 6 skipped; duration 294593.7829 ms. |
| Production build and runtime preparation | `npm run b` | PASS | Vite production build completed; runtime package verification passed; `prepare-file` completed in 655.634 s. The build emitted a chunk-size warning and dependency deprecation warnings for later investigation. |
| Minimal Electron smoke | `npx playwright test test/e2e/00181.layout.spec.js test/e2e/00182.workspace.spec.js --workers=1` | PASS | 2/2 passed in 45.0 s across eight terminal layouts and workspace save/load/delete. |
| Production dependency audit | `npm audit --omit=dev` | PASS | 0 production vulnerabilities. The full development tree reported advisories and is handled separately in round two. |

## User-journey execution

| Journey | Main evidence | Result | What was verified |
| --- | --- | --- | --- |
| Fresh launch and local terminal | `008.basic-terminal.spec.js`, direct first-run visual inspection | PASS | v0.4.24 opened on the disconnected home; no terminal or remote connection opened automatically; New Tab created a working local terminal; title-bar double-click maximized/restored. |
| Bookmark and group management | `007.basic.bookmarks.spec.js`, `021.basic.bookmarks-groups.spec.js`, `021.secondary-ui-state.spec.js`, bookmark flow contracts | PASS, 6/6 in 47 s | New/Edit/Delete targeting, nested groups, quick/history save into a chosen group, moving selected servers, non-empty group handling, persisted identities, and localized action labels. |
| SSH terminal startup | `005.local-ssh-lifecycle.spec.js`, `005.basic-ssh.spec.js`, `008.basic-terminal.spec.js` | PASS | Current three-step connection wizard, first-use fingerprint review, immediate command input, command output, Ctrl+C, and no startup input loss. The local SSH lifecycle passed three consecutive repetitions. |
| SFTP startup and recovery | `005.local-ssh-lifecycle.spec.js`, `027.quality-core-flows.spec.js`, 58 terminal/SFTP unit contracts | PASS for isolated coverage | An SSH-only server no longer produces a hidden generic SFTP error; opening SFTP retries and shows an actionable failure. The isolated quality flow exercised bounded remote read/write/rename, safety record, and rollback. |
| Current-server status | `006.server-status.spec.js` with real-credential preference and deterministic local fallback | PASS | Status stayed disabled without live SSH, then collected system, resource, service, network, firewall, security, container, endpoint, and platform information using readonly commands. |
| Fleet, operations, and tunnels | `023.fleet-status.spec.js`, `032.operations-toolkit.spec.js`, `033.ssh-tunnel-manager.spec.js` | PASS, 3/3 within the 5/5 group in 34.1 s | Fleet search/selection/AI handoff/cancel/scaling; 24 diagnostics, 10 runbooks, 11 safe-maintenance entries; tunnel disconnected planning, local-forward lifecycle, stop/restart, port conflict, exposure confirmation, and API failure. |
| AI chat, configuration, takeover, and Skill | 15 tests across `005.ai-config`, `006.ai-chat`, `006.ai-explain`, `022.ai-language-terminal-context`, `026.ai-takeover`, `026.agent-skill-manager` | PASS, 15/15 in 1.8 min | Minimal model setup, chat and attachments, terminal context, English actions, exact-session takeover, readonly fast path, one risky confirmation, cancellation, revocation, Skill draft/review/enable/version/digest behavior. |
| Incident archive | `034.incident-archive-foundation.spec.js`, incident export and storage contracts | PASS, E2E 4/4 and export 5/5 | Manual lifecycle, persistence, search/filter/paging, home reopen, pending candidate confirmation, responsive layouts, bounded/redacted export, and removal of obsolete manual DB backup/restore APIs. |
| Cross-feature quality | `027.quality-core-flows.spec.js` | PASS | One isolated app completed SSH, SFTP safety/rollback, AI stop, update-current state, trace correlation, and secret-absence checks. |

## Manual visual findings

The first-run window showed ShellPilot `v0.4.24`, the disconnected home, expected left/top navigation, and the AI panel without silently creating a session. Primary controls were reachable in the inspected desktop size. Fleet, operations, server-status, and incident E2E tests additionally asserted layout bounds at representative 1366×768/1920×1080 and 100%/125%/150% combinations. This is useful round-one evidence, but it is not substituted for the full visual/theme/language matrix planned for round three.

## Confirmed defects and resolutions

| ID | Severity | User-visible problem | Root cause | Resolution | Evidence |
| --- | --- | --- | --- | --- | --- |
| R1-01 | P1 | Sidebar “new bookmark” appeared clickable but silently did nothing. | The sidebar sent a synthetic bookmark ID through a selection callback instead of opening the create flow. | Route the action to the real create handler and lock it with a flow contract. | `0a665f4`; bookmark group 6/6. |
| R1-02 | P1 | Sidebar bookmark Edit opened the new-SSH wizard instead of the selected bookmark editor. | Edit and create actions shared the wrong callback. | Bind Edit to the selected bookmark identity and existing editor. | `0a665f4`; edit/delete E2E passed. |
| R1-03 | P2 | Bookmark icon-only actions lacked localized accessible names/tooltips. | Buttons depended on glyph meaning only. | Add Chinese/English `aria-label` and title text. | `0a665f4`; unit contract and lint passed. |
| R1-04 | P1 | Connecting to an SSH server without SFTP could surface a hidden generic `Error`; opening SFTP did not reliably retry, and a provisional client could remain allocated. | Eager SFTP initialization treated an optional capability as a foreground failure and did not fully clean/retry its provisional connection. | Suppress hidden optional-capability errors, clean provisional clients, retry on explicit SFTP open, and show localized actionable fallback text. | `fbd1462`; 58/58 unit tests; SSH/SFTP E2E repeated 6/6. |
| R1-05 | P0 | Typing immediately after SSH connection could interleave with shell-integration injection and lose the beginning of the user command. | User input and startup output-suppression/injection used the same channel without an ordering barrier. | Queue input during suppression, flush it in order after injection, and clear it on dispose. | `fbd1462`; immediate-input E2E passed three times. |
| R1-06 | P1 | Chinese guide and Chinese/English built-in help claimed manual terminal Enter was intercepted and safety-classified, while current code intentionally sends manual input directly. | The direct-input behavior change removed manual interception but did not update all documentation surfaces. | State the native/direct manual-input boundary and reserve safety transactions for AI, quick commands, operations, and other controlled entry points; add bilingual contract tests. | `ca00e98`, `7a0ab5f`; safety matrix 13/13 and lint passed. |
| R1-07 | P2 | Incident tests/locales/help still referred to a removed manual database backup/restore UI, including instructions to open a nonexistent “Storage and Recovery” path. | The export-only incident design removed renderer/store/IPC APIs but left old acceptance and help copy. | Replace stale acceptance with lifecycle/persistence checks, remove dead locale keys, and direct users to bounded Markdown/HTML/JSON export while documenting internal-only automatic protection. | `b98405b`, `7a0ab5f`; incident E2E 4/4, export 5/5. |

## Test infrastructure optimization

`006.server-status.spec.js` now prefers configured real-server credentials but falls back to a deterministic local SSH fixture with command-specific outputs. This preserves optional real-environment coverage while making the status center a repeatable release gate. The local SSH fixture gained `execResults` support and its own 3/3 unit coverage (`b631e2a`).

## Environment limitations and substitutions

- Four legacy SFTP tests require `TEST_HOST`, `TEST_PASS`, and `TEST_USER`; those credentials were unavailable. They are recorded as environment-unavailable rather than product passes or failures.
- The missing real SFTP environment was partially substituted with the isolated SFTP-capable quality fixture in `027.quality-core-flows.spec.js`. A complete two-pane SFTP UI operation matrix remains open.
- Real-server status credentials were unavailable; `006.server-status.spec.js` used its deterministic local fallback while retaining the real-server path when credentials exist.
- No external server mutation, online release publication, updater-state change, or historical asset deletion occurred.

## Requirement matrix after round one

The matrix contains 166 traceable requirements:

- `已满足`: 34
- `部分满足`: 30
- `未验证`: 101
- `已废止`: 1
- `未满足`: 0
- `无法验证`: 0

The single retired item is the former `TERM-06` requirement to intercept manual terminal Enter. It is not counted as silently satisfied: the current implementation deliberately keeps manual SSH input native/direct, and `TERM-05` plus the corrected guide now define where controlled safety classification applies.

Round one therefore confirms a healthy and materially improved core baseline, but not full requirement completion. The remaining requirements are primarily abnormal/cancellation/security paths (round two) and visual/performance/package/current-release checks (round three).

## Round conclusion

Round one is complete. Seven concrete product/usability/documentation defects were confirmed and fixed, one flaky external-environment dependency was converted into deterministic optional coverage, and every modified area passed focused regression plus lint. No currently verified P0 requirement remains failed; release readiness is intentionally still open until rounds two and three complete.
