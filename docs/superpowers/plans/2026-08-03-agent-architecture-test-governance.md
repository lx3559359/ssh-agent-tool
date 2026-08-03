# Agent Architecture and Test Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变公开工具与调用入口的前提下拆分 Agent 大型模块、减少全局耦合、为安全读取增加有限并发，并把关键源码正则测试升级为行为测试。

**Architecture:** agent-tools.js 变为兼容外观，工具目录、风险生命周期和执行器分别位于独立模块。运行服务通过可选适配器注入，同时保留 window 默认适配器。调度器只并发执行目录明确标记为 conversation + readonly + parallelSafe 的连续调用，并按原顺序返回结果。

**Tech Stack:** JavaScript ES modules, React 19, Node.js node:test, StandardJS, existing Electron IPC and Agent gateway

---

## File map

- Create apps/electerm-agent/src/client/components/ai/agent-tool-catalog.js.
- Create apps/electerm-agent/src/client/components/ai/agent-tool-risk-lifecycle.js.
- Create apps/electerm-agent/src/client/components/ai/agent-tool-execution.js.
- Create apps/electerm-agent/src/client/components/ai/agent-runtime-services.js.
- Create apps/electerm-agent/src/client/components/ai/agent-tool-scheduler.js.
- Create apps/electerm-agent/test/unit-ci/agent-tool-catalog-compat.spec.js.
- Create apps/electerm-agent/test/unit-ci/agent-runtime-services.spec.js.
- Create apps/electerm-agent/test/unit-ci/agent-tool-scheduler.spec.js.
- Modify apps/electerm-agent/src/client/components/ai/agent-tools.js.
- Modify apps/electerm-agent/src/client/components/ai/agent.js.
- Modify apps/electerm-agent/src/client/components/ai/agent-task-controller.js.
- Modify apps/electerm-agent/src/client/components/ai/agent-task-runner.jsx.
- Modify apps/electerm-agent/test/unit-ci/agent-cancellation.spec.js.
- Modify apps/electerm-agent/test/unit-ci/agent-diagnostic-ui.spec.js.
- Modify apps/electerm-agent/test/unit-ci/quality-business-propagation.spec.js.

### Task 1: Characterize the compatibility surface before moving code

**Files:**
- Create: apps/electerm-agent/test/unit-ci/agent-tool-catalog-compat.spec.js
- Modify: apps/electerm-agent/test/unit-ci/agent-risk-execution.spec.js

- [ ] **Step 1: Write an export and descriptor snapshot test**

Import agent-tools.js and assert these exports remain functions/arrays: agentTools, getAgentToolDescriptor, prepareAgentRiskArgs, prepareAgentRiskBatch, runReadonlyTool, failAgentRiskBatch, and executeToolCall.

Build a normalized descriptor snapshot containing only each public function name, description, parameters, scope, and policy metadata. Compare it before and after extraction within the test by importing the compatibility facade and the new catalog. Do not snapshot function source or module paths.

- [ ] **Step 2: Write execution characterization tests**

For one conversation read, one terminal readonly command, one risky terminal command, one structured read, one SFTP read, one SFTP write, and one local CLI call, assert the same gateway inputs, store/IPC calls, cancellation registration, result string, and error codes.

- [ ] **Step 3: Run and verify RED**

~~~powershell
node --test test/unit-ci/agent-tool-catalog-compat.spec.js test/unit-ci/agent-risk-execution.spec.js
~~~

Expected: the new catalog import fails while existing execution characterizations pass.

- [ ] **Step 4: Commit tests only**

~~~powershell
git add apps/electerm-agent/test/unit-ci/agent-tool-catalog-compat.spec.js apps/electerm-agent/test/unit-ci/agent-risk-execution.spec.js
git commit -m "test: characterize Agent tool compatibility"
~~~

### Task 2: Extract the tool catalog without changing public definitions

**Files:**
- Create: apps/electerm-agent/src/client/components/ai/agent-tool-catalog.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-tools.js
- Modify: apps/electerm-agent/test/unit-ci/agent-tool-catalog-compat.spec.js

- [ ] **Step 1: Verify the characterization test currently fails only on the missing module**

~~~powershell
node --test test/unit-ci/agent-tool-catalog-compat.spec.js
~~~

Expected: ERR_MODULE_NOT_FOUND for agent-tool-catalog.js.

- [ ] **Step 2: Move catalog construction as one mechanical change**

