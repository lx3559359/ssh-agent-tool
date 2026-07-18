const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadModule () {
  const url = pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/common/recovery/client-recovery-state.js'
  ))
  url.search = `test=${Date.now()}-${Math.random()}`
  return import(url)
}

test('renderer recovery state keeps only disconnected tab shells and task summaries', async () => {
  const { serializeClientRecoveryState } = await loadModule()
  const snapshot = serializeClientRecoveryState({
    layout: 'c2',
    activeTabId: 'tab-1',
    tabs: [{
      id: 'tab-1',
      type: 'ssh',
      srcId: 'bookmark-1',
      title: '生产服务器 password=do-not-store',
      host: '10.0.0.8',
      port: 2222,
      username: 'ops',
      password: 'secret-password',
      privateKey: 'secret-key',
      terminalOutput: 'root shell output',
      command: 'cat /etc/shadow',
      attachments: [{ path: 'C:\\Users\\demo\\secret.txt' }],
      batch: 1,
      pane: 'terminal',
      status: 'success'
    }],
    aiChatHistory: [{
      id: 'ai-1',
      mode: 'agent',
      completionStatus: 'running',
      prompt: 'read API key sk-secret-value'
    }],
    fileTransfers: [{ id: 'sftp-1', status: 'running', path: '/root/private.log' }],
    upgradeInfo: { downloading: true, installerPath: 'C:\\Users\\demo\\update.exe' }
  }, {
    now: () => Date.parse('2026-07-18T02:00:00.000Z')
  })

  assert.equal(snapshot.tabs[0].connectionState, 'disconnected')
  assert.equal(snapshot.tabs[0].recoveryPending, true)
  assert.equal(snapshot.pendingTasks.length, 3)
  assert.deepEqual(snapshot.pendingTasks.map(item => item.type).sort(), [
    'agent', 'sftp', 'update'
  ])
  const json = JSON.stringify(snapshot)
  assert.doesNotMatch(json, /secret-password|secret-key|root shell output|cat \/etc\/shadow/)
  assert.doesNotMatch(json, /sk-secret-value|private\.log|update\.exe/)
  assert.doesNotMatch(json, /password|privateKey|terminalOutput|attachments|command|prompt/i)
})

test('recovery plan validation rejects executable and oversized input', async () => {
  const { buildClientRecoveryPlan } = await loadModule()
  const plan = buildClientRecoveryPlan({
    abnormalExit: true,
    reason: 'renderer-crashed',
    clientState: {
      layout: 'not-a-layout',
      activeTabId: 'tab-1',
      tabs: Array.from({ length: 40 }, (_, index) => ({
        id: `tab-${index}`,
        type: index === 0 ? 'ssh' : 'unsupported',
        title: 'x'.repeat(500),
        host: 'example.internal',
        port: 22,
        command: 'dangerous',
        batch: 99
      })),
      pendingTasks: Array.from({ length: 80 }, (_, index) => ({
        id: `task-${index}`,
        type: 'agent',
        status: 'running',
        title: 'task'
      }))
    }
  })

  assert.equal(plan.layout, 'c1')
  assert.equal(plan.tabs.length, 1)
  assert.equal(plan.tabs[0].batch, 0)
  assert.equal(plan.tabs[0].title.length <= 120, true)
  assert.equal(plan.pendingTasks.length, 50)
  assert.equal(plan.pendingTasks.every(item => item.status === 'interrupted'), true)
  assert.doesNotMatch(JSON.stringify(plan), /dangerous/)
})

test('recovered tabs remain dormant until the user explicitly reconnects', async () => {
  const { createRecoveredTabs } = await loadModule()
  const tabs = createRecoveredTabs({
    tabs: [{
      id: 'tab-1',
      type: 'ssh',
      srcId: 'bookmark-1',
      title: '生产服务器',
      host: '10.0.0.8',
      port: 22,
      username: 'ops',
      batch: 0,
      pane: 'terminal'
    }]
  })

  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].status, 'error')
  assert.equal(tabs[0].recoveryPending, true)
  assert.equal(tabs[0].autoReConnect, 0)
  assert.equal(tabs[0].password, undefined)
  assert.equal(tabs[0].privateKey, undefined)
  assert.equal(tabs[0].runScripts, undefined)
})
