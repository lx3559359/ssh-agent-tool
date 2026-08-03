const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const viewStateUrl = pathToFileURL(path.join(aiRoot, 'agent-task-view-state.js')).href
const handoffUrl = pathToFileURL(path.join(aiRoot, 'agent-task-handoff.js')).href
const registryUrl = pathToFileURL(path.join(aiRoot, 'agent-task-registry.js')).href

test('run creation failure is visible without a task object', async () => {
  const { getAgentTaskViewState } = await import(viewStateUrl)
  const view = getAgentTaskViewState({
    phase: 'run-error',
    task: null,
    error: 'create failed'
  })
  assert.equal(view.kind, 'error')
  assert.equal(view.status, 'failed')
  assert.equal(view.canRetry, true)
  assert.equal(view.showEvidence, false)
})

test('task view model covers every Agent diagnostic lifecycle state', async () => {
  const { getAgentTaskViewState } = await import(viewStateUrl)
  const cases = [{
    name: 'creating',
    input: { phase: 'generating' },
    expected: ['creating', 'shellpilotAgentTaskStateCreating', 'info', true, false, true, false]
  }, {
    name: 'running',
    input: {
      phase: 'running',
      task: { id: 'running', status: 'running-readonly' },
      runState: {
        phase: 'tool_execution',
        durationMs: 1200,
        modelRequests: 2,
        toolCalls: 3,
        endpointFingerprint: 'endpoint-12345678'
      }
    },
    expected: ['running', 'shellpilotAgentTaskStateRunning', 'info', true, false, true, true]
  }, {
    name: 'cancelling',
    input: {
      phase: 'running',
      cancelling: true,
      task: { id: 'cancelling', status: 'running-readonly' }
    },
    expected: ['cancelling', 'shellpilotAgentTaskStateCancelling', 'warning', false, false, true, true]
  }, {
    name: 'cancel_failed',
    input: {
      phase: 'cancel_failed',
      task: { id: 'cancel-failed', status: 'running-readonly' }
    },
    expected: ['cancel_failed', 'shellpilotAgentTaskStateCancelFailed', 'error', true, false, true, true]
  }, {
    name: 'budget_exceeded',
    input: {
      phase: 'finished',
      task: { id: 'budget', status: 'failed', terminationReason: 'budget_exceeded' }
    },
    expected: ['budget_exceeded', 'shellpilotAgentTaskStateBudgetExceeded', 'warning', false, true, true, true]
  }, {
    name: 'endpoint_changed',
    input: {
      phase: 'finished',
      task: { id: 'endpoint', status: 'failed', errorCode: 'AGENT_ENDPOINT_CHANGED' }
    },
    expected: ['endpoint_changed', 'shellpilotAgentTaskStateEndpointChanged', 'error', false, true, true, true]
  }, {
    name: 'failed',
    input: {
      phase: 'finished',
      task: { id: 'failed', status: 'failed' }
    },
    expected: ['failed', 'shellpilotAgentTaskStateFailed', 'error', false, true, true, true]
  }, {
    name: 'orphan',
    input: {
      phase: 'finished',
      task: {
        id: 'orphan',
        status: 'failed',
        terminationReason: 'orphaned',
        errorCode: 'AGENT_TASK_ORPHANED'
      }
    },
    expected: ['orphan', 'shellpilotAgentTaskStateOrphaned', 'error', false, true, true, true]
  }, {
    name: 'finished',
    input: {
      phase: 'finished',
      task: { id: 'finished', status: 'completed' }
    },
    expected: ['finished', 'shellpilotAgentTaskStateFinished', 'success', false, true, true, true]
  }]

  for (const item of cases) {
    const view = getAgentTaskViewState(item.input)
    assert.deepEqual([
      view.status,
      view.titleKey,
      view.severity,
      view.canCancel,
      view.canRetry,
      view.canClose,
      view.showEvidence
    ], item.expected, item.name)
  }

  const running = getAgentTaskViewState(cases[1].input)
  assert.equal(running.phase, 'tool_execution')
  assert.equal(running.elapsedMs, 1200)
  assert.equal(running.modelRequests, 2)
  assert.equal(running.toolCalls, 3)
  assert.equal(running.endpointFingerprint, 'endpoint-12345678')
})

test('AI prompt handoff waits until the chat composer is ready', async () => {
  const { handoffAgentPromptToAi } = await import(handoffUrl)
  const scheduled = []
  const prompts = []
  let attempts = 0
  let ready = 0
  handoffAgentPromptToAi({
    prompt: 'diagnostic prompt',
    getAiChat: () => {
      attempts += 1
      return attempts < 2 ? null : { setPrompt: value => prompts.push(value) }
    },
    schedule: callback => scheduled.push(callback),
    onReady: () => { ready += 1 }
  })

  assert.equal(scheduled.length, 1)
  scheduled.shift()()
  assert.deepEqual(prompts, ['diagnostic prompt'])
  assert.equal(ready, 1)
})

test('AI prompt handoff reports a bounded timeout', async () => {
  const { handoffAgentPromptToAi } = await import(handoffUrl)
  const scheduled = []
  let unavailable = 0
  handoffAgentPromptToAi({
    prompt: 'diagnostic prompt',
    getAiChat: () => null,
    schedule: callback => scheduled.push(callback),
    maxAttempts: 2,
    onUnavailable: () => { unavailable += 1 }
  })
  scheduled.shift()()
  assert.equal(unavailable, 1)
  assert.equal(scheduled.length, 0)
})

test('AI prompt handoff cancellation prevents a delayed write', async () => {
  const { handoffAgentPromptToAi } = await import(handoffUrl)
  const scheduled = []
  let promptWrites = 0
  const cancel = handoffAgentPromptToAi({
    prompt: 'diagnostic prompt',
    getAiChat: () => null,
    schedule: callback => scheduled.push(callback)
  })
  cancel()
  scheduled.shift()()
  assert.equal(promptWrites, 0)

  handoffAgentPromptToAi({
    prompt: 'other prompt',
    getAiChat: () => ({ setPrompt: () => { promptWrites += 1 } })
  })
  assert.equal(promptWrites, 1)
})

test('registry cancellation becomes visible and keeps finished task evidence', async () => {
  const { getAgentTaskViewState } = await import(viewStateUrl)
  const { createAgentTaskRegistry } = await import(registryUrl)
  const registry = createAgentTaskRegistry()
  const task = {
    id: 'visible-cancelled-task',
    status: 'running-readonly',
    endpoint: {
      host: 'srv.test',
      port: 22,
      username: 'ops',
      tabId: 'tab-a',
      pid: 'pid-a',
      terminalPid: 'terminal-a',
      sessionType: 'ssh',
      hostKeyFingerprint: 'SHA256:a'
    },
    steps: [{
      id: 'step-a',
      status: 'completed',
      output: 'bounded readonly evidence'
    }]
  }
  let aborted = false
  registry.register({
    taskId: task.id,
    endpoint: task.endpoint,
    controller: { abort: () => { aborted = true } },
    runner: {
      cancel: async () => ({ ...task, status: 'cancelled' })
    }
  })

  const cancelled = await registry.cancel(task.id)
  const view = getAgentTaskViewState({ phase: 'finished', task: cancelled })

  assert.equal(aborted, true)
  assert.equal(registry.has(task.id), false)
  assert.equal(view.status, 'cancelled')
  assert.equal(view.showEvidence, true)
  assert.equal(cancelled.steps[0].output, 'bounded readonly evidence')
})
