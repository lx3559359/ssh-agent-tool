# Agent UI and Local Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Agent 提供完整、可恢复的运行状态和仅本地的脱敏观察记录，并让聊天与诊断界面准确展示取消、预算、端点和错误阶段。

**Architecture:** AgentRunObserver 复用现有 recordQualityEvent IPC，只发送白名单稳定字段；端点只保存不可逆用途的短摘要，不保存主机、用户名或命令。聊天状态保存在现有历史 metadata，诊断状态保存在现有 agentTasks 表；恢复器按诊断键和端点精确匹配，不引入第二套数据库。

**Tech Stack:** JavaScript ES modules/CommonJS, React 19, Ant Design 6, existing quality log and transaction store, Node.js node:test, StandardJS

---

## File map

- Create apps/electerm-agent/src/client/components/ai/agent-run-observer.js.
- Create apps/electerm-agent/src/client/components/ai/agent-task-recovery.js.
- Create apps/electerm-agent/test/unit-ci/agent-run-observer.spec.js.
- Create apps/electerm-agent/test/unit-ci/agent-task-recovery.spec.js.
- Modify apps/electerm-agent/src/client/common/quality/quality-events.js.
- Modify apps/electerm-agent/src/app/lib/quality/quality-log.js.
- Modify apps/electerm-agent/test/unit-ci/quality-trace-context.spec.js.
- Modify apps/electerm-agent/src/client/components/ai/agent.js.
- Modify apps/electerm-agent/src/client/components/ai/agent-task-controller.js.
- Modify apps/electerm-agent/src/client/components/ai/agent-task-runner.jsx.
- Modify apps/electerm-agent/src/client/components/ai/agent-task-view-state.js.
- Modify apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx.
- Modify apps/electerm-agent/src/client/components/ai/ai-run-cancellation.js.
- Modify apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js.
- Modify apps/electerm-agent/src/client/components/ai/agent-task-runner.styl.

### Task 1: Extend the local quality-event whitelist safely

**Files:**
- Modify: apps/electerm-agent/src/client/common/quality/quality-events.js
- Modify: apps/electerm-agent/src/app/lib/quality/quality-log.js
- Modify: apps/electerm-agent/test/unit-ci/quality-trace-context.spec.js

- [ ] **Step 1: Write renderer/main parity and redaction tests**

Add event normalization cases for errorStage, budgetType, endpointFingerprint, modelRequests, and toolCalls. Assert raw hostnames, usernames, paths, commands, outputs, API keys, and free-form messages are dropped by both renderer and main normalizers.

~~~js
const input = {
  module: 'agent',
  action: 'run',
  phase: 'budget_exceeded',
  errorStage: 'tool_execution',
  budgetType: 'tool_calls',
  endpointFingerprint: 'endpoint-12ab34cd',
  modelRequests: 7,
  toolCalls: 11,
  host: 'private.example',
  command: 'cat /etc/shadow'
}
~~~

Expected normalized output contains only the approved stable and numeric fields.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test --test-name-pattern "Agent observation fields|normalization contracts" test/unit-ci/quality-trace-context.spec.js
~~~

Expected: new fields are removed because they are not whitelisted.

- [ ] **Step 3: Add identical fields to both normalizers**

Add these strings to EVENT_STRING_LIMITS in both files:

~~~js
errorStage: 64,
budgetType: 64,
endpointFingerprint: 64
~~~

Add modelRequests and toolCalls to EVENT_NUMBER_FIELDS in both files. Keep STABLE_VALUE_PATTERN and credential rejection unchanged.

- [ ] **Step 4: Run parity and logger tests**

~~~powershell
node --test --test-name-pattern "Agent observation fields|normalization contracts|quality logger|structured credentials" test/unit-ci/quality-trace-context.spec.js
~~~

Expected: 0 failures.

- [ ] **Step 5: Commit**

~~~powershell
git add apps/electerm-agent/src/client/common/quality/quality-events.js apps/electerm-agent/src/app/lib/quality/quality-log.js apps/electerm-agent/test/unit-ci/quality-trace-context.spec.js
git commit -m "feat: whitelist safe Agent quality fields"
~~~

### Task 2: Implement a fail-open, local-only Agent observer

**Files:**
- Create: apps/electerm-agent/src/client/components/ai/agent-run-observer.js
- Create: apps/electerm-agent/test/unit-ci/agent-run-observer.spec.js

- [ ] **Step 1: Write observer tests**

Test one started event, monotonic phase durations, model/tool counters, budget and cancellation events, one terminal event, an opaque per-run endpoint ID, writer rejection, writer throw, and redaction. Assert JSON.stringify(events) never contains the source host, username, host key, command, output, credential, or conversation text.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test test/unit-ci/agent-run-observer.spec.js
~~~

