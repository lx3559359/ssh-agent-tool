# ShellPilot SSH Tunnel Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chinese, one-click SSH tunnel wizard and runtime manager that starts and stops local, remote, and SOCKS5 forwarding without reconnecting the terminal.

**Architecture:** Keep the existing `ssh2` tunnel implementation and extend it to return disposable controllers. Route start, stop, list, and test requests through the existing common WebSocket and session child-process bridge, then expose them through a lazy-loaded React manager that shares the existing bookmark `sshTunnels` schema.

**Tech Stack:** Electron, React, Ant Design, Manate, Node.js `net`, `ssh2`, `socksv5-server`, Node test runner, Playwright.

---

## File Map

**Create**

- `apps/electerm-agent/src/app/server/ssh-tunnel-runtime.js`: normalize tunnel errors and manage one session's controller registry.
- `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-definition.js`: types, templates, validation, flow labels, and exposure-risk rules.
- `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-api.js`: client wrappers for runtime tunnel actions.
- `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx`: wizard and running-tunnel list.
- `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.styl`: responsive day/night presentation.
- `apps/electerm-agent/test/unit-ci/ssh-tunnel-definition.spec.js`: definition and validation tests.
- `apps/electerm-agent/test/unit-ci/ssh-tunnel-runtime.spec.js`: controller lifecycle and error-isolation tests.
- `apps/electerm-agent/test/unit-ci/ssh-tunnel-api-contract.spec.js`: client-to-session action contract tests.
- `apps/electerm-agent/test/unit-ci/ssh-tunnel-ui.spec.js`: static UI and translation contract tests.
- `apps/electerm-agent/test/e2e/033.ssh-tunnel-manager.spec.js`: Electron UI regression.

**Modify**

- `apps/electerm-agent/src/app/server/ssh-tunnel.js`: return closeable controllers for all three tunnel types.
- `apps/electerm-agent/src/app/server/session-ssh.js`: own runtime registry and expose start/stop/list/test methods.
- `apps/electerm-agent/src/app/server/session-api.js`: child-process session API handlers.
- `apps/electerm-agent/src/app/server/session-process.js`: proxy tunnel actions to the correct child process.
- `apps/electerm-agent/src/app/server/session-server.js`: dispatch tunnel actions inside the session child.
- `apps/electerm-agent/src/app/server/terminal-api.js`: common WebSocket response handling.
- `apps/electerm-agent/src/app/server/dispatch-center.js`: register common WebSocket tunnel actions.
- `apps/electerm-agent/src/client/components/terminal/terminal-apis.js`: expose typed tunnel request helpers.
- `apps/electerm-agent/src/client/components/main/aigshell-topbar.jsx`: lazy-load and open the tunnel manager.
- `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`: document the tunnel workflow and safety rules.
- `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`: Chinese and English UI strings.
- `apps/electerm-agent/src/client/components/bookmark-form/common/ssh-tunnel-form.jsx`: reuse definitions and replace unreadable symbolic labels.
- `apps/electerm-agent/src/client/components/bookmark-form/common/ssh-tunnels.jsx`: preserve stable IDs and `autoStart`.
- `apps/electerm-agent/package.json`: add the focused tunnel test command.

### Task 1: Tunnel Definitions, Templates, and Validation

**Files:**
- Create: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-definition.js`
- Test: `apps/electerm-agent/test/unit-ci/ssh-tunnel-definition.spec.js`

- [ ] **Step 1: Write failing definition tests**

Cover:

```js
assert.equal(normalizeTunnel({
  sshTunnel: 'forwardLocalToRemote',
  sshTunnelLocalHost: '',
  sshTunnelLocalPort: '3307',
  sshTunnelRemoteHost: '',
  sshTunnelRemotePort: '3306'
}).sshTunnelLocalHost, '127.0.0.1')

assert.equal(getTunnelRisk({
  sshTunnel: 'forwardLocalToRemote',
  sshTunnelLocalHost: '0.0.0.0'
}).requiresConfirmation, true)

assert.equal(getTunnelTemplate('mysql').sshTunnelRemotePort, 3306)
assert.throws(() => validateTunnel({ sshTunnelLocalPort: 70000 }), /端口/)
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-definition.spec.js
```

Expected: fail because `ssh-tunnel-definition.js` does not exist.

- [ ] **Step 3: Implement the shared definition module**

Export:

```js
export const tunnelTypes = Object.freeze([
  'forwardLocalToRemote',
  'forwardRemoteToLocal',
  'dynamicForward'
])

