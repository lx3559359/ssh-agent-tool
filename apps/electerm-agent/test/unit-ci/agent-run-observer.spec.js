const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const observerUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-run-observer.js'
)).href

test('Agent observer records counters, monotonic phases, and one terminal event', async () => {
  const { createAgentRunObserver } = await import(observerUrl)
  let now = 100
  const writes = []
  const observer = createAgentRunObserver({
    context: {
      traceId: 'sp-1784304000000-12345678',
      taskId: 'task-1'
    },
    token: 'run-token-a',
    now: () => now,
    writeEvent: (context, event) => writes.push({ context, event })
  })

  observer.start()
  observer.start()
  now = 125
  observer.phase('plan_request')
  now = 180
  observer.modelRequest()
  now = 240
  observer.toolCall()
  now = 300
  assert.equal(observer.finish('completed'), true)
  assert.equal(observer.finish('failed'), false)

  assert.deepEqual(writes.map(item => item.event.phase), [
    'started',
    'plan_request',
    'model_request',
    'tool_execution',
    'completed'
  ])
  assert.deepEqual(writes.map(item => item.event.durationMs), [0, 25, 80, 140, 200])
  assert.deepEqual(writes.map(item => item.event.modelRequests), [0, 0, 1, 1, 1])
  assert.deepEqual(writes.map(item => item.event.toolCalls), [0, 0, 0, 1, 1])
  assert.equal(new Set(writes.map(item => item.event.endpointFingerprint)).size, 1)
  assert.deepEqual(observer.snapshot(), {
    status: 'completed',
    phase: 'completed',
    durationMs: 200,
    modelRequests: 1,
    toolCalls: 1,
    endpointFingerprint: writes[0].event.endpointFingerprint,
    terminal: true
  })
})

test('Agent observer emits stable budget cancellation and error fields', async () => {
  const { createAgentRunObserver } = await import(observerUrl)
  const events = []
  const observer = createAgentRunObserver({
    token: 'run-token-b',
    now: () => 10,
    writeEvent: (context, event) => events.push(event)
  })

  observer.start()
  observer.budgetExceeded({
    code: 'AGENT_BUDGET_EXCEEDED',
    budgetType: 'tool_calls'
  })
  observer.cancellation('cancelling')
  observer.cancellation('cancel_failed', 'AGENT_CANCELLATION_FAILED')
  observer.error('endpoint', { code: 'AGENT_ENDPOINT_CHANGED' })
  observer.finish('failed', 'AGENT_ENDPOINT_CHANGED')

  assert.deepEqual(events.slice(1).map(event => ({
    phase: event.phase,
    status: event.status,
    errorStage: event.errorStage,
    budgetType: event.budgetType,
    reasonCode: event.reasonCode
  })), [
    {
      phase: 'budget_exceeded',
      status: 'failed',
      errorStage: 'budget',
      budgetType: 'tool_calls',
      reasonCode: 'AGENT_BUDGET_EXCEEDED'
    },
    {
      phase: 'cancelling',
      status: 'cancelling',
      errorStage: undefined,
      budgetType: undefined,
      reasonCode: undefined
    },
    {
      phase: 'cancel_failed',
      status: 'cancel_failed',
      errorStage: 'cancellation',
      budgetType: undefined,
      reasonCode: 'AGENT_CANCELLATION_FAILED'
    },
    {
      phase: 'error',
      status: 'failed',
      errorStage: 'endpoint',
      budgetType: undefined,
      reasonCode: 'AGENT_ENDPOINT_CHANGED'
    },
    {
      phase: 'failed',
      status: 'failed',
      errorStage: undefined,
      budgetType: undefined,
      reasonCode: 'AGENT_ENDPOINT_CHANGED'
    }
  ])
})

test('Agent observer writes bounded context compaction metrics', async () => {
  const { createAgentRunObserver } = await import(observerUrl)
  const events = []
  const observer = createAgentRunObserver({
    token: 'run-token-context',
    writeEvent: (context, event) => events.push(event)
  })

  observer.start()
  assert.equal(observer.metric('context_omitted_groups', 12), true)
  assert.equal(observer.metric('context omitted secrets', 5), false)
  assert.equal(observer.metric('context_omitted_messages', 24), true)

  assert.deepEqual(events.slice(1).map(event => ({
    metric: event.metric,
    value: event.value
  })), [
    { metric: 'context_omitted_groups', value: 12 },
    { metric: 'context_omitted_messages', value: 24 }
  ])
})

test('Agent observer endpoint ids are random-token based and redact all source data', async () => {
  const {
    createAgentEndpointFingerprint,
    createAgentRunObserver
  } = await import(observerUrl)
  const sensitive = {
    host: 'private.example',
    username: 'alice',
    hostKeyFingerprint: 'SHA256:private-key',
    command: 'cat /etc/shadow',
    output: 'private output',
    apiKey: 'sk-private-secret',
    conversation: 'private conversation'
  }
  const events = []
  const first = createAgentRunObserver({
    context: sensitive,
    endpoint: sensitive,
    token: 'opaque-a',
    writeEvent: (context, event) => events.push({ context, event })
  })
  const second = createAgentRunObserver({
    context: sensitive,
    endpoint: sensitive,
    token: 'opaque-b',
    writeEvent: (context, event) => events.push({ context, event })
  })
  first.start()
  first.error('model', { code: 'MODEL_ERROR', message: sensitive.conversation })
  second.start()

  assert.equal(
    first.snapshot().endpointFingerprint,
    createAgentEndpointFingerprint({ token: 'opaque-a' })
  )
  assert.notEqual(
    first.snapshot().endpointFingerprint,
    second.snapshot().endpointFingerprint
  )
  assert.match(first.snapshot().endpointFingerprint, /^endpoint-[0-9a-f]{8}$/)
  assert.doesNotMatch(
    JSON.stringify(events),
    /private|alice|shadow|sk-/i
  )
})

test('Agent observer never interrupts runs when its local writer fails', async () => {
  const { createAgentRunObserver } = await import(observerUrl)
  const syncObserver = createAgentRunObserver({
    writeEvent: () => { throw new Error('disk unavailable') }
  })
  const asyncObserver = createAgentRunObserver({
    writeEvent: async () => { throw new Error('queue unavailable') }
  })

  assert.doesNotThrow(() => {
    syncObserver.start()
    syncObserver.finish('completed')
    asyncObserver.start()
    asyncObserver.finish('completed')
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(syncObserver.snapshot().terminal, true)
  assert.equal(asyncObserver.snapshot().terminal, true)
})
