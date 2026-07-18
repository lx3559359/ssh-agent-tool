const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const commandEntrypointUrl = pathToFileURL(path.join(
  root,
  'src/client/common/safety-transactions/command-entrypoint.js'
)).href
const transferSafetyUrl = pathToFileURL(path.join(
  root,
  'src/client/components/file-transfer/file-transfer-safety.js'
)).href

function installQualityRecorder () {
  const calls = []
  const previousWindow = globalThis.window
  globalThis.window = {
    pre: {
      runGlobalAsync: async (...args) => {
        if (args[0] === 'recordQualityEvent') calls.push(args)
        return true
      }
    }
  }
  return {
    calls,
    restore () {
      if (previousWindow === undefined) delete globalThis.window
      else globalThis.window = previousWindow
    }
  }
}

test('SSH safety command records one trace across started and completed events', async () => {
  const recorder = installQualityRecorder()
  try {
    const { createSafetyCommandEntrypoint } = await import(commandEntrypointUrl)
    const parentTrace = {
      traceId: 'sp-1784304000000-12345678',
      taskId: 'agent-parent-task',
      requestId: 'agent-parent-request',
      password: 'parent-secret'
    }
    let preparedRequest
    const entrypoint = createSafetyCommandEntrypoint({
      createId: () => 'command-business-id',
      getEndpoint: () => ({ host: 'server.example.com', port: 22, username: 'operator' }),
      buildConfirmation: () => ({ executeAllowed: true }),
      inputCommand: () => {},
      submitCommand: () => true,
      tracker: {
        expectExternalSubmission: () => 'submission-token',
        markExpectedSubmissionReleased: () => true,
        cancelExpectedSubmission: () => true
      },
      runner: {
        prepare: async request => {
          preparedRequest = request
          return { ...request, state: 'awaiting-confirmation' }
        },
        beginExternalExecution: async () => ({
          state: 'executing',
          executionId: 'execution-business-id'
        }),
        completeExternalExecution: async () => ({ state: 'rollback-available' }),
        cancel: async () => true
      }
    })
    entrypoint.beginSession()

    const run = await entrypoint.runSafetyCommand('pwd', {
      traceContext: parentTrace
    })
    await entrypoint.handleCommandFinished({
      token: run.token,
      command: run.execution.submittedCommand,
      exitCode: 0
    })

    assert.equal(run.operationId, 'command-business-id')
    assert.equal(preparedRequest.id, 'command-business-id')
    assert.deepEqual(Object.keys(preparedRequest.metadata).sort(), [
      'commandEntrypoint',
      'execution',
      'traceId'
    ])
    const events = recorder.calls.map(([, context, event]) => ({ context, event }))
    assert.equal(events.length, 2)
    assert.equal(events[0].context.traceId, parentTrace.traceId)
    assert.equal(events[0].context.traceId, events[1].context.traceId)
    assert.equal(events[0].context.operationId, 'command-business-id')
    assert.equal(events[1].context.operationId, 'command-business-id')
    assert.equal(events[0].context.taskId, undefined)
    assert.equal(events[0].context.requestId, undefined)
    assert.deepEqual(events.map(entry => entry.event.phase), ['started', 'completed'])
    assert.doesNotMatch(JSON.stringify(events), /pwd|server\.example\.com|operator/)
    assert.doesNotMatch(
      JSON.stringify(preparedRequest.metadata),
      /parent-secret|agent-parent-(?:task|request)/
    )
  } finally {
    recorder.restore()
  }
})