Expected: module import fails.

- [ ] **Step 3: Implement the opaque endpoint identifier**

Generate an opaque ID from injected randomness, never from host, username, tab, process, host key, or any endpoint field. Hash only the random token so a dictionary attack cannot recover endpoint identity. The same observer instance reuses the ID for its run; a new run receives a new ID.

~~~js
export function createAgentEndpointFingerprint ({ token } = {}) {
  const source = String(token || globalThis.crypto?.randomUUID?.() || Math.random())
  let hash = 2166136261
  for (const character of source) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return 'endpoint-' + (hash >>> 0).toString(16).padStart(8, '0')
}
~~~

- [ ] **Step 4: Implement the observer contract**

Export createAgentRunObserver with injected now and writeEvent. It exposes start, phase, modelRequest, toolCall, budgetExceeded, cancellation, error, finish, and snapshot. Every method catches synchronous writer errors and attaches a rejection handler. finish is idempotent. Events contain only module, action, phase, result, reasonCode, status, errorStage, budgetType, endpointFingerprint, durationMs, modelRequests, and toolCalls.

- [ ] **Step 5: Run tests, lint, and commit**

~~~powershell
node --test test/unit-ci/agent-run-observer.spec.js
npx standard src/client/components/ai/agent-run-observer.js
git add apps/electerm-agent/src/client/components/ai/agent-run-observer.js apps/electerm-agent/test/unit-ci/agent-run-observer.spec.js
git commit -m "feat: observe Agent runs locally"
~~~

Expected: tests and StandardJS exit 0.

### Task 3: Connect observation to chat and diagnostic runs

**Files:**
- Modify: apps/electerm-agent/src/client/components/ai/agent.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-task-controller.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-run-cancellation-controller.js
- Modify: apps/electerm-agent/test/unit-ci/agent-run-observer.spec.js
- Modify: apps/electerm-agent/test/unit-ci/agent-task-runner.spec.js

- [ ] **Step 1: Write integration tests with an injected writer**

For chat, assert phases started, model_request, tool_execution, and completed. For diagnostic, assert plan_request, task_running, and completed. Add cancel_confirmed, cancel_failed, budget_exceeded, endpoint_changed, model error, argument error, policy error, execution error, and persistence error cases. Assert one terminal event per run.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test --test-name-pattern "observer|terminal event" test/unit-ci/agent-run-observer.spec.js test/unit-ci/agent-task-runner.spec.js
~~~

Expected: no observer events are emitted.

- [ ] **Step 3: Add optional observer injection**

Add an optional final services/options argument to runAgentLoop and createAgentTaskController. Existing callers remain valid. Construct a default observer with recordQualityEvent and the run trace context when no observer is supplied.

Call observer.modelRequest before each backend request and observer.toolCall before each valid execution. Map caught errors to these exact stages: model, tool_arguments, tool_policy, tool_execution, cancellation, budget, endpoint, persistence, ui_handoff.

- [ ] **Step 4: Make cancellation events reflect confirmation**

The cancellation controller calls observer.cancellation with cancelling before stops, cancel_confirmed only after all acknowledgements, and cancel_failed on rejection/false acknowledgement. The chat and diagnostic callers must not emit cancelled before the controller reaches confirmed state.

- [ ] **Step 5: Run suites and commit**

~~~powershell
node --test test/unit-ci/agent-run-observer.spec.js test/unit-ci/agent-cancellation.spec.js test/unit-ci/agent-task-runner.spec.js test/unit-ci/ai-run-cancellation.spec.js
npx standard src/client/components/ai/agent.js src/client/components/ai/agent-task-controller.js src/client/components/ai/agent-run-cancellation-controller.js
git add apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/src/client/components/ai/agent-task-controller.js apps/electerm-agent/src/client/components/ai/agent-run-cancellation-controller.js apps/electerm-agent/test/unit-ci/agent-run-observer.spec.js apps/electerm-agent/test/unit-ci/agent-task-runner.spec.js
git commit -m "feat: record Agent lifecycle events"
~~~

Expected: tests and StandardJS exit 0.

### Task 4: Persist minimal chat run status without changing history compatibility

**Files:**
- Modify: apps/electerm-agent/src/client/components/ai/agent.js
- Modify: apps/electerm-agent/src/client/components/ai/ai-run-cancellation.js
- Modify: apps/electerm-agent/src/client/components/ai/ai-chat-actions.js
- Modify: apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx
- Modify: apps/electerm-agent/test/unit-ci/ai-run-cancellation.spec.js
- Modify: apps/electerm-agent/test/unit-ci/ai-chat-stability-matrix.spec.js

