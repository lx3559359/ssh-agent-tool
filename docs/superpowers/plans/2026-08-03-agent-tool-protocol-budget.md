# Agent Tool Protocol and Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每个工具调用只解析和校验一次，并为 Agent 默认启用总时长、模型、工具及内容大小预算。

**Architecture:** 新的参数解析器从现有工具描述符读取 JSON Schema，输出冻结的规范调用；风险判断和执行共享该对象。独立预算对象在昂贵操作前原子预留额度，并通过根 AbortController 中止超时运行。主进程 Axios 和渲染进程同时执行内容上限，避免完整缓冲超大响应。

**Tech Stack:** JavaScript ES modules/CommonJS, Axios 1.18, React 19, Ant Design InputNumber, Node.js node:test, StandardJS

---

## File map

- Create apps/electerm-agent/src/client/components/ai/agent-json-schema.js: 项目所需 JSON Schema 子集验证器。
- Create apps/electerm-agent/src/client/components/ai/agent-tool-call-parser.js: 严格解析并冻结工具调用。
- Create apps/electerm-agent/src/client/components/ai/agent-run-budget.js: 默认限制、计数、期限和标准错误。
- Create apps/electerm-agent/test/unit-ci/agent-tool-call-parser.spec.js.
- Create apps/electerm-agent/test/unit-ci/agent-run-budget.spec.js.
- Modify apps/electerm-agent/src/client/components/ai/agent.js.
- Modify apps/electerm-agent/src/client/components/ai/agent-tools.js.
- Modify apps/electerm-agent/src/client/components/ai/agent-runtime-context.js.
- Modify apps/electerm-agent/src/app/lib/ai.js.
- Modify apps/electerm-agent/src/client/common/default-setting.js.
- Modify apps/electerm-agent/src/client/components/ai/ai-config-props.js.
- Modify apps/electerm-agent/src/client/components/ai/ai-profiles.js.
- Modify apps/electerm-agent/src/client/components/ai/ai-config.jsx.
- Modify apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js.
- Modify apps/electerm-agent/test/unit-ci/ai-models.spec.js.
- Modify apps/electerm-agent/test/unit-ci/ai-profiles.spec.js.

### Task 1: Parse and validate every tool call exactly once

**Files:**
- Create: apps/electerm-agent/src/client/components/ai/agent-json-schema.js
- Create: apps/electerm-agent/src/client/components/ai/agent-tool-call-parser.js
- Create: apps/electerm-agent/test/unit-ci/agent-tool-call-parser.spec.js

- [ ] **Step 1: Write parser tests**

Cover invalid JSON, missing required fields, wrong primitive type, enum/range/length violations, additional properties, nested arrays/objects, unknown tools, valid no-argument tools, byte limits, and frozen output.

~~~js
test('malformed arguments never become an empty object', async () => {
  const { parseAgentToolCall } = await import(parserUrl)
  let descriptorReads = 0
  assert.throws(() => parseAgentToolCall({
    id: 'call-a',
    function: { name: 'list_tabs', arguments: '{bad' }
  }, {
    resolveDescriptor: () => {
      descriptorReads += 1
      return {
        function: {
          name: 'list_tabs',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        }
      }
    }
  }), error => error.code === 'AGENT_TOOL_ARGUMENTS_INVALID_JSON')
  assert.equal(descriptorReads, 0)
})

test('valid parsed arguments are frozen and reuse the public tool name', async () => {
  const { parseAgentToolCall } = await import(parserUrl)
  const parsed = parseAgentToolCall({
    id: 'call-b',
    function: { name: 'read_recent_logs', arguments: '{"unit":"sshd","limit":20}' }
  }, {
    resolveDescriptor: () => descriptor()
  })
  assert.equal(parsed.name, 'read_recent_logs')
  assert.deepEqual(parsed.args, { unit: 'sshd', limit: 20 })
  assert.equal(Object.isFrozen(parsed.args), true)
})
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test test/unit-ci/agent-tool-call-parser.spec.js
~~~

Expected: module import fails.

- [ ] **Step 3: Implement the schema validator**

Export validateAgentJsonSchema(schema, value, path = '$'). It returns the original value or throws an Error with code AGENT_TOOL_ARGUMENTS_SCHEMA_INVALID. Implement only the keywords used by the current catalog: type, properties, required, additionalProperties, items, enum, minimum, maximum, minItems, maxItems, minLength, and maxLength.

