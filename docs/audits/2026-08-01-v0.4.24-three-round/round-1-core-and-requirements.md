# Round 1 — Core Journeys And Requirement Compliance

## Environment

- Audit date: 2026-08-01 (Asia/Shanghai)
- Platform: Windows, PowerShell
- Isolated worktree: `F:\SSH工具开发\.worktrees\release-0.4.24`
- Audit branch: `codex/self-audit-0.4.24`
- Audited base: `28bfc97` (`origin/master` at audit start)
- Product version: `0.4.24`
- Electron E2E profile: a per-run temporary directory whose `data` child is passed as `DATA_PATH`; the normal ShellPilot profile is not reused.

## Automated baseline

| Gate | Command | Result | Evidence / notes |
| --- | --- | --- | --- |
| Lint | `npm run lint` | PASS | Exit code 0. |
| Unit and component tests | `npm test` | PASS | 3071 tests: 3065 passed, 0 failed, 6 skipped; duration 294593.7829 ms. |
| Production build and runtime preparation | `npm run b` | PASS | Vite production build completed; runtime package verification passed; `prepare-file` completed in 655.634 s. The generated bundle emitted a chunk-size warning and the production dependency install produced deprecation warnings; these are follow-up observations, not baseline failures. |
| Minimal Electron smoke | `npx playwright test test/e2e/00181.layout.spec.js test/e2e/00182.workspace.spec.js --workers=1` | PASS | 2/2 passed in 45.0 s. |

## Desktop journey results

The automated Electron smoke exercised tab creation in `twoColumnsBottom`, `twoRowsRight`, `grid2x2`, `threeRows`, `twoRows`, `threeColumns`, `twoColumns`, and `single` layouts. It also exercised opening the workspace UI, switching tabs, saving a named workspace, loading it, and deleting it. All exercised actions completed without a Playwright assertion failure or Electron launch failure.

Interactive user journeys remain pending in this round; passing the smoke tests is not treated as proof for connection, terminal, SFTP, fleet, operations, AI, or accessibility requirements.

## Confirmed defects

None confirmed by the automated baseline. Build latency, large chunks, and dependency deprecation warnings are observations to investigate in later rounds; they are not yet classified as product defects.

## Fix evidence

No production fix was made during baseline establishment.

## Requirement matrix updates

- `BASE-08` → `已满足`: both Electron tests used the shared isolated launch options with a temporary `DATA_PATH`.
- `REL-01` → `部分满足`: source identity and the production build agree on ShellPilot `0.4.24`; packaged artifact metadata remains to be checked.
- `REL-10` → `部分满足`: production build and runtime package verification passed; portable/installer/package smoke checks remain pending for round three.

## Round conclusion

The source baseline is healthy enough to continue interactive auditing: lint, the complete unit suite, production build preparation, and the minimal Electron smoke all pass. This is a baseline conclusion only, not a release-readiness conclusion.
