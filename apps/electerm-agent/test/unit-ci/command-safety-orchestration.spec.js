const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const orchestrationUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/command-orchestration.js'
)).href

function deferred () {
  let resolveDeferred
  const promise = new Promise(resolve => { resolveDeferred = resolve })
  return { promise, resolve: resolveDeferred }
}

async function waitFor (predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('timed out waiting for condition')
}

test('single-step commands return only after their tracked completion', async () => {
  const { runSafetyCommandSequence } = await import(orchestrationUrl)
  let waited = false
  const results = await runSafetyCommandSequence(['only'], {
    runStep: async () => ({
      sent: true,
      waitForCompletion: async () => {
        waited = true
        return { exitCode: 0, command: 'only' }
      }
    })
  })

  assert.equal(waited, true)
  assert.equal(results.length, 1)
  assert.equal(results[0].completion.command, 'only')
})

test('multi-step commands wait for terminal completion before starting the next step', async () => {
  const { runSafetyCommandSequence } = await import(orchestrationUrl)
  const firstCompletion = deferred()
  const calls = []
  const running = runSafetyCommandSequence(['first', 'second'], {
    timeoutMs: 1000,
    runStep: async command => {
      calls.push(command)
      return {
        sent: true,
        waitForCompletion: async () => {
          if (command === 'first') await firstCompletion.promise
          return { exitCode: 0, command }
        }
      }
    }
  })

  await waitFor(() => calls.length === 1)
  assert.deepEqual(calls, ['first'])
  firstCompletion.resolve()
  const results = await running
  assert.deepEqual(calls, ['first', 'second'])
  assert.deepEqual(results.map(result => result.completion.command), [
    'first',
    'second'
  ])
})

test('multi-step commands stop after exit failure or safety cancellation', async () => {
  const { runSafetyCommandSequence } = await import(orchestrationUrl)
  for (const mode of ['exit', 'cancel']) {
    const calls = []
    await assert.rejects(runSafetyCommandSequence(['first', 'second'], {
      timeoutMs: 1000,
      runStep: async command => {
        calls.push(command)
        if (mode === 'cancel') {
          return { sent: false, cancelled: true }
        }
        return {
          sent: true,
          waitForCompletion: async () => {
            throw new Error('命令执行失败，退出码 9，已停止后续命令。')
          }
        }
      }
    }), mode === 'exit' ? /退出码 9/ : /取消|尚未发送/)
    assert.deepEqual(calls, ['first'], mode)
  }
})

test('batch commands create one safety execution per terminal and report every failure', async () => {
  const { runSafetyCommandBatch } = await import(orchestrationUrl)
  const calls = []
  const terminals = new Map([
    ['tab-1', {
      runSafetyCommand: async (command, options) => {
        calls.push({ tabId: 'tab-1', command, options })
        return {
          sent: true,
          waitForCompletion: async () => ({ exitCode: 0 })
        }
      }
    }],
    ['tab-2', {
      runSafetyCommand: async (command, options) => {
        calls.push({ tabId: 'tab-2', command, options })
        return {
          sent: true,
          waitForCompletion: async () => {
            throw new Error('命令执行失败，退出码 4。')
          }
        }
      }
    }]
  ])

  await assert.rejects(runSafetyCommandBatch('uptime', ['tab-1', 'tab-2'], {
    getTerminal: tabId => terminals.get(tabId),
    timeoutMs: 1000,
    source: 'quick-command',
    title: '批量终端命令'
  }), error => {
    assert.match(error.message, /tab-2.*退出码 4/)
    assert.equal(error.failures.length, 1)
    return true
  })
  assert.deepEqual(calls.map(call => call.tabId), ['tab-1', 'tab-2'])
  assert.deepEqual(calls.map(call => call.options.source), [
    'quick-command',
    'quick-command'
  ])
})

test('batch commands fail explicitly when a terminal has no safety entrypoint', async () => {
  const { runSafetyCommandBatch } = await import(orchestrationUrl)
  await assert.rejects(runSafetyCommandBatch('uptime', ['missing'], {
    getTerminal: () => undefined
  }), /missing.*安全命令入口|终端/)
})
