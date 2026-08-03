# Agent Cancellation Deadline and Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent cancellation bounded and genuinely retryable after an unconfirmed backend stop while preserving existing call signatures and successful-cancellation idempotency.

**Architecture:** Keep the existing `AgentRunCancellationController` as the compatibility entrypoint. Wrap its concurrent stop barrier in one internal 30-second deadline, expose timer injection only as optional constructor dependencies for deterministic tests, and clear the memoized cancellation attempt only after failure so a later user retry performs fresh stop calls while the task registry continues holding the resource lock.

**Tech Stack:** JavaScript ES modules, Node.js built-in test runner, existing Agent task registry and local observer.

---

### Task 1: Reproduce hung cancellation and failed-attempt retry

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/agent-cancellation.spec.js`
- Test: `apps/electerm-agent/test/unit-ci/agent-cancellation.spec.js`

- [ ] **Step 1: Write the failing deadline test**

Add a test that registers a never-settling stop function, injects `cancellationTimeoutMs`, `setTimeout`, and `clearTimeout`, fires the captured deadline, and requires rejection with top-level code `AGENT_CANCELLATION_FAILED`, nested code `AGENT_CANCELLATION_TIMEOUT`, state `cancel_failed`, one observer failure event, and timer cleanup.

- [ ] **Step 2: Run the deadline test to verify RED**

Run:

```powershell
node --test --test-name-pattern "times out a hung backend stop" test/unit-ci/agent-cancellation.spec.js
```

Expected: FAIL because the current controller does not schedule a cancellation deadline.

- [ ] **Step 3: Write the failing retry test**

Add a test whose stop acknowledgement is false on the first call and true on the second. Concurrent calls during the first attempt must deduplicate, while a later `cancel()` must invoke the stop function again and end in `cancelled`.

- [ ] **Step 4: Run the retry test to verify RED**

Run:

```powershell
node --test --test-name-pattern "retries after an unconfirmed cancellation" test/unit-ci/agent-cancellation.spec.js
```

Expected: FAIL because the controller permanently returns the first rejected Promise.

### Task 2: Implement one bounded retryable cancellation attempt

**Files:**
- Modify: `apps/electerm-agent/src/client/components/ai/agent-run-cancellation-controller.js`
- Test: `apps/electerm-agent/test/unit-ci/agent-cancellation.spec.js`

- [ ] **Step 1: Add the internal deadline**

Define `DEFAULT_CANCELLATION_TIMEOUT_MS = 30000`, normalize an optional positive finite `cancellationTimeoutMs`, and accept optional `setTimeout`/`clearTimeout` dependencies. Race the existing `Promise.allSettled` stop barrier against a timer that rejects with `AGENT_CANCELLATION_TIMEOUT`, and always clear the timer when the attempt settles.

- [ ] **Step 2: Normalize all failed attempts**

Convert false acknowledgements, stop rejections, and timeout rejection into the existing top-level `AGENT_CANCELLATION_FAILED` aggregate. Preserve nested causes, publish one `cancel_failed` observer event, and keep state at `cancel_failed`.

- [ ] **Step 3: Permit a fresh attempt only after failure**

Keep concurrent callers on the same Promise. In the rejected attempt's `finally`, clear the memoized Promise only if it is still the active attempt; retain the resolved Promise after success so successful cancellation remains idempotent.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```powershell
node --test test/unit-ci/agent-cancellation.spec.js test/unit-ci/agent-cancellation-lifecycle.spec.js test/unit-ci/ai-run-cancellation.spec.js
```

Expected: all selected tests pass with zero failures.

### Task 3: Preserve retry through the chat Agent compatibility entrypoint

**Files:**
- Modify: `apps/electerm-agent/test/unit-ci/ai-empty-response-consumers.spec.js`
- Modify: `apps/electerm-agent/src/client/components/ai/agent.js`

- [ ] **Step 1: Write the failing `runAgentLoop` retry test**

Start a chat Agent with a hung model request, make `AIAgentCancel` reject once and acknowledge the next call, retain the public `abortRef.cancelCurrent` function, and require concurrent first-attempt calls to deduplicate while a later call reaches the backend again.

- [ ] **Step 2: Run the integration test to verify RED**

Run:

```powershell
node --test --test-name-pattern "chat Agent retries backend cancellation" test/unit-ci/ai-empty-response-consumers.spec.js
```

Expected: FAIL because `runAgentLoop` permanently caches the first rejected cancellation Promise.

- [ ] **Step 3: Clear only a failed outer cancellation attempt**

In `cancelCurrent`, clear `activeCancellation` in the failed attempt's `finally` when it still references that exact attempt, reset the prior failure before starting a fresh attempt, and retain successful attempts for idempotency.

- [ ] **Step 4: Run the integration test to verify GREEN**

Run:

```powershell
node --test --test-name-pattern "chat Agent retries backend cancellation" test/unit-ci/ai-empty-response-consumers.spec.js
```

Expected: one passing test, two backend cancellation calls, and a successful second attempt.

### Task 4: Verify compatibility and regression scope

Before final regression verification, apply the same shared cancellation deadline to `requestDiagnosticPlanText`: add a failing test for a hung `stopStream`, require `AGENT_CANCELLATION_TIMEOUT`, timer cleanup, and observer classification as `cancellation`, then reuse the controller module's deadline helper in `agent-task-controller.js` without changing existing request arguments. Extend the existing late-stream cancellation test to require a failed late `stopStream` to enter the local cancellation observer instead of an empty catch.

Review the retry path through active tool resources as well: a registered remote cancellation must remain registered after rejection, concurrent calls must share the same attempt, a later call must invoke the same idempotent remote stop again, and `runAgentLoop` must not clear unresolved cancellation handles when cancellation is unconfirmed. Add runtime and chat-loop behavior tests before changing these lifecycles.

**Files:**
- Verify: `apps/electerm-agent/src/client/components/ai/agent-run-cancellation-controller.js`
- Verify: `apps/electerm-agent/src/client/components/ai/agent.js`
- Verify: `apps/electerm-agent/src/client/components/ai/agent-task-controller.js`
- Verify: `apps/electerm-agent/src/client/components/ai/agent-runtime-context.js`
- Verify: `apps/electerm-agent/test/unit-ci/agent-cancellation.spec.js`
- Verify: `apps/electerm-agent/test/unit-ci/ai-empty-response-consumers.spec.js`
- Verify: `apps/electerm-agent/test/unit-ci/agent-task-runner.spec.js`

- [ ] **Step 1: Run Agent/AI cancellation and task suites**

Run:

```powershell
node --test test/unit-ci/agent-*.spec.js test/unit-ci/ai-run-cancellation.spec.js
```

Expected: zero failures; unsupported local SSH-agent capabilities may remain explicitly skipped.

- [ ] **Step 2: Run lint and the full unit suite**

Run:

```powershell
npm run lint
npm run test-unit-ci
```

Expected: lint exits 0 and all unit tests finish with zero failures.

- [ ] **Step 3: Review the diff and commit**

Run:

```powershell
git diff --check
git diff -- apps/electerm-agent/src/client/components/ai/agent-run-cancellation-controller.js apps/electerm-agent/test/unit-ci/agent-cancellation.spec.js docs/superpowers/plans/2026-08-04-agent-cancellation-deadline-retry.md
git add apps/electerm-agent/src/client/components/ai/agent-run-cancellation-controller.js apps/electerm-agent/test/unit-ci/agent-cancellation.spec.js docs/superpowers/plans/2026-08-04-agent-cancellation-deadline-retry.md
git commit -m "fix: bound and retry Agent cancellation"
```

Expected: the commit contains only the controller, regression tests, and this plan.