The object branch must iterate required keys, reject unknown keys only when additionalProperties is false, and recursively validate declared properties. The array branch validates length and every item. Number checks reject NaN and Infinity; integer additionally requires Number.isSafeInteger. Error messages contain the JSON path and schema rule but never serialize the rejected value.

- [ ] **Step 4: Implement strict call parsing**

~~~js
export function parseAgentToolCall (toolCall = {}, {
  resolveDescriptor = getAgentToolDescriptor,
  maxArgumentBytes = 256 * 1024
} = {}) {
  const name = String(toolCall?.function?.name || '')
  const source = toolCall?.function?.arguments
  const text = source === undefined || source === '' ? '{}' : String(source)
  if (new TextEncoder().encode(text).byteLength > maxArgumentBytes) {
    const error = new Error('Agent tool arguments exceed the byte limit')
    error.code = 'AGENT_TOOL_ARGUMENTS_TOO_LARGE'
    throw error
  }
  let args
  try {
    args = JSON.parse(text)
  } catch (cause) {
    const error = new Error('Agent tool arguments are not valid JSON')
    error.code = 'AGENT_TOOL_ARGUMENTS_INVALID_JSON'
    error.cause = cause
    throw error
  }
  const descriptor = resolveDescriptor(name)
  validateAgentJsonSchema(
    descriptor.function?.parameters || { type: 'object' },
    args
  )
  return Object.freeze({
    id: String(toolCall.id || ''),
    name,
    args: Object.freeze({ ...args }),
    descriptor
  })
}
~~~

Use a recursive deepFreeze for nested arrays/objects instead of the shallow freeze shown in the return sketch.

- [ ] **Step 5: Run tests, lint, and commit**

~~~powershell
node --test test/unit-ci/agent-tool-call-parser.spec.js
npx standard src/client/components/ai/agent-json-schema.js src/client/components/ai/agent-tool-call-parser.js
git add apps/electerm-agent/src/client/components/ai/agent-json-schema.js apps/electerm-agent/src/client/components/ai/agent-tool-call-parser.js apps/electerm-agent/test/unit-ci/agent-tool-call-parser.spec.js
git commit -m "feat: validate Agent tool calls once"
~~~

Expected: tests and StandardJS exit 0.

### Task 2: Share parsed arguments between risk and execution

**Files:**
- Modify: apps/electerm-agent/src/client/components/ai/agent.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-tools.js
- Modify: apps/electerm-agent/test/unit-ci/agent-tool-call-parser.spec.js
- Modify: apps/electerm-agent/test/unit-ci/agent-risk-execution.spec.js

- [ ] **Step 1: Write a failing identity test**

Inject a descriptor and executor, parse one call, and assert risk preparation and execution receive the exact same args object by strict identity. Add a malformed no-argument tool test that asserts neither prepareAgentRiskBatch nor executeToolCall is called.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test --test-name-pattern "same parsed arguments|malformed no-argument" test/unit-ci/agent-tool-call-parser.spec.js test/unit-ci/agent-risk-execution.spec.js
~~~

Expected: current prepareAgentRiskBatch reparses raw text and malformed JSON falls back to an executable empty object.

- [ ] **Step 3: Change risk preparation to parsed calls**

Change prepareAgentRiskBatch to accept entries shaped as id, name, args, descriptor. Remove its JSON.parse block. Use parsed.name, parsed.args, and parsed.descriptor directly. This function is internal and has one production caller, so no public IPC changes are needed.

- [ ] **Step 4: Integrate parser errors as non-executing tool results**

Before prepareAgentRiskBatch, map assistant tool calls through parseAgentToolCall. Store each parse failure as a tool card with status error and push a tool-role message containing:

~~~js
{
  error: true,
  code: error.code,
  name: 'AgentToolArgumentsError',
  data: sanitizeAIStoredText(error.message),
  executed: false
}
~~~

Pass only successfully parsed calls into risk preparation and executeToolCall. Use parsed.args for presentation, audit, observation, and execution. Never parse function.arguments elsewhere in the loop.

- [ ] **Step 5: Run the Agent protocol suites and commit**

~~~powershell
node --test test/unit-ci/agent-tool-call-parser.spec.js test/unit-ci/agent-risk-execution.spec.js test/unit-ci/agent-tool-policy.spec.js test/unit-ci/agent-tool-gateway.spec.js
git add apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/src/client/components/ai/agent-tools.js apps/electerm-agent/test/unit-ci/agent-tool-call-parser.spec.js apps/electerm-agent/test/unit-ci/agent-risk-execution.spec.js
git commit -m "fix: share validated Agent tool arguments"
~~~

