# Agent Runtime Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent 任务并发边界、取消确认、运行端点漂移、诊断失败界面和 AI 提示交接问题，同时保持旧入口兼容。

**Architecture:** 任务注册表用作用域与端点的并集判定冲突；取消操作只有在后端确认后才释放资源；运行上下文冻结首次端点。UI 的运行错误和交接过程下沉为可测试的纯函数/控制器，React 组件只负责渲染和调用。

**Tech Stack:** JavaScript ES modules, React 19, Ant Design 6, Node.js node:test, StandardJS

---

## File map

- Create apps/electerm-agent/src/client/components/ai/agent-run-cancellation-controller.js: 统一验证后端取消结果并提供幂等取消 Promise。
- Create apps/electerm-agent/src/client/components/ai/agent-task-handoff.js: 有界条件等待 AI Chat 就绪。
- Create apps/electerm-agent/src/client/components/ai/agent-task-view-state.js: 诊断任务可见状态决策。
- Modify apps/electerm-agent/src/client/components/ai/agent-task-registry.js: 混合作用域冲突和取消失败锁保留。
- Modify apps/electerm-agent/src/client/components/ai/agent-takeover-lifecycle.js: 仅在端点销毁事件中强制清理取消失败锁。
- Modify apps/electerm-agent/src/client/components/ai/agent-task-controller.js: 诊断流停止屏障。
- Modify apps/electerm-agent/src/client/components/ai/agent-runtime-context.js: 冻结并校验初始端点。
- Modify apps/electerm-agent/src/client/components/ai/agent.js: 聊天 Agent 使用统一取消结果。
- Modify apps/electerm-agent/src/client/components/ai/agent-task-runner.jsx: 显式运行错误状态与可靠交接。
- Modify apps/electerm-agent/src/client/components/server-status/server-status-modal.jsx: 复用可靠交接。
- Modify apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js: 新增中英文错误和重试文案。
- Test apps/electerm-agent/test/unit-ci/agent-task-runner.spec.js.
- Test apps/electerm-agent/test/unit-ci/agent-cancellation-lifecycle.spec.js.
- Test apps/electerm-agent/test/unit-ci/agent-runtime-endpoint.spec.js.
- Test apps/electerm-agent/test/unit-ci/agent-task-ui-state.spec.js.

### Task 1: Close mixed task-registry boundaries

**Files:**
- Modify: apps/electerm-agent/test/unit-ci/agent-task-runner.spec.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-task-registry.js

- [ ] **Step 1: Write the failing mixed-boundary tests**

Add both registration orders and a different-scope control:

~~~js
test('task registry rejects endpoint and scope-only tasks that share a tab', async () => {
  const { createAgentTaskRegistry } = await import(registryUrl)
  for (const endpointFirst of [true, false]) {
    const registry = createAgentTaskRegistry()
    const endpointEntry = {
      taskId: endpointFirst ? 'first' : 'second',
      endpoint: endpoint(),
      scopeId: 'tab-a',
      runner: { cancel: async () => ({ status: 'cancelled' }) }
    }
    const scopeEntry = {
      taskId: endpointFirst ? 'second' : 'first',
      scopeId: 'tab-a',
      runner: { cancel: async () => ({ status: 'cancelled' }) }
    }
    registry.register(endpointFirst ? endpointEntry : scopeEntry)
    assert.throws(
      () => registry.register(endpointFirst ? scopeEntry : endpointEntry),
      error => error.code === 'AI_AGENT_SESSION_BUSY'
    )
    assert.equal(registry.size, 1)
  }
})

test('task registry allows mixed tasks with different scopes', async () => {
  const { createAgentTaskRegistry } = await import(registryUrl)
  const registry = createAgentTaskRegistry()
  registry.register({
    taskId: 'endpoint-task',
    endpoint: endpoint(),
    scopeId: 'tab-a',
    runner: { cancel: async () => ({ status: 'cancelled' }) }
  })
  registry.register({
    taskId: 'scope-task',
    scopeId: 'tab-b',
    runner: { cancel: async () => ({ status: 'cancelled' }) }
  })
  assert.equal(registry.size, 2)
})
~~~

