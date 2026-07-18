const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const readonlyExecUrl = pathToFileURL(path.join(
  aiRoot,
  'agent-readonly-exec.js'
)).href
const runtimeContextUrl = pathToFileURL(path.join(
  aiRoot,
  'agent-runtime-context.js'
)).href

function sessionEndpoint (overrides = {}) {
  return {
    host: 'agent.example.test',
    port: 22,
    username: 'operator',
    tabId: 'tab-readonly',
    pid: 1001,
    terminalPid: 2001,
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:test-fingerprint',
    ...overrides
  }
}

function commandResult (overrides = {}) {
  return {
    stdout: '',
    stderr: '',
    code: 0,
    signal: null,
    truncated: false,
    ...overrides
  }
}

test('executes ip addr through bounded SSH exec and freezes the captured result', async () => {
  const { executeAgentReadonlyCommand } = await import(readonlyExecUrl)
  const endpoint = sessionEndpoint()
  const currentEndpoint = sessionEndpoint()
  const runtime = { cancellations: new Set() }
  const calls = []
  const clock = [1000, 1125]

  const result = await executeAgentReadonlyCommand({
    command: 'ip addr',
    endpoint,
    resolveEndpoint: () => currentEndpoint,
    runtime,
    run: async (pid, command, options) => {
      calls.push({ pid, command, options })
      return commandResult({
        stdout: 'inet 10.0.0.2/24',
        stderr: 'link warning'
      })
    },
    cancel: async () => true,
    now: () => clock.shift(),
    createExecutionId: () => 'agent-readonly-test'
  })

  assert.deepEqual(calls, [{
    pid: endpoint.pid,
    command: 'ip addr',
    options: {
      timeoutMs: 15000,
      maxOutputBytes: 32768,
      executionId: 'agent-readonly-test'
    }
  }])
  assert.deepEqual(result, {
    kind: 'readonly-exec-result',
    command: 'ip addr',
    executionId: 'agent-readonly-test',
    endpoint: sessionEndpoint(),
    capturedAt: 1125,
    durationMs: 125,
    exitCode: 0,
    signal: null,
    truncated: false,
    output: 'inet 10.0.0.2/24\nlink warning'
  })
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.endpoint), true)
  assert.equal(Reflect.set(result, 'output', 'changed'), false)
  assert.equal(Reflect.set(result.endpoint, 'host', 'changed.example.test'), false)
  endpoint.host = 'mutated.example.test'
  assert.equal(result.endpoint.host, 'agent.example.test')
  assert.equal(runtime.cancellations.size, 0)
})

test('rejects changed unknown and dynamic shell commands before SSH dispatch', async () => {
  const { executeAgentReadonlyCommand } = await import(readonlyExecUrl)
  let runCalls = 0

  for (const command of [
    'ip addr add 10.0.0.2/24 dev eth0',
    'unknown-static-command',
    'echo $(id)',
    'ip addr && whoami'
  ]) {
    await assert.rejects(executeAgentReadonlyCommand({
      command,
      endpoint: sessionEndpoint(),
      resolveEndpoint: () => sessionEndpoint(),
      runtime: { cancellations: new Set() },
      run: async () => {
        runCalls += 1
        return commandResult()
      },
      cancel: async () => true
    }), error => {
      assert.equal(error.code, 'AGENT_READONLY_COMMAND_REJECTED')
      return true
    }, command)
  }

  assert.equal(runCalls, 0)
})

test('rejects an already cancelled Agent runtime without dispatch', async () => {
  const { executeAgentReadonlyCommand } = await import(readonlyExecUrl)
  const controller = new AbortController()
  controller.abort()
  let runCalls = 0

  await assert.rejects(executeAgentReadonlyCommand({
    command: 'ip addr',
    endpoint: sessionEndpoint(),
    resolveEndpoint: () => sessionEndpoint(),
    runtime: {
      signal: controller.signal,
      cancellations: new Set()
    },
    run: async () => {
      runCalls += 1
      return commandResult()
    },
    cancel: async () => true
  }), error => error.name === 'AbortError')

  assert.equal(runCalls, 0)
})