Expected: 0 failures.

### Task 3: Implement default Agent run budgets

**Files:**
- Create: apps/electerm-agent/src/client/components/ai/agent-run-budget.js
- Create: apps/electerm-agent/test/unit-ci/agent-run-budget.spec.js

- [ ] **Step 1: Write boundary tests**

Test defaults, lower and upper override normalization, exact-limit success, one-over-limit failure for every counter/byte field, deadline expiration with an injected clock, one callback from startDeadline, idempotent dispose, and snapshots.

~~~js
test('default Agent budget exposes approved limits', async () => {
  const { createAgentRunBudget } = await import(budgetUrl)
  const budget = createAgentRunBudget()
  assert.deepEqual(budget.limits, {
    maxDurationMs: 60 * 60 * 1000,
    maxModelRequests: 100,
    maxToolCalls: 256,
    maxToolCallsPerTurn: 32,
    maxModelResponseBytes: 8 * 1024 * 1024,
    maxToolArgumentBytes: 256 * 1024,
    maxToolResultBytes: 8 * 1024 * 1024
  })
})
~~~

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test test/unit-ci/agent-run-budget.spec.js
~~~

Expected: module import fails.

- [ ] **Step 3: Implement limits and errors**

Export DEFAULT_AGENT_RUN_LIMITS, normalizeAgentLimitConfig, resolveAgentRunLimits, AgentBudgetError, and createAgentRunBudget. normalizeAgentLimitConfig preserves the user-facing minute/MiB/KiB fields; resolveAgentRunLimits converts that normalized object to millisecond/byte fields. AgentBudgetError has code AGENT_BUDGET_EXCEEDED and budgetType. The budget object exposes:

~~~js
{
  limits,
  reserveModelRequest,
  reserveToolCalls,
  assertToolArguments,
  assertModelResponse,
  assertToolResult,
  assertTime,
  startDeadline,
  snapshot,
  dispose
}
~~~

reserveToolCalls(count) checks both per-turn count and cumulative count before incrementing. Byte checks accept a byte count and do not allocate copies. snapshot returns elapsedMs, modelRequests, toolCalls, and the immutable limits.

- [ ] **Step 4: Implement the deadline without timer leaks**

startDeadline(onExceeded) creates one timeout for remaining duration. Its callback creates one AgentBudgetError with budgetType duration, records it on the budget, and invokes onExceeded(error). dispose clears the timer. assertTime throws the recorded deadline error or creates the same error when the injected clock passes the deadline.

- [ ] **Step 5: Run tests, lint, and commit**

~~~powershell
node --test test/unit-ci/agent-run-budget.spec.js
npx standard src/client/components/ai/agent-run-budget.js
git add apps/electerm-agent/src/client/components/ai/agent-run-budget.js apps/electerm-agent/test/unit-ci/agent-run-budget.spec.js
git commit -m "feat: add default Agent run budgets"
~~~

Expected: tests and StandardJS exit 0.

### Task 4: Persist configurable limits without breaking old profiles

**Files:**
- Modify: apps/electerm-agent/src/client/common/default-setting.js
- Modify: apps/electerm-agent/src/client/components/ai/ai-config-props.js
- Modify: apps/electerm-agent/src/client/components/ai/ai-profiles.js
- Modify: apps/electerm-agent/src/client/components/ai/ai-config.jsx
- Modify: apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js
- Modify: apps/electerm-agent/test/unit-ci/ai-profiles.spec.js
- Modify: apps/electerm-agent/test/unit-ci/ai-config-required.spec.js

- [ ] **Step 1: Write compatibility tests**

Assert an old profile without agentLimits normalizes to defaults, a profile with limits round-trips through migrate/upsert/export-import, invalid negative/NaN/string values fall back to defaults, and the primary configuration section remains unchanged.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test --test-name-pattern "Agent limits|primary section" test/unit-ci/ai-profiles.spec.js test/unit-ci/ai-profile-transfer.spec.js test/unit-ci/ai-config-required.spec.js
~~~

Expected: the new limits are absent after profile normalization and transfer.

- [ ] **Step 3: Add one optional profile object**

