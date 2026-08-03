# SSH Tunnel Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved SSH tunnels recover predictably after reconnect and turn local port conflicts into an actionable, non-destructive UI flow.

**Architecture:** Add a server-side local-port inspection helper and keep it separate from tunnel controller lifecycle. The session validates local listeners before starting a controller and returns structured, serializable conflict metadata. The renderer consumes that metadata and offers an explicit “use suggested port” action without silently changing saved profiles.

**Tech Stack:** Node.js `net`, existing SSH session RPC bridge, React 19, Ant Design, Node test runner, Playwright Electron E2E.

---

### Task 1: Local port inspection contract

**Files:**
- Create: `apps/electerm-agent/src/app/server/ssh-tunnel-port.js`
- Create: `apps/electerm-agent/test/unit-ci/ssh-tunnel-port.spec.js`

- [ ] **Step 1: Write failing tests**

Cover these exact behaviors:

```js
test('returns requested port when it is available')
test('returns the first available suggestion after a conflict')
test('does not suggest a port when the bounded range is exhausted')
test('skips local inspection for remote forwarding')
```

Use an injected `canListen(host, port)` function so tests bind no real ports.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-port.spec.js
```

Expected: fail because `ssh-tunnel-port.js` does not exist.

- [ ] **Step 3: Implement the minimal helper**

Export:

```js
inspectTunnelLocalPort(definition, {
  canListen,
  maxOffset = 20
})
```

Return:

```js
{ required: false }
{ required: true, available: true, requestedPort }
{ required: true, available: false, requestedPort, suggestedPort }
```

The helper must never mutate `definition`.

- [ ] **Step 4: Verify GREEN**

Run the same test command. Expected: all four tests pass.

### Task 2: Structured start conflict

**Files:**
- Modify: `apps/electerm-agent/src/app/server/session-ssh.js`
- Modify: `apps/electerm-agent/src/app/server/ssh-tunnel-runtime.js`
- Modify: `apps/electerm-agent/test/unit-ci/ssh-tunnel-runtime.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ssh-tunnel-session.spec.js`

- [ ] **Step 1: Write failing tests**

Add coverage proving:

```js
error.code === 'SSH_TUNNEL_PORT_IN_USE'
error.details.requestedPort === 3307
error.details.suggestedPort === 3308
```

Also verify remote forwarding bypasses local inspection and that one failed auto-start does not block the next tunnel.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-runtime.spec.js test/unit-ci/ssh-tunnel-session.spec.js
```

Expected: assertions fail because errors do not contain structured details.

- [ ] **Step 3: Implement minimal server integration**

Before `startController` for local and dynamic tunnels, call `inspectTunnelLocalPort`. Throw a tunnel error with serializable `details` only when the requested port is unavailable. Extend `serializeTunnelError` to copy safe scalar detail fields.

- [ ] **Step 4: Verify GREEN**

Run the same tests and confirm zero failures.

### Task 3: Actionable renderer flow

**Files:**
- Modify: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-api.js`
- Modify: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx`
- Modify: `apps/electerm-agent/src/client/components/ssh-tunnel/ssh-tunnel-modal.styl`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Modify: `apps/electerm-agent/test/unit-ci/ssh-tunnel-ui.spec.js`

- [ ] **Step 1: Write failing UI contract tests**

Assert the modal contains:

- conflict alert with requested and suggested ports;
- explicit “改用 {port}” button;
- “临时隧道仅当前连接有效” hint;
- no automatic saved-profile mutation.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test test/unit-ci/ssh-tunnel-ui.spec.js
```

Expected: fail because the conflict action does not exist.

- [ ] **Step 3: Implement the renderer flow**

Store the last structured conflict in component state. The action updates only the draft local port, clears the conflict, and requires the user to press start again. Saving remains a separate explicit action.

- [ ] **Step 4: Verify GREEN**

Run the same tests and confirm zero failures.

### Task 4: Reconnect and conflict E2E

**Files:**
- Modify: `apps/electerm-agent/test/e2e/033.ssh-tunnel-manager.spec.js`

- [ ] **Step 1: Add failing E2E scenarios**

The fake session must:

- return `SSH_TUNNEL_PORT_IN_USE` with suggestion 3308;
- show the conflict action;
- update the draft to 3308 only after user action;
- keep the SSH tab alive when tunnel start fails;
- restore only saved auto-start profiles after simulated reconnect.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npx playwright test test/e2e/033.ssh-tunnel-manager.spec.js --workers=1
```

Expected: new scenario fails before UI implementation.

- [ ] **Step 3: Complete only the integration needed by E2E**

Do not add background processes or silently retry on another port.

- [ ] **Step 4: Verify GREEN and regression**

Run:

```powershell
npm run test-ssh-tunnel
npm run test-quality-e2e
```

Expected: all tests pass with zero failures.

### Task 5: Documentation and commit

**Files:**
- Modify: `apps/electerm-agent/src/client/components/help/help-center.jsx`
- Create: `apps/electerm-agent/docs/releases/v0.4.17.md`

- [ ] **Step 1: Update Chinese help**

Explain saved auto-start behavior, temporary tunnel lifetime, port-conflict suggestions, and why ShellPilot does not silently change ports.

- [ ] **Step 2: Add release notes**

Use `[新增]`、`[修复]`、`[改动]` sections and include only completed behavior.

- [ ] **Step 3: Run final verification**

Run:

```powershell
npm run test-ssh-tunnel
npm run test-unit-ci
```

Expected: zero failures.

- [ ] **Step 4: Commit**

```powershell
git add apps/electerm-agent/src apps/electerm-agent/test apps/electerm-agent/docs docs/superpowers
git commit -m "feat: harden SSH tunnel reconnect and port conflicts"
```