test('runtime cancellation reaches the exact SSH exec and preserves its cancellation error', async () => {
  const { executeAgentReadonlyCommand } = await import(readonlyExecUrl)
  const { cancelAgentRuntimeOperations } = await import(runtimeContextUrl)
  const controller = new AbortController()
  const runtime = {
    signal: controller.signal,
    cancellations: new Set()
  }
  const cancelCalls = []
  let rejectRun
  let runCalls = 0
  const cancellationError = new Error('Remote command cancelled.')
  cancellationError.name = 'RunCmdCancelledError'

  const running = executeAgentReadonlyCommand({
    command: 'ip addr',
    endpoint: sessionEndpoint(),
    resolveEndpoint: () => sessionEndpoint(),
    runtime,
    run: async () => {
      runCalls += 1
      return new Promise((resolve, reject) => { rejectRun = reject })
    },
    cancel: async (pid, executionId) => {
      cancelCalls.push({ pid, executionId })
      return true
    },
    createExecutionId: () => 'agent-readonly-cancel'
  })

  assert.equal(runtime.cancellations.size, 1)
  controller.abort()
  await cancelAgentRuntimeOperations(runtime)
  assert.deepEqual(cancelCalls, [{
    pid: sessionEndpoint().pid,
    executionId: 'agent-readonly-cancel'
  }])
  rejectRun(cancellationError)

  await assert.rejects(running, error => error === cancellationError)
  assert.equal(runCalls, 1)
  assert.equal(runtime.cancellations.size, 0)
})

test('rejects an endpoint change before dispatch with the stable error code', async () => {
  const { executeAgentReadonlyCommand } = await import(readonlyExecUrl)
  let runCalls = 0

  await assert.rejects(executeAgentReadonlyCommand({
    command: 'ip addr',
    endpoint: sessionEndpoint(),
    resolveEndpoint: () => sessionEndpoint({ pid: 1002 }),
    runtime: { cancellations: new Set() },
    run: async () => {
      runCalls += 1
      return commandResult()
    },
    cancel: async () => true
  }), error => error.code === 'SESSION_ENDPOINT_CHANGED')

  assert.equal(runCalls, 0)
})

test('rejects an endpoint change after SSH completion and clears cancellation state', async () => {
  const { executeAgentReadonlyCommand } = await import(readonlyExecUrl)
  const runtime = { cancellations: new Set() }
  let endpointChecks = 0

  await assert.rejects(executeAgentReadonlyCommand({
    command: 'ip addr',
    endpoint: sessionEndpoint(),
    resolveEndpoint: () => {
      endpointChecks += 1
      return endpointChecks === 1
        ? sessionEndpoint()
        : sessionEndpoint({ hostKeyFingerprint: 'SHA256:replacement' })
    },
    runtime,
    run: async () => commandResult({ stdout: 'completed output' }),
    cancel: async () => true
  }), error => error.code === 'SESSION_ENDPOINT_CHANGED')

  assert.equal(endpointChecks, 2)
  assert.equal(runtime.cancellations.size, 0)
})

test('passes through backend truncation metadata without applying a second output cap', async () => {
  const { executeAgentReadonlyCommand } = await import(readonlyExecUrl)
  const boundedBackendOutput = 'x'.repeat(32 * 1024)

  const result = await executeAgentReadonlyCommand({
    command: 'ip addr',
    endpoint: sessionEndpoint(),
    resolveEndpoint: () => sessionEndpoint(),
    runtime: { cancellations: new Set() },
    run: async () => commandResult({
      stdout: boundedBackendOutput,
      truncated: true
    }),
    cancel: async () => true,
    createExecutionId: () => 'agent-readonly-truncated'
  })

  assert.equal(result.truncated, true)
  assert.equal(result.output, boundedBackendOutput)
  assert.equal(Buffer.byteLength(result.output, 'utf8'), 32 * 1024)
})

test('freezes non-zero SSH close metadata and stderr output without retrying', async () => {
  const { executeAgentReadonlyCommand } = await import(readonlyExecUrl)
  let runCalls = 0

  const result = await executeAgentReadonlyCommand({
    command: 'ip addr',
    endpoint: sessionEndpoint(),
    resolveEndpoint: () => sessionEndpoint(),
    runtime: { cancellations: new Set() },
    run: async () => {
      runCalls += 1
      return commandResult({
        stdout: 'partial output',
        stderr: 'permission denied',
        code: 7,
        signal: 'TERM'
      })
    },
    cancel: async () => true,
    createExecutionId: () => 'agent-readonly-nonzero'
  })

  assert.equal(runCalls, 1)
  assert.equal(result.exitCode, 7)
  assert.equal(result.signal, 'TERM')
  assert.equal(result.truncated, false)
  assert.equal(result.output, 'partial output\npermission denied')
  assert.equal(Object.isFrozen(result), true)
})