Add agentLimits to PROFILE_KEYS, AI_PROFILE_REQUEST_KEYS, aiConfigsArr, default setting, profile add/copy paths, and profile transfer. Normalize it through normalizeAgentRunLimits. Use these user-facing fields:

~~~js
{
  maxDurationMinutes: 60,
  maxModelRequests: 100,
  maxToolCalls: 256,
  maxToolCallsPerTurn: 32,
  maxModelResponseMiB: 8,
  maxToolArgumentKiB: 256,
  maxToolResultMiB: 8
}
~~~

normalizeAgentLimitConfig validates and persists these display-unit fields. resolveAgentRunLimits converts the validated object to runtime byte/millisecond fields. Invalid non-finite, non-numeric, or non-positive inputs fall back to the corresponding default instead of being coerced.

- [ ] **Step 4: Add advanced form controls**

Import InputNumber from Ant Design. Add seven controls inside the existing advanced collapse using nested names such as ['agentLimits', 'maxDurationMinutes']. Set min 1 and explicit max values: 1440 minutes, 1000 model requests, 4096 tool calls, 128 calls per turn, 64 MiB model response, 1024 KiB arguments, and 64 MiB tool result. Add Chinese and English labels, units, and the explanation that limits are enabled by default.

- [ ] **Step 5: Run profile/UI tests, lint, and commit**

~~~powershell
node --test test/unit-ci/ai-profiles.spec.js test/unit-ci/ai-profile-transfer.spec.js test/unit-ci/ai-config-required.spec.js
npx standard src/client/common/default-setting.js src/client/components/ai/ai-config-props.js src/client/components/ai/ai-profiles.js src/client/components/ai/ai-config.jsx
git add apps/electerm-agent/src/client/common/default-setting.js apps/electerm-agent/src/client/components/ai/ai-config-props.js apps/electerm-agent/src/client/components/ai/ai-profiles.js apps/electerm-agent/src/client/components/ai/ai-config.jsx apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/test/unit-ci/ai-profiles.spec.js apps/electerm-agent/test/unit-ci/ai-profile-transfer.spec.js apps/electerm-agent/test/unit-ci/ai-config-required.spec.js
git commit -m "feat: persist configurable Agent limits"
~~~

Expected: tests and StandardJS exit 0.

### Task 5: Enforce model response limits in the main process

**Files:**
- Modify: apps/electerm-agent/src/app/lib/ai.js
- Modify: apps/electerm-agent/test/unit-ci/ai-models.spec.js

- [ ] **Step 1: Write Axios configuration tests**

Capture axios.create options for AIchatWithTools and assert maxContentLength equals 8 MiB by default. Pass an optional final requestLimits argument and assert a valid lower value is honored while zero, negative, NaN, string, and above-64-MiB values use the default.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test --test-name-pattern "maxContentLength" test/unit-ci/ai-models.spec.js
~~~

Expected: maxContentLength is undefined.

- [ ] **Step 3: Add a bounded request option**

Extend AI_REQUEST_LIMITS with maxContentLengthBytes from SHELLPILOT_AI_RESPONSE_MAX_BYTES and default 8 MiB. In createAIClient set:

~~~js
config.maxContentLength = readBoundedResponseLimit(
  options.maxContentLength,
  AI_REQUEST_LIMITS.maxContentLengthBytes
)
~~~

readBoundedResponseLimit accepts only finite positive integers up to 64 MiB. Extend AIchatWithTools with one optional final requestLimits argument and pass its maxContentLengthBytes into createAIClient. Existing callers remain valid because the new argument is last and optional.

- [ ] **Step 4: Pass the selected Agent limit from renderer**

Append this sanitized object after traceContext in callBackendAIchatWithTools:

~~~js
{
  maxContentLengthBytes: runtimeLimits.maxModelResponseBytes
}
~~~

Do not pass credentials or other profile fields in this object.

- [ ] **Step 5: Run backend tests and commit**

~~~powershell
node --test test/unit-ci/ai-models.spec.js test/unit-ci/ai-health-backend.spec.js
git add apps/electerm-agent/src/app/lib/ai.js apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/test/unit-ci/ai-models.spec.js
git commit -m "fix: bound Agent model response bodies"
~~~

Expected: 0 failures.

### Task 6: Enforce budgets in the Agent loop

