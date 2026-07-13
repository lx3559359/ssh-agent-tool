# AI 运维安全事务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ShellPilot 建立覆盖普通 SSH 终端、AI Agent、服务器状态、快捷命令和 SFTP 的统一安全事务引擎，提供只读诊断计划、可取消执行、自动备份、可验证回滚和完整审计。

**Architecture:** 在客户端新增纯函数安全域（分类、脱敏、端点校验、恢复脚本生成），以现有 `runGlobalAsync('dbAction')` 和独立 SSH `runCmd` 通道实现持久化与执行。普通终端只在完整命令的回车发送前拦截，AI 与快捷命令复用同一个事务运行器；安全操作中心统一展示事务、任务和旧版恢复记录。

**Tech Stack:** Electron 41、React 19、Ant Design 6、xterm.js 6、自定义 AttachAddon、Node SQLite/NeDB、Node test、现有 SSH `runCmd` IPC。

---

### Task 1: 安全事务数据模型、命令分类与审计脱敏

**Files:**
- Create: `src/client/common/safety-transactions/models.js`
- Create: `src/client/common/safety-transactions/command-classifier.js`
- Create: `src/client/common/safety-transactions/audit-redaction.js`
- Create: `src/client/common/safety-transactions/endpoint-guard.js`
- Test: `test/unit-ci/safety-transaction-domain.spec.js`

- [ ] **Step 1: Write the failing test**

```js
test('classifies reversible terminal changes and redacts secrets', () => {
  assert.deepEqual(classifyCommand('sudo systemctl restart nginx'), {
    risk: 'change', reversible: true, provider: 'systemd', requiresConfirmation: true
  })
  assert.equal(classifyCommand('uptime').risk, 'readonly')
  assert.equal(classifyCommand('mkfs.xfs /dev/sdb').reversible, false)
  assert.doesNotMatch(redactAuditText('Authorization: Bearer abc123'), /abc123/)
})

test('rejects rollback when endpoint identity changed', () => {
  assert.throws(() => assertSameEndpoint(
    { host: '10.0.0.1', port: 22, username: 'root' },
    { host: '10.0.0.2', port: 22, username: 'root' }
  ), /服务器不一致/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit-ci/safety-transaction-domain.spec.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write minimal implementation**

```js
export const operationStates = Object.freeze({
  preparing: 'preparing', recoveryReady: 'recovery-ready',
  awaitingConfirmation: 'awaiting-confirmation', executing: 'executing',
  verificationPassed: 'verification-passed', rollbackAvailable: 'rollback-available',
  kept: 'kept', rollingBack: 'rolling-back', restored: 'restored', failed: 'failed'
})