export const tunnelTemplates = Object.freeze({
  http: { localPort: 8080, remoteHost: '127.0.0.1', remotePort: 80 },
  https: { localPort: 8443, remoteHost: '127.0.0.1', remotePort: 443 },
  mysql: { localPort: 3307, remoteHost: '127.0.0.1', remotePort: 3306 },
  postgresql: { localPort: 5433, remoteHost: '127.0.0.1', remotePort: 5432 },
  redis: { localPort: 6380, remoteHost: '127.0.0.1', remotePort: 6379 },
  socks5: { type: 'dynamicForward', localPort: 1080 }
})
```

Implement `normalizeTunnel`, `validateTunnel`, `getTunnelRisk`, `getTunnelFlowText`, and `getTunnelTemplate`. Accept only supported types, valid host strings, ports `1..65535`, and names under 80 characters. Generate a stable ID only when one is absent.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-definition.spec.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-definition.js apps/electerm-agent/test/unit-ci/ssh-tunnel-definition.spec.js
git commit -m "feat: define SSH tunnel templates and validation"
```

### Task 2: Closeable Tunnel Controllers

**Files:**
- Modify: `apps/electerm-agent/src/app/server/ssh-tunnel.js`
- Create: `apps/electerm-agent/src/app/server/ssh-tunnel-runtime.js`
- Test: `apps/electerm-agent/test/unit-ci/ssh-tunnel-runtime.spec.js`

- [ ] **Step 1: Write failing lifecycle tests**

Use fake `net.Server`, SOCKS server, sockets, and an `EventEmitter` SSH connection. Assert:

```js
const controller = await forwardLocalToRemote(options)
assert.equal(controller.state, 'running')
await controller.close()
assert.equal(localServer.close.mock.calls.length, 1)
assert.equal(activeSocket.destroy.mock.calls.length, 1)
```

Also assert:

- remote forwarding calls `unforwardIn` during close;
- dynamic forwarding closes the SOCKS server;
- calling `close()` twice is harmless;
- a listener or target-socket error does not close the SSH connection;
- duplicate runtime IDs return `SSH_TUNNEL_EXISTS`.

- [ ] **Step 2: Run the lifecycle test and verify RED**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-runtime.spec.js
```

Expected: fail because current tunnel functions resolve to `1` and have no disposer.

- [ ] **Step 3: Return controllers from all tunnel functions**

Each function resolves:

```js
{
  state: 'running',
  descriptor: normalizedTunnel,
  close: async () => {
    // remove listeners, destroy active sockets, close/unregister forwarding
  }
}
```

Track active sockets and named connection listeners. For remote forwarding, call:

```js
await new Promise((resolve, reject) => {
  conn.unforwardIn(remoteHost, remotePort, err => err ? reject(err) : resolve())
})
```

If the SSH connection is already closed, cleanup local resources and treat the unforward operation as complete.

- [ ] **Step 4: Implement the runtime registry**

`createSshTunnelRuntime({ startController, probe })` owns a `Map`. It exposes:

```js
start(definition)
stop(id)
list()
test(id)
closeAll(reason)
```

Return serializable states only; never expose sockets, `conn`, callbacks, or controller objects to the renderer.

- [ ] **Step 5: Run lifecycle and existing session tests**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-runtime.spec.js test/unit-ci/session-ssh-errors.spec.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/electerm-agent/src/app/server/ssh-tunnel.js apps/electerm-agent/src/app/server/ssh-tunnel-runtime.js apps/electerm-agent/test/unit-ci/ssh-tunnel-runtime.spec.js
git commit -m "feat: add closeable SSH tunnel controllers"
```

### Task 3: Runtime Session API

**Files:**
- Modify: `apps/electerm-agent/src/app/server/session-ssh.js`
- Modify: `apps/electerm-agent/src/app/server/session-api.js`
- Modify: `apps/electerm-agent/src/app/server/session-process.js`
- Modify: `apps/electerm-agent/src/app/server/session-server.js`
- Modify: `apps/electerm-agent/src/app/server/terminal-api.js`
- Modify: `apps/electerm-agent/src/app/server/dispatch-center.js`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal-apis.js`
- Create: `apps/electerm-agent/test/unit-ci/ssh-tunnel-api-contract.spec.js`

- [ ] **Step 1: Write failing API contract tests**

Assert the renderer helpers send:

```js
{ action: 'ssh-tunnel-start', pid, tunnel }
{ action: 'ssh-tunnel-stop', pid, tunnelId }
{ action: 'ssh-tunnel-list', pid }
{ action: 'ssh-tunnel-test', pid, tunnelId }
```

Assert parent and child dispatchers return `{ id, data }`, sanitize errors to `{ code, message }`, and do not return stacks or socket objects.

- [ ] **Step 2: Run contract tests and verify RED**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-api-contract.spec.js
```

