const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

function result (stdout, code = 0) {
  return {
    stdout,
    stderr: '',
    code,
    signal: null,
    truncated: false
  }
}

test('ssh task channel uses runCmd and never writes to terminal', async () => {
  const calls = []
  const responses = [
    result(''),
    result(''),
    result('__OPS_SIZE__=6\n__OPS_NEXT__=3\n__OPS_EXIT__=0\n__OPS_DATA__=dXAK'),
    result('__OPS_SIZE__=6\n__OPS_NEXT__=6\n__OPS_EXIT__=0\n__OPS_DATA__=ZGF5')
  ]
  const { createSshTaskChannel } = await importModule(
    'src/client/components/operations-toolkit/runtime/ssh-task-channel.js'
  )
  const channel = createSshTaskChannel({
    runCmd: async (pid, command, options) => {
      calls.push({ pid, command, options })
      return responses.shift()
    },
    cancelRunCmd: async () => true,
    sleep: async () => {}
  })
  const chunks = []
  const completed = await channel.execute({
    pid: 88,
    taskId: 'ops-100',
    script: 'uptime',
    timeoutMs: 1000,
    onChunk: chunk => chunks.push(chunk)
  })
  assert.equal(completed.exitCode, 0)
  assert.equal(chunks.join(''), 'up\nday')
  assert.equal(calls.every(call => call.pid === 88), true)
  assert.equal(calls.some(call => call.command.includes('run.sh')), true)
})

test('ssh task channel cancels active poll and remote process', async () => {
  const calls = []
  const controller = new AbortController()
  const { createSshTaskChannel } = await importModule(
    'src/client/components/operations-toolkit/runtime/ssh-task-channel.js'
  )
  const channel = createSshTaskChannel({
    runCmd: async (pid, command) => {
      calls.push(command)
      if (calls.length === 2) controller.abort()
      return result('')
    },
    cancelRunCmd: async () => true,
    sleep: async () => {}
  })
  await assert.rejects(
    channel.execute({
      pid: 88,
      taskId: 'ops-101',
      script: 'sleep 60',
      timeoutMs: 1000,
      signal: controller.signal
    }),
    error => error.name === 'AbortError'
  )
  assert.equal(calls.some(command => command.includes('TERM')), true)
})
