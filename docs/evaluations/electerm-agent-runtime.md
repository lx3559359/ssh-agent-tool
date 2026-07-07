# Electerm Agent Runtime Validation

Date: 2026-07-07

## Environment

- Windows: `Windows_NT 10.0.26200`
- Node.js from PATH: `v24.18.0`
- npm from PATH: `11.16.0`
- Visual Studio C++ Build Tools: not found (`msbuild` and `cl` not found)
- Windows OpenSSH Agent service: changed from `Disabled/Stopped` to `Manual/Running` during validation

## Commands

| Command | Result | Notes |
|---|---|---|
| `npm install` | FAIL | First failed on npm peer resolution because `@types/node@22.9.3` did not satisfy `vite@8.1.0` peer range `^20.19.0 || >=22.12.0`; after updating `@types/node` to `22.12.0`, install failed compiling `node-pty@1.1.0-beta34` because Visual Studio C++ Build Tools were not installed. |
| `npm install --ignore-scripts` | PASS | Installed 972 packages for diagnostic build only. This skips Electron download and native rebuilds, so it is not a valid runtime install. |
| `node node_modules/electron/install.js` | PASS | Downloaded Electron binary after script-skipped install. |
| `npm run test-unit-ci` | FAIL | 49/54 passed. Five SSH-agent tests failed. Before enabling the Windows service: `unable to start ssh-agent service, error :1058`. After enabling it: Windows `ssh-agent -a ... -s` produced no Unix-style env output, so tests failed with `Cannot parse ssh-agent output`. |
| `npm run build` | PASS | Vite production build completed successfully. Output went to ignored `apps/electerm-agent/work/`. |
| `npm run start` | PARTIAL | Started Vite dev server at `http://127.0.0.1:5570`; HTTP check returned `200`. One run reported `WebSocket server error: Port 30085 is already in use`. |
| `npm run app` with Vite running | PARTIAL | Electron main process started and backend logged `server runs on 127.0.0.1 30975`. No immediate crash was observed, but terminal runtime cannot be accepted because `node-pty` native build is missing. |

## Test Detail

Passing areas from `npm run test-unit-ci`:

- Filename sanitization.
- SSH known_hosts verification.
- SSH password-first auth flows.
- SSH key auth with RSA and Ed25519 passphrases.
- SSH MFA/keyboard-interactive auth flows.
- FTP transport flows.
- Serial transport flows.
- Telnet transport flows.
- Terminal OSC color query helpers.

Failing areas:

- SSH-agent-only auth tests on Windows.
- Root cause is Windows OpenSSH Agent behavior in this environment, not the password/key SSH flow.

## Manual SSH Checks

| Check | Result | Notes |
|---|---|---|
| Add SSH host | NOT RUN | Blocked until valid runtime install with `node-pty` native module. |
| Open SSH terminal | NOT RUN | Blocked until valid runtime install with `node-pty` native module. |
| Press Enter after command | NOT RUN | Blocked until valid runtime install with `node-pty` native module. |
| Ctrl+C interrupts command | NOT RUN | Blocked until valid runtime install with `node-pty` native module. |
| SFTP list directory | NOT RUN | Needs live app runtime and test host. |
| Upload/download small file | NOT RUN | Needs live app runtime and test host. |

## Decision

Do not proceed to custom Agent UI or model API integration yet.

Electerm remains the correct formal base, but this Windows development machine needs a reproducible native build setup before SSH terminal behavior can be accepted. Required next work:

1. Pin a supported Node.js LTS version for the project, preferably Node 22 LTS instead of Node 24.
2. Install or document Visual Studio Build Tools with the `Desktop development with C++` workload for `node-pty`.
3. Run `npm install` without `--ignore-scripts`.
4. Re-run `npm run test-unit-ci`, `npm run build`, `npm run start`, and a real SSH/SFTP smoke test.

Only after a real SSH terminal can open, run commands, handle Enter, handle `Ctrl+C`, and browse SFTP should Agent-side development continue.
