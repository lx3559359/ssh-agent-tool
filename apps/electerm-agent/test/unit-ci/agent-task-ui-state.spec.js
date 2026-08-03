const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const viewStateUrl = pathToFileURL(path.join(aiRoot, 'agent-task-view-state.js')).href
const handoffUrl = pathToFileURL(path.join(aiRoot, 'agent-task-handoff.js')).href

test('run creation failure is visible without a task object', async () => {
  const { getAgentTaskViewState } = await import(viewStateUrl)
  assert.deepEqual(getAgentTaskViewState({
    phase: 'run-error',
    task: null,
    error: 'create failed'
  }), { kind: 'error', message: 'create failed', retryable: true })
})

test('task view distinguishes creation from a real task', async () => {
  const { getAgentTaskViewState } = await import(viewStateUrl)
  assert.deepEqual(getAgentTaskViewState({ phase: 'running' }), {
    kind: 'creating'
  })
  const task = { id: 'task-a', status: 'running-readonly' }
  assert.deepEqual(getAgentTaskViewState({ phase: 'running', task }), {
    kind: 'task',
    task
  })
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