Move buildAddBookmarkParameters, withRequiredRiskContextParameters, the current agentTools definition, sftp_list required-parameter adjustment, descriptor Map, and getAgentToolDescriptor into agent-tool-catalog.js. Preserve every public type, function name, description, parameter Schema, scope, and policy field byte-for-byte.

Export:

~~~js
export {
  agentTools,
  getAgentToolDescriptor
}
~~~

In agent-tools.js re-export both names from the new module and import getAgentToolDescriptor for internal use.

- [ ] **Step 3: Add internal scheduling metadata**

Add an optional execution field outside each public function object. Mark only list_tabs and list_bookmarks as:

~~~js
execution: {
  parallelSafe: true,
  readonly: true,
  stateful: false
}
~~~

agent.js must continue stripping descriptors to type and function before IPC, so this metadata is never sent to the model.

- [ ] **Step 4: Run catalog, policy, scope, and structured-tool tests**

~~~powershell
node --test test/unit-ci/agent-tool-catalog-compat.spec.js test/unit-ci/agent-tool-policy.spec.js test/unit-ci/agent-tool-gateway.spec.js test/unit-ci/agent-structured-tools.spec.js
npx standard src/client/components/ai/agent-tool-catalog.js src/client/components/ai/agent-tools.js
~~~

Expected: tests and StandardJS exit 0.

- [ ] **Step 5: Commit**

~~~powershell
git add apps/electerm-agent/src/client/components/ai/agent-tool-catalog.js apps/electerm-agent/src/client/components/ai/agent-tools.js apps/electerm-agent/test/unit-ci/agent-tool-catalog-compat.spec.js
git commit -m "refactor: extract Agent tool catalog"
~~~

### Task 3: Extract risk lifecycle and execution while keeping the facade

**Files:**
- Create: apps/electerm-agent/src/client/components/ai/agent-tool-risk-lifecycle.js
- Create: apps/electerm-agent/src/client/components/ai/agent-tool-execution.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-tools.js
- Modify: apps/electerm-agent/test/unit-ci/agent-tool-catalog-compat.spec.js
- Modify: apps/electerm-agent/test/unit-ci/agent-risk-execution.spec.js

- [ ] **Step 1: Add direct-module parity assertions**

Import each new module and compare its exported function identities with the facade re-exports. The new risk module exports prepareAgentRiskArgs, prepareAgentRiskBatch, and failAgentRiskBatch. The execution module exports runReadonlyTool and executeToolCall.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test --test-name-pattern "direct module parity" test/unit-ci/agent-tool-catalog-compat.spec.js
~~~

Expected: module imports fail.

- [ ] **Step 3: Move risk lifecycle as one behavior-preserving unit**

Move recoveryFor, buildResolvedRiskTransaction, prepareAgentRiskArgs, prepared-batch helpers, prepareAgentRiskBatch, prepareResolvedAgentTool, verification helpers, completion handlers, and failAgentRiskBatch to agent-tool-risk-lifecycle.js. Pass store and runtime services explicitly instead of importing the execution module, preventing a circular dependency.

- [ ] **Step 4: Move execution as one behavior-preserving unit**

Move transfer cancellation, terminal/readonly helpers, executeResolvedAgentTool, structured verification execution, parseToolResult, and executeToolCall to agent-tool-execution.js. Import catalog and risk lifecycle from their focused modules. Keep agent-tools.js as this facade:

~~~js
export {
  agentTools,
  getAgentToolDescriptor
} from './agent-tool-catalog.js'
export {
  prepareAgentRiskArgs,
  prepareAgentRiskBatch,
  failAgentRiskBatch
} from './agent-tool-risk-lifecycle.js'
export {
  runReadonlyTool,
  executeToolCall
} from './agent-tool-execution.js'
~~~

- [ ] **Step 5: Run all Agent tool suites and commit**

~~~powershell
node --test test/unit-ci/agent-tool-catalog-compat.spec.js test/unit-ci/agent-risk-execution.spec.js test/unit-ci/agent-risk-transaction.spec.js test/unit-ci/agent-risk-async.spec.js test/unit-ci/agent-tool-policy.spec.js test/unit-ci/agent-tool-gateway.spec.js test/unit-ci/agent-structured-tools.spec.js test/unit-ci/agent-cancellation.spec.js
npx standard src/client/components/ai/agent-tool-catalog.js src/client/components/ai/agent-tool-risk-lifecycle.js src/client/components/ai/agent-tool-execution.js src/client/components/ai/agent-tools.js
git add apps/electerm-agent/src/client/components/ai/agent-tool-catalog.js apps/electerm-agent/src/client/components/ai/agent-tool-risk-lifecycle.js apps/electerm-agent/src/client/components/ai/agent-tool-execution.js apps/electerm-agent/src/client/components/ai/agent-tools.js apps/electerm-agent/test/unit-ci/agent-tool-catalog-compat.spec.js apps/electerm-agent/test/unit-ci/agent-risk-execution.spec.js
git commit -m "refactor: split Agent tool responsibilities"
~~~

