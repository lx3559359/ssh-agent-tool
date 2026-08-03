const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-tool-scheduler.js'
)).href

const safeDescriptor = Object.freeze({
  scope: 'conversation',
  execution: 'structured',
  scheduling: Object.freeze({
    readonly: true,
    stateful: false,
    parallelSafe: true,
    coalesce: true
  })
})

const serialDescriptors = [
  { scope: 'session-read', scheduling: { parallelSafe: true } },
  { scope: 'conversation', scheduling: { parallelSafe: false } },
  { scope: 'conversation', scheduling: { parallelSafe: true, stateful: true } },
  { scope: 'session-write', scheduling: { parallelSafe: false } }
]

function safeCall (id, name = 'list_tabs', args = {}) {
  return { id, name, args, descriptor: safeDescriptor }
}

function delay (milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

test('declared pure reads overlap within the configured bound and keep input order', async () => {
  const { scheduleAgentToolCalls } = await import(moduleUrl)
  let active = 0
  let maxActive = 0
  const completed = []
  const calls = Array.from({ length: 6 }, (_, index) => (
    safeCall(`call-${index}`, index % 2 ? 'list_bookmarks' : 'list_tabs', {
      page: index
    })
  ))

  const results = await scheduleAgentToolCalls(calls, async call => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await delay(call.id === 'call-0' ? 15 : 2)
    completed.push(call.id)
    active -= 1
    return `result:${call.id}`
  }, { maxParallel: 2 })

  assert.equal(maxActive, 2)
  assert.notDeepEqual(completed, calls.map(call => call.id))
  assert.deepEqual(results, calls.map(call => `result:${call.id}`))
})

test('one rejected pure read does not cancel its siblings', async () => {
  const { scheduleAgentToolCalls } = await import(moduleUrl)
  const completed = []
  await assert.rejects(scheduleAgentToolCalls([
    safeCall('first', 'list_tabs', { page: 1 }),
    safeCall('broken', 'list_bookmarks', { page: 2 }),
    safeCall('last', 'list_tabs', { page: 3 })
  ], async call => {
    await delay(call.id === 'last' ? 5 : 1)
    completed.push(call.id)
    if (call.id === 'broken') throw new Error('read failed')
    return call.id
  }, { maxParallel: 3 }), /read failed/)

  assert.deepEqual(completed.sort(), ['broken', 'first', 'last'])
})

test('AbortSignal prevents undispatched pure reads', async () => {
  const { scheduleAgentToolCalls } = await import(moduleUrl)
  const controller = new AbortController()
  const executed = []
  await assert.rejects(scheduleAgentToolCalls([
    safeCall('first', 'list_tabs', { page: 1 }),
    safeCall('second', 'list_tabs', { page: 2 }),
    safeCall('third', 'list_tabs', { page: 3 })
  ], async call => {
    executed.push(call.id)
    controller.abort()
    return call.id
  }, {
    maxParallel: 1,
    signal: controller.signal
  }), error => error?.name === 'AbortError')

  assert.deepEqual(executed, ['first'])
})

test('terminal SFTP risky and stateful calls remain strictly serial', async () => {
  const { scheduleAgentToolCalls } = await import(moduleUrl)
  let active = 0
  let maxActive = 0
  const calls = serialDescriptors.map((descriptor, index) => ({
    id: `serial-${index}`,
    name: index === 0 ? 'sftp_list' : 'send_terminal_command',
    args: { index },
    descriptor
  }))

  const results = await scheduleAgentToolCalls(calls, async call => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await delay(2)
    active -= 1
    return call.id
  }, { maxParallel: 4 })

  assert.equal(maxActive, 1)
  assert.deepEqual(results, calls.map(call => call.id))
})

test('identical safe reads coalesce once while preserving both call results', async () => {
  const { scheduleAgentToolCalls } = await import(moduleUrl)
  let executions = 0
  const results = await scheduleAgentToolCalls([
    safeCall('tabs-a'),
    safeCall('tabs-b')
  ], async () => {
    executions += 1
    return '[{"id":"tab-a"}]'
  })

  assert.equal(executions, 1)
  assert.deepEqual(results, [
    '[{"id":"tab-a"}]',
    '[{"id":"tab-a"}]'
  ])
})