- [ ] **Step 1: Write compatibility and rendering tests**

Assert old entries without runState render unchanged. New entries persist only this metadata shape:

~~~js
{
  runState: {
    status: 'running',
    phase: 'model_request',
    terminationReason: '',
    errorCode: '',
    endpointFingerprint: 'endpoint-12ab34cd',
    budget: {
      elapsedMs: 1200,
      modelRequests: 2,
      toolCalls: 3
    }
  }
}
~~~

Assert cancellation failure stores status cancel_failed and completionStatus partially-completed; confirmed cancellation stores cancelled. Startup recovery maps running/cancelling snapshots to failed interrupted state without deleting response/tool cards.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test --test-name-pattern "runState|cancel_failed snapshot" test/unit-ci/ai-run-cancellation.spec.js test/unit-ci/ai-chat-stability-matrix.spec.js
~~~

Expected: runState is absent or cancellation failure is represented only by response text.

- [ ] **Step 3: Add a bounded normalizer**

In ai-chat-actions.js normalize runState by whitelisting status, phase, terminationReason, errorCode, endpointFingerprint, and non-negative integer budget counters. Drop unknown nested keys. Preserve entries that have no runState.

- [ ] **Step 4: Persist and render status**

agent.js updates runState at phase changes and terminal paths. ai-run-cancellation sets cancelling before awaiting and cancel_failed/cancelled afterward. ai-chat-history-item.jsx displays a compact localized status row for budget_exceeded, endpoint_changed, cancel_failed, cancelled, failed, and finished, including elapsed time and counts when present.

- [ ] **Step 5: Run suites, lint, and commit**

~~~powershell
node --test test/unit-ci/ai-run-cancellation.spec.js test/unit-ci/ai-chat-stability-matrix.spec.js test/unit-ci/ai-chat-history-item.spec.js
npx standard src/client/components/ai/ai-chat-actions.js src/client/components/ai/ai-run-cancellation.js src/client/components/ai/ai-chat-history-item.jsx
git add apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/src/client/components/ai/ai-run-cancellation.js apps/electerm-agent/src/client/components/ai/ai-chat-actions.js apps/electerm-agent/src/client/components/ai/ai-chat-history-item.jsx apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/ai-run-cancellation.spec.js apps/electerm-agent/test/unit-ci/ai-chat-stability-matrix.spec.js apps/electerm-agent/test/unit-ci/ai-chat-history-item.spec.js
git commit -m "feat: persist visible Agent run states"
~~~

Expected: tests and StandardJS exit 0.

### Task 5: Recover diagnostic tasks from the existing transaction store

**Files:**
- Create: apps/electerm-agent/src/client/components/ai/agent-task-recovery.js
- Create: apps/electerm-agent/test/unit-ci/agent-task-recovery.spec.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-task-controller.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-task-runner.jsx
- Modify: apps/electerm-agent/src/client/components/ai/agent-task-view-state.js

- [ ] **Step 1: Write recovery tests**

Cover live registry task, completed persisted task, recovered orphan, different endpoint, different diagnostic target, newest matching task, malformed legacy metadata, and empty store. Cross-endpoint records must never be returned.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test test/unit-ci/agent-task-recovery.spec.js
~~~

Expected: module import fails.

- [ ] **Step 3: Implement a stable diagnostic key**

Export createAgentDiagnosticKey(target) using the target request ID, target kind, and normalized target name only. Export restoreAgentDiagnosticTask with registry, store, scopeId, endpoint, and diagnosticKey. It first checks live registry entries of kind diagnostic, then lists persisted tasks, filters source server-status, exact endpoint through assertSameSessionEndpoint, and matching metadata.diagnosticKey, and returns the newest by updatedAt. The opaque observation endpoint ID is never used as an authorization or recovery key.

- [ ] **Step 4: Persist and restore the key**

When AgentTaskRunner creates a plan/controller, add metadata.diagnosticKey and kind diagnostic. On open, call restoreAgentDiagnosticTask before generating a new plan. If a matching task exists, set task and phase finished for final statuses or running for a live registry entry. The view-state module must render recovered failed/orphaned tasks as error plus evidence, not as a spinner.

- [ ] **Step 5: Run suites and commit**

