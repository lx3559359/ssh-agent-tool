# ShellPilot v0.4.24 Three-Round Self-Audit Final Report

## Executive result

The three-round audit is complete on the isolated branch `codex/self-audit-0.4.24`, based on official source commit `28bfc97`. The official repository and latest published release both remain ShellPilot `v0.4.24`; the audit did not mutate either remote release or update source.

The corrected audit candidate is materially healthier than the published baseline: fourteen confirmed defects or stale user-facing contracts were fixed, the complete current suite and packaged application pass, production and development dependency audits report zero vulnerabilities, and every one of the 166 retained requirements has an explicit final classification.

This does **not** mean that the already-published v0.4.24 binaries automatically contain these fixes. The fixes exist on the local audit branch and should be merged into a new patch release rather than overwriting historical v0.4.24 assets.

The answer to “does the current version meet all previous requirements?” is therefore precise rather than absolute:

- the corrected candidate satisfies 159 requirements;
- six requirements are partially verified because they need authorized external SFTP/tunnel infrastructure or a separate website deployment;
- one former manual-terminal-interception requirement is explicitly retired and replaced by the documented native/direct terminal behavior;
- no current requirement is left unverified or classified as unmet.

## Requirement compliance totals

| Status | Count | Share | Meaning |
| --- | ---: | ---: | --- |
| 已满足 | 159 | 95.8% | Current source/runtime evidence covers the requirement. |
| 部分满足 | 6 | 3.6% | Deterministic contracts pass, but a named external desktop/deployment condition is absent. |
| 已废止 | 1 | 0.6% | Superseded by an explicit newer behavior contract (`TERM-06` → `TERM-05`). |
| 未验证 | 0 | 0% | No requirement remains without a disposition. |
| 未满足 | 0 | 0% | No current retained requirement has a confirmed failing implementation. |
| 无法验证 | 0 | 0% | External gaps are partially evidenced and explained rather than left opaque. |

The authoritative row-level evidence is in [requirements-matrix.md](requirements-matrix.md).

## Round-one findings and fixes

| ID | Severity | Fix | Regression evidence | Commit |
| --- | --- | --- | --- | --- |
| R1-01 | P1 | Sidebar New Bookmark now opens the real create flow. | [bookmark-management-flow.spec.js](../../../apps/electerm-agent/test/unit-ci/bookmark-management-flow.spec.js), [007.basic.bookmarks.spec.js](../../../apps/electerm-agent/test/e2e/007.basic.bookmarks.spec.js) | `0a665f4` |
| R1-02 | P1 | Sidebar Edit targets the selected bookmark instead of opening the new-connection flow. | [bookmark-management-flow.spec.js](../../../apps/electerm-agent/test/unit-ci/bookmark-management-flow.spec.js) | `0a665f4` |
| R1-03 | P2 | Bookmark icon-only actions now expose localized accessible names/tooltips. | [bookmark-management-flow.spec.js](../../../apps/electerm-agent/test/unit-ci/bookmark-management-flow.spec.js) | `0a665f4` |
| R1-04 | P1 | Hidden eager SFTP failures no longer interrupt SSH; explicit SFTP opening retries, cleans provisional clients, and shows actionable bilingual errors. | [sftp-refresh-behavior.spec.js](../../../apps/electerm-agent/test/unit-ci/sftp-refresh-behavior.spec.js), [005.local-ssh-lifecycle.spec.js](../../../apps/electerm-agent/test/e2e/005.local-ssh-lifecycle.spec.js) | `fbd1462` |
| R1-05 | P0 | User input typed during shell-integration startup suppression is queued and flushed in order instead of losing the command prefix. | [terminal-input-stability.spec.js](../../../apps/electerm-agent/test/unit-ci/terminal-input-stability.spec.js), [005.local-ssh-lifecycle.spec.js](../../../apps/electerm-agent/test/e2e/005.local-ssh-lifecycle.spec.js) | `fbd1462` |
| R1-06 | P1 | Guide and bilingual Help now distinguish native/direct manual SSH input from controlled safety entry points. | [safety-release-matrix.spec.js](../../../apps/electerm-agent/test/unit-ci/safety-release-matrix.spec.js) | `ca00e98`, `7a0ab5f` |
| R1-07 | P2 | Removed stale incident manual database backup/restore acceptance, locale keys, and Help guidance; bounded export remains. | [incident-export.spec.js](../../../apps/electerm-agent/test/unit-ci/incident-export.spec.js), [034.incident-archive-foundation.spec.js](../../../apps/electerm-agent/test/e2e/034.incident-archive-foundation.spec.js) | `b98405b`, `7a0ab5f` |