- [ ] **Step 2: Run the tests and verify RED**

Run:

~~~powershell
node --test --test-name-pattern "endpoint and scope-only|mixed tasks" test/unit-ci/agent-task-runner.spec.js
~~~

Expected: the shared-tab case fails with Missing expected exception.

- [ ] **Step 3: Implement union conflict matching**

Add and use these helpers in agent-task-registry.js:

~~~js
function sameEndpoint (left, right) {
  if (!left || !right) return false
  try {
    assertSameSessionEndpoint(left, right)
    return true
  } catch {
    return false
  }
}

function entriesConflict (left, right) {
  const sameScope = Boolean(
    left.scopeId && right.scopeId && left.scopeId === right.scopeId
  )
  return sameScope || sameEndpoint(left.endpoint, right.endpoint)
}
~~~

Construct the candidate before searching entries. Use entriesConflict for registration and sameEndpoint for matchesEndpoint.

- [ ] **Step 4: Run the registry tests and verify GREEN**

~~~powershell
node --test --test-name-pattern "task registry" test/unit-ci/agent-task-runner.spec.js
~~~

Expected: all matching tests pass.

- [ ] **Step 5: Commit**

~~~powershell
git add apps/electerm-agent/src/client/components/ai/agent-task-registry.js apps/electerm-agent/test/unit-ci/agent-task-runner.spec.js
git commit -m "fix: close mixed Agent task boundaries"
~~~

### Task 2: Keep locks when cancellation is not confirmed

**Files:**
- Modify: apps/electerm-agent/test/unit-ci/agent-cancellation-lifecycle.spec.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-task-registry.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-takeover-lifecycle.js

- [ ] **Step 1: Write the failing lock-retention test**

~~~js
test('failed cancellation keeps the resource locked until owner cleanup', async () => {
  const { createAgentTaskRegistry } = await import(taskRegistryUrl)
  const registry = createAgentTaskRegistry()
  registry.register({
    taskId: 'task-a',
    endpoint: endpoint(),
    scopeId: 'tab-a',
    runner: { cancel: async () => { throw new Error('stop unconfirmed') } }
  })
  await assert.rejects(registry.cancel('task-a'), /stop unconfirmed/)
  assert.equal(registry.has('task-a'), true)
  assert.equal(registry.unregister('task-a'), false)
  assert.throws(() => registry.register({
    taskId: 'task-b',
    endpoint: endpoint(),
    scopeId: 'tab-a',
    runner: { cancel: async () => ({ status: 'cancelled' }) }
  }), error => error.code === 'AI_AGENT_SESSION_BUSY')
  assert.equal(registry.forceUnregister('task-a'), true)
})
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test --test-name-pattern "failed cancellation keeps" test/unit-ci/agent-cancellation-lifecycle.spec.js
~~~

Expected: registry.has returns false under the current unconditional finally cleanup.

- [ ] **Step 3: Release only after confirmed cancellation**

Add cancellationFailed to each entry. unregister returns false when that flag is true; forceUnregister bypasses the guard. Replace the inner registry cancellation with:

~~~js
const cancellation = (async () => {
  entry.controller?.abort?.()
  try {
    const result = await entry.runner.cancel(taskId)
    const confirmed = result === true ||
      result?.cancelled === true ||
      result?.stopped === true ||
      result?.status === 'cancelled'
    if (!confirmed) {
      const error = new Error('Agent 任务取消未得到后端确认。')
      error.code = 'AGENT_CANCELLATION_FAILED'
      throw error
    }
    entry.cancellationFailed = false
    forceUnregister(taskId)
    return result
  } catch (error) {
    entry.cancellationFailed = true
    throw error
  }
})()
~~~

Keep only the cancellation-deduplication map cleanup in the outer finally. In agent-takeover-lifecycle.js, force-unregister matching protected entries after disconnect, reconnect-start, tab-close, endpoint-change, and app-before-quit; manual-stop must retain an unconfirmed lock so a re-enabled takeover cannot overlap it.