test('SFTP safety transfer keeps paths out of events and preserves its operation id', async () => {
  const recorder = installQualityRecorder()
  try {
    const { createTransferSafetyController } = await import(transferSafetyUrl)
    let preparedPlan
    const operation = { id: 'sftp-operation-business-id' }
    const capability = {
      prepareTransferSafetyOperation: async plan => {
        preparedPlan = plan
        operation.id = plan.operationId
        operation.metadata = { ...plan.metadata }
        return operation
      },
      beginTransferSafetyOperation: async () => ({ executionId: 'sftp-execution-id' }),
      completeTransferSafetyOperation: async () => ({ state: 'rollback-available' }),
      cancelTransferSafetyOperation: async () => ({ state: 'cancelled' })
    }
    const controller = createTransferSafetyController({
      getTransfer: () => ({
        id: 'transfer-item-id',
        transferBatch: 'transfer-batch-id',
        typeFrom: 'local',
        typeTo: 'remote',
        fromPath: 'C:\\private\\source.txt',
        toPath: '/srv/private/target.txt',
        finalToPath: '/srv/private/target.txt',
        fromFile: { isDirectory: false, size: 42 }
      }),
      getCapability: () => capability,
      cancelTransport: () => true
    })

    await controller.begin()
    await controller.complete({ exitCode: 0 })

    assert.equal(controller.operationId, preparedPlan.operationId)
    assert.equal(operation.metadata.traceId, preparedPlan.metadata.traceId)
    const events = recorder.calls.map(([, context, event]) => ({ context, event }))
    assert.equal(events.length, 2)
    assert.equal(events[0].context.traceId, events[1].context.traceId)
    assert.equal(events[0].context.operationId, preparedPlan.operationId)
    assert.equal(events[1].context.operationId, preparedPlan.operationId)
    assert.deepEqual(events.map(entry => entry.event.phase), ['started', 'completed'])
    assert.doesNotMatch(JSON.stringify(events), /private|source\.txt|target\.txt|\/srv\//)
  } finally {
    recorder.restore()
  }
})

test('SFTP safety transfer closes started traces when lifecycle capabilities disappear', async t => {
  const { createTransferSafetyController } = await import(transferSafetyUrl)
  const transfer = {
    id: 'capability-loss-transfer',
    typeFrom: 'local',
    typeTo: 'remote',
    fromPath: 'C:\\private\\source.txt',
    toPath: '/srv/private/target.txt',
    fromFile: { isDirectory: false, size: 42 }
  }

  await t.test('begin capability is missing', async () => {
    const recorder = installQualityRecorder()
    try {
      const controller = createTransferSafetyController({
        getTransfer: () => transfer,
        getCapability: () => null,
        cancelTransport: () => true
      })

      await assert.rejects(controller.begin())
      assert.deepEqual(
        recorder.calls.map(([, , event]) => event.phase),
        ['started', 'failed']
      )
    } finally {
      recorder.restore()
    }
  })

  await t.test('complete capability is missing', async () => {
    const recorder = installQualityRecorder()
    try {
      const capability = {
        prepareTransferSafetyOperation: async plan => ({
          id: plan.operationId,
          metadata: { ...plan.metadata }
        }),
        beginTransferSafetyOperation: async () => ({ executionId: 'execution-complete-loss' })
      }
      const controller = createTransferSafetyController({
        getTransfer: () => transfer,
        getCapability: () => capability,
        cancelTransport: () => true
      })

      await controller.begin()
      const completing = controller.complete()
      assert.strictEqual(controller.cancel(), completing)
      await assert.rejects(completing)
      assert.strictEqual(controller.dispose(), completing)
      assert.deepEqual(
        recorder.calls.map(([, , event]) => event.phase),
        ['started', 'failed']
      )
    } finally {
      recorder.restore()
    }
  })

  await t.test('cancel capability is missing', async () => {
    const recorder = installQualityRecorder()
    try {
      const capability = {
        prepareTransferSafetyOperation: async plan => ({
          id: plan.operationId,
          metadata: { ...plan.metadata }
        }),
        beginTransferSafetyOperation: async () => ({ executionId: 'execution-cancel-loss' })
      }
      const controller = createTransferSafetyController({
        getTransfer: () => transfer,
        getCapability: () => capability,
        cancelTransport: () => true
      })

      await controller.begin()
      const cancelling = controller.cancel()
      assert.strictEqual(controller.complete(), cancelling)
      await assert.rejects(cancelling)
      assert.strictEqual(controller.dispose(), cancelling)
      assert.deepEqual(
        recorder.calls.map(([, , event]) => event.phase),
        ['started', 'failed']
      )
    } finally {
      recorder.restore()
    }
  })
})

test('SFTP begin retries use one parent trace and distinct child operations', async () => {
  const recorder = installQualityRecorder()
  try {
    const { createTransferSafetyController } = await import(transferSafetyUrl)
    let beginCalls = 0
    const capability = {
      prepareTransferSafetyOperation: async plan => ({
        id: plan.operationId,
        metadata: { ...plan.metadata }
      }),
      beginTransferSafetyOperation: async () => {
        beginCalls += 1
        if (beginCalls === 1) {
          return { state: 'failed', error: 'temporary begin failure' }
        }
        return { executionId: 'execution-after-retry' }
      },
      completeTransferSafetyOperation: async () => ({ state: 'rollback-available' })
    }
    const controller = createTransferSafetyController({
      getTransfer: () => ({
        id: 'retry-trace-transfer',
        typeFrom: 'local',
        typeTo: 'remote',
        fromPath: 'C:\\private\\retry.txt',
        toPath: '/srv/private/retry.txt',
        fromFile: { isDirectory: false, size: 42 }
      }),
      getCapability: () => capability,
      cancelTransport: () => true
    })

    await assert.rejects(controller.begin(), /temporary begin failure/)
    await controller.begin()
    await controller.complete()

    const events = recorder.calls.map(([, context, event]) => ({ context, event }))
    assert.deepEqual(events.map(entry => entry.event.phase), [
      'started',
      'failed',
      'started',
      'completed'
    ])
    assert.equal(events[0].context.traceId, events[1].context.traceId)
    assert.equal(events[2].context.traceId, events[3].context.traceId)
    assert.equal(events[0].context.traceId, events[2].context.traceId)
    assert.equal(events[0].context.operationId, events[1].context.operationId)
    assert.equal(events[2].context.operationId, events[3].context.operationId)
    assert.notEqual(events[0].context.operationId, events[2].context.operationId)
  } finally {
    recorder.restore()
  }
})

test('production SFTP transfer preparation retains the controller trace id', () => {
  const source = fs.readFileSync(path.join(
    root,
    'src/client/components/sftp/sftp-entry.jsx'
  ), 'utf8')
  const prepareTransfer = source.slice(
    source.indexOf('prepareTransferSafetyOperation ='),
    source.indexOf('beginTransferSafetyOperation =')
  )

  assert.match(prepareTransfer, /traceId:\s*plan\.metadata\?\.traceId/)
})

test('renderer AI and updater entrypoints pass optional trace context at the IPC tail', () => {
  const historyItem = fs.readFileSync(path.join(
    root,
    'src/client/components/ai/ai-chat-history-item.jsx'
  ), 'utf8')
  const agent = fs.readFileSync(path.join(
    root,
    'src/client/components/ai/agent.js'
  ), 'utf8')
  const upgrade = fs.readFileSync(path.join(
    root,
    'src/client/components/main/upgrade.jsx'
  ), 'utf8')

  for (const source of [historyItem, upgrade]) {
    assert.match(source, /createTraceContext/)
    assert.match(source, /recordQualityEvent/)
  }
  assert.match(historyItem, /'AIchat',[\s\S]*?requestId,\s*traceContext/)
  assert.match(agent, /'AIchatWithTools',[\s\S]*?requestId,\s*traceContext/)
  assert.match(upgrade, /'nativeUpdateCheck',\s*updateOptions,\s*traceContext/)
  assert.match(upgrade, /'nativeUpdateDownload',\s*updateOptions,\s*traceContext/)
  assert.match(upgrade, /'nativeUpdateInstall',\s*traceContext/)
})