~~~powershell
node --test test/unit-ci/agent-task-recovery.spec.js test/unit-ci/agent-task-runner.spec.js test/unit-ci/agent-task-ui-state.spec.js
npx standard src/client/components/ai/agent-task-recovery.js src/client/components/ai/agent-task-controller.js src/client/components/ai/agent-task-runner.jsx src/client/components/ai/agent-task-view-state.js
git add apps/electerm-agent/src/client/components/ai/agent-task-recovery.js apps/electerm-agent/src/client/components/ai/agent-task-controller.js apps/electerm-agent/src/client/components/ai/agent-task-runner.jsx apps/electerm-agent/src/client/components/ai/agent-task-view-state.js apps/electerm-agent/test/unit-ci/agent-task-recovery.spec.js
git commit -m "feat: recover Agent diagnostic task state"
~~~

Expected: tests and StandardJS exit 0.

### Task 6: Display phase, budget, endpoint, and recovery actions

**Files:**
- Modify: apps/electerm-agent/src/client/components/ai/agent-task-runner.jsx
- Modify: apps/electerm-agent/src/client/components/ai/agent-task-runner.styl
- Modify: apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js
- Modify: apps/electerm-agent/test/unit-ci/agent-task-ui-state.spec.js
- Modify: apps/electerm-agent/test/unit-ci/agent-diagnostic-ui.spec.js

- [ ] **Step 1: Write view-model tests**

Cover creating, running, cancelling, cancel_failed, budget_exceeded, endpoint_changed, failed, recovered orphan, and finished. Each state specifies title key, severity, canCancel, canRetry, canClose, and whether evidence remains visible.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test --test-name-pattern "task view model" test/unit-ci/agent-task-ui-state.spec.js
~~~

Expected: the current view state has only creating/task/error.

- [ ] **Step 3: Extend the pure view model**

Return:

~~~js
{
  kind,
  status,
  titleKey,
  severity,
  canCancel,
  canRetry,
  canClose,
  showEvidence,
  phase,
  elapsedMs,
  modelRequests,
  toolCalls,
  endpointFingerprint
}
~~~

Read absent fields defensively so legacy tasks still render.

- [ ] **Step 4: Render from the view model**

Show endpoint fingerprint, phase, elapsed time, model/tool counts, ending reason, and retry/close/cancel actions. cancelling disables duplicate cancellation. cancel_failed keeps cancel retry available and warns that remote work may still run. Budget and endpoint failures retain task evidence and offer rerun. Add responsive styles and Chinese/English keys.

- [ ] **Step 5: Run tests, lint, and commit**

~~~powershell
node --test test/unit-ci/agent-task-ui-state.spec.js test/unit-ci/agent-diagnostic-ui.spec.js test/unit-ci/agent-task-recovery.spec.js
npx standard src/client/components/ai/agent-task-runner.jsx src/client/components/ai/agent-task-view-state.js
git add apps/electerm-agent/src/client/components/ai/agent-task-runner.jsx apps/electerm-agent/src/client/components/ai/agent-task-runner.styl apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/agent-task-ui-state.spec.js apps/electerm-agent/test/unit-ci/agent-diagnostic-ui.spec.js
git commit -m "feat: expose complete Agent task states"
~~~

Expected: tests and StandardJS exit 0.

### Task 7: Verify UI and local-observation batch

**Files:**
- Verify only.

- [ ] **Step 1: Run focused suites**

~~~powershell
node --test test/unit-ci/agent-run-observer.spec.js test/unit-ci/agent-task-recovery.spec.js test/unit-ci/agent-task-ui-state.spec.js test/unit-ci/agent-diagnostic-ui.spec.js test/unit-ci/agent-task-runner.spec.js test/unit-ci/agent-cancellation.spec.js test/unit-ci/ai-run-cancellation.spec.js test/unit-ci/ai-chat-stability-matrix.spec.js test/unit-ci/quality-trace-context.spec.js
~~~

Expected: 0 failures.

- [ ] **Step 2: Run targeted lint**

~~~powershell
npx standard src/client/components/ai/agent-run-observer.js src/client/components/ai/agent-task-recovery.js src/client/components/ai/agent.js src/client/components/ai/agent-task-controller.js src/client/components/ai/agent-task-runner.jsx src/client/components/ai/agent-task-view-state.js src/client/components/ai/ai-chat-actions.js src/client/components/ai/ai-run-cancellation.js src/client/components/ai/ai-chat-history-item.jsx src/client/common/quality/quality-events.js src/app/lib/quality/quality-log.js
~~~

Expected: exit 0.

- [ ] **Step 3: Verify no external telemetry dependency**

~~~powershell
rg -n "fetch\\(|axios|https?://|sendBeacon|WebSocket" src/client/components/ai/agent-run-observer.js
~~~

Expected: no matches.

- [ ] **Step 4: Inspect scope**

~~~powershell
git diff --check
git status --short
~~~

Expected: no whitespace errors and no unrelated file changes.