- [ ] **Step 4: Run both suites**

~~~powershell
node --test test/unit-ci/agent-cancellation-lifecycle.spec.js test/unit-ci/agent-task-runner.spec.js test/unit-ci/agent-takeover-lifecycle.spec.js
~~~

Expected: 0 failures. Any standalone registry test must use explicit owner cleanup after a rejected cancellation.

- [ ] **Step 5: Commit**

~~~powershell
git add apps/electerm-agent/src/client/components/ai/agent-task-registry.js apps/electerm-agent/src/client/components/ai/agent-takeover-lifecycle.js apps/electerm-agent/test/unit-ci/agent-cancellation-lifecycle.spec.js apps/electerm-agent/test/unit-ci/agent-task-runner.spec.js apps/electerm-agent/test/unit-ci/agent-takeover-lifecycle.spec.js
git commit -m "fix: retain Agent locks after failed cancellation"
~~~

### Task 3: Await diagnostic and chat backend cancellation truth

**Files:**
- Create: apps/electerm-agent/src/client/components/ai/agent-run-cancellation-controller.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-task-controller.js
- Modify: apps/electerm-agent/src/client/components/ai/agent.js
- Modify: apps/electerm-agent/test/unit-ci/agent-task-runner.spec.js
- Modify: apps/electerm-agent/test/unit-ci/agent-cancellation.spec.js

- [ ] **Step 1: Write failing behavior tests**

Add a diagnostic test with a deferred stopStream Promise and prove abort remains unsettled until that Promise resolves. Add this controller test:

~~~js
test('backend cancellation rejects false acknowledgement and deduplicates callers', async () => {
  const { createAgentRunCancellationController } = await import(cancellationControllerUrl)
  let calls = 0
  const controller = createAgentRunCancellationController({ abort: () => {} })
  controller.register(async () => {
    calls += 1
    return { cancelled: false }
  }, { confirm: value => value?.cancelled === true })
  const first = controller.cancel()
  const second = controller.cancel()
  await assert.rejects(first, error => error.code === 'AGENT_CANCELLATION_FAILED')
  await assert.rejects(second, error => error.code === 'AGENT_CANCELLATION_FAILED')
  assert.equal(calls, 1)
  assert.equal(controller.state, 'cancel_failed')
})
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test --test-name-pattern "backend cancellation|awaits stopStream" test/unit-ci/agent-cancellation.spec.js test/unit-ci/agent-task-runner.spec.js
~~~

Expected: the new module import fails first; after an empty export is introduced, both behavior assertions fail.

- [ ] **Step 3: Implement the cancellation controller**

~~~js
export function createAgentRunCancellationController ({ abort } = {}) {
  const stops = new Set()
  let state = 'running'
  let cancellation
  return {
    get state () { return state },
    register (stop, { confirm = () => true } = {}) {
      if (typeof stop !== 'function') return () => {}
      const entry = { stop, confirm }
      stops.add(entry)
      return () => stops.delete(entry)
    },
    cancel () {
      if (cancellation) return cancellation
      state = 'cancelling'
      abort?.()
      cancellation = Promise.allSettled(
        [...stops].map(entry => Promise.resolve()
          .then(entry.stop)
          .then(value => {
            if (!entry.confirm(value)) {
              throw new Error('Cancellation acknowledgement was false')
            }
            return value
          }))
      ).then(results => {
        const errors = results.flatMap(result => {
          if (result.status === 'rejected') return [result.reason]
          return []
        })
        if (errors.length) {
          state = 'cancel_failed'
          const error = new AggregateError(errors, 'Agent cancellation was not confirmed')
          error.code = 'AGENT_CANCELLATION_FAILED'
          throw error
        }
        state = 'cancelled'
        return { cancelled: true, status: 'cancelled' }
      })
      return cancellation
    }
  }
}
~~~

- [ ] **Step 4: Wire both callers**

In requestDiagnosticPlanText, cache stop Promises by session ID. onAbort must await the known session stop before rejecting; when no session exists, it rejects immediately and leaves the existing late-response cleanup attached. Register stopStream with a confirm function that accepts true or an object whose stopped field is true.

