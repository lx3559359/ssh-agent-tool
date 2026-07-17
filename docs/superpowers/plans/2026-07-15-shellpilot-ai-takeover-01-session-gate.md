# ShellPilot AI Takeover Phase 01 Session Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加默认关闭、每个 SSH 会话独立授权的 AI 接管开关，并确保所有远程执行能力在统一门禁处验证精确会话身份。

**Architecture:** 接管授权只保存在渲染进程内存的会话注册表中，不写入配置或恢复数据；授权键由标签页、连接进程、主机、端口、用户、SSH 类型和已验证主机密钥指纹组成。复用 v0.4.3 的 `agent-runtime-context.js`、`ai-conversation-context.js` 和 `agent-task-registry.js` 管理运行上下文与任务，新的注册表只负责授权和接管状态。

**Tech Stack:** React、Manate、Node.js、现有 SSH host verifier、safety-transactions endpoint guard、Node test runner。

---

## 前置条件

- `codex/fleet-operations-release` 已进入当前分支基线，版本为 ShellPilot v0.4.3。
- 在 `.worktrees/ai-takeover-user-skills` 的 `codex/ai-takeover-user-skills` 分支执行。
- 每次只暂存本阶段列出的文件，不暂存主工作树的 `.superpowers/`。

## Task 1: 把已验证主机指纹加入精确端点身份