Expected: tests and StandardJS exit 0 before commit.

### Task 4: Inject runtime services and retain browser defaults

**Files:**
- Create: apps/electerm-agent/src/client/components/ai/agent-runtime-services.js
- Create: apps/electerm-agent/test/unit-ci/agent-runtime-services.spec.js
- Modify: apps/electerm-agent/src/client/components/ai/agent.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-tool-risk-lifecycle.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-tool-execution.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-task-controller.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-task-runner.jsx

- [ ] **Step 1: Write injection tests**

Create fake store, IPC, refs, translate, now, and error reporter. Assert createAgentRuntimeServices returns exactly those adapters. With no overrides and a temporary global window, assert it uses current browser services. Test that Agent loop/backend call, tool execution, risk cleanup, diagnostic request, and handoff can run with injected services while global window is absent.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test test/unit-ci/agent-runtime-services.spec.js
~~~

Expected: module import fails and current modules require window.

- [ ] **Step 3: Implement the service adapter**

~~~js
export function createAgentRuntimeServices (overrides = {}) {
  const browser = globalThis.window || {}
  const pre = overrides.pre || browser.pre
  const store = overrides.store || browser.store
  return Object.freeze({
    store,
    pre,
    refs: overrides.refs || browser.refs,
    translate: overrides.translate || browser.translate || (key => key),
    now: overrides.now || Date.now,
    reportError: overrides.reportError || (error => store?.onError?.(error))
  })
}
~~~

- [ ] **Step 4: Thread services through compatible optional tails**

runAgentLoop receives services in its final optional options object and sets agentRuntime.services. Tool modules read runtime.services.store/pre first and browser fallback only through createAgentRuntimeServices. requestDiagnosticPlanText accepts services but keeps runGlobalAsync as a supported override. AgentTaskRunner constructs services once with its store, refsStatic, window.pre, and translate.

- [ ] **Step 5: Run suites, lint, and commit**

~~~powershell
node --test test/unit-ci/agent-runtime-services.spec.js test/unit-ci/agent-risk-execution.spec.js test/unit-ci/agent-task-runner.spec.js test/unit-ci/agent-cancellation.spec.js
npx standard src/client/components/ai/agent-runtime-services.js src/client/components/ai/agent.js src/client/components/ai/agent-tool-risk-lifecycle.js src/client/components/ai/agent-tool-execution.js src/client/components/ai/agent-task-controller.js src/client/components/ai/agent-task-runner.jsx
git add apps/electerm-agent/src/client/components/ai/agent-runtime-services.js apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/src/client/components/ai/agent-tool-risk-lifecycle.js apps/electerm-agent/src/client/components/ai/agent-tool-execution.js apps/electerm-agent/src/client/components/ai/agent-task-controller.js apps/electerm-agent/src/client/components/ai/agent-task-runner.jsx apps/electerm-agent/test/unit-ci/agent-runtime-services.spec.js
git commit -m "refactor: inject Agent runtime services"
~~~

Expected: tests and StandardJS exit 0.

### Task 5: Add bounded concurrency for declared pure reads

**Files:**
- Create: apps/electerm-agent/src/client/components/ai/agent-tool-scheduler.js
- Create: apps/electerm-agent/test/unit-ci/agent-tool-scheduler.spec.js
- Modify: apps/electerm-agent/src/client/components/ai/agent.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-tool-catalog.js

- [ ] **Step 1: Write scheduler tests**

Use deferred executors to prove list_tabs and list_bookmarks overlap with maxParallel 2, results remain in input order, maxParallel is never exceeded, one rejected read does not cancel siblings, AbortSignal prevents undispatched work, and terminal/SFTP/risky/stateful calls remain strictly serial. Add two identical list_tabs calls and prove the executor runs once while both original call IDs receive a result.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test test/unit-ci/agent-tool-scheduler.spec.js
~~~

Expected: module import fails.

- [ ] **Step 3: Implement the scheduler**

Export scheduleAgentToolCalls(calls, execute, options). Partition consecutive calls into a parallel group only when descriptor.scope is conversation and descriptor.execution equals readonly true, stateful false, parallelSafe true. Within one parallel group, coalesce calls with the same tool name and stable serialization of validated arguments onto one Promise; do not cache across groups or model turns. Execute each group with a worker pool capped at four and the configured maxParallel. Store settled results by original index and return them in input order.