In agent.js, register cancelAgentRuntimeOperations with the default fulfilled-Promise confirmation and AIAgentCancel with a confirm function requiring cancelled true. Remove the empty catch and have the task-registry runner return the controller result.

- [ ] **Step 5: Run suites and commit**

~~~powershell
node --test test/unit-ci/agent-cancellation.spec.js test/unit-ci/agent-cancellation-lifecycle.spec.js test/unit-ci/agent-task-runner.spec.js test/unit-ci/ai-run-cancellation.spec.js
git add apps/electerm-agent/src/client/components/ai/agent-run-cancellation-controller.js apps/electerm-agent/src/client/components/ai/agent-task-controller.js apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/test/unit-ci/agent-task-runner.spec.js apps/electerm-agent/test/unit-ci/agent-cancellation.spec.js
git commit -m "fix: await Agent backend cancellation"
~~~

Expected: 0 test failures before commit.

### Task 4: Freeze the Agent endpoint at run creation

**Files:**
- Create: apps/electerm-agent/test/unit-ci/agent-runtime-endpoint.spec.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-runtime-context.js
- Modify: apps/electerm-agent/src/client/components/ai/agent.js

- [ ] **Step 1: Write endpoint binding tests**

Cover matching endpoints, changed host-key fingerprint, and an endpoint that appears only after the run starts:

~~~js
test('a tab-scoped Agent cannot bind to an endpoint that appeared after start', async () => {
  const { resolveAgentExecutionEndpoint } = await import(runtimeUrl)
  assert.throws(() => resolveAgentExecutionEndpoint({
    descriptor: { scope: 'session' },
    runtime: {
      sourceTabId: 'tab-a',
      endpoint: null,
      resolveEndpoint: () => endpoint()
    }
  }), error => error.code === 'AGENT_ENDPOINT_UNAVAILABLE_AT_START')
})
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test test/unit-ci/agent-runtime-endpoint.spec.js
~~~

Expected: the late endpoint case does not throw the expected code and changed endpoints use the generic takeover code.

- [ ] **Step 3: Implement stable endpoint errors and snapshots**

In resolveAgentExecutionEndpoint, reject a non-conversation tool when sourceTabId exists but runtime.endpoint was absent at start. Translate endpoint mismatch to AGENT_ENDPOINT_CHANGED while preserving cause.

In agent.js snapshot once:

~~~js
const initialEndpoint = resolveEndpoint()
const endpoint = initialEndpoint
  ? Object.freeze({ ...initialEndpoint })
  : null
~~~

Assign endpoint to agentRuntime and never replace it.

- [ ] **Step 4: Run endpoint and gateway suites**

~~~powershell
node --test test/unit-ci/agent-runtime-endpoint.spec.js test/unit-ci/agent-tool-gateway.spec.js test/unit-ci/agent-structured-tools.spec.js test/unit-ci/agent-session-resource-boundary.spec.js
~~~

Expected: 0 failures.

- [ ] **Step 5: Commit**

~~~powershell
git add apps/electerm-agent/src/client/components/ai/agent-runtime-context.js apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/test/unit-ci/agent-runtime-endpoint.spec.js
git commit -m "fix: freeze Agent execution endpoints"
~~~

### Task 5: Make diagnostic failures and AI handoff recoverable

**Files:**
- Create: apps/electerm-agent/src/client/components/ai/agent-task-handoff.js
- Create: apps/electerm-agent/src/client/components/ai/agent-task-view-state.js
- Create: apps/electerm-agent/test/unit-ci/agent-task-ui-state.spec.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-task-runner.jsx
- Modify: apps/electerm-agent/src/client/components/server-status/server-status-modal.jsx
- Modify: apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js

- [ ] **Step 1: Write pure behavior tests**

Test an error view without a task, successful delayed handoff, final timeout, and cancellation:

~~~js
test('run creation failure is visible without a task object', async () => {
  const { getAgentTaskViewState } = await import(viewStateUrl)
  assert.deepEqual(getAgentTaskViewState({
    phase: 'run-error',
    task: null,
    error: 'create failed'
  }), { kind: 'error', message: 'create failed', retryable: true })
})
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test test/unit-ci/agent-task-ui-state.spec.js
~~~

Expected: both new module imports fail.

- [ ] **Step 3: Implement view state and condition waiting**

getAgentTaskViewState returns creating, task, or error. Implement handoffAgentPromptToAi:

~~~js
export function handoffAgentPromptToAi ({
  prompt,
  getAiChat,
  schedule = setTimeout,
  maxAttempts = 20,
  retryDelay = 150,
  onReady = () => {},
  onUnavailable = () => {}
} = {}) {
  let attempts = 0
  let cancelled = false
  const tryHandoff = () => {
    if (cancelled) return
    attempts += 1
    const aiChat = getAiChat?.()
    if (typeof aiChat?.setPrompt === 'function') {
      aiChat.setPrompt(String(prompt || ''))
      onReady()
      return
    }
    if (attempts >= Math.max(1, maxAttempts)) return onUnavailable()
    schedule(tryHandoff, Math.max(0, retryDelay))
  }
  tryHandoff()
  return () => { cancelled = true }
}
~~~

- [ ] **Step 4: Integrate both UI call sites**

Set phase to run-error when confirmAndRun rejects before a task exists. Render the pure error state and add a retry button calling handleConfirm. Replace both 120ms timers with handoffAgentPromptToAi. Close only from onReady; warn from onUnavailable. Store and cancel each pending handoff on unmount.

Add Chinese and English keys for retry run, task creation failed, and handoff timeout in shellpilot-i18n-overrides.js.

- [ ] **Step 5: Run tests, lint, and commit**

~~~powershell
node --test test/unit-ci/agent-task-ui-state.spec.js test/unit-ci/agent-diagnostic-ui.spec.js test/unit-ci/agent-task-runner.spec.js
npx standard src/client/components/ai/agent-task-handoff.js src/client/components/ai/agent-task-view-state.js src/client/components/ai/agent-task-runner.jsx src/client/components/server-status/server-status-modal.jsx
git add apps/electerm-agent/src/client/components/ai/agent-task-handoff.js apps/electerm-agent/src/client/components/ai/agent-task-view-state.js apps/electerm-agent/src/client/components/ai/agent-task-runner.jsx apps/electerm-agent/src/client/components/server-status/server-status-modal.jsx apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/agent-task-ui-state.spec.js
git commit -m "fix: make Agent task recovery actions reliable"
~~~

Expected: tests and StandardJS exit 0 before commit.

### Task 6: Verify runtime-safety batch

**Files:**
- Verify only.

- [ ] **Step 1: Run the focused suite**

~~~powershell
node --test test/unit-ci/agent-task-runner.spec.js test/unit-ci/agent-cancellation.spec.js test/unit-ci/agent-cancellation-lifecycle.spec.js test/unit-ci/ai-run-cancellation.spec.js test/unit-ci/agent-runtime-endpoint.spec.js test/unit-ci/agent-task-ui-state.spec.js test/unit-ci/agent-tool-gateway.spec.js test/unit-ci/agent-structured-tools.spec.js test/unit-ci/agent-session-resource-boundary.spec.js
~~~

Expected: 0 failures.

- [ ] **Step 2: Run targeted lint**

~~~powershell
npx standard src/client/components/ai/agent-task-registry.js src/client/components/ai/agent-task-controller.js src/client/components/ai/agent-run-cancellation-controller.js src/client/components/ai/agent-runtime-context.js src/client/components/ai/agent.js src/client/components/ai/agent-task-handoff.js src/client/components/ai/agent-task-view-state.js src/client/components/ai/agent-task-runner.jsx src/client/components/server-status/server-status-modal.jsx
~~~

Expected: exit 0.

- [ ] **Step 3: Inspect scope**

~~~powershell
git diff --check
git status --short
~~~

Expected: no whitespace errors; unrelated pre-existing dirty files remain untouched.