export function classifyCommand (command) {
  const text = String(command || '').trim()
  if (/^(uptime|whoami|id|hostname|pwd|date|df|du|free|ps|ss|ip\s+(addr|route|link)|systemctl\s+(status|is-active|list-units)|journalctl)\b/i.test(text)) {
    return { risk: 'readonly', reversible: false, provider: null, requiresConfirmation: false }
  }
  const providers = [
    ['systemd', /\b(systemctl|service)\s+\S*\s*(restart|stop|start|reload|enable|disable)\b|\bsystemctl\s+(restart|stop|start|reload|enable|disable)\b/i],
    ['permissions', /\b(chmod|chown)\b/i],
    ['firewall', /\b(firewall-cmd|ufw|iptables|nft)\b/i],
    ['network', /\b(nmcli|ip\s+(addr|route)\s+(add|del|replace)|ifconfig)\b/i],
    ['docker', /\bdocker\s+(start|stop|restart|rm)\b/i],
    ['file', /(^|[;&|])\s*(rm|mv|cp|sed\s+-i|truncate)\b|(^|[^>])>{1,2}\s*\//i]
  ]
  const provider = providers.find(([, pattern]) => pattern.test(text))?.[0]
  if (provider) return { risk: 'change', reversible: true, provider, requiresConfirmation: true }
  return { risk: 'unknown', reversible: false, provider: null, requiresConfirmation: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit-ci/safety-transaction-domain.spec.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/common/safety-transactions test/unit-ci/safety-transaction-domain.spec.js
git commit -m "feat: add safety transaction domain"
```

### Task 2: 加密持久化与旧记录迁移

**Files:**
- Modify: `src/app/lib/sqlite.js`
- Modify: `src/app/lib/nedb.js`
- Modify: `src/client/common/db.js`
- Create: `src/client/common/safety-transactions/transaction-store.js`
- Modify: `src/client/common/safety-operation-records.js`
- Test: `test/unit-ci/safety-transaction-store.spec.js`
- Modify: `test/unit-ci/data-security-matrix.spec.js`

- [ ] **Step 1: Write the failing persistence contract test**

```js
test('normalizes an operation for encrypted database storage', () => {
  const record = normalizeOperation({
    id: 'op-1', source: 'terminal', command: 'systemctl restart nginx',
    endpoint: { host: '10.0.0.1', port: 22, username: 'root' }
  })
  assert.equal(record.state, 'preparing')
  assert.equal(record.endpointKey, 'root@10.0.0.1:22')
  assert.equal(record.schemaVersion, 1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit-ci/safety-transaction-store.spec.js`
Expected: FAIL because `normalizeOperation` is missing.

- [ ] **Step 3: Add encrypted tables and store adapter**

Add `safetyOperations` and `agentTasks` to SQLite/NeDB table lists, encrypted table allow-lists, and client `dbNames`. Implement:

```js
export async function saveOperation (operation) {
  const item = normalizeOperation(operation)
  await update(item.id, item, 'safetyOperations', true, true)
  return item
}
export const listOperations = () => find('safetyOperations')
export const saveTask = task => update(task.id, task, 'agentTasks', true, true)
export const listTasks = () => find('agentTasks')
```

Keep `readSafetyOperationRecords()` as the legacy source and merge it once by deterministic legacy IDs; do not delete legacy data.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/unit-ci/safety-transaction-store.spec.js test/unit-ci/data-security-matrix.spec.js`
Expected: PASS and encrypted table allow-list includes both new tables.

- [ ] **Step 5: Commit**

```bash
git add src/app/lib src/client/common test/unit-ci
git commit -m "feat: persist safety operations and agent tasks"
```

### Task 3: 恢复提供器与可验证回滚包

**Files:**
- Create: `src/client/common/safety-transactions/recovery-providers.js`
- Create: `src/client/common/safety-transactions/remote-recovery.js`
- Test: `test/unit-ci/safety-recovery-providers.spec.js`

- [ ] **Step 1: Write failing provider tests**

```js
test('builds a permission rollback package with strict permissions', () => {
  const plan = buildRecoveryPlan({
    id: 'op-1', provider: 'permissions', command: 'chmod 600 /etc/demo.conf'
  })
  assert.match(plan.prepareCommand, /umask 077/)
  assert.match(plan.prepareCommand, /stat/)
  assert.match(plan.rollbackCommand, /chmod/)
  assert.match(plan.verifyCommand, /stat/)
})

test('network provider cannot bypass recovery', () => {
  assert.equal(buildRecoveryPlan({ id: 'op-2', provider: 'network', command: 'nmcli con mod eth0 ipv4.addresses 10.0.0.2\/24' }).allowUnsafeExecute, false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit-ci/safety-recovery-providers.spec.js`
Expected: FAIL with missing module.

- [ ] **Step 3: Implement provider registry**

Each provider returns `{ prepareCommand, rollbackCommand, verifyCommand, allowUnsafeExecute, summary }`. Store remote artifacts under `~/.shellpilot/operations/<operation-id>/`, run `umask 077`, write `manifest.json`, `rollback.sh`, `verify.sh`, and provider-specific backup files. Implement providers for `file`, `permissions`, `systemd`, `firewall`, `network`, and `docker`; reject unsupported or ambiguous parse results rather than generating a guessed rollback.

- [ ] **Step 4: Run provider tests**

Run: `node --test test/unit-ci/safety-recovery-providers.spec.js`
Expected: PASS for supported commands and explicit rejection for ambiguous commands.

- [ ] **Step 5: Commit**

```bash
git add src/client/common/safety-transactions test/unit-ci/safety-recovery-providers.spec.js
git commit -m "feat: add verified remote recovery providers"
```

### Task 4: 统一事务执行器、进度与取消

**Files:**
- Create: `src/client/common/safety-transactions/transaction-runner.js`
- Create: `src/client/common/safety-transactions/task-runner.js`
- Test: `test/unit-ci/safety-transaction-runner.spec.js`

- [ ] **Step 1: Write failing runner tests**

```js
test('prepares recovery before executing a modifying command', async () => {
  const calls = []
  const runner = createTransactionRunner({
    runRemote: async command => { calls.push(command); return { output: 'ok', code: 0 } },
    saveOperation: async item => item
  })
  const result = await runner.execute(request, { confirmed: true })
  assert.match(calls[0], /\.shellpilot\/operations/)
  assert.equal(calls.at(-1), request.command)
  assert.equal(result.state, 'rollback-available')
})

test('stops a readonly plan after cancellation', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => runTaskPlan(plan, { signal: controller.signal }), /已取消/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit-ci/safety-transaction-runner.spec.js`
Expected: FAIL with missing runner exports.

- [ ] **Step 3: Implement the state machines**

The transaction runner must persist every state transition, enforce endpoint identity before prepare/execute/rollback, redact command output before audit storage, and expose `prepare()`, `execute()`, `rollback()`, `keep()` and `cancel()`. The task runner executes only validated readonly steps sequentially, emits `{ taskId, stepId, status, output }`, applies per-step timeout, and stops before any change step.

- [ ] **Step 4: Run runner tests**

Run: `node --test test/unit-ci/safety-transaction-runner.spec.js`
Expected: PASS including prepare-before-execute ordering and cancellation.

- [ ] **Step 5: Commit**

```bash
git add src/client/common/safety-transactions test/unit-ci/safety-transaction-runner.spec.js
git commit -m "feat: add cancellable safety transaction runner"
```

### Task 5: 普通 SSH 终端命令拦截

**Files:**
- Create: `src/client/components/terminal/terminal-safety-controller.js`
- Create: `src/client/components/terminal/terminal-command-safety-modal.jsx`
- Create: `src/client/components/terminal/terminal-command-safety-modal.styl`
- Modify: `src/client/components/terminal/attach-addon-custom.js`
- Modify: `src/client/components/terminal/terminal.jsx`
- Test: `test/unit-ci/terminal-safety-controller.spec.js`

- [ ] **Step 1: Write failing interception tests**

```js
test('withholds Enter for a reversible modifying command', async () => {
  const result = await controller.beforeSend('\r', {
    command: 'systemctl restart nginx', passwordMode: false, alternateBuffer: false
  })
  assert.equal(result.sendNow, false)
  assert.equal(result.openConfirmation, true)
})

test('never intercepts passwords, Ctrl+C or alternate-screen apps', async () => {
  assert.equal((await controller.beforeSend('secret', { passwordMode: true })).sendNow, true)
  assert.equal((await controller.beforeSend('\x03', {})).sendNow, true)
  assert.equal((await controller.beforeSend('\r', { alternateBuffer: true })).sendNow, true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit-ci/terminal-safety-controller.spec.js`
Expected: FAIL because the controller is missing.

- [ ] **Step 3: Wire the AttachAddon gate**

Change `sendToServer(data)` so only Enter asks `term.parent.beforeTerminalEnter(currentCommand)`. While confirmation is pending, do not send Enter; typed command remains in the remote PTY line buffer. On acceptance prepare recovery through independent `runCmd`, then call `_sendData('\r')`; on cancel send Ctrl+U to clear the pending line. Readonly commands, password prompts, paste, heredoc continuation, alternate buffer/TUI, local terminals and incomplete commands remain transparent.

- [ ] **Step 4: Run controller and terminal regression tests**

Run: `node --test test/unit-ci/terminal-safety-controller.spec.js test/unit-ci/terminal-input-stability.spec.js`
Expected: PASS; Ctrl+C and ordinary Enter behavior remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/terminal test/unit-ci
git commit -m "feat: protect modifying commands in SSH terminal"
```

### Task 6: 安全操作中心与快捷回滚

**Files:**
- Modify: `src/client/components/main/safety-operation-center-modal.jsx`
- Modify: `src/client/components/main/safety-operation-center-modal.styl`
- Create: `src/client/components/main/safety-task-progress.jsx`
- Test: `test/unit-ci/safety-operation-center.spec.js`

- [ ] **Step 1: Write failing view-model tests**

```js
test('groups records into running, rollback, history and legacy tabs', () => {
  const groups = groupSafetyCenterRecords(records)
  assert.deepEqual(groups.running.map(x => x.id), ['op-running'])
  assert.deepEqual(groups.rollback.map(x => x.id), ['op-ready'])
  assert.deepEqual(groups.legacy.map(x => x.id), ['legacy-1'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit-ci/safety-operation-center.spec.js`
Expected: FAIL with missing grouping function.

- [ ] **Step 3: Implement unified center UI**

Add four tabs: `执行中`, `可回滚`, `历史记录`, `旧版记录`. Each operation shows source, endpoint, command summary, backup path, state timeline, verification result and audit output. `立即回滚` calls the transaction runner after endpoint validation; `保留修改` changes state to `kept`; running tasks expose `取消任务`. Keep legacy SFTP and quick-command restore paths functional.

- [ ] **Step 4: Run focused tests and build**

Run: `node --test test/unit-ci/safety-operation-center.spec.js test/unit-ci/safety-operation-records.spec.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/main test/unit-ci
git commit -m "feat: unify safety center and quick rollback"
```

### Task 7: 服务器异常一键诊断与结构化只读计划

**Files:**
- Create: `src/client/components/ai/diagnostic-plan.js`
- Create: `src/client/components/ai/agent-task-runner.jsx`
- Modify: `src/client/components/ai/agent-task-mode.js`
- Modify: `src/client/components/server-status/server-status-modal.jsx`
- Modify: `src/client/components/server-status/server-status-modal.styl`
- Test: `test/unit-ci/agent-diagnostic-plan.spec.js`

- [ ] **Step 1: Write failing plan validation tests**

```js
test('accepts readonly diagnostic steps and rejects change commands', () => {
  const valid = validateDiagnosticPlan({ summary: 'Nginx 异常', steps: [
    { id: 'status', title: '服务状态', command: 'systemctl status nginx --no-pager', purpose: '确认状态', readOnly: true, risk: 'readonly', timeoutMs: 15000 }
  ] })
  assert.equal(valid.steps.length, 1)
  assert.throws(() => validateDiagnosticPlan({ summary: 'bad', steps: [
    { id: 'restart', command: 'systemctl restart nginx', readOnly: true }
  ] }), /不是只读命令/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit-ci/agent-diagnostic-plan.spec.js`
Expected: FAIL with missing validator.

- [ ] **Step 3: Implement targeted diagnosis**

Add `AI 诊断` to each abnormal alert/service row. Build a prompt containing only that target's service state, recent logs, listening ports, process details and endpoint context. AI must return `{ summary, steps, expectedSignals, stopConditions }`; validate every command with the shared classifier before showing the plan. The confirmation modal lists purposes and commands; after confirmation, show live step progress, output preview, cancel button and final audit report.

- [ ] **Step 4: Run plan tests and AI stability matrix**

Run: `node --test test/unit-ci/agent-diagnostic-plan.spec.js test/unit-ci/ai-chat-stability-matrix.spec.js`
Expected: PASS and ordinary chat remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/ai src/client/components/server-status test/unit-ci
git commit -m "feat: add one-click AI diagnostics with readonly plans"
```

### Task 8: 迁移快捷命令、SFTP 与 AI 修改操作

**Files:**
- Modify: `src/client/components/quick-commands/quick-commands-box.jsx`
- Modify: `src/client/components/ai/agent-tools.js`
- Modify: `src/client/components/ai/agent-tool-confirm.js`
- Modify: `src/client/components/sftp/sftp.jsx`
- Test: `test/unit-ci/safety-entrypoint-integration.spec.js`

- [ ] **Step 1: Write failing entrypoint tests**

```js
test('all modifying entrypoints create the same transaction request shape', () => {
  for (const source of ['quick-command', 'agent', 'sftp']) {
    const request = buildSafetyRequest({ source, endpoint, title: 'test', command: 'chmod 600 /tmp/a' })
    assert.equal(request.endpoint.host, endpoint.host)
    assert.equal(request.risk, 'change')
    assert.equal(request.recoveryProvider, 'permissions')
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit-ci/safety-entrypoint-integration.spec.js`
Expected: FAIL until all adapters use `buildSafetyRequest`.

- [ ] **Step 3: Replace entrypoint-specific execution**

Quick commands and Agent tools must call the transaction runner rather than maintaining separate rollback records. SFTP overwrite/delete/rename first backs up the selected path into the operation directory and writes a restore action. Unknown AI commands remain second-confirmation-only with an explicit `无法自动回滚` warning; network changes cannot bypass recovery.

- [ ] **Step 4: Run focused regression tests**

Run: `node --test test/unit-ci/safety-entrypoint-integration.spec.js test/unit-ci/sftp-backup.spec.js test/unit-ci/agent-task-mode.spec.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components test/unit-ci
git commit -m "feat: route modifying actions through safety transactions"
```

### Task 9: 完整验证、帮助文档与 0.4.0 候选包

**Files:**
- Modify: `src/client/components/main/help-center-modal.jsx`
- Create: `docs/AI-OPS-SAFETY-TRANSACTIONS.md`
- Create: `build/bin/smoke-safety-transactions.js`
- Modify: `package.json`
- Test: `test/unit-ci/safety-release-matrix.spec.js`

- [ ] **Step 1: Add release matrix assertions**

Assert that help includes terminal recovery, AI plan confirmation, cancellation, endpoint guard, rollback verification and nonreversible warnings; assert package version is not bumped before all safety tests pass.

- [ ] **Step 2: Run all unit CI tests**

Run: `npm run test-unit-ci`
Expected: all tests PASS.

- [ ] **Step 3: Run lint and production build**

Run: `npm run lint`
Expected: exit 0.

Run: `npm run vite-build`
Expected: exit 0 and no unresolved imports.

- [ ] **Step 4: Run local packaged smoke and real-server regression**

Run: `npm run test-package-smoke`
Expected: packaged application starts without main/renderer errors.

Run: `node build/bin/smoke-safety-transactions.js`
Expected: against the configured test server, readonly plan completes; a temporary file permission change creates recovery, verifies the change, rolls back by button-equivalent API, verifies restoration; cancellation stops a long-running readonly command. Do not change network/firewall on the real server.

- [ ] **Step 5: Prepare but do not publish the candidate**

After all checks pass, update version to `0.4.0`, add release notes grouped as `[新增]`, `[修复]`, `[改动]`, build the local installer and portable package, and stop before GitHub/ModelScope upload until the user confirms release.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/main docs build/bin package.json test/unit-ci
git commit -m "chore: prepare ShellPilot 0.4.0 safety release"
```