Expected: fail because the four actions are not registered.

- [ ] **Step 3: Add session-owned runtime methods**

In `TerminalSshBase`, initialize the registry after `this.conn` is ready and expose:

```js
startSshTunnel(tunnel)
stopSshTunnel(tunnelId)
listSshTunnels()
testSshTunnel(tunnelId)
closeAllSshTunnels(reason)
```

Start saved definitions through the same registry in `onInitSshReady()`. Call `closeAllSshTunnels('ssh-disconnected')` before `endConns()` closes SSH connections.

- [ ] **Step 4: Route all four actions through both process modes**

Add handlers to:

- `session-api.js` for direct child access;
- `session-process.js` proxy methods;
- `session-server.js` child dispatch;
- `terminal-api.js` common WebSocket responses;
- `dispatch-center.js` common WebSocket action selection;
- `terminal-apis.js` renderer requests.

Use one error serializer:

```js
function serializeTunnelError (error) {
  return {
    code: String(error?.code || 'SSH_TUNNEL_ERROR'),
    message: String(error?.message || 'SSH 隧道操作失败')
  }
}
```

- [ ] **Step 5: Run contract and lifecycle tests**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-api-contract.spec.js test/unit-ci/ssh-tunnel-runtime.spec.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/electerm-agent/src/app/server/session-ssh.js apps/electerm-agent/src/app/server/session-api.js apps/electerm-agent/src/app/server/session-process.js apps/electerm-agent/src/app/server/session-server.js apps/electerm-agent/src/app/server/terminal-api.js apps/electerm-agent/src/app/server/dispatch-center.js apps/electerm-agent/src/client/components/terminal/terminal-apis.js apps/electerm-agent/test/unit-ci/ssh-tunnel-api-contract.spec.js
git commit -m "feat: control SSH tunnels at runtime"
```

### Task 4: Chinese Tunnel Wizard and Runtime Manager

**Files:**
- Create: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-api.js`
- Create: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx`
- Create: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.styl`
- Modify: `apps/electerm-agent/src/client/components/main/aigshell-topbar.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Create: `apps/electerm-agent/test/unit-ci/ssh-tunnel-ui.spec.js`

- [ ] **Step 1: Write failing UI contract tests**

Assert source contains:

- lazy import of `ssh-tunnel-modal`;
- topbar action key `sshTunnel`;
- Chinese labels for the three tunnel types;
- `连接 SSH 后启动` disabled-state text;
- running-state actions for copy, test, edit/restart, save, auto-start, and stop;
- no use of terminal text injection or `ssh -L/-R/-D`.

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-ui.spec.js
```

Expected: fail because the manager does not exist.

- [ ] **Step 3: Build the client API adapter**

Resolve the current endpoint using the same `refs.get('term-' + tab.id)` pattern as the operations toolkit. Return:

```js
{
  tabId,
  pid: terminal.pid,
  host,
  port,
  username,
  title,
  bookmarkId: tab.srcId
}
```

Refuse runtime actions when the active terminal is absent, not SSH, disconnected, or does not match the visible tab.

- [ ] **Step 4: Build the modal**

Use one modal with:

- type cards and templates;
- compact form fields;
- live flow preview;
- risk banner only when required;
- runtime list grouped by current session;
- explicit empty and disconnected states.

The primary action reads `启动隧道`, `连接 SSH 后启动`, or `保存配置` according to state. Stopping and status refresh never require confirmation. Exposure-risk confirmation uses Ant Design `Modal.confirm` once per start.

- [ ] **Step 5: Add the topbar action**

Lazy-load the modal through `LazyModuleBoundary`. Add a `SwapOutlined` or `LinkOutlined` icon and label `SSH 隧道`. Keep it enabled while disconnected so users can browse and configure; runtime controls remain disabled.

- [ ] **Step 6: Add responsive styles**