**Files:**
- Modify: `apps/electerm-agent/src/app/server/ssh-known-hosts.js`
- Modify: `apps/electerm-agent/src/app/server/session-ssh.js`
- Modify: `apps/electerm-agent/src/app/server/session-api.js`
- Modify: `apps/electerm-agent/src/app/server/session-process.js`
- Modify: `apps/electerm-agent/src/client/common/safety-transactions/endpoint-guard.js`
- Modify: `apps/electerm-agent/src/client/common/safety-transactions/models.js`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal-safety-controller.js`
- Modify: `apps/electerm-agent/src/client/components/terminal/terminal.jsx`
- Test: `apps/electerm-agent/test/unit-ci/session-ssh-known-hosts.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/session-api-identity.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/session-process.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/safety-transaction-domain.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-takeover-endpoint.spec.js`

- [x] **Step 1: 写入失败测试，要求 host verifier 回传已接受指纹**

Add a test using the existing `createHostVerifier` fixture:

```js
test('reports the exact accepted host key metadata', async () => {
  const tempDir = await fs.promises.mkdtemp(join(os.tmpdir(), 'electerm-known-hosts-'))
  try {
    const accepted = []
    const hostKey = createHostKey('takeover-endpoint')
    const verified = await new Promise((resolve, reject) => {
      const verifier = createHostVerifier({
        host: 'example.test',
        port: 22,
        knownHostsPath: join(tempDir, 'known_hosts'),
        confirm: async () => true,
        onVerified: meta => accepted.push(meta),
        onError: reject
      })
      verifier(hostKey, resolve)
    })
    assert.equal(verified, true)
    assert.equal(accepted.length, 1)
    assert.match(accepted[0].fingerprint, /^SHA256:/)
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
})
```

- [x] **Step 2: 写入失败测试，要求严格身份包含指纹**

```js
test('strict SSH endpoint identity includes host key fingerprint', async () => {
  const { projectEndpoint } = await import('../../src/client/common/safety-transactions/endpoint-guard.js')
  const endpoint = projectEndpoint({
    tabId: 'tab-a', pid: 'pid-a', terminalPid: 'term-a', sessionType: 'ssh',
    host: 'srv.test', port: 22, username: 'ops', hostKeyFingerprint: 'SHA256:abc'
  })
  assert.equal(endpoint.hostKeyFingerprint, 'SHA256:abc')
})
```

- [x] **Step 3: 运行测试并确认失败**

```powershell
Set-Location apps/electerm-agent
node --test test/unit-ci/session-ssh-known-hosts.spec.js test/unit-ci/safety-transaction-domain.spec.js test/unit-ci/agent-takeover-endpoint.spec.js
```

Expected: `onVerified` 未调用或 endpoint 缺少 `hostKeyFingerprint`，测试失败。

- [x] **Step 4: 实现一次性指纹回传和只读会话元数据传播**

Add `onVerified(meta)` only after the verifier has accepted the key. Normalize the public value as `SHA256:<base64>` and expose it through the existing session metadata response; never expose raw host key bytes.

In `endpoint-guard.js`, make the strict projection include:

```js
const STRICT_SESSION_FIELDS = [
  'tabId',
  'pid',
  'terminalPid',
  'sessionType',
  'hostKeyFingerprint'
]
```

Reject an SSH endpoint as incomplete when the accepted fingerprint is missing. Do not apply this requirement to local, serial, RDP, VNC or Telnet sessions; those session types cannot enable SSH takeover.

- [x] **Step 5: 运行测试并提交**

```powershell
node --test test/unit-ci/session-ssh-known-hosts.spec.js test/unit-ci/safety-transaction-domain.spec.js test/unit-ci/agent-takeover-endpoint.spec.js
git add src/app/server/ssh-known-hosts.js src/app/server/session-ssh.js src/app/server/session-api.js src/app/server/session-process.js src/client/common/safety-transactions/endpoint-guard.js src/client/common/safety-transactions/models.js src/client/components/terminal/terminal-safety-controller.js src/client/components/terminal/terminal.jsx test/unit-ci/session-ssh-known-hosts.spec.js test/unit-ci/session-api-identity.spec.js test/unit-ci/session-process.spec.js test/unit-ci/safety-transaction-domain.spec.js test/unit-ci/agent-takeover-endpoint.spec.js test/unit-ci/terminal-safety-controller.spec.js
git commit -m "feat: bind agent takeover to verified ssh identity"
```

Expected: tests pass; commit contains no private key, password or raw host key.

## Task 2: 建立接管状态机和内存注册表

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/agent-takeover-state.js`
- Create: `apps/electerm-agent/src/client/components/ai/agent-takeover-registry.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-takeover-state.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-takeover-registry.spec.js`

- [x] **Step 1: 写入状态转换失败测试**

```js
test('allows only declared takeover transitions', async () => {
  const { canTransition } = await import('../../src/client/components/ai/agent-takeover-state.js')
  assert.equal(canTransition('off', 'enabling'), true)
  assert.equal(canTransition('enabling', 'active-idle'), true)
  assert.equal(canTransition('active-idle', 'running-readonly'), true)
  assert.equal(canTransition('running-readonly', 'running-confirmed-change'), false)
  assert.equal(canTransition('awaiting-risk-confirmation', 'running-confirmed-change'), true)
  assert.equal(canTransition('running-confirmed-change', 'verifying'), true)
  assert.equal(canTransition('verifying', 'active-idle'), true)
})
```

Also assert all active states can enter `stopping`, then `off`, and execution states can enter `failed` or `partially-completed`.

- [x] **Step 2: 写入会话隔离和非持久化失败测试**

```js
test('keeps takeover grants isolated by exact session identity', async () => {
  const { createTakeoverRegistry } = await import('../../src/client/components/ai/agent-takeover-registry.js')
  const registry = createTakeoverRegistry()
  const endpoint = overrides => ({
    tabId: 'tab-a', pid: 'pid-a', terminalPid: 'terminal-a', sessionType: 'ssh',
    host: 'srv.test', port: 22, username: 'ops', hostKeyFingerprint: 'SHA256:abc',
    ...overrides
  })
  const first = endpoint({ tabId: 'a', pid: '1' })
  const second = endpoint({ tabId: 'b', pid: '2' })
  registry.enable(first)
  assert.equal(registry.isActive(first), true)
  assert.equal(registry.isActive(second), false)
  assert.equal(JSON.stringify(registry.snapshot()).includes('password'), false)
})
```

- [x] **Step 3: 运行测试并确认模块缺失**

```powershell
node --test test/unit-ci/agent-takeover-state.spec.js test/unit-ci/agent-takeover-registry.spec.js
```

Expected: module-not-found failure.

- [x] **Step 4: 实现纯状态机和可订阅注册表**

Export these exact states:

```js
export const TAKEOVER_STATES = Object.freeze([
  'off',
  'enabling',
  'active-idle',
  'running-readonly',
  'awaiting-risk-confirmation',
  'running-confirmed-change',
  'verifying',
  'stopping',
  'failed',
  'partially-completed'
])
```

The registry API is `enable(endpoint)`, `transition(endpoint, nextState)`, `disable(endpoint, reason)`, `stop(endpoint)`, `get(endpoint)`, `isActive(endpoint)`, `assertActive(endpoint)`, `subscribe(listener)` and `snapshot()`. Freeze a normalized copy of the endpoint at enable time. Keep records only in a closure-owned `Map`; do not connect it to Manate persisted store or config serialization.

- [x] **Step 5: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-takeover-state.spec.js test/unit-ci/agent-takeover-registry.spec.js
git add src/client/components/ai/agent-takeover-state.js src/client/components/ai/agent-takeover-registry.js test/unit-ci/agent-takeover-state.spec.js test/unit-ci/agent-takeover-registry.spec.js
git commit -m "feat: add per-session takeover state registry"
```

## Task 3: 在 Agent 工具入口增加统一接管门禁

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/agent-tool-scopes.js`
- Create: `apps/electerm-agent/src/client/components/ai/agent-takeover-gate.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-takeover-registry.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-tools.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-runtime-context.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-takeover-gate.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-agent-tools.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-empty-response-consumers.spec.js`

- [x] **Step 1: 写入失败测试，覆盖所有已有工具**

Create a table-driven test that imports the exported tool descriptors and asserts every tool has one scope:

```js
const VALID_SCOPES = new Set(['conversation', 'session-read', 'session-write', 'session-control'])
for (const tool of tools) {
  assert.equal(VALID_SCOPES.has(tool.scope), true, `${tool.name} has a scope`)
}
```

Assert `conversation` tools work while takeover is off, and every other scope throws an error with code `AI_TAKEOVER_REQUIRED` before its executor is invoked.

- [x] **Step 2: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-takeover-gate.spec.js test/unit-ci/ai-agent-tools.spec.js
```

Expected: tool descriptors lack scope or tools execute without an active grant.

- [x] **Step 3: 实现门禁并把 runtime 传到单一执行入口**

The public gate contract is:

```js
export function assertAgentExecutionAllowed ({ descriptor, endpoint, registry }) {
  if (descriptor.scope === 'conversation') return
  registry.assertActive(endpoint)
}
```

Change `executeToolCall` to resolve one descriptor, call the gate exactly once, and only then invoke the executor. Extend the existing runtime created by `runAgentLoop` with `endpoint` and `takeoverRegistry`; retain its `AbortSignal`, cancellation set, `sourceTabId` binding and bounded-message helpers. Resolve endpoint from the active `conversationScopeId`/`sourceTabId`, then verify the complete endpoint rather than trusting the tab ID alone. Phase 01 only establishes scope and takeover enforcement; phase 02 owns final read/write risk policy.

- [x] **Step 4: 增加回归断言，禁止直接 switch 绕过门禁**

In `ai-agent-tools.spec.js`, assert every exported callable tool routes through `assertAgentExecutionAllowed` and that `send_terminal_command`, SFTP mutation, background command and local CLI cannot run while takeover is off.

- [x] **Step 5: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-takeover-gate.spec.js test/unit-ci/ai-agent-tools.spec.js test/unit-ci/agent-task-mode.spec.js
git add src/client/components/ai/agent-tool-scopes.js src/client/components/ai/agent-takeover-gate.js src/client/components/ai/agent-takeover-registry.js src/client/components/ai/agent-tools.js src/client/components/ai/agent.js src/client/components/ai/agent-runtime-context.js test/unit-ci/agent-takeover-gate.spec.js test/unit-ci/ai-agent-tools.spec.js test/unit-ci/ai-empty-response-consumers.spec.js
git commit -m "feat: require takeover grant for agent execution tools"
```

## Task 4: 增加局部接管 UI，不改变主布局

**Files:**
- Create: `apps/electerm-agent/src/client/components/ai/agent-takeover-controls.jsx`
- Modify: `apps/electerm-agent/src/client/components/ai/agent.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai.styl`
- Modify: `apps/electerm-agent/src/client/components/common/modal.jsx`
- Modify: `apps/electerm-agent/src/client/components/side-panel-r/side-panel-r.jsx`
- Modify: `apps/electerm-agent/src/client/components/main/main.jsx`
- Modify: `apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-takeover-ui.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-chat-layout.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/ai-empty-response-consumers.spec.js`
- Modify: `apps/electerm-agent/test/unit-ci/shellpilot-i18n-overrides.spec.js`

- [x] **Step 1: 写入 UI 合同失败测试**

Assert source and rendered fixture expose:

```js
assert.match(source, /role=['"]switch['"]/)
assert.match(source, /aria-checked=/)
assert.match(source, /AI 接管/)
assert.match(source, /一键停止/)
assert.doesNotMatch(sidePanelSource, /takeover[^\n]*width:\s*\d+px/)
```

Also assert non-SSH tabs render the control disabled with an explanation, and narrow layout preserves the existing right panel dimensions.

- [x] **Step 2: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-takeover-ui.spec.js test/unit-ci/ai-chat-layout.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
```

Expected: takeover switch and translations are absent.

- [x] **Step 3: 实现启用确认和状态展示**

Place the compact switch in the existing AI assistant header beside the v0.4.3 profile/model selection and health status, without replacing or rescheduling `aiHealthCoordinator`. Before calling `registry.enable`, show host, port, username, fingerprint, automatic-read-only behavior and risky-operation confirmation rule. Use the current modal system. Show a compact tab badge only while active. Show `一键停止` for all active or executing states. Hiding the right panel must not stop the task.

- [x] **Step 4: 验证主题、缩放和键盘语义**

Use existing color tokens and responsive breakpoints. The switch must support Space/Enter, modal focus trap, Escape cancel and visible focus. Add Chinese and English strings through `shellpilot-i18n-overrides.js`.

- [x] **Step 5: 运行测试并提交**

```powershell
node --test test/unit-ci/agent-takeover-ui.spec.js test/unit-ci/ai-chat-layout.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js test/unit-ci/shellpilot-ui-responsive.spec.js
git add src/client/components/ai/agent-takeover-controls.jsx src/client/components/ai/agent.js src/client/components/ai/ai.styl src/client/components/common/modal.jsx src/client/components/side-panel-r/side-panel-r.jsx src/client/components/main/main.jsx src/client/common/shellpilot-i18n-overrides.js test/unit-ci/agent-takeover-ui.spec.js test/unit-ci/ai-chat-layout.spec.js test/unit-ci/ai-empty-response-consumers.spec.js test/unit-ci/shellpilot-i18n-overrides.spec.js
git commit -m "feat: add session takeover controls to ai panel"
```

## Task 5: 绑定断线、重连、标签关闭、身份变化和应用重启

**Files:**
- Modify: `apps/electerm-agent/src/client/components/ai/agent-takeover-registry.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-task-registry.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent-runtime-context.js`
- Modify: `apps/electerm-agent/src/client/components/ai/ai-conversation-context.js`
- Modify: `apps/electerm-agent/src/client/components/main/main.jsx`
- Modify: `apps/electerm-agent/src/client/store/init-state.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-takeover-lifecycle.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-takeover-concurrency.spec.js`
- Create: `apps/electerm-agent/test/unit-ci/agent-takeover-fleet-boundary.spec.js`

- [ ] **Step 1: 写入生命周期失败测试**

Table-test these events: `disconnect`, `reconnect-start`, `tab-close`, `endpoint-change`, `app-before-quit`, `manual-stop`. Each event must move the matching grant to off, abort its active task, invalidate pending confirmations and leave unrelated sessions active.

Also reload a fresh store and assert:

```js
assert.equal(Object.hasOwn(freshInitialState, 'takeoverGrants'), false)
```

Add concurrency assertions: two Agent runs for one exact session are rejected, while runs for two different complete endpoint identities may coexist in `agent-task-registry`. Remove the global `agentRunning` boolean as an authorization or concurrency source; a UI-wide busy indicator may be derived from the registry size.

Add Fleet boundary assertions: `fleet-status-ai-context` and a Fleet workspace conversation can provide already collected observations, but cannot create, borrow or match a takeover grant. Any remote-capable tool from that scope fails with `AI_TAKEOVER_REQUIRED` until a concrete SSH tab is opened and enabled.

- [ ] **Step 2: 运行测试并确认失败**

```powershell
node --test test/unit-ci/agent-takeover-lifecycle.spec.js test/unit-ci/agent-takeover-concurrency.spec.js test/unit-ci/agent-takeover-fleet-boundary.spec.js
```

Expected: grants survive one or more lifecycle events or are represented in persisted initial state.

- [ ] **Step 3: 订阅已有会话生命周期并精确失效**

Add one adapter in `main.jsx` that translates existing tab/session events into registry calls. On endpoint comparison failure, call `disable(previousEndpoint, 'endpoint-changed')` before any new Agent tool can run. On stop, request task cancellation first, then transition `stopping -> off`; phase 02 will connect the abort signal to remote tools.

- [ ] **Step 4: 添加空闲零工作测试**

Warm or stub the existing `aiHealthCoordinator`, record its control baseline, then enable ten mock sessions and advance fake time by five minutes. Assert the takeover delta is zero model calls, zero remote commands, zero remote processes and zero periodic timers; the test must not misattribute the existing deduplicated model health check to takeover.

- [ ] **Step 5: 运行本阶段回归并提交**

```powershell
node --test test/unit-ci/agent-takeover-*.spec.js test/unit-ci/ai-agent-tools.spec.js test/unit-ci/ai-chat-layout.spec.js test/unit-ci/session-ssh-known-hosts.spec.js
git add src/client/components/ai/agent-takeover-registry.js src/client/components/ai/agent.js src/client/components/ai/agent-task-registry.js src/client/components/ai/agent-runtime-context.js src/client/components/ai/ai-conversation-context.js src/client/components/main/main.jsx src/client/store/init-state.js test/unit-ci/agent-takeover-lifecycle.spec.js test/unit-ci/agent-takeover-concurrency.spec.js test/unit-ci/agent-takeover-fleet-boundary.spec.js
git commit -m "feat: revoke takeover grants on session lifecycle changes"
```

Expected: phase 01 tests pass and idle takeover produces no work.

## Task 6: 阶段 01 验收

**Files:**
- Verify only: all files changed in phase 01

- [ ] **Step 1: 运行针对性回归**

```powershell
npm run test-unit-ci
npm run lint
git diff --check HEAD~5..HEAD
```

Expected: tests and lint pass; no whitespace errors.

- [ ] **Step 2: 手工核对两个 SSH 标签页**

Open two SSH sessions to distinct identities. Enable only the first; verify the second remains off. Reconnect the first and verify it returns to off. Restart the app and verify both are off while prior audit records remain readable.

- [ ] **Step 3: 评审门**

Do not begin phase 02 until reviewers can trace every remote-capable Agent tool to the single gate and confirm no takeover authorization is persisted.
