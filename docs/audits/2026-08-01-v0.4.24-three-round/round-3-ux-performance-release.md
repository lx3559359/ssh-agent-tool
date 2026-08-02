# Round 3 — Usability, Visual, Performance, And Release Quality

## First-use and information architecture

The audited build continues to open on the disconnected home with no automatic local terminal or remote connection. The primary left navigation, top action rail, settings, Help, AI panel, update center, safety center, Fleet, Operations, incident archive, bookmarks, and terminal-related entry points remained reachable in the real Electron application.

At the smallest audited condition (590×400 at the 150% equivalent), the top action rail intentionally becomes horizontally scrollable. Settings and Help can begin outside the viewport, but keyboard focus, wheel/rail scrolling, and focus-following make them reachable; the document itself does not overflow. This is treated as a valid compact-layout strategy rather than a hidden-action defect.

The current source identity was checked against the official remote. `origin/master`, tag `v0.4.24`, the application package, and the latest published release all identify ShellPilot 0.4.24.

## Language, theme, zoom, and keyboard matrix

The combined secondary-surface and primary-workspace Playwright matrix passed 14/14 cases in approximately 14.5 minutes:

- Chinese and English.
- Five built-in themes: Ocean, Jade, Indigo, Amber, and Graphite.
- 590×400, 820×600, 1100×700, and 1600×900 viewports, including 100%, 125%, and 150% equivalents.
- Compact top-bar keyboard reach, focus entry from internal sentinels, Escape behavior, menus and last-item reachability.
- AI panel, terminal-theme isolation, settings search/language preview, UI-font lifecycle, long Chinese AI history, bookmark groups, dialogs, menus, overlays, and danger actions.

The run recorded 408 secondary-surface checks, 408 focus checks, 278 disabled-state contrast checks, 68 danger-action checks, 34 final-menu-item checks, 34 danger-semantic checks, and zero newly introduced document-overflow failures. The focused UI contracts also passed 56/56 before the final compatibility edits; the complete final unit run subsequently included those same contracts.

## Aurora release-claim verification

The visual matrix and theme contracts confirm the v0.4.24 Aurora claims that are executable in the repository:

- semantic 10/14/18/22/28px radius roles remain mapped to controls, toolbars, cards, panels, and overlays;
- light and dark themes retain contact plus ambient depth without applying elevation to terminal character canvases, tables, logs, or file rows;
- hover/focus styling does not translate layout boxes;
- disabled, selected, warning, danger, success, and muted states remain distinguishable;
- terminal palette/font settings remain independent from the application UI theme and UI-font picker;
- the twenty grouped UI-font presets retain fallback and persistence behavior;
- no inspected visual change altered routes, data ordering, SSH/SFTP/AI safety behavior, or shortcut contracts.

The official release note says the release contains UI-only Aurora changes. The full functional suite, core desktop journeys, visual matrix, and packaged-runtime smoke collectively support that compatibility claim after the audit fixes.

## Performance and capacity

`npm run test-performance-e2e` passed 1/1 in 13.2 seconds. The focused metrics/client/takeover/startup set passed 24/24 in 276.7 ms, and the long-history/output-backpressure set passed 5/5 in 114.5 ms.

Covered budgets include startup and first terminal readiness, settings opening, first AI event, readonly Agent takeover, Fleet refresh, transfer progress, cancellation responsiveness, metric bounds/retention/atomic persistence, lazy loading, and disconnected-home startup. A 100 MB asynchronous Agent output source was consumed through a bounded window and remained cancellation-responsive; AI history opened on the latest page and expanded backward without rendering the complete history.

No performance threshold was edited or retried to obtain a pass. Vite still reports two dependency-heavy chunks over 500 kB. This is a warning and a P3 optimization opportunity, not a demonstrated startup/performance gate failure.

## Build, package, and update verification

| Gate | Result | Current evidence |
| --- | --- | --- |
| `npm run lint` | PASS | StandardJS exit 0 after the final production changes. |
| `npm run test-unit-ci` | PASS | 3,082 tests; 3,076 passed, 0 failed, 6 environment-dependent skips; 287,490.6935 ms. |
| `npm run b` | PASS | Executed inside the fresh `package:win:dir` command; Vite production build and runtime preparation passed. |
| `npm run package:win:dir` | PASS | Electron 41.2.0 / x64 directory package produced from the Chinese-path worktree; native serialport and `node-pty` modules rebuilt successfully. |
| Runtime dependency preparation | PASS | 285 runtime packages audited, 0 vulnerabilities; runtime package verification passed; 66 empty/residual directories were removed. |
| `npm run test-package-smoke` | PASS | Launched the newly built `dist/win-unpacked/ShellPilot.exe` with isolated `DATA_PATH`, initialized data, and exited cleanly. |
| `npm run release:github:dry` | PASS | Generated the intended draft/create/upload/publish command sequence without contacting a mutating release API. |
| `npm run release:update-sources:verify` | PASS | ModelScope and GitHub both reported 0.4.24 and independently byte-verified eight approved assets. |

The latest official release is `v0.4.24`, published as a non-draft, non-prerelease release. Its asset set includes installer, blockmap, portable ZIP, update metadata, checksums, and approval/release manifests. The audit did not upload or modify any remote asset.

The runtime installation still prints upstream transitive deprecation warnings for `inflight`, `lodash.isequal`, and `glob@7`. The production and full dependency audits both report zero vulnerabilities. These packages are not direct application declarations, so the audit records them as non-blocking technical debt instead of forcing incompatible overrides.

## Confirmed defects and fixes

| ID | Severity | User-visible problem | Root cause | Resolution | Evidence |
| --- | --- | --- | --- | --- | --- |
| R3-01 | P2 | Opening AI configuration or Save Workspace could emit Ant Design runtime deprecation warnings, adding noise to diagnostics and obscuring real renderer warnings. | Two vertical `Space` components still used the deprecated `direction` property. | Replaced it with the supported `orientation` property and added a source contract. | Commit `f0d05b5`; focused compatibility/localization set 35/35; final full suite passed. |
| R3-02 | P1 | English Help had 19 sections while Chinese Help had 20; English users could not find Incident Archive guidance. | The incident section was added only to the Chinese catalog, and the parity test checked selected sections instead of exact section keys. | Added complete English incident candidate, timeline, verification, bounded export, secret, and local-storage guidance; strengthened the test to require exact bilingual section parity. | Commit `f0d05b5`; focused compatibility/localization set 35/35; final full suite passed. |

## Requirement matrix updates

The final round closes all 72 formerly unverified rows and re-evaluates the 29 formerly partial rows against current desktop, unit, package, and online-release evidence. The 166-row matrix now contains:

- `已满足`: 159
- `部分满足`: 6
- `已废止`: 1
- `未验证`: 0
- `未满足`: 0
- `无法验证`: 0

The six partial rows are deliberate and explained in the matrix: complete connected SFTP two-pane/all-operation/drag-drop journeys (three rows), live remote-forward/SOCKS and non-local tunnel error journeys (two rows), and the undeployed official website (one row). Deterministic local contracts and failure behavior passed, but the missing external endpoint or deployment is not represented as full proof.

## Round conclusion

Round three is complete. Two user-facing compatibility/help defects were fixed, the full visual and keyboard matrix passed, all performance budgets passed unchanged, a fresh Windows package built and launched, and both public update sources passed byte-level asset verification. No verified P0/P1/P2 desktop-release behavior is failing. The remaining partial items require external infrastructure or a separate website implementation rather than another in-scope desktop code fix.