- [ ] **Step 4: Integrate without changing audit order**

Extract the current per-tool loop body into executeParsedAgentTool(parsed, runtime). After risk preparation, pass parsed calls to the scheduler. For each settled result, update tool cards and append tool-role messages in original call order. Budget reservation remains before scheduling, and each worker checks the shared AbortSignal.

- [ ] **Step 5: Run scheduler, ordering, risk, and cancellation tests; commit**

~~~powershell
node --test test/unit-ci/agent-tool-scheduler.spec.js test/unit-ci/agent-risk-execution.spec.js test/unit-ci/agent-cancellation.spec.js test/unit-ci/agent-tool-presentation.spec.js test/unit-ci/agent-run-budget.spec.js
npx standard src/client/components/ai/agent-tool-scheduler.js src/client/components/ai/agent.js src/client/components/ai/agent-tool-catalog.js
git add apps/electerm-agent/src/client/components/ai/agent-tool-scheduler.js apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/src/client/components/ai/agent-tool-catalog.js apps/electerm-agent/test/unit-ci/agent-tool-scheduler.spec.js
git commit -m "perf: parallelize safe Agent reads"
~~~

Expected: tests and StandardJS exit 0.

### Task 6: Make context compaction explicit and cursor-friendly

**Files:**
- Modify: apps/electerm-agent/src/client/components/ai/agent-runtime-context.js
- Modify: apps/electerm-agent/test/unit-ci/agent-output-stress.spec.js
- Modify: apps/electerm-agent/test/unit-ci/agent-pagination.spec.js

- [ ] **Step 1: Write compaction behavior tests**

Build enough assistant/tool groups to exceed the runtime window. Assert every retained assistant tool call still has its matching tool response, omitted groups are counted, the final messages include one bounded omission notice, and pagination cursors in retained observations remain intact. Assert no omitted command, path, output, or argument text appears in the notice.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test --test-name-pattern "omission notice|pagination cursor" test/unit-ci/agent-output-stress.spec.js test/unit-ci/agent-pagination.spec.js
~~~

Expected: old groups are dropped without an explicit omission notice.

- [ ] **Step 3: Return window metadata from compaction**

Add buildAgentContextWindow(baseMessages, runtimeMessages) returning messages, omittedGroups, omittedMessages, and retainedMessages. Keep buildBoundedAgentMessages as a compatibility wrapper returning only messages.

When groups are omitted, insert this bounded system notice immediately before retained runtime groups:

~~~js
{
  role: 'system',
  content: 'Agent context window omitted ' + omittedGroups +
    ' older tool groups. Re-read paginated resources with their cursor when needed.'
}
~~~

The notice contains counts only and cannot include source content.

- [ ] **Step 4: Use the explicit window in Agent loop observation**

agent.js calls buildAgentContextWindow and sends window.messages. When content is omitted, the observer writes two existing metric/value events named context_omitted_groups and context_omitted_messages; no new free-form quality fields are added. Existing callers and tests that use buildBoundedAgentMessages remain compatible.

- [ ] **Step 5: Run tests, lint, and commit**

~~~powershell
node --test test/unit-ci/agent-output-stress.spec.js test/unit-ci/agent-output-backpressure.spec.js test/unit-ci/agent-pagination.spec.js test/unit-ci/agent-run-observer.spec.js
npx standard src/client/components/ai/agent-runtime-context.js src/client/components/ai/agent.js
git add apps/electerm-agent/src/client/components/ai/agent-runtime-context.js apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/test/unit-ci/agent-output-stress.spec.js apps/electerm-agent/test/unit-ci/agent-pagination.spec.js apps/electerm-agent/test/unit-ci/agent-run-observer.spec.js
git commit -m "feat: expose Agent context compaction"
~~~

Expected: tests and StandardJS exit 0.

### Task 7: Replace critical source-regex assertions with behavior tests

**Files:**
- Modify: apps/electerm-agent/test/unit-ci/agent-cancellation.spec.js
- Modify: apps/electerm-agent/test/unit-ci/agent-diagnostic-ui.spec.js
- Modify: apps/electerm-agent/test/unit-ci/quality-business-propagation.spec.js
- Modify: apps/electerm-agent/test/unit-ci/agent-task-ui-state.spec.js
- Modify: apps/electerm-agent/test/unit-ci/agent-run-observer.spec.js

