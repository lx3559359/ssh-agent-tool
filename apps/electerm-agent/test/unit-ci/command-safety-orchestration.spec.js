const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const orchestrationUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/command-orchestration.js'
)).href
const classifierUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/command-classifier.js'
)).href

test('classifies limited ip address aliases as readonly', async () => {
  const { classifyCommand } = await import(classifierUrl)

  assert.equal(classifyCommand('ip a').risk, 'readonly')
  assert.equal(classifyCommand('ip a show dev eth0').risk, 'readonly')
})

function trustedCommand (command) {
  const text = String(command)
  if (text.startsWith('/')) return text
  return text.replace(/^([A-Za-z0-9_-]+)/, '/usr/bin/$1')
}

test('git readonly classification accepts only query subcommands and side-effect-free options', async () => {
  const { classifyCommand } = await import(classifierUrl)

  for (const command of [
    'git status --short',
    'git log --oneline -5',
    'git show --stat HEAD',
    'git diff --stat',
    'git branch --all',
    'git remote',
    'git remote -v',
    'git remote show origin',
    'git remote -v show -n origin',
    'git remote get-url origin',
    'git remote get-url --push --all origin'
  ]) {
    assert.equal(classifyCommand(trustedCommand(command)).risk, 'readonly', command)
  }

  for (const command of [
    'git diff --output=/tmp/diff.txt',
    'git diff --output /tmp/diff.txt',
    'git log --output=/tmp/log.txt',
    'git show --output /tmp/show.txt HEAD',
    'git diff --ext-diff',
    'git log --textconv',
    'git branch new-branch',
    'git branch -D old-branch',
    'git tag v1.0.0',
    'git remote add origin https://example.test/repo.git',
    'git remote remove origin',
    'git remote rename origin upstream',
    'git remote set-head origin --auto',
    'git remote set-branches origin main',
    'git remote set-url origin https://example.test/repo.git',
    'git remote prune origin',
    'git remote update origin'
  ]) {
    const classification = classifyCommand(trustedCommand(command))
    assert.notEqual(classification.risk, 'readonly', command)
    assert.equal(classification.requiresConfirmation, true, command)
  }
})

test('journal and utility query allowlists reject state-changing option combinations', async () => {
  const { classifyCommand } = await import(classifierUrl)

  for (const command of [
    'journalctl --cursor-file=/tmp/cursor',
    'journalctl --rotate',
    'journalctl --vacuum-time=7d',
    'journalctl --vacuum-size=100M',
    'journalctl --vacuum-files=2',
    'journalctl --flush',
    'journalctl --sync',
    'journalctl --relinquish-var',
    'journalctl --smart-relinquish-var',
    'journalctl --update-catalog',
    'less -o /tmp/less.log README.md',
    'less -O/tmp/less.log README.md',
    'less --log-file=/tmp/less.log README.md',
    'less --log=/tmp/less.log README.md',
    "less '+!touch /tmp/less-owned' README.md",
    'firewall-cmd --state --add-port=443/tcp',
    'firewall-cmd --list-all --remove-service=ssh',
    'ufw status enable',
    'ss -K dst 10.0.0.8',
    'find /tmp -delete',
    'find /tmp -exec touch /tmp/created {} \\;'
  ]) {
    const classification = classifyCommand(trustedCommand(command))
    assert.notEqual(classification.risk, 'readonly', command)
    assert.equal(classification.requiresConfirmation, true, command)
  }

  for (const command of [
    'journalctl --since today --no-pager',
    'less README.md',
    'firewall-cmd --state',
    'firewall-cmd --zone=public --list-all',
    'firewall-cmd --zone public --query-port 443/tcp',
    'ufw status verbose',
    'ss -ltn',
    'find /tmp -name "*.log"'
  ]) {
    assert.equal(classifyCommand(trustedCommand(command)).risk, 'readonly', command)
  }
})

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