Round one also made server-status E2E deterministic through an optional local SSH fixture while preserving the real-credential path (`b631e2a`).

## Round-two findings and fixes

| ID | Severity | Fix | Regression evidence | Commit |
| --- | --- | --- | --- | --- |
| R2-01 | P1 | Regenerated the lock so ExcelJS resolves its declared Archiver 5 dependency to compatible 5.3.2 instead of 7.0.1. | [ai-artifact-office-generators.spec.js](../../../apps/electerm-agent/test/unit-ci/ai-artifact-office-generators.spec.js) | `fc91362` |
| R2-02 | P1 | Updated Electron Builder 26.9.0 → 26.15.3 and PostCSS 8.5.15 → 8.5.25, removing eight high development/build advisories without a major-version jump. | Full and production `npm audit`; Office/build/package regressions | `fc91362` |
| R2-03 | P1 | Forced Python UTF-8 mode for Windows packaging in non-ASCII workspace paths while preserving an explicit override. | [electron-builder-prepare.spec.js](../../../apps/electerm-agent/test/unit-ci/electron-builder-prepare.spec.js), two successful Chinese-path package builds | `fc91362` |
| R2-04 | P2 | Centralized cleanup of optional `cpu-features` and its orphaned `buildcheck` residue. | [prepare-cleanup-utils.spec.js](../../../apps/electerm-agent/test/unit-ci/prepare-cleanup-utils.spec.js), runtime package verification | `fc91362` |

Invalid/extreme input checks passed 58/58; cancellation/recovery passed 46/46; safety/redaction passed 40/40; quality and crash-recovery E2E passed 2/2. No remote production mutation occurred.

## Round-three findings and fixes

| ID | Severity | Fix | Regression evidence | Commit |
| --- | --- | --- | --- | --- |
| R3-01 | P2 | Replaced deprecated Ant Design `Space direction` usage with `orientation` in AI configuration and workspace save. | [shellpilot-ui-responsive.spec.js](../../../apps/electerm-agent/test/unit-ci/shellpilot-ui-responsive.spec.js) | `f0d05b5` |
| R3-02 | P1 | Added the missing English Incident Archive Help section and made exact Chinese/English section-key parity mandatory. | [shellpilot-help-content.spec.js](../../../apps/electerm-agent/test/unit-ci/shellpilot-help-content.spec.js) | `f0d05b5` |
| R3-03 | P3 | Final diff review removed the last unused `Storage & Recovery / 存储与恢复` locale key so catalogs no longer advertise a removed incident action. | [incident-export.spec.js](../../../apps/electerm-agent/test/unit-ci/incident-export.spec.js) | `04cf3e8` |

The 14-case real Electron visual matrix passed after R3-01/R3-02. R3-03 was then verified by a red-then-green focused test, the final complete suite, a fresh production build/package, packaged EXE smoke, quality E2E, and performance E2E.

## Verification evidence

All final source-sensitive gates below were run against HEAD after the last production fix:

| Gate | Final result |
| --- | --- |
| `npm run lint` | PASS, StandardJS exit 0. |
| `npm run test-unit-ci` | PASS: 3,082 tests, 3,076 passed, 0 failed, 6 skipped; 284,622.2514 ms. |
| `npm run test-quality-e2e` | PASS: 2/2 in 17.1 s; isolated SSH/SFTP/AI/update/rollback plus crash recovery. |
| `npm run test-performance-e2e` | PASS: 1/1 in 13.6 s; startup, terminal, memory, and AI budgets unchanged. |
| Round-three visual E2E | PASS: 14/14 in approximately 14.5 min; 408 surface/focus checks and 278 disabled-contrast checks across five themes, two languages, compact/large viewports, and zoom equivalents. |
| Focused performance/capacity | PASS: 24/24 metrics/startup/takeover plus 5/5 long-history/backpressure. |
| `npm run package:win:dir` | PASS: Vite production build, 285-package runtime preparation, runtime verification, native rebuilds, and Electron 41.2.0 Windows x64 directory package. |
| `npm run test-package-smoke` | PASS: newly built `dist/win-unpacked/ShellPilot.exe` launched with isolated `DATA_PATH`, initialized, and exited cleanly. |
| `npm audit --omit=dev` | PASS: 0 vulnerabilities. Full dependency audit also reports 0. |
| `npm run release:github:dry` | PASS: generated release operations without publishing. |
| `npm run release:update-sources:verify` | PASS: ModelScope and GitHub each reported 0.4.24 and byte-verified eight approved assets. |
| Final diff checks | PASS: `git diff 28bfc97 --check`; no generated build/test/profile directories tracked. |
| Secret scan | PASS after classification: all PEM/Bearer/AWS/GitHub-shaped hits are deliberate redaction fixtures under `test/`; no long literal API-key assignment exists in production source or docs. |

The complete `28bfc97..HEAD` production/test/documentation diff was reviewed. The requested independent-review skill could not dispatch a reviewer because no subagent tool is available in this session and creating a new user-owned task was not authorized. A full traced self-review was used as fallback; it found R3-03 and no remaining P0/P1/P2 issue.

## External limitations

- No audit-only `SHELLPILOT_E2E_*` real-server credentials were available. The two real-server Playwright tests skipped, and `smoke:ssh-sftp` failed closed before network activity because host, user, password, and pinned fingerprint were absent. Local SSH/status/SFTP fixtures still verified connection, fingerprint, status, remote I/O, rollback, and failure handling.
- No audit-only external AI base URL/model/key was available. Local provider stubs and the full AI contract suite verified configuration, models, profiles, streaming, cancellation, attachments, history, Agent/MCP/CLI safety, and redaction without reading a normal user profile.
- Three SFTP rows remain partial: a complete connected two-pane journey, every operation in one connected desktop session, and connected drag/drop/keyboard behavior require an SFTP-capable audit server.
- Two tunnel rows remain partial: live remote-forward/SOCKS5 and forwarding-prohibition/destination-refusal UI paths require an authorized external SSH endpoint. Local-forward E2E and all runtime contracts pass.
- The official repository/release branding is correct, but repository metadata has no deployed homepage. The website specification is explicitly design-only; website implementation/deployment is separate scope, so `REL-13` remains partial.

## Remaining P3 observations

- Vite reports dependency-heavy chunks over 500 kB (notably the main/locale dependency graph). Existing startup/memory/performance budgets pass; future code splitting can reduce update/download and parse cost.
- Runtime package preparation emits upstream deprecation warnings for `inflight`, `lodash.isequal`, and `glob@7` through compatible transitive dependencies. Current dependency audits report zero vulnerabilities. Revisit when ExcelJS/Archiver upstreams permit a compatible upgrade rather than forcing an override.
- A truly independent code reviewer was unavailable in this tool environment. The branch should still receive normal human/CI review before merge despite the completed traced self-review.

## Release recommendation

Recommendation: **merge the audited fixes, run normal CI/reviewer approval, and publish a new patch version (for example v0.4.25); do not overwrite v0.4.24 or any historical assets.**

The corrected candidate is suitable for that next patch gate: no known P0/P1/P2 implementation failure remains, complete current tests/build/package/smoke pass, and dependency advisories are zero. It should not be described as satisfying 100% of every historical promise until the six external/deployment-dependent partial rows are completed. The already-published v0.4.24 should likewise not be described as containing these local audit fixes.
