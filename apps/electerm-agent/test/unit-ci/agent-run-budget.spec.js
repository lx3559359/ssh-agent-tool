const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const budgetUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-run-budget.js'
)).href

test('Agent renderer sends only its model response byte limit to the backend', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/ai/agent.js'
  ), 'utf8')
  const requestLimits = source.match(
    /traceContext,\s*(\{\s*maxContentLengthBytes:[\s\S]*?\})\s*\)/
  )?.[1] || ''

  assert.match(requestLimits, /maxContentLengthBytes:\s*runtimeLimits\.maxModelResponseBytes/)
  assert.doesNotMatch(requestLimits, /apiKeyAI|\.\.\.config/)
})

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
  assert.equal(Object.isFrozen(budget.limits), true)
})

test('Agent limit normalization accepts boundaries and rejects invalid overrides', async () => {
  const {
    normalizeAgentLimitConfig,
    resolveAgentRunLimits
  } = await import(budgetUrl)
  const upper = normalizeAgentLimitConfig({
    maxDurationMinutes: 1440,
    maxModelRequests: 1000,
    maxToolCalls: 4096,
    maxToolCallsPerTurn: 128,
    maxModelResponseMiB: 64,
    maxToolArgumentKiB: 1024,
    maxToolResultMiB: 64
  })
  assert.equal(upper.maxDurationMinutes, 1440)
  assert.equal(upper.maxToolArgumentKiB, 1024)

  const lower = normalizeAgentLimitConfig({
    maxDurationMinutes: 1,
    maxModelRequests: 1,
    maxToolCalls: 1,
    maxToolCallsPerTurn: 1,
    maxModelResponseMiB: 1,
    maxToolArgumentKiB: 1,
    maxToolResultMiB: 1
  })
  assert.deepEqual(resolveAgentRunLimits(lower), {
    maxDurationMs: 60 * 1000,
    maxModelRequests: 1,
    maxToolCalls: 1,
    maxToolCallsPerTurn: 1,
    maxModelResponseBytes: 1024 * 1024,
    maxToolArgumentBytes: 1024,
    maxToolResultBytes: 1024 * 1024
  })

  assert.deepEqual(normalizeAgentLimitConfig({
    maxDurationMinutes: 0,
    maxModelRequests: -1,
    maxToolCalls: 4097,
    maxToolCallsPerTurn: NaN,
    maxModelResponseMiB: '2',
    maxToolArgumentKiB: Infinity,
    maxToolResultMiB: 65
  }), {
    maxDurationMinutes: 60,
    maxModelRequests: 100,
    maxToolCalls: 256,
    maxToolCallsPerTurn: 32,
    maxModelResponseMiB: 8,
    maxToolArgumentKiB: 256,
    maxToolResultMiB: 8
  })
})

test('Agent budget counters allow the exact limit and reject one over atomically', async () => {
  const { createAgentRunBudget } = await import(budgetUrl)
  const budget = createAgentRunBudget({
    maxModelRequests: 2,
    maxToolCalls: 3,
    maxToolCallsPerTurn: 2
  }, { now: () => 0 })

  budget.reserveModelRequest()
  budget.reserveModelRequest()
  assert.throws(
    () => budget.reserveModelRequest(),
    error => error.code === 'AGENT_BUDGET_EXCEEDED' &&
      error.budgetType === 'model_requests'
  )
  budget.reserveToolCalls(2)
  assert.throws(
    () => budget.reserveToolCalls(3),
    error => error.budgetType === 'tool_calls_per_turn'
  )
  budget.reserveToolCalls(1)
  assert.throws(
    () => budget.reserveToolCalls(1),
    error => error.budgetType === 'tool_calls'
  )
  assert.deepEqual(budget.snapshot(), {
    elapsedMs: 0,
    modelRequests: 2,
    toolCalls: 3,
    limits: budget.limits
  })
})

test('Agent budget byte checks allow exact limits and reject one over', async () => {
  const { createAgentRunBudget } = await import(budgetUrl)
  const budget = createAgentRunBudget({
    maxModelResponseMiB: 1,
    maxToolArgumentKiB: 1,
    maxToolResultMiB: 1
  })
  const checks = [
    ['assertModelResponse', 1024 * 1024, 'model_response'],
    ['assertToolArguments', 1024, 'tool_arguments'],
    ['assertToolResult', 1024 * 1024, 'tool_result']
  ]

  for (const [method, limit, budgetType] of checks) {
    assert.doesNotThrow(() => budget[method](limit))
    assert.throws(
      () => budget[method](limit + 1),
      error => error.code === 'AGENT_BUDGET_EXCEEDED' &&
        error.budgetType === budgetType
    )
  }
})

test('Agent deadline fires once, is observable, and dispose is idempotent', async () => {
  const { createAgentRunBudget } = await import(budgetUrl)
  let now = 1000
  let scheduled
  let cleared = 0
  const budget = createAgentRunBudget({ maxDurationMinutes: 1 }, {
    now: () => now,
    setTimeout: (callback, delay) => {
      scheduled = { callback, delay }
      return 7
    },
    clearTimeout: id => {
      assert.equal(id, 7)
      cleared += 1
    }
  })
  const errors = []

  budget.startDeadline(error => errors.push(error))
  budget.startDeadline(error => errors.push(error))
  assert.equal(scheduled.delay, 60 * 1000)
  now += 60 * 1000
  scheduled.callback()
  scheduled.callback()
  assert.equal(errors.length, 1)
  assert.equal(errors[0].budgetType, 'duration')
  assert.throws(() => budget.assertTime(), error => error === errors[0])
  assert.equal(budget.snapshot().elapsedMs, 60 * 1000)

  budget.dispose()
  budget.dispose()
  assert.equal(cleared, 1)
})

test('Agent deadline can be disposed before it fires', async () => {
  const { createAgentRunBudget } = await import(budgetUrl)
  let callback
  let calls = 0
  const budget = createAgentRunBudget({}, {
    now: () => 0,
    setTimeout: fn => {
      callback = fn
      return 9
    },
    clearTimeout: () => {}
  })
  budget.startDeadline(() => { calls += 1 })
  budget.dispose()
  callback()
  assert.equal(calls, 0)
})