- [ ] **Step 1: Identify only critical regex tests**

Replace tests whose sole proof is the presence of AIAgentCancel, setPrompt, getCurrentEndpoint, createTraceContext, or agentTaskRegistry.cancel. Keep small wiring smoke tests only for lazy component inclusion and IPC whitelist registration.

- [ ] **Step 2: Write behavior equivalents before deleting regex assertions**

Use injected services and pure view/controller modules to assert: backend cancellation result is awaited; handoff waits for readiness; endpoint is checked at execution; trace context reaches the observer/controller; registry cancel changes visible state; a finished task retains evidence.

- [ ] **Step 3: Run the new behavior tests and verify they pass against completed implementation**

~~~powershell
node --test test/unit-ci/agent-cancellation.spec.js test/unit-ci/agent-task-ui-state.spec.js test/unit-ci/agent-run-observer.spec.js test/unit-ci/agent-runtime-services.spec.js
~~~

Expected: 0 failures.

- [ ] **Step 4: Remove superseded regex assertions**

Delete only regex assertions now covered by behavior tests. Do not remove unrelated accessibility, stylesheet, lazy-loading, or IPC-whitelist wiring smoke tests.

- [ ] **Step 5: Run affected suites and commit**

~~~powershell
node --test test/unit-ci/agent-cancellation.spec.js test/unit-ci/agent-diagnostic-ui.spec.js test/unit-ci/quality-business-propagation.spec.js test/unit-ci/agent-task-ui-state.spec.js test/unit-ci/agent-run-observer.spec.js
git add apps/electerm-agent/test/unit-ci/agent-cancellation.spec.js apps/electerm-agent/test/unit-ci/agent-diagnostic-ui.spec.js apps/electerm-agent/test/unit-ci/quality-business-propagation.spec.js apps/electerm-agent/test/unit-ci/agent-task-ui-state.spec.js apps/electerm-agent/test/unit-ci/agent-run-observer.spec.js
git commit -m "test: verify Agent behavior instead of source shape"
~~~

Expected: 0 failures.

### Task 8: Final compatibility and regression verification

**Files:**
- Verify only unless a failing test identifies an in-scope regression.

- [ ] **Step 1: Run all Agent and AI safety unit tests**

~~~powershell
node --test "test/unit-ci/agent-*.spec.js" test/unit-ci/ai-run-cancellation.spec.js test/unit-ci/ai-chat-stability-matrix.spec.js test/unit-ci/ai-chat-async-prompt-guard.spec.js test/unit-ci/ai-models.spec.js test/unit-ci/ai-profiles.spec.js test/unit-ci/quality-trace-context.spec.js
~~~

Expected: 0 failures.

- [ ] **Step 2: Run targeted StandardJS across all changed production files**

~~~powershell
npx standard src/client/components/ai/agent*.js src/client/components/ai/agent*.jsx src/client/components/ai/ai-run-cancellation.js src/client/components/ai/ai-chat-actions.js src/client/components/ai/ai-chat-history-item.jsx src/client/components/ai/ai-profiles.js src/client/components/ai/ai-config.jsx src/client/components/server-status/server-status-modal.jsx src/client/common/quality/quality-events.js src/app/lib/quality/quality-log.js src/app/lib/ai.js
~~~

Expected: exit 0.

- [ ] **Step 3: Run the full unit suite**

~~~powershell
npm run test-unit-ci
~~~

Expected: 0 failures. If the known Git for Windows dash.exe timeout appears, rerun that exact named test in isolation and report both outputs; do not call the full suite green.

- [ ] **Step 4: Build the renderer**

~~~powershell
npm run vite-build
~~~

Expected: exit 0.

- [ ] **Step 5: Check real-SSH smoke prerequisites without reading secrets**

~~~powershell
Get-ChildItem Env:SHELLPILOT_AI_TAKEOVER_* | Select-Object Name
~~~

If all documented isolated-test variables are present, run npm run smoke:ai-takeover. Otherwise record the real SSH smoke as not executed because an isolated server, pinned fingerprint, credentials, test root, dedicated service, and recovery acknowledgement were not supplied.

- [ ] **Step 6: Verify clean scope and review the requirement checklist**

~~~powershell
git diff --check
git status --short
git log --oneline -20
~~~

Expected: no whitespace errors; all pre-existing unrelated changes remain untouched. Compare every acceptance item in docs/superpowers/specs/2026-08-03-shellpilot-agent-hardening-design.md with a passing behavior test or an explicitly reported external-smoke limitation.