**Files:**
- Modify: apps/electerm-agent/src/client/components/ai/agent.js
- Modify: apps/electerm-agent/src/client/components/ai/agent-runtime-context.js
- Modify: apps/electerm-agent/test/unit-ci/agent-run-budget.spec.js
- Modify: apps/electerm-agent/test/unit-ci/agent-output-backpressure.spec.js

- [ ] **Step 1: Write integration tests**

Use injected low limits and fake backend/tool functions. Assert: model request count stops at the limit; 33 tool calls fail before risk preparation with the default per-turn cap; cumulative calls stop at the total cap; duration aborts an active request; oversized tool results become explicit truncated observations; budget failure preserves prior response and sets completionStatus failed with terminationReason budget_exceeded.

- [ ] **Step 2: Run and verify RED**

~~~powershell
node --test --test-name-pattern "budget|per-turn|oversized tool result" test/unit-ci/agent-run-budget.spec.js test/unit-ci/agent-output-backpressure.spec.js
~~~

Expected: the loop continues or lacks the asserted termination metadata.

- [ ] **Step 3: Reserve before each expensive operation**

At run creation call resolveAgentRunLimits(config.agentLimits), create the budget, expose budget.snapshot on agentRuntime, and start its deadline with a callback that stores the AgentBudgetError then aborts the root controller.

Before every model request call assertTime and reserveModelRequest. Immediately after receiving the backend object assertModelResponse using byteLength(JSON.stringify(result)). Before risk preparation reserveToolCalls for the whole turn. The parser uses budget.limits.maxToolArgumentBytes.

- [ ] **Step 4: Bound results and persist the reason**

After executeToolCall and before creating an observation, measure string/JSON bytes. If the result exceeds maxToolResultBytes, replace it with an object containing truncated true, originalBytes, limitBytes, and a head/tail bounded preview. Keep the existing smaller model-context bound in boundAgentToolResult.

When AgentBudgetError is caught, cancel active operations, retain accumulatedContent and completed tool cards, append the localized budget notice, and persist:

~~~js
{
  completionStatus: 'failed',
  terminationReason: 'budget_exceeded',
  errorCode: 'AGENT_BUDGET_EXCEEDED',
  budget: budget.snapshot()
}
~~~

Always call budget.dispose in finally.

- [ ] **Step 5: Run focused tests and commit**

~~~powershell
node --test test/unit-ci/agent-run-budget.spec.js test/unit-ci/agent-output-backpressure.spec.js test/unit-ci/agent-output-stress.spec.js test/unit-ci/agent-pagination.spec.js test/unit-ci/agent-cancellation.spec.js
npx standard src/client/components/ai/agent.js src/client/components/ai/agent-runtime-context.js src/client/components/ai/agent-run-budget.js
git add apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/src/client/components/ai/agent-runtime-context.js apps/electerm-agent/test/unit-ci/agent-run-budget.spec.js apps/electerm-agent/test/unit-ci/agent-output-backpressure.spec.js apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js
git commit -m "feat: enforce Agent execution budgets"
~~~

Expected: tests and StandardJS exit 0.

### Task 7: Verify protocol-and-budget batch

**Files:**
- Verify only.

- [ ] **Step 1: Run focused suites**

~~~powershell
node --test test/unit-ci/agent-tool-call-parser.spec.js test/unit-ci/agent-run-budget.spec.js test/unit-ci/agent-risk-execution.spec.js test/unit-ci/agent-tool-policy.spec.js test/unit-ci/agent-tool-gateway.spec.js test/unit-ci/agent-output-backpressure.spec.js test/unit-ci/agent-output-stress.spec.js test/unit-ci/agent-pagination.spec.js test/unit-ci/ai-models.spec.js test/unit-ci/ai-profiles.spec.js test/unit-ci/ai-profile-transfer.spec.js test/unit-ci/ai-config-required.spec.js
~~~

Expected: 0 failures.

- [ ] **Step 2: Run targeted lint**

~~~powershell
npx standard src/client/components/ai/agent-json-schema.js src/client/components/ai/agent-tool-call-parser.js src/client/components/ai/agent-run-budget.js src/client/components/ai/agent.js src/client/components/ai/agent-tools.js src/client/components/ai/agent-runtime-context.js src/client/components/ai/ai-profiles.js src/client/components/ai/ai-config.jsx src/app/lib/ai.js
~~~

Expected: exit 0.

- [ ] **Step 3: Inspect scope**

~~~powershell
git diff --check
git status --short
~~~

Expected: no whitespace errors and no unrelated file changes.
