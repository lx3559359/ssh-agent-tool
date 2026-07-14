const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const executionUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/command-execution.js'
)).href
const registryUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/background-task-registry.js'
)).href

test('background wrapper writes only the captured PID with valid shell separators', async () => {
  const { buildCommandExecution } = await import(executionUrl)
  const execution = buildCommandExecution({
    command: 'printf ok',
    operationId: 'operation-1',
    mode: 'background'
  })

  assert.match(execution.submittedCommand, /^bash -c /)
  assert.match(execution.metadata.launcherScript, /bg_pid=\$!;/)
  assert.match(execution.metadata.launcherScript, /printf '%s\\n' "\$bg_pid"/)
  assert.match(execution.metadata.launcherScript, /; disown "\$bg_pid"/)
  assert.doesNotMatch(execution.metadata.launcherScript, /> [^;]+ disown/)
})

test('status finalizes the original operation from the real payload exit code once', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  const finalizations = []
  const registry = createBackgroundTaskRegistry({
    readFile: async (_tabId, path) => path.endsWith('.exit') ? '7\n' : '4321\n',
    isAlive: async () => false,
    kill: async () => false,
    now: () => 200
  })
  registry.register({
    id: 'bg-operation-1',
    operationId: 'operation-1',
    tabId: 'tab-1',
    command: 'exit 7',
    startTime: 100,
    pidFile: '/tmp/task.pid',
    exitFile: '/tmp/task.exit',
    logFile: '/tmp/task.log',
    finalize: async exitCode => finalizations.push(exitCode),
    cancel: async () => true
  })

  const first = await registry.status('bg-operation-1')
  const second = await registry.status('bg-operation-1')

  assert.equal(first.status, 'failed')
  assert.equal(first.exitCode, 7)
  assert.equal(first.operationId, 'operation-1')
  assert.equal(second.exitCode, 7)
  assert.deepEqual(finalizations, [7])
})

test('cancel uses a validated PID and cancels the transaction only after kill succeeds', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  const killed = []
  const cancellations = []
  const registry = createBackgroundTaskRegistry({
    readFile: async (_tabId, path) => path.endsWith('.exit') ? '' : '4321\n',
    isAlive: async () => true,
    kill: async (_tabId, pid) => {
      killed.push(pid)
      return true
    }
  })
  registry.register({
    id: 'bg-operation-2',
    operationId: 'operation-2',
    tabId: 'tab-1',
    command: 'sleep 30',
    pidFile: '/tmp/task.pid',
    exitFile: '/tmp/task.exit',
    logFile: '/tmp/task.log',
    finalize: async () => {},
    cancel: async reason => {
      cancellations.push(reason)
      return true
    }
  })

  const result = await registry.cancel('bg-operation-2')

  assert.equal(result.status, 'cancelled')
  assert.deepEqual(killed, ['4321'])
  assert.equal(cancellations.length, 1)
})

test('missing or malformed background identity is reported as interrupted, never completed', async () => {
  const { createBackgroundTaskRegistry } = await import(registryUrl)
  const registry = createBackgroundTaskRegistry({
    readFile: async () => '123; touch /tmp/pwned',
    isAlive: async () => true,
    kill: async () => true
  })

  const orphan = await registry.status('bg-after-restart')
  assert.equal(orphan.status, 'unknown')
  assert.equal(orphan.interrupted, true)

  registry.register({
    id: 'bg-malformed',
    operationId: 'operation-3',
    tabId: 'tab-1',
    command: 'sleep 30',
    pidFile: '/tmp/task.pid',
    exitFile: '/tmp/task.exit',
    logFile: '/tmp/task.log',
    finalize: async () => assert.fail('must not finalize'),
    cancel: async () => true
  })
  const malformed = await registry.status('bg-malformed')
  assert.equal(malformed.status, 'unknown')
  assert.equal(malformed.interrupted, true)
})