At normal width, render a two-column wizard/list layout. Below 1100 pixels or at effective 125%/150% scaling, switch to one column and constrain the modal body with vertical scrolling. Verify button labels do not wrap vertically.

- [ ] **Step 7: Run UI and lint checks**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-ui.spec.js
npx standard src/client/components/ssh-tunnel/*.js src/client/components/ssh-tunnel/*.jsx src/client/components/main/aigshell-topbar.jsx
```

Expected: all pass.

- [ ] **Step 8: Commit**

```powershell
git add apps/electerm-agent/src/client/components/ssh-tunnel apps/electerm-agent/src/client/components/main/aigshell-topbar.jsx apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/ssh-tunnel-ui.spec.js
git commit -m "feat: add one-click SSH tunnel manager"
```

### Task 5: Bookmark Persistence and Advanced-Form Compatibility

**Files:**
- Modify: `apps/electerm-agent/src/client/components/bookmark-form/common/ssh-tunnel-form.jsx`
- Modify: `apps/electerm-agent/src/client/components/bookmark-form/common/ssh-tunnels.jsx`
- Modify: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx`
- Test: `apps/electerm-agent/test/unit-ci/ssh-tunnel-definition.spec.js`

- [ ] **Step 1: Extend tests for old and new bookmark data**

Assert old entries without `id` or `autoStart` normalize without mutation. Assert UI-only keys such as `state`, `error`, `controller`, and `lastTestAt` are removed before persistence.

- [ ] **Step 2: Run the compatibility test and verify RED**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-definition.spec.js
```

Expected: fail until serialization is implemented.

- [ ] **Step 3: Implement safe serialization and saving**

Export `serializeTunnelForBookmark` and use `store.editItem(bookmarkId, { sshTunnels }, settingMap.bookmarks)` for existing bookmarks. For history-only sessions, offer “另存为服务器” rather than mutating history.

Only definitions with `autoStart !== false` are passed into a new SSH connection. Preserve old entries as auto-starting to avoid changing existing behavior.

- [ ] **Step 4: Clean the advanced form**

Replace corrupted arrow labels with full Chinese text:

- `本地端口访问远程服务`
- `远程端口访问本地服务`
- `SOCKS5 动态代理`

Reuse the shared validator and flow formatter so the advanced form and one-click manager cannot disagree.

- [ ] **Step 5: Run compatibility and existing bookmark tests**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-definition.spec.js test/unit/quick-connect.spec.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/electerm-agent/src/client/components/bookmark-form/common/ssh-tunnel-form.jsx apps/electerm-agent/src/client/components/bookmark-form/common/ssh-tunnels.jsx apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx apps/electerm-agent/test/unit-ci/ssh-tunnel-definition.spec.js
git commit -m "feat: persist SSH tunnel profiles safely"
```

### Task 6: Help, Electron E2E, and Failure Isolation

**Files:**
- Modify: `apps/electerm-agent/src/client/components/main/help-center-modal.jsx`
- Create: `apps/electerm-agent/test/e2e/033.ssh-tunnel-manager.spec.js`
- Modify: `apps/electerm-agent/package.json`

- [ ] **Step 1: Add the focused test script**

Add:

```json
"test-ssh-tunnel": "node --test test/unit-ci/ssh-tunnel-*.spec.js && playwright test test/e2e/033.ssh-tunnel-manager.spec.js --workers=1"
```

- [ ] **Step 2: Write Electron E2E tests**

Mock tunnel runtime APIs and verify:

1. disconnected state opens without a blank panel;
2. MySQL template fills `127.0.0.1:3306` and local port `3307`;
3. starting changes status to `运行中`;
4. stopping returns to `已停止`;
5. `0.0.0.0` requires confirmation;
6. a module or API failure shows retryable Chinese feedback;
7. closing the manager does not close the SSH tab;
8. reopening the manager refreshes runtime state.

- [ ] **Step 3: Run E2E and verify failures are useful**

Run:

```powershell
npx playwright test test/e2e/033.ssh-tunnel-manager.spec.js --workers=1 --reporter=line
```

Expected before final fixes: any failure points to a specific state or selector, not a generic timeout.

- [ ] **Step 4: Complete help content and failure isolation**

Document local, remote, and dynamic examples, default loopback safety, automatic cleanup, and common errors (`EADDRINUSE`, forwarding prohibited, target refused, disconnected session).

- [ ] **Step 5: Run focused validation**

Run:

```powershell
npm run test-ssh-tunnel
```

Expected: all tunnel unit and Electron tests pass.

- [ ] **Step 6: Commit**

```powershell
git add apps/electerm-agent/src/client/components/main/help-center-modal.jsx apps/electerm-agent/test/e2e/033.ssh-tunnel-manager.spec.js apps/electerm-agent/package.json
git commit -m "test: cover SSH tunnel manager workflows"
```

### Task 7: Full Regression, Real SSH Verification, and Local Package

**Files:**
- Modify only if a verified defect is found.

- [ ] **Step 1: Run all unit tests**

```powershell
node --test --test-reporter=dot test/unit-ci/*.spec.js
```

Expected: exit code `0`.

- [ ] **Step 2: Run the primary Electron regressions**

```powershell
npx playwright test test/e2e/006.ai-chat.spec.js test/e2e/026.primary-workspace-regression.spec.js test/e2e/027.quality-core-flows.spec.js test/e2e/032.operations-toolkit.spec.js test/e2e/033.ssh-tunnel-manager.spec.js --workers=1 --reporter=line
```

Expected: all pass; SSH, SFTP, AI, operations toolkit, and window layout remain usable.

- [ ] **Step 3: Build production assets**

```powershell
npm run compile
```

Expected: Vite/Electron build exits `0`; the tunnel manager is emitted as a lazy chunk.

- [ ] **Step 4: Perform real-server local-forward verification**

Using the existing private VPS test data, connect normally and create a loopback-only local forward to an available remote test port. Verify:

- tunnel reaches `运行中`;
- the local port accepts traffic through SSH;
- stop releases the local port;
- disconnect releases the local port;
- invalid target reports failure without closing the terminal;
- no password or key material appears in logs.

Do not expose `0.0.0.0` and do not change server firewall or SSH daemon configuration during this test.

- [ ] **Step 5: Verify responsive UI**

Capture and inspect day/night screenshots at:

- 1366×768, 100%;
- 1920×1080, 100%;
- 1536×864 effective viewport for Windows 125%;
- 1280×720 effective viewport for Windows 150%.

Expected: no clipped form controls, vertical button text, terminal overlap, or inaccessible close button.

- [ ] **Step 6: Build an isolated unpacked package**

```powershell
npx electron-builder --win dir --x64 --config build/electron-builder.json --config.directories.output=dist/local-ssh-tunnel-verification
node build/bin/package-smoke-test.js --app "dist/local-ssh-tunnel-verification/win-unpacked/ShellPilot.exe"
```

Expected: package smoke test passes and the existing release directories remain untouched.

- [ ] **Step 7: Final diff audit**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; unrelated local files and prior artifact fixes remain intact and are not reverted.

- [ ] **Step 8: Commit verified follow-up fixes, if any**

Stage only tunnel-related verified fixes:

```powershell
git add -- apps/electerm-agent/src/app/server/ssh-tunnel.js apps/electerm-agent/src/app/server/ssh-tunnel-runtime.js apps/electerm-agent/src/app/server/session-ssh.js apps/electerm-agent/src/app/server/session-api.js apps/electerm-agent/src/app/server/session-process.js apps/electerm-agent/src/app/server/session-server.js apps/electerm-agent/src/app/server/terminal-api.js apps/electerm-agent/src/app/server/dispatch-center.js apps/electerm-agent/src/client/components/ssh-tunnel apps/electerm-agent/src/client/components/terminal/terminal-apis.js apps/electerm-agent/src/client/components/main/aigshell-topbar.jsx apps/electerm-agent/src/client/components/main/help-center-modal.jsx apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/src/client/components/bookmark-form/common/ssh-tunnel-form.jsx apps/electerm-agent/src/client/components/bookmark-form/common/ssh-tunnels.jsx apps/electerm-agent/test/unit-ci/ssh-tunnel-definition.spec.js apps/electerm-agent/test/unit-ci/ssh-tunnel-runtime.spec.js apps/electerm-agent/test/unit-ci/ssh-tunnel-api-contract.spec.js apps/electerm-agent/test/unit-ci/ssh-tunnel-ui.spec.js apps/electerm-agent/test/e2e/033.ssh-tunnel-manager.spec.js apps/electerm-agent/package.json
git commit -m "fix: close SSH tunnel verification gaps"
```

Skip this commit when verification required no changes.
