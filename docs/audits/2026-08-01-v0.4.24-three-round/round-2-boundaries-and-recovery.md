# Round 2 — Boundaries, Recovery, And Dependency Integrity

## Environment

- Audit date: 2026-08-01 to 2026-08-02 (Asia/Shanghai)
- Platform: Windows, PowerShell
- Isolated worktree: `F:\SSH工具开发\.worktrees\release-0.4.24`
- Audit branch: `codex/self-audit-0.4.24`
- Product version: `0.4.24`
- Remote policy: no production server was mutated. Desktop E2E used isolated `DATA_PATH` directories and deterministic local fixtures.

## Invalid and extreme inputs

The focused invalid-input set ran 58/58 tests successfully in 2.395 s:

```text
node --test \
  test/unit-ci/quick-connect.spec.js \
  test/unit-ci/sftp-file-name-validation.spec.js \
  test/unit-ci/ai-attachments.spec.js \
  test/unit-ci/ai-content-ingestion.spec.js \
  test/unit-ci/ai-empty-response-consumers.spec.js \
  test/unit-ci/operations-parameter-value.spec.js
```

Evidence included empty and dot-only filenames, unsafe preview content, IPv6 and raw `user@host` quick-connect inputs, unsupported and forged image types, oversized Office expansion, SFTP/local/browser attachments, null/undefined AI responses, stale async results, public/private URL boundaries, and operation-parameter normalization. Invalid input failed before an empty model request or unsafe remote action.

## Concurrency and stale state

The focused cancellation/recovery set ran 46/46 tests successfully in 287.858 ms. It covered Agent lifecycle/status races, AbortSignal propagation, hung backend/tool cancellation, AI conversation scoping, transfer terminal races, SFTP recovery, serialized persistence queues, dormant tab restoration, and rejection of late results after dispose or restart.

`027.quality-core-flows.spec.js` and `028.crash-recovery.spec.js` then passed 2/2 desktop journeys in 17.8 s. Crash recovery restored safe dormant tabs and a task summary without reconnecting to SSH, dispatching a command, or replaying an uncertain mutation.

## Disconnect, cancellation, and restart

- AI/Agent stop is idempotent and scoped to the active conversation/session.
- Completion and cancellation races retain one authoritative final state.
- Hung local or remote work releases its registry lock without waiting indefinitely.
- Cancellation does not claim that rollback occurred.
- Persisted running transfers/tasks reconcile to authoritative final or interrupted/retryable state after restart.
- Stale callbacks cannot overwrite completed, cancelled, failed, partial, or unknown state.
- State persistence queues flush in order and propagate failures instead of reporting premature success.

## Safety and redaction

The focused safety/redaction set passed 40/40 tests in 607 ms. It verified exact endpoint/account/target binding, frozen arguments and verification plans, ordered-call identity, pre-dispatch blocking, readonly fast paths, recovery reservation and binding, no replay after uncertain outcomes, serialized safety persistence, and nested redaction across diagnostic objects, errors, headers, cookies, commands, renderer reports, logs, and session logs.

The quality E2E additionally confirmed that its SSH password, API token, and local AI request body did not appear in collected logs.

## Dependency audit and package integrity

Four dependency/build defects were found and fixed:

| ID | Severity | Problem | Resolution | Verification |
| --- | --- | --- | --- | --- |
| R2-01 | P1 | The lockfile resolved ExcelJS's declared Archiver 5 dependency to incompatible Archiver 7.0.1. | Regenerated the lock to resolve Archiver 5.3.2 and added a major-compatibility regression test. | Office DOCX/XLSX/PDF tests passed; production tree resolution is valid. |
| R2-02 | P1 | The full development/build dependency tree contained eight high advisories through Electron Builder 26.9.0 and PostCSS 8.5.15. | Updated Electron Builder within major 26 to 26.15.3 and PostCSS to 8.5.25. | Full `npm audit` reports 0 vulnerabilities across 1,113 dependencies; production audit also reports 0. |
| R2-03 | P1 | Windows packaging from a workspace with Chinese path segments failed while rebuilding `node-pty`: Python decoded a generated UTF-8 Visual Studio filters file as GBK. | Force Python UTF-8 mode in the direct Windows package command and shared Electron build environment, while preserving an explicit developer override. | Failing regression turned green; `node-pty` rebuilt twice and `package:win:dir` completed from the audited Chinese path. |
| R2-04 | P2 | Cleanup removed optional `cpu-features` but left its sole build helper `buildcheck` as an extraneous development and package-preparation residue. | Centralized cleanup of both modules in post-install and package preparation. | Temporary-directory regression passed; actual root/work residues were removed without touching `node-pty`. |

Package evidence:

- `npm run lint`: pass.
- Dependency/build/Office focused regression: 32/32 pass.
- `npm run package:win:dir`: pass with Electron 41.2.0 and Electron Builder 26.15.3.
- Native `@serialport/bindings-cpp` and `node-pty` rebuilds: pass.
- Runtime package verification: pass.
- `npm run test-package-smoke`: pass; launched `dist/win-unpacked/ShellPilot.exe`, initialized isolated data, and exited cleanly.
- `npm audit --json`: 0 info, low, moderate, high, or critical vulnerabilities.

The build still emits warning-only observations for deprecated transitive packages under ExcelJS/Archiver 5 and Vite chunks over 500 kB. They have no current advisory or demonstrated failure and are carried into round three for performance/release characterization rather than hidden.

## Real external smoke tests

- `030.real-server-regression.spec.js`: skipped because `SHELLPILOT_E2E_*` credentials were not configured.
- `031.agent-readonly-real-server.spec.js`: skipped for the same reason.
- `npm run smoke:ssh-sftp`: failed closed before network activity because `SHELLPILOT_SSH_HOST`, `SHELLPILOT_SSH_USER`, `SHELLPILOT_SSH_PASSWORD`, and `SHELLPILOT_SSH_HOST_FINGERPRINT` were absent.
- External AI smoke was not run because no explicit audit-only base URL, model, and key were configured. The script can otherwise read the normal profile, which this audit deliberately did not authorize.

These are environment-unavailable checks, not product passes or product failures. Local SSH/SFTP/AI fixtures and package smoke supplied deterministic coverage, but they do not prove compatibility with the user's particular external server or provider.

## Requirement matrix updates

After round two, the 166 requirements are classified as:

- `已满足`: 64
- `部分满足`: 29
- `未验证`: 72
- `已废止`: 1
- `未满足`: 0
- `无法验证`: 0

Round two promoted 30 requirements to satisfied, primarily in secret protection, error pages, crash recovery, terminal/session lifecycle, SFTP boundaries/recovery, AI cancellation/content ingestion, safety transactions, and dependency integrity. Remaining unverified requirements are dominated by full visual/theme/language coverage, performance, release/update policy, and feature journeys scheduled for round three.

## Round conclusion

Round two is complete. Four concrete dependency/build defects were fixed, all focused abnormal-input/cancellation/security tests passed, a real Windows package was built and launched from the Chinese-path worktree, and the full dependency advisory count is zero. No verified P0 behavior failed. External server/provider coverage remains explicitly unavailable without credentials and is not represented as passed.
